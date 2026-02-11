import iconv from 'iconv-lite'
import { Buffer } from '@std/io/buffer'

export enum Alignment {
	Left,
	Center,
	Right,
}

export interface PrinterState {
	alignment: Alignment
	charSize: number
	leftMargin: number
	printAreaWidth: number
}

export interface EscPosText {
	type: 'text'
	content: string
}

export interface EscPosCommand {
	type: 'command'
	name: string
	details?: { [key: string]: unknown }
}

export interface EscPosImage {
	type: 'image'
	width: number
	height: number
	data: number[]
}

export type ParsedEscPosBlock = EscPosText | EscPosCommand | EscPosImage

export interface ParsedCommandResult {
	data: ParsedEscPosBlock | null
	consumedBytes: number
}

export function parseEscPos(
	command: Uint8Array,
	state: PrinterState,
): ParsedCommandResult {
	let parsedBlock: ParsedEscPosBlock | null = null
	let consumedBytes = 0
	let textBuffer: number[] = []

	if (command.length === 0) {
		return { data: null, consumedBytes: 0 }
	}

	const createTextBlock = (): EscPosText | null => {
		if (textBuffer.length > 0) {
			const content = iconv.decode(new Uint8Array(textBuffer), 'CP852')
			textBuffer = []
			return { type: 'text', content: content }
		}
		return null
	}

	const firstByte = command[0]

	if (firstByte !== 0x0a && firstByte !== 0x1b && firstByte !== 0x1d && firstByte !== 0x10 && firstByte !== 0x12) {
		let currentTextIndex = 0
		while (currentTextIndex < command.length) {
			const currentByte = command[currentTextIndex]
			if (
				currentByte === 0x0a || currentByte === 0x1b || currentByte === 0x1d || currentByte === 0x10 || currentByte === 0x12
			) {
				break
			}
			textBuffer.push(currentByte)
			currentTextIndex++
		}

		if (textBuffer.length > 0) {
			parsedBlock = createTextBlock()
			consumedBytes = currentTextIndex
			return { data: parsedBlock, consumedBytes: consumedBytes }
		}
		return { data: null, consumedBytes: 0 }
	}

	switch (firstByte) {
		case 0x0a: // LF
			parsedBlock = { type: 'text', content: '\n' }
			consumedBytes = 1
			break
		case 0x10: // DLE (Data Link Escape) - often used for printer commands
			// For now, treat as a generic command to consume it and prevent it from appearing as text
			parsedBlock = { type: 'command', name: 'Unknown DLE Command' };
			consumedBytes = 1;
			break;
		case 0x12: // DC2 (Device Control 2) - often used for printer commands (e.g., set character size)
			// For now, treat as a generic command to consume it and prevent it from appearing as text
			parsedBlock = { type: 'command', name: 'Unknown DC2 Command' };
			consumedBytes = 1;
			break;
		case 0x1b: // ESC
			if (command.length >= 2) {
				const nextByte = command[1]
				switch (nextByte) {
					case 0x40: // @ - Initialize Printer
						state.alignment = Alignment.Left
						state.charSize = 0
						state.leftMargin = 0
						state.printAreaWidth = 0
						parsedBlock = { type: 'command', name: 'Initialize Printer' }
						consumedBytes = 2
						break
					case 0x61: // a - Set Alignment
						if (command.length >= 3) {
							const alignmentByte = command[2]
							let alignment: Alignment
							let alignmentName: string
							if (alignmentByte === 0 || alignmentByte === 48) {
								alignment = Alignment.Left
								alignmentName = 'Left'
							} else if (alignmentByte === 1 || alignmentByte === 49) {
								alignment = Alignment.Center
								alignmentName = 'Center'
							} else if (alignmentByte === 2 || alignmentByte === 50) {
								alignment = Alignment.Right
								alignmentName = 'Right'
							} else {
								parsedBlock = {
									type: 'command',
									name: 'Set Alignment (unknown)',
									details: { byte: alignmentByte },
								}
								consumedBytes = 3
								break
							}
							state.alignment = alignment
							parsedBlock = {
								type: 'command',
								name: 'Set Alignment',
								details: { alignment: alignmentName },
							}
							consumedBytes = 3
						} else {
							return { data: null, consumedBytes: 0 }
						}
						break
					case 0x21: // ! - Set Font Size/Style
						if (command.length >= 3) {
							const fontByte = command[2]
							parsedBlock = {
								type: 'command',
								name: 'Set Font',
								details: { byte: fontByte },
							}
							consumedBytes = 3
						} else {
							return { data: null, consumedBytes: 0 }
						}
						break
					case 0x69: // i - Full cut (common implementation for some printers)
						parsedBlock = {
							type: 'command',
							name: 'Cut Paper',
							details: { command: 'ESC i', cutType: 'Full' },
						}
						consumedBytes = 2
						break
					default:
						parsedBlock = {
							type: 'command',
							name: 'Unknown ESC Command',
							details: { byte: nextByte },
						}
						consumedBytes = 2
						break
				}
			} else {
				return { data: null, consumedBytes: 0 }
			}
			break
		case 0x1d: // GS
			if (command.length >= 2) {
				const nextByte = command[1]
				switch (nextByte) {
					case 0x21: // ! - Set Character Size
						if (command.length >= 3) {
							state.charSize = command[2]
							parsedBlock = {
								type: 'command',
								name: 'Set Char Size',
								details: { size: state.charSize },
							}
							consumedBytes = 3
						} else {
							return { data: null, consumedBytes: 0 }
						}
						break
					case 0x4c: // L - Set Left Margin
						if (command.length >= 4) {
							state.leftMargin = command[2] + command[3] * 256
							parsedBlock = {
								type: 'command',
								name: 'Set Left Margin',
								details: { margin: state.leftMargin },
							}
							consumedBytes = 4
						} else {
							return { data: null, consumedBytes: 0 }
						}
						break
					case 0x56: // V - Cut Paper (GS V n)
						if (command.length >= 3) {
							const cutTypeByte = command[2]
							let cutType = 'Full';
							if (cutTypeByte === 0x01 || cutTypeByte === 0x31) {
								cutType = 'Partial';
							} else if (cutTypeByte === 0x00 || cutTypeByte === 0x30) {
								cutType = 'Full';
							}
							parsedBlock = { type: 'command', name: 'Cut Paper', details: { command: 'GS V n', cutType: cutType } }
							consumedBytes = 3
						} else {
							parsedBlock = { type: 'command', name: 'Cut Paper', details: { command: 'GS V', cutType: 'Full' } }
							consumedBytes = 2
						}
						break
					case 0x76: // v - Print Raster Bit Image (GS v 0)
						if (command.length >= 3 && command[2] === 0x30) {
							if (command.length >= 8) {
								const xL = command[4]
								const xH = command[5]
								const yL = command[6]
								const yH = command[7]
								const rawWidth = xL + xH * 256
								const height = yL + yH * 256

								const expectedImageDataSize = rawWidth * height

								if (8 + expectedImageDataSize <= command.length) {
									const imageData = command.subarray(
										8,
										8 + expectedImageDataSize,
									)
									parsedBlock = {
										type: 'image',
										width: rawWidth * 8,
										height: height,
										data: Array.from(imageData),
									}
									consumedBytes = 8 + expectedImageDataSize
								} else {
									return { data: null, consumedBytes: 0 }
								}
							} else {
								return { data: null, consumedBytes: 0 }
							}
						} else {
							parsedBlock = {
								type: 'command',
								name: 'Unknown GS v Command',
								details: { byte: command[2] },
							}
							consumedBytes = 3
						}
						break
					case 0x57: // W - Set Print Area Width
						if (command.length >= 4) {
							state.printAreaWidth = command[2] + command[3] * 256
							parsedBlock = {
								type: 'command',
								name: 'Set Print Area Width',
								details: { width: state.printAreaWidth },
							}
							consumedBytes = 4
						} else {
							return { data: null, consumedBytes: 0 }
						}
						break
					default:
						parsedBlock = {
							type: 'command',
							name: 'Unknown GS Command',
							details: { byte: nextByte },
						}
						consumedBytes = 2
						break
				}
			} else {
				return { data: null, consumedBytes: 0 }
			}
			break
	}

	return { data: parsedBlock, consumedBytes: consumedBytes }
}

