import iconv from 'iconv-lite'
import { Buffer } from '@std/io/buffer'
import { Image } from 'imagescript'
import { encodeBase64 } from '@std/encoding/base64'

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
	emphasized: boolean
	underline: number
	reversePrinting: boolean
}

export interface EscPosText {
	type: 'text'
	content: string
	alignment: Alignment
	emphasized: boolean
	underline: number
	charSize: number
	reversePrinting: boolean
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
	base64: string // Changed from data: number[]
}

export type ParsedEscPosBlock = EscPosText | EscPosCommand | EscPosImage

export interface ParsedCommandResult {
	data: ParsedEscPosBlock | null
	consumedBytes: number
}

// Helper function to convert 1-bit per pixel image data to RGBA
function convert1BitToRgba(
	oneBitData: Uint8Array,
	rawWidth: number, // width in bytes
	height: number,
): Uint8ClampedArray {
	const width = rawWidth * 8 // actual pixel width
	const rgbaData = new Uint8ClampedArray(width * height * 4) // 4 bytes per pixel (RGBA)

	let oneBitDataIndex = 0
	for (let y = 0; y < height; y++) {
		for (let xByte = 0; xByte < rawWidth; xByte++) {
			const byte = oneBitData[oneBitDataIndex++]
			for (let bit = 0; bit < 8; bit++) {
				const x = xByte * 8 + bit
				if (x >= width) {
					continue
				}

				const rgbaIndex = (y * width + x) * 4
				const isBlack = (byte >> (7 - bit)) & 0x01 // Read bit from MSB to LSB

				// Monochrome: Black for 1, White for 0 (inverted for typical display)
				const color = isBlack ? 0 : 255

				rgbaData[rgbaIndex] = color // R
				rgbaData[rgbaIndex + 1] = color // G
				rgbaData[rgbaIndex + 2] = color // B
				rgbaData[rgbaIndex + 3] = 255 // A (fully opaque)
			}
		}
	}
	return rgbaData
}

