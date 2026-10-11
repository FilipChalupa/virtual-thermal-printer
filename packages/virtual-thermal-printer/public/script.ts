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
	{ cellWidth: 12, cellHeight: 24, fontSize: 20 },
	{ cellWidth: 9, cellHeight: 17, fontSize: 14 },
]
// Line spacing until ESC 3 sets one (and after ESC 2), about 1/6 in.
const defaultLineSpacing = 30

interface TextSegment {
	text: string
	style: EscPosText
	x: number // Dots from the start of the line
}

interface TextRow {
	canvas: HTMLCanvasElement
	segments: TextSegment[]
	style: EscPosText // Style at the start of the line, which sets its layout
	width: number // Canvas width in dots: the paper, or the page in page mode
	left: number // Left margin in dots
	area: number // Printable width in dots from the left margin
	position: number // Next print position in dots from the start of the line
}

// Page mode (ESC L) composes output on a page that FF or ESC FF prints.
interface Page {
	canvas: HTMLCanvasElement // The physical page, as wide as the paper
	area: { x: number; y: number; width: number; height: number } // ESC W
	// ESC T: 0 left to right, 1 bottom to top, 2 right to left, 3 top to bottom.
	direction: number
	y: number // Top of the current line in the print direction, in dots
	pendingImages: Promise<void>[]
}

// The row being printed. Text blocks that arrive before it ends (style
// changes mid-line) are appended to it. An LF, paper feed, image or cut ends
// it, and the next text starts a new row.
let openRow: TextRow | null = null
// ESC $ or ESC \ received before any text on the line, applied when the row starts.
let pendingPosition: number | null = null
let page: Page | null = null
// The default page area differs between models; this one is the full head
// width and 831 dots (about 104 mm) high.
const defaultPageHeight = 831

function fontOf(style: EscPosText) {
	return fonts[style.font] ?? fonts[0]
}

function lineSpacing(style: { lineSpacing: number | null }): number {
	return style.lineSpacing ?? defaultLineSpacing
}