/**
 * A Transformer that parses incoming Uint8Array chunks of ESC/POS commands
 * into structured EscPosBlock objects.
 */
export class EscPosTransformer implements Transformer<Uint8Array, ParsedEscPosBlock> {
  #accumulatedBuffer: Buffer;
  #printerState: PrinterState;

  constructor() {
    this.#accumulatedBuffer = new Buffer();
    this.#printerState = {
      alignment: Alignment.Left,
      charSize: 0,
      leftMargin: 0,
      printAreaWidth: 0,
    };
  }

  transform(
    chunk: Uint8Array,
    controller: TransformStreamDefaultController<ParsedEscPosBlock>,
  ) {
    // Write newly read data to the accumulated buffer
    this.#accumulatedBuffer.writeSync(chunk);

    while (true) {
      const parsedResult = parseEscPos(
        this.#accumulatedBuffer.bytes(),
        this.#printerState,
      );

      if (parsedResult.consumedBytes > 0) {
        if (parsedResult.data) {
          controller.enqueue(parsedResult.data);
        }
        // Remove consumed bytes from the accumulated buffer
        const remainingBytes = this.#accumulatedBuffer.bytes().subarray(
          parsedResult.consumedBytes,
        );
        this.#accumulatedBuffer = new Buffer(remainingBytes);
      } else {
        // No complete command parsed, wait for more data
        break;
      }
    }
  }

  // The flush method is called when the input stream is closed.
  // It allows processing any remaining buffered data.
  flush(controller: TransformStreamDefaultController<ParsedEscPosBlock>) {
    // Attempt to parse any remaining data in the buffer
    while (this.#accumulatedBuffer.length > 0) {
      const parsedResult = parseEscPos(
        this.#accumulatedBuffer.bytes(),
        this.#printerState,
      );

      if (parsedResult.consumedBytes > 0) {
        if (parsedResult.data) {
          controller.enqueue(parsedResult.data);
        }
        const remainingBytes = this.#accumulatedBuffer.bytes().subarray(
          parsedResult.consumedBytes,
        );
        this.#accumulatedBuffer = new Buffer(remainingBytes);
      } else {
        // If there's still unparsed data, but parseEscPos couldn't make progress,
        // it means there's an incomplete command at the end of the stream.
        // We could choose to error here, or emit a special 'partial' event.
        // For now, we'll just stop trying to parse.
        if (this.#accumulatedBuffer.length > 0) {
          console.warn(
            `Incomplete ESC/POS command(s) at end of stream. Remaining bytes: ${this.#accumulatedBuffer.length}`,
          );
        }
        break;
      }
    }
  }
}