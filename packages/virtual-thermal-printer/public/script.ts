import {
	Alignment,
	EscPosCommand,
	EscPosImage,
	EscPosText,
	ParsedEscPosBlock,
} from 'escpos-decoder/types'
import { printerWidth } from '../settings.js'

// Type guards for narrowing ParsedEscPosBlock
function isEscPosText(block: ParsedEscPosBlock): block is EscPosText {
	return block.type === 'text'
}

function isEscPosCommand(block: ParsedEscPosBlock): block is EscPosCommand {
	return block.type === 'command'
}

function isEscPosImage(block: ParsedEscPosBlock): block is EscPosImage {
	return block.type === 'image'
}

let isAutoScrolling = false

function linearScrollToEnd() {
	if (isAutoScrolling) {
		return
	}
	isAutoScrolling = true
	const pixelsPerSecond = 700
	let lastTimestamp: number
	const step = () => {
		if (
			!isAutoScrollEnabled /* @TODO: or check if already scrolled to bottom */
		) {
			isAutoScrolling = false
			return
		}

		const currentTimestamp = Date.now()
		const topBefore = root.scrollTop
		root.scrollTop += lastTimestamp
			? ((currentTimestamp - lastTimestamp) / 1000) * pixelsPerSecond
			: (pixelsPerSecond / 60)
		if (root.scrollTop === topBefore) {
			isAutoScrolling = false
			return
		}
		lastTimestamp = currentTimestamp
		requestAnimationFrame(step)
	}
	step()
}

const root = document.documentElement
const paper = document.querySelector(
	'#printer-output .paper',
) as HTMLDivElement
if (!paper) {
	throw new Error('Paper element not found')
}
const paperContent = paper.querySelector(
	'.paper-content',
) as HTMLDivElement
if (!paperContent) {
	throw new Error('Paper content element not found')
}
paper.style.width = `${printerWidth + 20}px`

let socket: WebSocket | undefined
let reconnectInterval = 1000 // Initial reconnect attempt after 1 second
let isAutoScrollEnabled = true

const beepSound = new Audio('/beep.mp3')

const disableAutoScrollIfScrollable = () => {
	const isScrollable = root.scrollHeight > root.clientHeight
	if (isScrollable) {
		isAutoScrollEnabled = false
	}
}
document.addEventListener('wheel', disableAutoScrollIfScrollable)
document.addEventListener('mousedown', disableAutoScrollIfScrollable)
document.addEventListener(
	'touchstart',
	disableAutoScrollIfScrollable,
)

document.addEventListener('scrollend', () => {
	const isAtBottom = root.scrollHeight - root.scrollTop <=
		root.clientHeight + 50
	if (isAtBottom) {
		isAutoScrollEnabled = true
	}
})

const placeholderText = document.getElementById(
	'placeholder-text',
) as HTMLParagraphElement

let isFirstMessage = true

// Character cells in dots on a 576-dot head: Font A is 12 × 24 (48 columns),
// Font B 9 × 17 (64 columns). Glyphs are stretched onto these cells so
// wrapping and space-padded columns match the paper.
const fonts = [
	{ cellWidth: 12, fontSize: 20 },
	{ cellWidth: 9, fontSize: 14 },
]
const lineHeight = 1.5 // Row pitch relative to the font, with room for descenders

interface TextSegment {
	text: string
	style: EscPosText
	x: number // Dots from the start of the line
}

interface TextRow {
	canvas: HTMLCanvasElement
	segments: TextSegment[]
	style: EscPosText // Style at the start of the line, which sets its layout
	left: number // Left margin in dots
	area: number // Printable width in dots from the left margin
	position: number // Next print position in dots from the start of the line
}

// The row being printed. Text blocks that arrive before it ends (style
// changes mid-line) are appended to it. An LF, paper feed, image or cut ends
// it, and the next text starts a new row.
let openRow: TextRow | null = null
// ESC $ received before any text on the line, applied when the row starts.
let pendingPosition: number | null = null
// Blank line height for the latest text, used for line feeds sent as commands.
const defaultRowHeight = Math.floor(fonts[0].fontSize * lineHeight)
let lastRowHeight = defaultRowHeight

function fontOf(style: EscPosText) {
	return fonts[style.font] ?? fonts[0]
}

// Canvas sizes are whole pixels, so blank lines use the same rounded height.
function rowHeight(style: EscPosText): number {
	return Math.floor(fontOf(style).fontSize * style.charHeight * lineHeight)
}

