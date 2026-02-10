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

export interface ParsedCommandResult {
	data: string | object | null
	consumedBytes: number
}

export function parseEscPos(
	command: Uint8Array,
	state: PrinterState,
): ParsedCommandResult {
	let result: string | object | null = null
	let consumedBytes = 0
	let textBuffer: number[] = []

	const appendText = () => {
		if (textBuffer.length > 0) {
			result = (typeof result === 'string' ? result : '') +
				iconv.decode(new Uint8Array(textBuffer), 'CP852')
			textBuffer = []
		}
	}

	// If the buffer is empty, no command can be parsed.
	if (command.length === 0) {
		return { data: null, consumedBytes: 0 }
	}

	// Always parse from the beginning of the `command` buffer (index 0)
	const firstByte = command[0]

	// Check for text first - if the first byte is not a control character
	if (firstByte !== 0x0a && firstByte !== 0x1b && firstByte !== 0x1d) {
		let currentTextIndex = 0
		while (currentTextIndex < command.length) {
			const currentByte = command[currentTextIndex]
			// Stop if a control character or LF is encountered
			if (
				currentByte === 0x0a || currentByte === 0x1b || currentByte === 0x1d
			) {
				break
			}
			textBuffer.push(currentByte)
			currentTextIndex++
		}

		if (textBuffer.length > 0) {
			appendText() // Process the accumulated text
			consumedBytes = currentTextIndex
			return { data: result, consumedBytes: consumedBytes }
		}
		// If no text was accumulated (e.g., buffer started with only control characters not caught by outer if)
		// This should theoretically not be reached if firstByte check works.
		return { data: null, consumedBytes: 0 }
	}

	// If it's not text, then it must be a control character
	switch (firstByte) {
		case 0x0a: // LF
			appendText() // Ensure any preceding text is processed
			result = (typeof result === 'string' ? result : '') + '\n'
			consumedBytes = 1
			break
		case 0x1b: // ESC
			appendText() // Ensure any preceding text is processed
			if (command.length >= 2) {
				const nextByte = command[1]
				switch (nextByte) {
					case 0x40: // @
						result = (typeof result === 'string' ? result : '') +
							'[Initialize Printer]\n'
						consumedBytes = 2
						break
					case 0x61: // a
						if (command.length >= 3) {
							const alignment = command[2]
							if (alignment === 0 || alignment === 48) {
								state.alignment = Alignment.Left
								result = (typeof result === 'string' ? result : '') +
									'[Set Alignment: Left]\n'
							} else if (alignment === 1 || alignment === 49) {
								state.alignment = Alignment.Center
								result = (typeof result === 'string' ? result : '') +
									'[Set Alignment: Center]\n'
							} else if (alignment === 2 || alignment === 50) {
								state.alignment = Alignment.Right
								result = (typeof result === 'string' ? result : '') +
									'[Set Alignment: Right]\n'
							}
							consumedBytes = 3
						} else {
							return { data: null, consumedBytes: 0 } // Incomplete command
						}
						break
					case 0x21: // !
						if (command.length >= 3) {
							result = (typeof result === 'string' ? result : '') +
								`[Set Font: 0x${command[2].toString(16)}]\n`
							consumedBytes = 3
						} else {
							return { data: null, consumedBytes: 0 } // Incomplete command
						}
						break
					default:
						result = (typeof result === 'string' ? result : '') +
							`[ESC 0x${nextByte.toString(16)}]`
						consumedBytes = 2
						break
				}
			} else {
				return { data: null, consumedBytes: 0 } // Incomplete command
			}
			break
		case 0x1d: // GS
			appendText() // Ensure any preceding text is processed
			if (command.length >= 2) {
				const nextByte = command[1]
				switch (nextByte) {
					case 0x21: // !
						if (command.length >= 3) {
							state.charSize = command[2]
							result = (typeof result === 'string' ? result : '') +
								`[Set Char Size: ${state.charSize}]\n`
							consumedBytes = 3
						} else {
							return { data: null, consumedBytes: 0 } // Incomplete command
						}
						break
					case 0x4c: // L
						if (command.length >= 4) {
							state.leftMargin = command[2] + command[3] * 256
							result = (typeof result === 'string' ? result : '') +
								`[Set Left Margin: ${state.leftMargin}]\n`
							consumedBytes = 4
						} else {
							return { data: null, consumedBytes: 0 } // Incomplete command
						}
						break
					case 0x56: // V
						result = (typeof result === 'string' ? result : '') +
							'[Cut Paper]\n'
						consumedBytes = 2
						break
					case 0x76: // v
						// Check for 'GS v 0' command
						if (command.length >= 3 && command[2] === 0x30) {
							// Check if the full image header is present (GS v 0 m fn xL xH yL yH)
							if (command.length >= 8) {
								const xL = command[4]
								const xH = command[5]
								const yL = command[6]
								const yH = command[7]
								const rawWidth = xL + xH * 256
								const height = yL + yH * 256

								// Check if the full image data is present
								if (8 + (rawWidth * height) <= command.length) {
									const imageData = command.subarray(8, 8 + (rawWidth * height))
									result = {
										type: 'image',
										width: rawWidth * 8, // Corrected pixel width for frontend
										height: height,
										data: Array.from(imageData),
									}
									consumedBytes = 8 + (rawWidth * height)
								} else {
									return { data: null, consumedBytes: 0 } // Incomplete image data
								}
							} else {
								return { data: null, consumedBytes: 0 } // Incomplete image header
							}
						} else {
							consumedBytes = 2 // Not a 'GS v 0' command, skip 'GS v'
						}
						break
					case 0x57: // W
						if (command.length >= 4) {
							state.printAreaWidth = command[2] + command[3] * 256
							result = (typeof result === 'string' ? result : '') +
								`[Set Print Area Width: ${state.printAreaWidth}]\n`
							consumedBytes = 4
						} else {
							return { data: null, consumedBytes: 0 } // Incomplete command
						}
						break
					default:
						result = (typeof result === 'string' ? result : '') +
							`[GS 0x${nextByte.toString(16)}]`
						consumedBytes = 2
						break
				}
			} else {
				return { data: null, consumedBytes: 0 } // Incomplete command
			}
			break
	}

	// This appendText() is mostly for handling cases where a command is directly followed by text,
	// and the control command processing didn't use appendText() itself.
	// For example, if a `LF` is processed, result already has the `\n`, textBuffer is empty.
	// If an `ESC` command is processed, result is set to `[ESC...]`, textBuffer is empty.
	// This final appendText() acts as a safety net.
	appendText()
	return { data: result, consumedBytes: consumedBytes }
}

