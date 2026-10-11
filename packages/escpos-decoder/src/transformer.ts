import iconv from 'iconv-lite'
import { PNG } from 'pngjs'
import QRCode from 'qrcode'
import { Alignment, EscPosImage, EscPosText, ParsedEscPosBlock } from './types.js'

export type QrErrorCorrectionLevel = 'L' | 'M' | 'Q' | 'H'

export interface PrinterState {
	alignment: Alignment
	charWidth: number
	charHeight: number
	leftMargin: number
	printAreaWidth: number
	emphasized: boolean
	underline: number
	reversePrinting: boolean
	font: number
	rightSpacing: number
	tabStops: number[]
	lineSpacing: number | null
	qrModel: number
	qrModuleSize: number
	qrErrorCorrection: QrErrorCorrectionLevel
	qrData: string
}

// Character cell widths in dots: Font A is 12 × 24, Font B 9 × 17.
const fontCellWidths = [12, 9]

// Power-on tab stops: every 8 Font A characters, 32 stops, in dots.
export const defaultTabStops = Array.from(
	{ length: 32 },
	(_, i) => (i + 1) * 8 * fontCellWidths[0],
)

// ESC D accepts at most 32 stops before its NUL terminator.
const maxTabStops = 32

function textStyle(state: PrinterState): Omit<EscPosText, 'type' | 'content'> {
	return {
		alignment: state.alignment,
		emphasized: state.emphasized,
		underline: state.underline,
		charWidth: state.charWidth,
		charHeight: state.charHeight,
		reversePrinting: state.reversePrinting,
		font: state.font,
		rightSpacing: state.rightSpacing,
		leftMargin: state.leftMargin,
		printAreaWidth: state.printAreaWidth,
		tabStops: state.tabStops,
		lineSpacing: state.lineSpacing,
	}
}

// Parameter byte counts of fixed-length commands that do not affect the
// rendered output. They are consumed whole, so their parameters do not leak
// into the following text.
const ignoredEscCommands: Record<number, [name: string, params: number]> = {
	0x25: ['Select User-Defined Character Set', 1],
	0x3c: ['Return Home', 0],
	0x3d: ['Select Peripheral Device', 1],
	0x3f: ['Cancel User-Defined Characters', 1],
	0x47: ['Set Double-Strike Mode', 1],
	0x52: ['Select International Character Set', 1],
	0x55: ['Set Unidirectional Printing', 1],
	0x56: ['Set 90° Rotation', 1],
	0x63: ['Select Paper Sensor or Panel Buttons', 2],
	0x65: ['Print and Reverse Feed Lines', 1],
	0x72: ['Select Print Color', 1],
	0x75: ['Transmit Peripheral Device Status', 1],
	0x76: ['Transmit Paper Sensor Status', 0],
	0x7b: ['Set Upside-Down Printing', 1],
}

const ignoredGsCommands: Record<number, [name: string, params: number]> = {
	0x2f: ['Print Downloaded Bit Image', 1],
	0x3a: ['Start or End Macro Definition', 0],
	0x48: ['Select HRI Character Position', 1],
	0x49: ['Transmit Printer ID', 1],
	0x50: ['Set Motion Units', 2],
	0x54: ['Set Print Position to Line Start', 1],
	0x5e: ['Execute Macro', 3],
	0x61: ['Enable Automatic Status Back', 1],
	0x62: ['Set Smoothing Mode', 1],
	0x66: ['Select HRI Font', 1],
	0x67: ['Maintenance Counter', 4],
	0x72: ['Transmit Status', 1],
	0x77: ['Set Barcode Width', 1],
}

const ignoredFsCommands: Record<number, [name: string, params: number]> = {
	0x21: ['Set Kanji Print Mode', 1],
	0x26: ['Select Kanji Character Mode', 0],
	0x2d: ['Set Kanji Underline', 1],
	0x43: ['Select Kanji Code System', 1],
	0x53: ['Set Kanji Spacing', 2],
	0x57: ['Set Kanji Quadruple Size', 1],
	0x70: ['Print NV Bit Image', 2],
}

// DLE DC4 parameter byte counts by function; others take one byte.
const dleDc4Params: Record<number, number> = { 1: 3, 2: 3, 3: 3, 7: 2, 8: 8 }

