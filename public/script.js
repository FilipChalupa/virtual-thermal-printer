const printerOutput = document.getElementById('printer-output')
let socket
let reconnectInterval = 1000 // Initial reconnect attempt after 1 second

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
		if (data.type === 'image') {
			console.log('Received image data:', data)
			console.log('Image dimensions:', data.width, 'x', data.height)
			console.log('Image data length:', data.data.length)
			console.log('First 10 pixels of image data:', data.data.slice(0, 10))

			const canvas = document.createElement('canvas')
			canvas.width = data.width
			canvas.height = data.height
			const ctx = canvas.getContext('2d')
			if (ctx) {
				const imageData = ctx.createImageData(data.width, data.height)
				let byteIndex = 0
				for (let y = 0; y < data.height; y++) {
					for (let x = 0; x < data.width; x += 8) { // Process 8 pixels at a time
						const byte = data.data[byteIndex]
						for (let bit = 0; bit < 8; bit++) {
							if (x + bit < data.width) { // Ensure we don't go past image width
								const pixelIndex = ((y * data.width) + (x + bit)) * 4
								const isBlack = (byte >> (7 - bit)) & 0x01
								const color = isBlack ? 0 : 255 // 0 for black, 255 for white

								imageData.data[pixelIndex] = color // R
								imageData.data[pixelIndex + 1] = color // G
								imageData.data[pixelIndex + 2] = color // B
								imageData.data[pixelIndex + 3] = 255 // A
							}
						}
						byteIndex++
					}
				}
				ctx.putImageData(imageData, 0, 0)
			}
			printerOutput.appendChild(canvas)
			scrollToBottom()
		} else if (data.type === 'text') {
			data.content.split('\n').forEach((line) => {
				const div = document.createElement('div')
				div.textContent = line
				printerOutput.appendChild(div)
			})
			scrollToBottom()
		}
	}

	function scrollToBottom() {
		requestAnimationFrame(() => {
			printerOutput.scrollTop = printerOutput.scrollHeight
		})
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