export async function handleConnection(
	conn: Deno.Conn, // deno-lint-ignore no-explicit-any
	connectedClients: Set<any>,
) {
	const remoteAddr = conn.remoteAddr
	const remoteAddrString = remoteAddr.transport === 'tcp'
		? `${remoteAddr.hostname}:${remoteAddr.port}`
		: 'unknown'
	console.log(`New connection from ${remoteAddrString}.`)
	const state: PrinterState = {
		alignment: Alignment.Left,
		charSize: 0,
		leftMargin: 0,
		printAreaWidth: 0,
	}
	const readBuffer = new Uint8Array(1024)
	const accumulatedBuffer = new Buffer()

	while (true) {
		try {
			const n = await conn.read(readBuffer)
			if (n === null) {
				break // Connection closed
			}
			// Write newly read data to the accumulated buffer
			accumulatedBuffer.writeSync(readBuffer.subarray(0, n))

			while (true) {
				const parsedResult = parseEscPos(accumulatedBuffer.bytes(), state)

				if (parsedResult.consumedBytes > 0) {
					if (parsedResult.data) {
						const dataToSend = typeof parsedResult.data === 'string'
							? JSON.stringify({ type: 'text', content: parsedResult.data })
							: JSON.stringify(parsedResult.data)
						for (const client of connectedClients) {
							client.send(dataToSend)
						}
					}
					// Remove consumed bytes from the accumulated buffer
					accumulatedBuffer.readSync(new Uint8Array(parsedResult.consumedBytes))
				} else {
					// No complete command parsed, wait for more data
					break
				}
			}
		} catch (error) {
			console.error('Error reading from connection:', error)
			break
		}
	}
	console.log(`Connection from ${remoteAddrString} closed.`)
}
