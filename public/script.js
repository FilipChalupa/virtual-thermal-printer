const printerOutput = document.getElementById('printer-output')
let socket
let reconnectInterval = 1000 // Initial reconnect attempt after 1 second

let scrollTarget = 0 // Desired scroll position
let scrollAnimationId = null // To store requestAnimationFrame ID

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
	const threshold = 2 * printerOutput.clientHeight
	// Loop while scrollHeight exceeds the threshold and there's content to remove
	while (printerOutput.scrollHeight > threshold && printerOutput.firstChild) {
		printerOutput.removeChild(printerOutput.firstChild)
	}
}

function connectWebSocket() {
	socket = new WebSocket(`ws://${location.host}/stream`)

	socket.onopen = () => {
		console.log('WebSocket connected.')
		reconnectInterval = 1000 // Reset reconnect interval on successful connection
		// Clear existing content on successful reconnect
		while (printerOutput.firstChild) {
			printerOutput.removeChild(printerOutput.firstChild)
		}
	}

	socket.onmessage = (event) => {
		const data = JSON.parse(event.data)
		console.log(data)
		if (data.type === 'image') {
			const img = document.createElement('img')
			img.src = data.base64
			img.width = data.width
			img.height = data.height
			printerOutput.appendChild(img)
		} else if (data.type === 'text') {
			data.content.split('\n').forEach((line) => {
				const div = document.createElement('div')
				div.textContent = line
				printerOutput.appendChild(div)
			})
		} else if (data.type === 'command' && data.name === 'Cut Paper') {
			const cutLine = document.createElement('div')
			cutLine.className = 'cut-line'
			cutLine.textContent = '--- CUT ---'
			printerOutput.appendChild(cutLine)
		}
		updateScrollTargetAndAnimate()
		limitContentHeight()
	} // Closing brace for socket.onmessage, added for clarity.

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
