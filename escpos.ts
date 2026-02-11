import iconv from 'iconv-lite'
import { Buffer } from '@std/io/buffer'
import { EscPosTransformer } from './escpos-transform.ts'

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

// New interfaces for structured parsed blocks
export interface EscPosText {
	type: 'text'
	content: string
}

export interface EscPosCommand {
	type: 'command'
	name: string // e.g., 'Initialize Printer', 'Set Alignment', 'Cut Paper'
	details?: { [key: string]: any } // object for specific command parameters
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

	// If the buffer is empty, no command can be parsed.
	if (command.length === 0) {
		return { data: null, consumedBytes: 0 }
	}

	// Helper to create a text block if there's accumulated text
	const createTextBlock = (): EscPosText | null => {
		if (textBuffer.length > 0) {
			const content = iconv.decode(new Uint8Array(textBuffer), 'CP852')
			textBuffer = [] // Clear buffer after processing
			return { type: 'text', content: content }
		}
		return null
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
			parsedBlock = createTextBlock()
			consumedBytes = currentTextIndex
			return { data: parsedBlock, consumedBytes: consumedBytes }
		}
		// If no text was accumulated (e.g., buffer started with only control characters not caught by outer if)
		return { data: null, consumedBytes: 0 }
	}

	// If it's not text, then it must be a control character
	switch (firstByte) {
		case 0x0a: // LF
			parsedBlock = { type: 'text', content: '\n' }
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
								// Unknown alignment value, treat as generic command
								parsedBlock = {
									type: 'command',
									name: 'Set Alignment (unknown)',
									details: { byte: alignmentByte },
								}
								consumedBytes = 3
								break
							}
							state.alignment = alignment // Update printer state
							parsedBlock = {
								type: 'command',
								name: 'Set Alignment',
								details: { alignment: alignmentName },
							}
							consumedBytes = 3
						} else {
							return { data: null, consumedBytes: 0 } // Incomplete command
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
							return { data: null, consumedBytes: 0 } // Incomplete command
						}
						break
					default:
						// Unknown ESC command
						parsedBlock = {
							type: 'command',
							name: 'Unknown ESC Command',
							details: { byte: nextByte },
						}
						consumedBytes = 2
						break
				}
			} else {
				return { data: null, consumedBytes: 0 } // Incomplete command
			}
			break
		case 0x1d: // GS
			if (command.length >= 2) {
				const nextByte = command[1]
				switch (nextByte) {
					case 0x21: // ! - Set Character Size
						if (command.length >= 3) {
							state.charSize = command[2] // Update printer state
							parsedBlock = {
								type: 'command',
								name: 'Set Char Size',
								details: { size: state.charSize },
							}
							consumedBytes = 3
						} else {
							return { data: null, consumedBytes: 0 } // Incomplete command
						}
						break
					case 0x4c: // L - Set Left Margin
						if (command.length >= 4) {
							state.leftMargin = command[2] + command[3] * 256 // Update printer state
							parsedBlock = {
								type: 'command',
								name: 'Set Left Margin',
								details: { margin: state.leftMargin },
							}
							consumedBytes = 4
						} else {
							return { data: null, consumedBytes: 0 } // Incomplete command
						}
						break
					case 0x56: // V - Cut Paper
						parsedBlock = { type: 'command', name: 'Cut Paper' }
						consumedBytes = 2
						break
					case 0x76: // v - Print Raster Bit Image (GS v 0)
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

								// The spec usually defines width in bytes, so actual pixel width is rawWidth * 8
								const expectedImageDataSize = rawWidth * height

								// Check if the full image data is present
								if (8 + expectedImageDataSize <= command.length) {
									const imageData = command.subarray(
										8,
										8 + expectedImageDataSize,
									)
									parsedBlock = {
										type: 'image',
										width: rawWidth * 8, // Corrected pixel width for frontend
										height: height,
										data: Array.from(imageData),
									}
									consumedBytes = 8 + expectedImageDataSize
								} else {
									return { data: null, consumedBytes: 0 } // Incomplete image data
								}
							} else {
								return { data: null, consumedBytes: 0 } // Incomplete image header
							}
						} else {
							// Not a 'GS v 0' command or malformed 'GS v'
							parsedBlock = {
								type: 'command',
								name: 'Unknown GS v Command',
								details: { byte: command[2] },
							}
							consumedBytes = 3 // Consume GS v 0 byte
						}
						break
					case 0x57: // W - Set Print Area Width
						if (command.length >= 4) {
							state.printAreaWidth = command[2] + command[3] * 256 // Update printer state
							parsedBlock = {
								type: 'command',
								name: 'Set Print Area Width',
								details: { width: state.printAreaWidth },
							}
							consumedBytes = 4
						} else {
							return { data: null, consumedBytes: 0 } // Incomplete command
						}
						break
					default:
						// Unknown GS command
						parsedBlock = {
							type: 'command',
							name: 'Unknown GS Command',
							details: { byte: nextByte },
						}
						consumedBytes = 2
						break
				}
			} else {
				return { data: null, consumedBytes: 0 } // Incomplete command
			}
			break
	}

	return { data: parsedBlock, consumedBytes: consumedBytes }
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

	// Create an instance of the TransformStream
	const escPosTransformer = new TransformStream(new EscPosTransformer())

	try {
		// Pipe the incoming connection stream through the ESC/POS transformer
		const parsedBlocks = conn.readable.pipeThrough(escPosTransformer)

		for await (const block of parsedBlocks) {
			const dataToSend = JSON.stringify(block)
			for (const client of connectedClients) {
				client.send(dataToSend)
			}
		}
	} catch (error) {
		console.error('Error in handling connection or parsing stream:', error)
	} finally {
		console.log(`Connection from ${remoteAddrString} closed.`)
	}
}
