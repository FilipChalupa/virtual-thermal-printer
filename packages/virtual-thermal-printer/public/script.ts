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

// Font A on a 576-dot head prints 12-dot-wide cells, 48 columns per line.
// Text is laid out on that grid so wrapping and space-padded columns match
// the paper.
const columns = 48
const cellWidth = printerWidth / columns
const baseFontSize = 20 // Glyph size in dots for a single-height character
const lineHeight = 1.5 // Row pitch relative to the font, with room for descenders

interface TextSegment {
	text: string
	style: EscPosText
}

interface TextRow {
	canvas: HTMLCanvasElement
	segments: TextSegment[]
}

// The row being printed. Text blocks that arrive before it ends (style
// changes mid-line) are appended to it. An LF, paper feed, image or cut ends
// it, and the next text starts a new row.
let openRow: TextRow | null = null
// Character height of the latest text, used for line feeds sent as commands.
let lastCharHeight = 1

// Canvas sizes are whole pixels, so blank lines use the same rounded height.
function rowHeight(charHeight: number): number {
	return Math.floor(baseFontSize * charHeight * lineHeight)
}

function segmentFont(style: EscPosText): string {
	return `${style.emphasized ? 'bold ' : ''}${
		baseFontSize * style.charHeight
	}px monospace`
}

function segmentColumns({ text, style }: TextSegment): number {
	return text.length * style.charWidth
}

function rowColumns(row: TextRow): number {
	return row.segments.reduce((sum, segment) => sum + segmentColumns(segment), 0)
}

function drawRow(row: TextRow) {
	const ctx = row.canvas.getContext('2d')
	if (!ctx) {
		return
	}

	const largest = row.segments.reduce((a, b) =>
		b.style.charHeight > a.style.charHeight ? b : a
	).style
	// Resizing clears the canvas, so the whole row is redrawn each time.
	row.canvas.width = printerWidth
	row.canvas.height = rowHeight(largest.charHeight)

	// Center the largest font's ascent and descent in the row, so descenders
	// are not clipped. Smaller text shares the baseline and sits on the bottom.
	ctx.font = segmentFont(largest)
	const metrics = ctx.measureText('Mg')
	const ascent = metrics.fontBoundingBoxAscent
	const descent = metrics.fontBoundingBoxDescent
	const baseline = Math.round((row.canvas.height + ascent - descent) / 2)

	// Printers apply alignment per line, so the row's first segment decides it.
	const alignment = row.segments[0].style.alignment
	const rowWidth = rowColumns(row) * cellWidth
	let x = alignment === Alignment.Center
		? (printerWidth - rowWidth) / 2
		: alignment === Alignment.Right
		? printerWidth - rowWidth
		: 0

	ctx.textAlign = 'left'
	row.segments.forEach((segment) => {
		const { text, style } = segment
		const width = segmentColumns(segment) * cellWidth
		ctx.font = segmentFont(style)
		if (style.reversePrinting) {
			ctx.fillStyle = 'black'
			ctx.fillRect(x, 0, width, row.canvas.height)
			ctx.fillStyle = 'white'
		} else {
			ctx.fillStyle = 'black'
		}
		// Stretch the monospace advance to the cell grid. Double-width
		// characters are the same glyphs stretched to two cells.
		const advance = ctx.measureText('0').width
		ctx.save()
		ctx.translate(x, baseline)
		ctx.scale((cellWidth * style.charWidth) / advance, 1)
		ctx.fillText(text, 0, 0)
		ctx.restore()
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
		x += width
	})
}

function appendText(text: string, style: EscPosText) {
	while (text.length > 0) {
		const freeColumns = columns - (openRow ? rowColumns(openRow) : 0)
		const fittingChars = Math.floor(freeColumns / style.charWidth)
		if (openRow && fittingChars === 0) {
			// The line is full, so the printer prints it and continues on the next.
			openRow = null
			continue
		}
		const part = text.slice(0, Math.max(fittingChars, 1))
		text = text.slice(part.length)
		if (openRow) {
			openRow.segments.push({ text: part, style })
		} else {
			openRow = {
				canvas: document.createElement('canvas'),
				segments: [{ text: part, style }],
			}
			paperContent.appendChild(openRow.canvas)
		}
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

function lineFeed(charHeight: number) {
	// Text rows are block elements, so an LF that ends one needs no extra
	// element. Only an LF with no text before it feeds a blank line.
	if (openRow) {
		openRow = null
	} else {
		appendFeed(rowHeight(charHeight))
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
		openRow = null
		lastCharHeight = 1
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
			openRow = null
		} else if (isEscPosText(data)) {
			lastCharHeight = data.charHeight
			// CR is ignored, as on printers without auto line feed. CRLF line
			// endings would otherwise take up a column before every LF.
			data.content.replace(/\r/g, '').split(/(\n)/).forEach((part) => {
				if (part === '\n') {
					lineFeed(data.charHeight)
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
				openRow = null
			} else if (data.name === 'Print and Feed Lines') {
				// ESC d n: print the row, then feed n lines, so it acts as n LFs.
				const lines = Number(data.details?.lines ?? 0)
				if (lines === 0) {
					openRow = null
				}
				for (let i = 0; i < lines; i++) {
					lineFeed(lastCharHeight)
				}
			} else if (data.name === 'Print and Feed Paper') {
				// ESC J n: print the row, then feed n motion units, taken as dots
				// (1/203 in on a 576-dot head). The printed row already takes up its
				// own height, so only the rest of the feed is added below it.
				const dots = Number(data.details?.feed ?? 0)
				const rowHeight = openRow?.canvas.height ?? 0
				openRow = null
				appendFeed(dots - rowHeight)
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
