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
	const threshold = 10 * printerOutput.clientHeight
	// Loop while scrollHeight exceeds the threshold and there's content to remove
	while (printerOutput.scrollHeight > threshold && paper.firstChild) {
		paper.removeChild(paper.firstChild)
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
	}

	socket.onmessage = (event: MessageEvent) => {
		const data: ParsedEscPosBlock = JSON.parse(event.data)
		console.log(data)

		if (isEscPosImage(data)) {
			const img = document.createElement('img')
			img.src = data.base64
			img.width = data.width
			img.height = data.height
			paper.appendChild(img)
		} else if (isEscPosText(data)) {
			const alignmentMap: { [key: number]: string } = {
				[Alignment.Left]: 'left',
				[Alignment.Center]: 'center',
				[Alignment.Right]: 'right',
			}
			data.content.split('\n').forEach((line) => {
				const div = document.createElement('div')
				div.style.textAlign = alignmentMap[data.alignment] || 'left'
				if (data.emphasized) {
					div.style.fontWeight = 'bold'
				}
				if (data.underline) {
					div.style.textDecoration = 'underline'
				}
				if (data.charSize) {
					div.classList.add(`char-size-${data.charSize}`)
				}
				if (data.reversePrinting) {
					div.classList.add('reverse-printing')
				}
				div.textContent = line
				paper.appendChild(div)
			})
		} else if (isEscPosCommand(data) && data.name === 'Cut Paper') {
			const cutLine = document.createElement('div')
			cutLine.className = 'cut-line'
			cutLine.textContent = '--- CUT ---'
			paper.appendChild(cutLine)
		}
		updateScrollTargetAndAnimate()
		limitContentHeight()
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
