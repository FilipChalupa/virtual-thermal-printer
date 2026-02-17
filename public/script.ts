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
const paper = document.querySelector('#printer-output .paper') as HTMLDivElement
if (!paper) {
	throw new Error('Paper element not found')
}
paper.style.width = `${printerWidth}px`

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
	}

	socket.onmessage = (event: MessageEvent) => {
		const data: ParsedEscPosBlock = JSON.parse(event.data)
		console.log(data)

		const baseFontSize = 16 // Base font size in px
		const lineHeight = 1.2

		if (isEscPosImage(data)) {
			const img = document.createElement('img')
			img.src = data.base64
			img.width = data.width
			img.height = data.height
			paper.appendChild(img)
		} else if (isEscPosText(data)) {
			data.content.split('\n').forEach((line) => {
				const canvas = document.createElement('canvas')
				const ctx = canvas.getContext('2d')
				if (!ctx) {
					return
				}

				const fontSize = baseFontSize * data.charHeight
				const font = `${data.emphasized ? 'bold ' : ''}${fontSize}px monospace`
				ctx.font = font

				if (data.charWidth > 1) {
					line = line.split('').join(' '.repeat(data.charWidth - 1))
				}

				const textMetrics = ctx.measureText(line)
				canvas.width = textMetrics.width
				canvas.height = fontSize * lineHeight

				// It's important to set the font again after resizing the canvas
				ctx.font = font

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
					ctx.fillStyle = 'black'
					ctx.fillRect(0, 0, canvas.width, canvas.height)
					ctx.fillStyle = 'white'
				} else {
					ctx.fillStyle = 'black'
				}

				ctx.fillText(line, x, fontSize)
				paper.appendChild(canvas)
			})
		} else if (isEscPosCommand(data)) {
			// Handle 'Beep' command
			if (data.name === 'Beep') {
				console.log('Playing beep sound')
				beepSound.play()
			} else if (data.name === 'Cut Paper') {
				const cutLine = document.createElement('div')
				cutLine.className = 'cut-line'
				paper.appendChild(cutLine)
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
