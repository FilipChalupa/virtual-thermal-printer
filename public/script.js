const printerOutput = document.getElementById('printer-output')
const paper = printerOutput.querySelector('.paper')
let socket
let reconnectInterval = 1000 // Initial reconnect attempt after 1 second

let scrollTarget = 0 // Desired scroll position
let scrollAnimationId = null // To store requestAnimationFrame ID

// Initial printer state
let printerState = {
	alignment: 'left',
	emphasized: false,
	underline: 0,
	charSize: 0,
	reversePrinting: false,
}

// Function to update the scroll target and ensure animation is running
function updateScrollTargetAndAnimate() {
	scrollTarget = printerOutput.scrollHeight // Always scroll to the very bottom
	if (scrollAnimationId === null) {
		animateScroll()
	}
}

// Custom continuous scroll animation logic
function animateScroll() {
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

function limitContentHeight() {
	const threshold = 10 * printerOutput.clientHeight
	// Loop while scrollHeight exceeds the threshold and there's content to remove
	while (printerOutput.scrollHeight > threshold && paper.firstChild) {
		paper.removeChild(paper.firstChild)
	}
}

function connectWebSocket() {
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

	socket.onmessage = (event) => {
		const data = JSON.parse(event.data)
		console.log(data)

		if (data.type === 'command') {
			switch (data.name) {
				case 'Initialize Printer':
					printerState = {
						alignment: 'left',
						emphasized: false,
						underline: 0,
						charSize: 0,
						reversePrinting: false,
					}
					break
				case 'Set Alignment':
					printerState.alignment = data.details.alignment.toLowerCase()
					break
				case 'Set Emphasized Mode':
					printerState.emphasized = data.details.emphasized
					break
				case 'Set Underline Mode':
					printerState.underline = data.details.underline
					break
				case 'Set Char Size':
					printerState.charSize = data.details.size
					break
				case 'Set Reverse Printing':
					printerState.reversePrinting = data.details.reverse
					break
				case 'Cut Paper': {
					const cutLine = document.createElement('div')
					cutLine.className = 'cut-line'
					cutLine.textContent = '--- CUT ---'
					paper.appendChild(cutLine)
					break
				}
			}
		} else if (data.type === 'image') {
			const img = document.createElement('img')
			img.src = data.base64
			img.width = data.width
			img.height = data.height
			paper.appendChild(img)
		} else if (data.type === 'text') {
			data.content.split('\n').forEach((line) => {
				const div = document.createElement('div')
				div.style.textAlign = printerState.alignment
				if (printerState.emphasized) {
					div.style.fontWeight = 'bold'
				}
				if (printerState.underline) {
					div.style.textDecoration = 'underline'
				}
				if (printerState.charSize) {
					div.classList.add(`char-size-${printerState.charSize}`)
				}
				if (printerState.reversePrinting) {
					div.classList.add('reverse-printing')
				}
				div.textContent = line
				paper.appendChild(div)
			})
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

	socket.onerror = (error) => {
		console.error('WebSocket error:', error)
		socket.close() // Close the socket to trigger onclose and reconnect logic
	}
}

// Initial connection
connectWebSocket()
