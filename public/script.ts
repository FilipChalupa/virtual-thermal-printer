import {
	Alignment,
	EscPosCommand,
	EscPosImage,
	EscPosText,
	ParsedEscPosBlock,
} from '../shared/types.ts'
import { printerWidth } from '../shared/settings.ts'

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

const printerOutput = document.getElementById(
	'printer-output',
) as HTMLDivElement
if (!printerOutput) {
	throw new Error('Printer output element not found')
}
const paper = printerOutput.querySelector('.paper') as HTMLDivElement
if (!paper) {
	throw new Error('Paper element not found')
}
paper.style.width = `${printerWidth}px`

let socket: WebSocket | undefined
let reconnectInterval = 1000 // Initial reconnect attempt after 1 second
let canvas: HTMLCanvasElement
let ctx: CanvasRenderingContext2D
let y: number // Current y position on the canvas

let scrollTarget: number = 0 // Desired scroll position
let scrollAnimationId: number | null = null // To store requestAnimationFrame ID

// Function to update the scroll target and ensure animation is running
function updateScrollTargetAndAnimate(): void {
	scrollTarget = printerOutput.scrollHeight // Always scroll to the very bottom
	if (scrollAnimationId === null) {
		animateScroll()
	}
}

// Custom continuous scroll animation logic
function animateScroll(): void {
	const currentScrollTop = printerOutput.scrollTop
	const scrollDelta = scrollTarget - currentScrollTop
	const scrollStep = 8 // Pixels to scroll per frame

	if (scrollDelta > 0) { // Only scroll down if not at target
		let newScrollTop = currentScrollTop + scrollStep
		// Ensure we don't overshoot the target (or the actual scrollHeight)
		newScrollTop = Math.min(newScrollTop, scrollTarget)
		printerOutput.scrollTop = newScrollTop

		// Continue animation if still not at target
		if (printerOutput.scrollTop < scrollTarget) {
			scrollAnimationId = requestAnimationFrame(animateScroll)
		} else {
			scrollAnimationId = null // Reached target
		}
	} else {
		scrollAnimationId = null // Already at or past target
	}
}

function limitContentHeight(): void {
	// This function will need to be adapted for the canvas implementation.
	// For now, it will be a no-op.
}

function resizeCanvas(newHeight: number) {
	if (newHeight <= canvas.height) {
		return
	}
	const tempCanvas = document.createElement('canvas')
	tempCanvas.width = canvas.width
	tempCanvas.height = canvas.height
	const tempCtx = tempCanvas.getContext('2d')
	if (tempCtx) {
		tempCtx.drawImage(canvas, 0, 0)
		canvas.height = newHeight
		ctx.drawImage(tempCanvas, 0, 0)
	}
}

function connectWebSocket(): void {
	const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
	socket = new WebSocket(`${protocol}//${location.host}/stream`)

	socket.onopen = () => {
		console.log('WebSocket connected.')
		reconnectInterval = 1000 // Reset reconnect interval on successful connection
		// Clear existing content on successful reconnect
		while (paper.firstChild) {
			paper.removeChild(paper.firstChild)
		}
		// Create canvas element
		canvas = document.createElement('canvas')
		canvas.width = printerWidth
		paper.appendChild(canvas)
		const context = canvas.getContext('2d')
		if (!context) {
			throw new Error('Failed to get 2D context')
		}
		ctx = context
		y = 20 // Initial y position
	}

	socket.onmessage = (event: MessageEvent) => {
		const data: ParsedEscPosBlock = JSON.parse(event.data)
		console.log(data)

		const baseFontSize = 16 // Base font size in px
		const lineHeight = 1.2

		if (isEscPosImage(data)) {
			const img = new Image()
			img.onload = () => {
				resizeCanvas(y + data.height)
				ctx.drawImage(img, 0, y)
				y += data.height
				updateScrollTargetAndAnimate()
			}
			img.src = data.base64
		} else if (isEscPosText(data)) {
			const fontSize = baseFontSize * data.charHeight
			const totalHeight = data.content.split('\n').length * fontSize * lineHeight
			resizeCanvas(y + totalHeight)

			ctx.save()
			ctx.font = `${data.emphasized ? 'bold ' : ''}${fontSize}px monospace`

			const alignmentMap: { [key: number]: CanvasTextAlign } = {
				[Alignment.Left]: 'left',
				[Alignment.Center]: 'center',
				[Alignment.Right]: 'right',
			}
			ctx.textAlign = alignmentMap[data.alignment] || 'left'

			const x = {
				[Alignment.Left]: 0,
				[Alignment.Center]: canvas.width / 2,
				[Alignment.Right]: canvas.width,
			}[data.alignment] ?? 0

			if (data.reversePrinting) {
				ctx.fillStyle = 'white'
				// To do: Add a background rect for reverse printing
			} else {
				ctx.fillStyle = 'black'
			}

			data.content.split('\n').forEach((line) => {
				if (data.charWidth > 1) {
					line = line.split('').join(' '.repeat(data.charWidth - 1))
				}
				ctx.fillText(line, x, y)
				y += fontSize * lineHeight
			})

			ctx.restore()
		} else if (isEscPosCommand(data) && data.name === 'Cut Paper') {
			resizeCanvas(y + 20)
			ctx.save()
			ctx.setLineDash([5, 5])
			ctx.beginPath()
			ctx.moveTo(0, y)
			ctx.lineTo(canvas.width, y)
			ctx.stroke()
			ctx.restore()
			y += 20
		}
		updateScrollTargetAndAnimate()
		// limitContentHeight() is a no-op
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