export async function parseEscPos(
	command: Uint8Array,
	state: PrinterState,
): Promise<ParsedCommandResult> {
	let parsedBlock: ParsedEscPosBlock | null = null
	let consumedBytes = 0
	let textBuffer: number[] = []

	if (command.length === 0) {
		return { data: null, consumedBytes: 0 }
	}

	const createTextBlock = (state: PrinterState): EscPosText | null => {
		if (textBuffer.length > 0) {
			const content = iconv.decode(new Uint8Array(textBuffer), 'CP852')
			textBuffer = []
			return {
				type: 'text',
				content: content,
				alignment: state.alignment,
				emphasized: state.emphasized,
				underline: state.underline,
				charSize: state.charSize,
				reversePrinting: state.reversePrinting,
			}
		}
		return null
	}

	const firstByte = command[0]

	if (
		firstByte !== 0x0a && firstByte !== 0x1b && firstByte !== 0x1d &&
		firstByte !== 0x1c
	) {
		let currentTextIndex = 0
		while (currentTextIndex < command.length) {
			const currentByte = command[currentTextIndex]
			if (
				currentByte === 0x0a || currentByte === 0x1b || currentByte === 0x1d ||
				currentByte === 0x1c
			) {
				break
			}
			textBuffer.push(currentByte)
			currentTextIndex++
		}

		if (textBuffer.length > 0) {
			parsedBlock = createTextBlock(state)
			consumedBytes = currentTextIndex
			return { data: parsedBlock, consumedBytes: consumedBytes }
		}
		return { data: null, consumedBytes: 0 }
	}

	switch (firstByte) {
		case 0x0a: // LF
			parsedBlock = {
				type: 'text',
				content: '\n',
				alignment: state.alignment,
				emphasized: state.emphasized,
				underline: state.underline,
				charSize: state.charSize,
				reversePrinting: state.reversePrinting,
			}
			consumedBytes = 1
			break
		case 0x1b: // ESC
			if (command.length >= 2) {
				const nextByte = command[1]
				switch (nextByte) {
					case 0x40: // @ - Initialize Printer
						state.alignment = Alignment.Left
						state.charSize = 0
						state.leftMargin = 0
						state.printAreaWidth = 0
						state.emphasized = false
						state.underline = 0
						state.reversePrinting = false
						parsedBlock = { type: 'command', name: 'Initialize Printer' }
						consumedBytes = 2
						break
					case 0x42: // B - Set Print Density
						if (command.length >= 3) {
							const density = command[2]
							parsedBlock = {
								type: 'command',
								name: 'Set Print Density',
								details: { density },
							}
							consumedBytes = 3
						} else {
							return { data: null, consumedBytes: 0 }
						}
						break
					case 0x45: // E - Set emphasized mode
						if (command.length >= 3) {
							const emphasized = command[2] !== 0
							state.emphasized = emphasized
							parsedBlock = {
								type: 'command',
								name: 'Set Emphasized Mode',
								details: { emphasized },
							}
							consumedBytes = 3
						} else {
							return { data: null, consumedBytes: 0 }
						}
						break
					case 0x2d: // - - Set underline mode
						if (command.length >= 3) {
							const underline = command[2]
							state.underline = underline
							parsedBlock = {
								type: 'command',
								name: 'Set Underline Mode',
								details: { underline },
							}
							consumedBytes = 3
						} else {
							return { data: null, consumedBytes: 0 }
						}
						break
					case 0x4d: // M - Select character font
						if (command.length >= 3) {
							const font = command[2]
							parsedBlock = {
								type: 'command',
								name: 'Select Character Font',
								details: { font },
							}
							consumedBytes = 3
						} else {
							return { data: null, consumedBytes: 0 }
						}
						break
					case 0x20: // SP - Set right-side character spacing
						if (command.length >= 3) {
							const spacing = command[2]
							parsedBlock = {
								type: 'command',
								name: 'Set Right-Side Character Spacing',
								details: { spacing },
							}
							consumedBytes = 3
						} else {
							return { data: null, consumedBytes: 0 }
						}
						break
					case 0x24: // $ - Set absolute print position
						if (command.length >= 4) {
							const nL = command[2]
							const nH = command[3]
							const position = nL + nH * 256
							parsedBlock = {
								type: 'command',
								name: 'Set Absolute Print Position',
								details: { position },
							}
							consumedBytes = 4
						} else {
							return { data: null, consumedBytes: 0 }
						}
						break
					case 0x70: // p - Generate pulse (Open/close cash drawer)
						if (command.length >= 5) {
							const m = command[2]
							const t1 = command[3]
							const t2 = command[4]
							parsedBlock = {
								type: 'command',
								name: 'Generate Pulse',
								details: { mode: m, t1: t1, t2: t2 },
							}
							consumedBytes = 5
						} else {
							return { data: null, consumedBytes: 0 }
						}
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
					case 0x4a: // J - Print and feed paper
						if (command.length >= 3) {
							const n = command[2]
							parsedBlock = {
								type: 'command',
								name: 'Print and Feed Paper',
								details: { feed: n },
							}
							consumedBytes = 3
						} else {
							return { data: null, consumedBytes: 0 }
						}
						break
					case 0x74: // t - Select character code table
						if (command.length >= 3) {
							const n = command[2]
							parsedBlock = {
								type: 'command',
								name: 'Select Character Code Table',
								details: { table: n },
							}
							consumedBytes = 3
						} else {
							return { data: null, consumedBytes: 0 }
						}
						break
					case 0x2a: // * - Bit image
						if (command.length >= 5) { // ESC * m nL nH
							const m = command[2]
							const nL = command[3]
							const nH = command[4]
							const widthDots = nL + nH * 256

							let bytesPerSlice = 1
							if (m === 32 || m === 33) { // 24-dot
								bytesPerSlice = 3
							}

							const expectedDataSize = widthDots * bytesPerSlice

							if (command.length >= 5 + expectedDataSize) {
								// Just consume the command for now, don't render.
								parsedBlock = {
									type: 'command',
									name: 'Bit Image (ESC *)',
									details: { m: m, width: widthDots },
								}
								consumedBytes = 5 + expectedDataSize
							} else {
								return { data: null, consumedBytes: 0 } // Not enough data
							}
						} else {
							return { data: null, consumedBytes: 0 } // Not enough header
						}
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
							let cutType = 'Full'
							if (cutTypeByte === 0x01 || cutTypeByte === 0x31) {
								cutType = 'Partial'
							} else if (cutTypeByte === 0x00 || cutTypeByte === 0x30) {
								cutType = 'Full'
							}
							parsedBlock = {
								type: 'command',
								name: 'Cut Paper',
								details: { command: 'GS V n', cutType: cutType },
							}
							consumedBytes = 3
						} else {
							parsedBlock = {
								type: 'command',
								name: 'Cut Paper',
								details: { command: 'GS V', cutType: 'Full' },
							}
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
									const oneBitImageData = command.subarray(
										8,
										8 + expectedImageDataSize,
									)
									const rgbaData = convert1BitToRgba(
										oneBitImageData,
										rawWidth,
										height,
									)
									const pixelWidth = rawWidth * 8
									const image = new Image(pixelWidth, height)
									image.bitmap = rgbaData
									const pngBuffer = await image.encode()
									const base64 = encodeBase64(pngBuffer)

									parsedBlock = {
										type: 'image',
										width: pixelWidth,
										height: height,
										base64: `data:image/png;base64,${base64}`,
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
					case 0x42: // B - Turn white/black reverse printing on/off
						if (command.length >= 3) {
							const reverse = command[2] !== 0
							state.reversePrinting = reverse
							parsedBlock = {
								type: 'command',
								name: 'Set Reverse Printing',
								details: { reverse },
							}
							consumedBytes = 3
						} else {
							return { data: null, consumedBytes: 0 }
						}
						break
					case 0x68: // h - Set barcode height
						if (command.length >= 3) {
							const height = command[2]
							parsedBlock = {
								type: 'command',
								name: 'Set Barcode Height',
								details: { height },
							}
							consumedBytes = 3
						} else {
							return { data: null, consumedBytes: 0 }
						}
						break
					case 0x6b: // k - Print barcode
						if (command.length >= 3) {
							const barcodeType = command[2]
							let barcodeData = ''
							let i = 3
							while (i < command.length && command[i] !== 0x00) {
								barcodeData += String.fromCharCode(command[i])
								i++
							}
							parsedBlock = {
								type: 'command',
								name: 'Print Barcode',
								details: {
									barcodeType,
									barcodeData,
								},
							}
							consumedBytes = i + 1
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
		case 0x1c: // FS
			if (command.length >= 2) {
				const nextByte = command[1]
				switch (nextByte) {
					case 0x2e: // . - Cancel Chinese character mode
						parsedBlock = {
							type: 'command',
							name: 'Cancel Chinese Character Mode',
						}
						consumedBytes = 2
						break
					default:
						parsedBlock = {
							type: 'command',
							name: 'Unknown FS Command',
							details: { byte: nextByte },
						}
						consumedBytes = 2 // Assume 2 bytes for now
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
export class EscPosTransformer
	implements Transformer<Uint8Array, ParsedEscPosBlock> {
	#accumulatedBuffer: Buffer
	#printerState: PrinterState

	constructor() {
		this.#accumulatedBuffer = new Buffer()
		this.#printerState = {
			alignment: Alignment.Left,
			charSize: 0,
			leftMargin: 0,
			printAreaWidth: 0,
			emphasized: false,
			underline: 0,
			reversePrinting: false,
		}
	}

	async transform(
		chunk: Uint8Array,
		controller: TransformStreamDefaultController<ParsedEscPosBlock>,
	) {
		// Write newly read data to the accumulated buffer
		this.#accumulatedBuffer.writeSync(chunk)

		while (true) {
			const parsedResult = await parseEscPos(
				this.#accumulatedBuffer.bytes(),
				this.#printerState,
			)

			if (parsedResult.consumedBytes > 0) {
				if (parsedResult.data) {
					controller.enqueue(parsedResult.data)
				}
				// Remove consumed bytes from the accumulated buffer
				const remainingBytes = this.#accumulatedBuffer.bytes().subarray(
					parsedResult.consumedBytes,
				)
				this.#accumulatedBuffer = new Buffer(remainingBytes)
			} else {
				// No complete command parsed, wait for more data
				break
			}
		}
	}

	// The flush method is called when the input stream is closed.
	// It allows processing any remaining buffered data.
	async flush(controller: TransformStreamDefaultController<ParsedEscPosBlock>) {
		// Attempt to parse any remaining data in the buffer
		while (this.#accumulatedBuffer.length > 0) {
			const parsedResult = await parseEscPos(
				this.#accumulatedBuffer.bytes(),
				this.#printerState,
			)

			if (parsedResult.consumedBytes > 0) {
				if (parsedResult.data) {
					controller.enqueue(parsedResult.data)
				}
				const remainingBytes = this.#accumulatedBuffer.bytes().subarray(
					parsedResult.consumedBytes,
				)
				this.#accumulatedBuffer = new Buffer(remainingBytes)
			} else {
				// If there's still unparsed data, but parseEscPos couldn't make progress,
				// it means there's an incomplete command at the end of the stream.
				// We could choose to error here, or emit a special 'partial' event.
				// For now, we'll just stop trying to parse.
				if (this.#accumulatedBuffer.length > 0) {
					console.warn(
						`Incomplete ESC/POS command(s) at end of stream. Remaining bytes: ${this.#accumulatedBuffer.length}`,
					)
				}
				break
			}
		}
	}
}