// A printed line advances by the line spacing, or by the character height
// when the characters are taller.
function rowHeight(style: EscPosText): number {
	return Math.max(lineSpacing(style), fontOf(style).cellHeight * style.charHeight)
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

// Width and height of the page area as seen in the current print direction.
function pageSize(target: Page): { width: number; height: number } {
	const { width, height } = target.area
	return target.direction % 2 === 0 ? { width, height } : { width: height, height: width }
}

// Draws in print-direction coordinates, rotated onto the page area.
function drawOnPage(target: Page, draw: (ctx: CanvasRenderingContext2D) => void) {
	const ctx = target.canvas.getContext('2d')
	if (!ctx) {
		return
	}
	const { x, y, width, height } = target.area
	ctx.save()
	ctx.beginPath()
	ctx.rect(x, y, width, height)
	ctx.clip()
	if (target.direction === 1) {
		ctx.translate(x, y + height)
		ctx.rotate(-Math.PI / 2)
	} else if (target.direction === 2) {
		ctx.translate(x + width, y + height)
		ctx.rotate(Math.PI)
	} else if (target.direction === 3) {
		ctx.translate(x + width, y)
		ctx.rotate(Math.PI / 2)
	} else {
		ctx.translate(x, y)
	}
	draw(ctx)
	ctx.restore()
}

// A page canvas as tall as the area ends, keeping what `from` had drawn.
function pageCanvas(height: number, from?: HTMLCanvasElement) {
	const canvas = document.createElement('canvas')
	canvas.width = printerWidth
	canvas.height = height
	if (from) {
		canvas.getContext('2d')?.drawImage(from, 0, 0)
	}
	return canvas
}

function createPage(): Page {
	return {
		canvas: pageCanvas(defaultPageHeight),
		area: { x: 0, y: 0, width: printerWidth, height: defaultPageHeight },
		direction: 0,
		y: 0,
		pendingImages: [],
	}
}

function printPage(target: Page) {
	// The page is copied once its images are drawn. ESC FF keeps the page for
	// further printing, so the copy must not change with it.
	const printed = document.createElement('canvas')
	printed.width = target.canvas.width
	printed.height = target.canvas.height
	paperContent.appendChild(printed)
	Promise.all(target.pendingImages).then(() => {
		printed.getContext('2d')?.drawImage(target.canvas, 0, 0)
	})
}

// Ends the open row. In page mode the row is drawn onto the page and, unless
// the vertical position is about to be set, the position moves below it.
function endRow(advance = true) {
	if (openRow && page) {
		const row = openRow
		const top = page.y
		drawOnPage(page, (ctx) => ctx.drawImage(row.canvas, 0, top))
		if (advance) {
			page.y += row.canvas.height
		}
	}
	openRow = null
	pendingPosition = null
}

function startRow(style: EscPosText): TextRow {
	const width = page ? pageSize(page).width : printerWidth
	// Margins apply in standard mode only. Out-of-range values are clamped so
	// at least one cell fits.
	const left = page ? 0 : Math.min(style.leftMargin, width - cellWidth(style))
	const area = page
		? width
		: Math.min(style.printAreaWidth || width, width - left)
	const position = pendingPosition !== null && pendingPosition <= area
		? pendingPosition
		: 0
	const row: TextRow = {
		canvas: document.createElement('canvas'),
		segments: [],
		style,
		width,
		left,
		area,
		position,
	}
	if (!page) {
		paperContent.appendChild(row.canvas)
	}
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
	row.canvas.width = row.width
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
			// HT moves to the next tab stop. Past the print area it fills the
			// line; with no stops set it is ignored.
			flush(row)
			if (style.tabStops.length > 0) {
				const next = style.tabStops.find((stop) => stop > row.position)
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

// Blank paper, scaled exactly like a text row canvas of the same height. In
// page mode it moves the vertical position instead.
function appendFeed(dots: number) {
	if (dots <= 0) {
		return
	}
	if (page) {
		page.y += dots
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

function appendImage(data: EscPosImage) {
	endRow()
	if (!page) {
		const img = document.createElement('img')
		img.src = data.base64
		img.width = data.width
		img.height = data.height
		paperContent.appendChild(img)
		return
	}
	const target = page
	const top = target.y
	const image = new Image()
	image.src = data.base64
	target.pendingImages.push(
		image.decode()
			.then(() => drawOnPage(target, (ctx) => ctx.drawImage(image, 0, top)))
			.catch(() => {}),
	)
	target.y += data.height
}

// Commands that only exist in page mode; they are ignored in standard mode.
function handlePageCommand(command: EscPosCommand, target: Page) {
	const details = command.details ?? {}
	if (command.name === 'Set Page Area') {
		const x = Math.min(Number(details.x ?? 0), printerWidth - 1)
		const width = Math.min(Number(details.width ?? 0), printerWidth - x)
		const y = Number(details.y ?? 0)
		const height = Number(details.height ?? 0)
		if (width === 0 || height === 0) {
			return
		}
		endRow()
		// The printed page ends with the area.
		target.canvas = pageCanvas(y + height, target.canvas)
		target.area = { x, y, width, height }
		target.y = 0
	} else if (command.name === 'Select Print Direction') {
		endRow()
		target.direction = Number(details.direction ?? 0)
		target.y = 0
	} else if (
		command.name === 'Set Absolute Vertical Position' ||
		command.name === 'Set Relative Vertical Position'
	) {
		// GS $ and GS \ move the line, here taken as its top edge, and keep
		// the horizontal position.
		const x = openRow?.position ?? pendingPosition
		endRow(false)
		const y = command.name === 'Set Absolute Vertical Position'
			? Number(details.position ?? 0)
			: target.y + Number(details.offset ?? 0)
		if (y >= 0 && y <= pageSize(target).height) {
			target.y = y
		}
		pendingPosition = x
	} else if (command.name === 'Print Page') {
		endRow()
		printPage(target)
	} else if (command.name === 'Form Feed') {
		endRow()
		printPage(target)
		page = null
	} else if (command.name === 'Cancel Page Data') {
		openRow = null
		pendingPosition = null
		target.canvas = pageCanvas(target.canvas.height)
		target.pendingImages = []
		target.y = 0
	}
}

const pageCommands = new Set([
	'Set Page Area',
	'Select Print Direction',
	'Set Absolute Vertical Position',
	'Set Relative Vertical Position',
	'Print Page',
	'Form Feed',
	'Cancel Page Data',
])

function isPageCommand(name: string): boolean {
	return pageCommands.has(name)
}

// Positions outside the print area are ignored, as on the printer.
function movePrintPosition(position: number) {
	if (position < 0) {
		return
	}
	if (!openRow) {
		pendingPosition = position
	} else if (position <= openRow.area) {
		openRow.position = position
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
		pendingPosition = null
		page = null
	}

	socket.onmessage = (event: MessageEvent) => {
		if (isFirstMessage) {
			placeholderText.classList.add('is-hidden')
			isFirstMessage = false
		}
		const data: ParsedEscPosBlock = JSON.parse(event.data)
		console.log(data)

		if (isEscPosImage(data)) {
			appendImage(data)
		} else if (isEscPosText(data)) {
			// CR is ignored, as on printers without auto line feed. CRLF line
			// endings would otherwise take up a column before every LF.
			data.content.replace(/\r/g, '').split(/(\n)/).forEach((part) => {
				if (part === '\n') {
					lineFeed(lineSpacing(data))
				} else if (part !== '') {
					appendText(part, data)
				}
			})
		} else if (isEscPosCommand(data)) {
			// Handle 'Beep' command
			if (data.name === 'Beep') {
				console.log('Playing beep sound')
				beepSound.play()
			} else if (data.name === 'Initialize Printer') {
				// ESC @ returns to standard mode and discards an unprinted page.
				if (page) {
					openRow = null
					page = null
				}
			} else if (data.name === 'Select Page Mode') {
				endRow()
				page ??= createPage()
			} else if (data.name === 'Select Standard Mode') {
				// ESC S discards the page without printing it.
				openRow = page ? null : openRow
				endRow()
				page = null
			} else if (page && isPageCommand(data.name)) {
				handlePageCommand(data, page)
			} else if (data.name === 'Cut Paper' && !page) {
				const cutLine = document.createElement('div')
				cutLine.className = 'cut-line'
				paperContent.appendChild(cutLine)
				endRow()
			} else if (data.name === 'Print and Feed Lines') {
				// ESC d n: print the row, then feed n lines, so it acts as n LFs.
				const lines = Number(data.details?.lines ?? 0)
				const spacing = lineSpacing({
					lineSpacing: (data.details?.lineSpacing as number | null) ?? null,
				})
				if (lines === 0) {
					endRow()
				}
				for (let i = 0; i < lines; i++) {
					lineFeed(spacing)
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
				movePrintPosition(Number(data.details?.position ?? 0))
			} else if (data.name === 'Set Relative Print Position') {
				// ESC \ moves the print position relative to the current one.
				const current = openRow?.position ?? pendingPosition ?? 0
				movePrintPosition(current + Number(data.details?.offset ?? 0))
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