// ESC SP spacing follows each character and doubles with double width.
function cellWidth(style: EscPosText): number {
	return (fontOf(style).cellWidth + style.rightSpacing) * style.charWidth
}

function segmentFont(style: EscPosText): string {
	return `${style.emphasized ? 'bold ' : ''}${
		fontOf(style).fontSize * style.charHeight
	}px monospace`
}

function endRow() {
	openRow = null
	pendingPosition = null
}

function startRow(style: EscPosText): TextRow {
	// Out-of-range margins and widths are clamped so at least one cell fits.
	const left = Math.min(style.leftMargin, printerWidth - cellWidth(style))
	const area = Math.min(
		style.printAreaWidth || printerWidth,
		printerWidth - left,
	)
	const position = pendingPosition !== null && pendingPosition <= area
		? pendingPosition
		: 0
	const row: TextRow = {
		canvas: document.createElement('canvas'),
		segments: [],
		style,
		left,
		area,
		position,
	}
	paperContent.appendChild(row.canvas)
	openRow = row
	pendingPosition = null
	return row
}

function drawRow(row: TextRow) {
	const ctx = row.canvas.getContext('2d')
	if (!ctx) {
		return
	}

	const tallest = row.segments.reduce(
		(a, { style }) => rowHeight(style) > rowHeight(a) ? style : a,
		row.style,
	)
	// Resizing clears the canvas, so the whole row is redrawn each time.
	row.canvas.width = printerWidth
	row.canvas.height = rowHeight(tallest)

	// Center the tallest font's ascent and descent in the row, so descenders
	// are not clipped. Smaller text shares the baseline and sits on the bottom.
	ctx.font = segmentFont(tallest)
	const metrics = ctx.measureText('Mg')
	const ascent = metrics.fontBoundingBoxAscent
	const descent = metrics.fontBoundingBoxDescent
	const baseline = Math.round((row.canvas.height + ascent - descent) / 2)

	// Printers apply alignment per line, within the print area.
	const offset = row.style.alignment === Alignment.Center
		? (row.area - row.position) / 2
		: row.style.alignment === Alignment.Right
		? row.area - row.position
		: 0

	ctx.textAlign = 'left'
	row.segments.forEach(({ text, style, x: segmentX }) => {
		const x = row.left + offset + segmentX
		const cell = cellWidth(style)
		const width = text.length * cell
		ctx.font = segmentFont(style)
		if (style.reversePrinting) {
			ctx.fillStyle = 'black'
			ctx.fillRect(x, 0, width, row.canvas.height)
			ctx.fillStyle = 'white'
		} else {
			ctx.fillStyle = 'black'
		}
		// Each glyph is stretched to its font's cell. Double-width characters
		// are the same glyphs stretched to two cells.
		const scale = (fontOf(style).cellWidth * style.charWidth) /
			ctx.measureText('0').width
		;[...text].forEach((char, index) => {
			ctx.save()
			ctx.translate(x + index * cell, baseline)
			ctx.scale(scale, 1)
			ctx.fillText(char, 0, 0)
			ctx.restore()
		})
		// ESC - selects a 1 or 2 dot underline. Like on Epson printers, it is
		// not printed under reversed text.
		if (style.underline > 0 && !style.reversePrinting) {
			ctx.fillRect(
				x,
				Math.round(baseline + descent / 2),
				width,
				style.underline,
			)
		}
	})
}

function appendText(text: string, style: EscPosText) {
	const cell = cellWidth(style)
	let run = ''
	let runX = 0
	const flush = (row: TextRow) => {
		if (run !== '') {
			row.segments.push({ text: run, style, x: runX })
			run = ''
		}
	}

	let index = 0
	while (index < text.length) {
		const char = text[index]
		const row = openRow ?? startRow(style)
		if (char === '\t') {
			// HT moves to the next tab stop, given in character columns. Past
			// the print area it fills the line; with no stops set it is ignored.
			flush(row)
			if (style.tabStops.length > 0) {
				const next = style.tabStops
					.map((column) => column * cell)
					.find((stop) => stop > row.position)
				row.position = next === undefined || next > row.area
					? row.area
					: next
			}
			index++
			continue
		}
		if (row.position > 0 && row.position + cell > row.area) {
			// The line is full, so the printer prints it and continues on the next.
			flush(row)
			drawRow(row)
			endRow()
			continue
		}
		if (run === '') {
			runX = row.position
		}
		run += char
		row.position += cell
		index++
	}
	if (openRow) {
		flush(openRow)
		drawRow(openRow)
	}
}