function signed16(low: number, high: number): number {
	const value = low + high * 256
	return value >= 0x8000 ? value - 0x10000 : value
}

// Printable bytes, plus HT and CR, which renderers handle within text.
function isTextByte(byte: number): boolean {
	return byte >= 0x20 || byte === 0x09 || byte === 0x0d
}

// Consumes a known fixed-length command, or waits until all of it arrived.
function ignoredCommand(
	command: Uint8Array,
	[name, params]: [string, number],
): ParsedCommandResult {
	if (command.length < 2 + params) {
		return { data: null, consumedBytes: 0 }
	}
	return {
		data: { type: 'command', name, details: { params: [...command.subarray(2, 2 + params)] } },
		consumedBytes: 2 + params,
	}
}

// ESC ( and FS ( families: prefix, function byte, pL pH, then pL + pH × 256
// bytes. None of them affect the rendered output.
function lengthPrefixedCommand(
	command: Uint8Array,
	name: string,
): ParsedCommandResult {
	if (command.length < 5) {
		return { data: null, consumedBytes: 0 }
	}
	const total = 5 + command[3] + command[4] * 256
	if (command.length < total) {
		return { data: null, consumedBytes: 0 }
	}
	return {
		data: { type: 'command', name, details: { fn: command[2] } },
		consumedBytes: total,
	}
}

export interface ParsedCommandResult {
	data: ParsedEscPosBlock | null
	consumedBytes: number
}

class AccumulatingBuffer {
	#data: Uint8Array<ArrayBufferLike> = new Uint8Array(0)

	get length(): number {
		return this.#data.length
	}