// Blank paper, scaled exactly like a text row canvas of the same height.
function appendFeed(dots: number) {
	if (dots <= 0) {
		return
	}
	const feed = document.createElement('div')
	feed.style.aspectRatio = `${printerWidth} / ${dots}`
	paperContent.appendChild(feed)
}

function lineFeed(height: number) {
	// Text rows are block elements, so an LF that ends one needs no extra
	// element. Only an LF with no text before it feeds a blank line.
	if (openRow) {
		endRow()
	} else {
		pendingPosition = null
		appendFeed(height)
	}
}

function connectWebSocket(): void {
	const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
	socket = new WebSocket(`${protocol}//${location.host}/stream`)

	socket.onopen = () => {
		console.log('WebSocket connected.')
		reconnectInterval = 1000 // Reset reconnect interval on successful connection
		// Clear existing content on successful reconnect
		while (paperContent.firstChild) {
			paperContent.removeChild(paperContent.firstChild)
		}
		placeholderText.classList.remove('is-hidden')
		isFirstMessage = true
		endRow()
		lastRowHeight = defaultRowHeight
	}

	socket.onmessage = (event: MessageEvent) => {
		if (isFirstMessage) {
			placeholderText.classList.add('is-hidden')
			isFirstMessage = false
		}
		const data: ParsedEscPosBlock = JSON.parse(event.data)
		console.log(data)

		if (isEscPosImage(data)) {
			const img = document.createElement('img')
			img.src = data.base64
			img.width = data.width
			img.height = data.height
			paperContent.appendChild(img)
			endRow()
		} else if (isEscPosText(data)) {
			lastRowHeight = rowHeight(data)
			// CR is ignored, as on printers without auto line feed. CRLF line
			// endings would otherwise take up a column before every LF.
			data.content.replace(/\r/g, '').split(/(\n)/).forEach((part) => {
				if (part === '\n') {
					lineFeed(rowHeight(data))
				} else if (part !== '') {
					appendText(part, data)
				}
			})
		} else if (isEscPosCommand(data)) {
			// Handle 'Beep' command
			if (data.name === 'Beep') {
				console.log('Playing beep sound')
				beepSound.play()
			} else if (data.name === 'Cut Paper') {
				const cutLine = document.createElement('div')
				cutLine.className = 'cut-line'
				paperContent.appendChild(cutLine)
				endRow()
			} else if (data.name === 'Print and Feed Lines') {
				// ESC d n: print the row, then feed n lines, so it acts as n LFs.
				const lines = Number(data.details?.lines ?? 0)
				if (lines === 0) {
					endRow()
				}
				for (let i = 0; i < lines; i++) {
					lineFeed(lastRowHeight)
				}
			} else if (data.name === 'Print and Feed Paper') {
				// ESC J n: print the row, then feed n motion units, taken as dots
				// (1/203 in on a 576-dot head). The printed row already takes up its
				// own height, so only the rest of the feed is added below it.
				const dots = Number(data.details?.feed ?? 0)
				const printedHeight = openRow?.canvas.height ?? 0
				endRow()
				appendFeed(dots - printedHeight)
			} else if (data.name === 'Set Absolute Print Position') {
				// ESC $ moves the print position, in dots from the start of the line.
				// Positions past the print area are ignored, as on the printer.
				const position = Number(data.details?.position ?? 0)
				if (!openRow) {
					pendingPosition = position
				} else if (position <= openRow.area) {
					openRow.position = position
				}
			}
		}
		linearScrollToEnd()
	}

	socket.onclose = () => {
		console.log(
			`WebSocket disconnected. Attempting to reconnect in ${
				reconnectInterval / 1000
			} seconds...`,
		)
		setTimeout(connectWebSocket, reconnectInterval)
		reconnectInterval = Math.min(reconnectInterval * 2, 30000) // Exponential backoff, max 30 seconds
	}

	socket.onerror = (error: Event) => {
		console.error('WebSocket error:', (error as ErrorEvent).message)
		if (socket) {
			socket.close() // Close the socket to trigger onclose and reconnect logic
		}
	}
}

// Initial connection
connectWebSocket()

fetch('/version')
	.then((r) => r.text())
	.then((v) => {
		const el = document.getElementById('version')
		if (el) el.textContent = `v${v}`
	})
	.catch(() => {})