	writeSync(chunk: Uint8Array): void {
		const merged = new Uint8Array(this.#data.length + chunk.length)
		merged.set(this.#data)
		merged.set(chunk, this.#data.length)
		this.#data = merged
	}

	bytes(): Uint8Array {
		return this.#data
	}

	constructor(initial?: Uint8Array) {
		if (initial) this.#data = initial
	}
}

function convert1BitToRgba(
	oneBitData: Uint8Array,
	rawWidth: number,
	height: number,
): Uint8ClampedArray {
	const width = rawWidth * 8
	const rgbaData = new Uint8ClampedArray(width * height * 4)

	let oneBitDataIndex = 0
	for (let y = 0; y < height; y++) {
		for (let xByte = 0; xByte < rawWidth; xByte++) {
			const byte = oneBitData[oneBitDataIndex++]
			for (let bit = 0; bit < 8; bit++) {
				const x = xByte * 8 + bit
				if (x >= width) continue

				const rgbaIndex = (y * width + x) * 4
				const isBlack = (byte >> (7 - bit)) & 0x01
				const color = isBlack ? 0 : 255

				rgbaData[rgbaIndex] = color
				rgbaData[rgbaIndex + 1] = color
				rgbaData[rgbaIndex + 2] = color
				rgbaData[rgbaIndex + 3] = 255
			}
		}
	}
	return rgbaData
}

async function renderQrAsImage(
	state: PrinterState,
): Promise<ParsedEscPosBlock> {
	if (state.qrData.length === 0) {
		return { type: 'command', name: 'Print QR Code (empty buffer)' }
	}
	const pngBuffer = await QRCode.toBuffer(state.qrData, {
		errorCorrectionLevel: state.qrErrorCorrection,
		scale: Math.max(1, Math.min(16, state.qrModuleSize)),
		margin: 0,
		type: 'png',
	})
	const png = PNG.sync.read(pngBuffer)
	const image: EscPosImage = {
		type: 'image',
		width: png.width,
		height: png.height,
		base64: `data:image/png;base64,${pngBuffer.toString('base64')}`,
	}
	state.qrData = ''
	return image
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
			const content = iconv.decode(Buffer.from(textBuffer), 'CP852')
			textBuffer = []
			return { type: 'text', content: content, ...textStyle(state) }
		}
		return null
	}

	const firstByte = command[0]

	if (isTextByte(firstByte)) {
		let currentTextIndex = 0
		while (currentTextIndex < command.length) {
			const currentByte = command[currentTextIndex]
			if (!isTextByte(currentByte)) {
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
			parsedBlock = { type: 'text', content: '\n', ...textStyle(state) }
			consumedBytes = 1
			break
		case 0x0c: // FF - Print the page and return to standard mode (page mode)
			parsedBlock = { type: 'command', name: 'Form Feed' }
			consumedBytes = 1
			break
		case 0x18: // CAN - Cancel print data in page mode
			parsedBlock = { type: 'command', name: 'Cancel Page Data' }
			consumedBytes = 1
			break
		case 0x10: // DLE - Real-time commands
			if (command.length < 2) {
				return { data: null, consumedBytes: 0 }
			}
			if (command[1] === 0x04 || command[1] === 0x05) { // EOT / ENQ n
				if (command.length < 3) {
					return { data: null, consumedBytes: 0 }
				}
				parsedBlock = {
					type: 'command',
					name: command[1] === 0x04
						? 'Real-Time Status Request'
						: 'Real-Time Request',
					details: { n: command[2] },
				}
				consumedBytes = 3
			} else if (command[1] === 0x14) { // DC4 fn ...
				if (command.length < 3) {
					return { data: null, consumedBytes: 0 }
				}
				const fn = command[2]
				const total = 3 + (dleDc4Params[fn] ?? 1)
				if (command.length < total) {
					return { data: null, consumedBytes: 0 }
				}
				parsedBlock = {
					type: 'command',
					name: 'Real-Time Command',
					details: { fn },
				}
				consumedBytes = total
			} else {
				parsedBlock = {
					type: 'command',
					name: 'Unknown Control Byte',
					details: { byte: firstByte },
				}
				consumedBytes = 1
			}
			break
		case 0x1b: // ESC
			if (command.length >= 2) {
				const nextByte = command[1]
				switch (nextByte) {
					case 0x40: // @ - Initialize Printer
						state.alignment = Alignment.Left
						state.charWidth = 1
						state.charHeight = 1
						state.leftMargin = 0
						state.printAreaWidth = 0
						state.emphasized = false
						state.underline = 0
						state.reversePrinting = false
						state.font = 0
						state.rightSpacing = 0
						state.tabStops = defaultTabStops
						state.lineSpacing = null
						state.qrModel = 2
						state.qrModuleSize = 3
						state.qrErrorCorrection = 'L'
						state.qrData = ''
						parsedBlock = { type: 'command', name: 'Initialize Printer' }
						consumedBytes = 2
						break
					case 0x42: // B - Beep
						if (command.length >= 4) {
							const count = command[2]
							const duration = command[3]
							parsedBlock = {
								type: 'command',
								name: 'Beep',
								details: { count, duration },
							}
							consumedBytes = 4
						} else {
							return { data: null, consumedBytes: 0 }
						}
						break
					case 0x45: // E - Set emphasized mode
						if (command.length >= 3) {
							// Only the lowest bit counts, so ASCII '0' and '1' work too.
							const emphasized = (command[2] & 0x01) !== 0
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
							// 0/1/2 or ASCII '0'/'1'/'2': off, 1-dot or 2-dot underline.
							const underline = Math.min(command[2] & 0x03, 2)
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
							// 0/1 or ASCII '0'/'1': Font A or B. Font C and up fall back to A.
							state.font = (font & 0x0f) === 1 ? 1 : 0
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
							state.rightSpacing = spacing
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
							state.font = fontByte & 0x01
							state.emphasized = (fontByte & 0x08) !== 0
							state.charHeight = fontByte & 0x10 ? 2 : 1
							state.charWidth = fontByte & 0x20 ? 2 : 1
							state.underline = fontByte & 0x80 ? 1 : 0
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
					case 0x69: // i - Full cut
						parsedBlock = {
							type: 'command',
							name: 'Cut Paper',
							details: { command: 'ESC i', cutType: 'Full' },
						}
						consumedBytes = 2
						break
					case 0x44: { // D - Set horizontal tab positions: ESC D n1 ... nk NUL
						const terminator = command.subarray(2, 2 + maxTabStops + 1)
							.indexOf(0x00)
						let stops: number[]
						if (terminator === -1) {
							if (command.length < 2 + maxTabStops + 1) {
								return { data: null, consumedBytes: 0 }
							}
							// No NUL within the limit: take 32 stops and resume after them.
							stops = [...command.subarray(2, 2 + maxTabStops)]
							consumedBytes = 2 + maxTabStops
						} else {
							stops = [...command.subarray(2, 2 + terminator)]
							consumedBytes = 2 + terminator + 1
						}
						// Stops are character columns, converted to dots with the
						// character width at this moment, as on Epson printers.
						const columnWidth = (fontCellWidths[state.font] + state.rightSpacing) *
							state.charWidth
						state.tabStops = stops.map((column) => column * columnWidth)
						parsedBlock = {
							type: 'command',
							name: 'Set Horizontal Tab Positions',
							details: { stops, positions: state.tabStops },
						}
						break
					}
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
					case 0x64: // d - Print and feed n lines
						if (command.length >= 3) {
							const n = command[2]
							parsedBlock = {
								type: 'command',
								name: 'Print and Feed Lines',
								details: { lines: n, lineSpacing: state.lineSpacing },
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
						if (command.length >= 5) {
							const m = command[2]
							const nL = command[3]
							const nH = command[4]
							const widthDots = nL + nH * 256

							let bytesPerSlice = 1
							if (m === 32 || m === 33) {
								bytesPerSlice = 3
							}

							const expectedDataSize = widthDots * bytesPerSlice

							if (command.length >= 5 + expectedDataSize) {
								parsedBlock = {
									type: 'command',
									name: 'Bit Image (ESC *)',
									details: { m: m, width: widthDots },
								}
								consumedBytes = 5 + expectedDataSize
							} else {
								return { data: null, consumedBytes: 0 }
							}
						} else {
							return { data: null, consumedBytes: 0 }
						}
						break
					case 0x32: // 2 - Select default line spacing
						state.lineSpacing = null
						parsedBlock = { type: 'command', name: 'Select Default Line Spacing' }
						consumedBytes = 2
						break
					case 0x33: // 3 - Set line spacing
						if (command.length >= 3) {
							state.lineSpacing = command[2]
							parsedBlock = {
								type: 'command',
								name: 'Set Line Spacing',
								details: { spacing: state.lineSpacing },
							}
							consumedBytes = 3
						} else {
							return { data: null, consumedBytes: 0 }
						}
						break
					case 0x5c: // \ - Set relative print position
						if (command.length >= 4) {
							parsedBlock = {
								type: 'command',
								name: 'Set Relative Print Position',
								details: { offset: signed16(command[2], command[3]) },
							}
							consumedBytes = 4
						} else {
							return { data: null, consumedBytes: 0 }
						}
						break
					case 0x4c: // L - Select page mode
						parsedBlock = { type: 'command', name: 'Select Page Mode' }
						consumedBytes = 2
						break
					case 0x53: // S - Select standard mode
						parsedBlock = { type: 'command', name: 'Select Standard Mode' }
						consumedBytes = 2
						break
					case 0x0c: // FF - Print data in page mode
						parsedBlock = { type: 'command', name: 'Print Page' }
						consumedBytes = 2
						break
					case 0x54: // T - Select print direction in page mode
						if (command.length >= 3) {
							parsedBlock = {
								type: 'command',
								name: 'Select Print Direction',
								details: { direction: command[2] & 0x03 },
							}
							consumedBytes = 3
						} else {
							return { data: null, consumedBytes: 0 }
						}
						break
					case 0x57: // W - Set print area in page mode
						if (command.length >= 10) {
							parsedBlock = {
								type: 'command',
								name: 'Set Page Area',
								details: {
									x: command[2] + command[3] * 256,
									y: command[4] + command[5] * 256,
									width: command[6] + command[7] * 256,
									height: command[8] + command[9] * 256,
								},
							}
							consumedBytes = 10
						} else {
							return { data: null, consumedBytes: 0 }
						}
						break
					case 0x26: { // & - Define user-defined characters: y c1 c2 [x d1...d(y × x)]...
						if (command.length < 5) {
							return { data: null, consumedBytes: 0 }
						}
						const [y, c1, c2] = command.subarray(2, 5)
						let end = 5
						for (let c = c1; c <= c2; c++) {
							if (command.length <= end) {
								return { data: null, consumedBytes: 0 }
							}
							end += 1 + y * command[end]
						}
						if (command.length < end) {
							return { data: null, consumedBytes: 0 }
						}
						parsedBlock = {
							type: 'command',
							name: 'Define User-Defined Characters',
							details: { from: c1, to: c2 },
						}
						consumedBytes = end
						break
					}
					case 0x28: // ( - Length-prefixed ESC ( family
						return lengthPrefixedCommand(command, 'ESC ( Command')
					default:
						if (ignoredEscCommands[nextByte]) {
							return ignoredCommand(command, ignoredEscCommands[nextByte])
						}
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
							const size = command[2]
							state.charHeight = (size & 0x07) + 1
							state.charWidth = ((size >> 4) & 0x07) + 1
							parsedBlock = {
								type: 'command',
								name: 'Set Char Size',
								details: {
									width: state.charWidth,
									height: state.charHeight,
								},
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

									const png = new PNG({ width: pixelWidth, height: height })
									Buffer.from(rgbaData.buffer).copy(png.data)
									const pngBuffer = PNG.sync.write(png)
									const base64 = pngBuffer.toString('base64')

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
							// Only the lowest bit counts, so ASCII '0' and '1' work too.
							const reverse = (command[2] & 0x01) !== 0
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
							let dataStart: number
							let dataEnd: number
							if (barcodeType >= 65) {
								// Format B: GS k m n d1...dn
								if (command.length < 4) {
									return { data: null, consumedBytes: 0 }
								}
								dataStart = 4
								dataEnd = 4 + command[3]
								consumedBytes = dataEnd
							} else {
								// Format A: GS k m d1...dk NUL
								dataStart = 3
								dataEnd = command.indexOf(0x00, 3)
								if (dataEnd === -1) {
									return { data: null, consumedBytes: 0 }
								}
								consumedBytes = dataEnd + 1
							}
							if (command.length < consumedBytes) {
								return { data: null, consumedBytes: 0 }
							}
							parsedBlock = {
								type: 'command',
								name: 'Print Barcode',
								details: {
									barcodeType,
									barcodeData: String.fromCharCode(
										...command.subarray(dataStart, dataEnd),
									),
								},
							}
						} else {
							return { data: null, consumedBytes: 0 }
						}
						break
					case 0x28: { // ( - Extended 2D/specialized command family: GS ( k pL pH cn fn [params]
						if (command.length < 5) {
							return { data: null, consumedBytes: 0 }
						}
						const subFamily = command[2]
						const pL = command[3]
						const pH = command[4]
						const payloadLen = pL + pH * 256
						const totalLen = 5 + payloadLen
						if (command.length < totalLen) {
							return { data: null, consumedBytes: 0 }
						}
						if (subFamily !== 0x6b || payloadLen < 2) {
							parsedBlock = {
								type: 'command',
								name: 'Unknown GS ( Command',
								details: { subFamily, payloadLen },
							}
							consumedBytes = totalLen
							break
						}
						const cn = command[5]
						const fn = command[6]
						const params = command.subarray(7, totalLen)
						consumedBytes = totalLen

						if (cn !== 49) {
							parsedBlock = {
								type: 'command',
								name: 'Unknown GS ( k Symbol',
								details: { cn, fn },
							}
							break
						}

						switch (fn) {
							case 65: // Select QR model
								if (params.length >= 1) {
									state.qrModel = params[0]
								}
								parsedBlock = {
									type: 'command',
									name: 'QR Set Model',
									details: { model: state.qrModel },
								}
								break
							case 67: // Set module size
								if (params.length >= 1 && params[0] >= 1 && params[0] <= 16) {
									state.qrModuleSize = params[0]
								}
								parsedBlock = {
									type: 'command',
									name: 'QR Set Module Size',
									details: { size: state.qrModuleSize },
								}
								break
							case 69: { // Set error correction level
								const levelMap: Record<number, QrErrorCorrectionLevel> = {
									48: 'L',
									49: 'M',
									50: 'Q',
									51: 'H',
								}
								if (params.length >= 1 && levelMap[params[0]]) {
									state.qrErrorCorrection = levelMap[params[0]]
								}
								parsedBlock = {
									type: 'command',
									name: 'QR Set Error Correction',
									details: { level: state.qrErrorCorrection },
								}
								break
							}
							case 80: // Store data in symbol storage buffer
								// params = [m, d1..dk]; m is typically 0x30 (48). Decode the rest as UTF-8.
								state.qrData = new TextDecoder('utf-8').decode(
									params.subarray(1),
								)
								parsedBlock = {
									type: 'command',
									name: 'QR Store Data',
									details: { length: params.length - 1 },
								}
								break
							case 81: // Print stored symbol data
								parsedBlock = await renderQrAsImage(state)
								break
							default:
								parsedBlock = {
									type: 'command',
									name: 'Unknown QR Function',
									details: { fn },
								}
								break
						}
						break
					}
					case 0x24: // $ - Set absolute vertical print position in page mode
						if (command.length >= 4) {
							parsedBlock = {
								type: 'command',
								name: 'Set Absolute Vertical Position',
								details: { position: command[2] + command[3] * 256 },
							}
							consumedBytes = 4
						} else {
							return { data: null, consumedBytes: 0 }
						}
						break
					case 0x5c: // \ - Set relative vertical print position in page mode
						if (command.length >= 4) {
							parsedBlock = {
								type: 'command',
								name: 'Set Relative Vertical Position',
								details: { offset: signed16(command[2], command[3]) },
							}
							consumedBytes = 4
						} else {
							return { data: null, consumedBytes: 0 }
						}
						break
					case 0x2a: { // * - Define downloaded bit image: x y d1...d(x × y × 8)
						if (command.length < 4) {
							return { data: null, consumedBytes: 0 }
						}
						const total = 4 + command[2] * command[3] * 8
						if (command.length < total) {
							return { data: null, consumedBytes: 0 }
						}
						parsedBlock = { type: 'command', name: 'Define Downloaded Bit Image' }
						consumedBytes = total
						break
					}
					case 0x38: { // 8 - GS 8 L p1 p2 p3 p4 m fn [params], 32-bit length
						if (command.length < 7) {
							return { data: null, consumedBytes: 0 }
						}
						const total = 7 + command[3] + command[4] * 0x100 +
							command[5] * 0x10000 + command[6] * 0x1000000
						if (command.length < total) {
							return { data: null, consumedBytes: 0 }
						}
						parsedBlock = {
							type: 'command',
							name: 'GS 8 Command',
							details: { fn: command[2] },
						}
						consumedBytes = total
						break
					}
					default:
						if (ignoredGsCommands[nextByte]) {
							return ignoredCommand(command, ignoredGsCommands[nextByte])
						}
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
					case 0x28: // ( - Length-prefixed FS ( family
						return lengthPrefixedCommand(command, 'FS ( Command')
					default:
						if (ignoredFsCommands[nextByte]) {
							return ignoredCommand(command, ignoredFsCommands[nextByte])
						}
						parsedBlock = {
							type: 'command',
							name: 'Unknown FS Command',
							details: { byte: nextByte },
						}
						consumedBytes = 2
						break
				}
			} else {
				return { data: null, consumedBytes: 0 }
			}
			break
		default: // Other control bytes (NUL, SO, DC2, ...) are skipped, not printed
			parsedBlock = {
				type: 'command',
				name: 'Unknown Control Byte',
				details: { byte: firstByte },
			}
			consumedBytes = 1
			break
	}

	return { data: parsedBlock, consumedBytes: consumedBytes }
}

export class EscPosTransformer
	implements Transformer<Uint8Array, ParsedEscPosBlock> {
	#accumulatedBuffer: AccumulatingBuffer
	#printerState: PrinterState

	constructor() {
		this.#accumulatedBuffer = new AccumulatingBuffer()
		this.#printerState = {
			alignment: Alignment.Left,
			charWidth: 1,
			charHeight: 1,
			leftMargin: 0,
			printAreaWidth: 0,
			emphasized: false,
			underline: 0,
			reversePrinting: false,
			font: 0,
			rightSpacing: 0,
			tabStops: defaultTabStops,
			lineSpacing: null,
			qrModel: 2,
			qrModuleSize: 3,
			qrErrorCorrection: 'L',
			qrData: '',
		}
	}

	async transform(
		chunk: Uint8Array,
		controller: TransformStreamDefaultController<ParsedEscPosBlock>,
	) {
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
				const remainingBytes = this.#accumulatedBuffer.bytes().subarray(
					parsedResult.consumedBytes,
				)
				this.#accumulatedBuffer = new AccumulatingBuffer(remainingBytes)
			} else {
				break
			}
		}
	}

	async flush(controller: TransformStreamDefaultController<ParsedEscPosBlock>) {
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
				this.#accumulatedBuffer = new AccumulatingBuffer(remainingBytes)
			} else {
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
