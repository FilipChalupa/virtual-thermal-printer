const images = document.querySelector('#images')

const delay = (milliseconds) =>
	new Promise((resolve) => setTimeout(resolve, milliseconds))

const connect = () => {
	console.log('Connecting to server…')
	const webSocket = new WebSocket('stream')

	webSocket.addEventListener('open', () => {
		console.log('Connected to server.')
		webSocket.send('Hello from client!')
	})

	webSocket.addEventListener('message', (event) => {
		const data = JSON.parse(event.data)
		if (data.type === 'image') {
			const image = document.createElement('img')
			image.src = data.url
			images.prepend(image)
		} else {
			console.log('Message from server:', event.data)
		}
	})

	webSocket.addEventListener('close', async () => {
		console.warn('Connection closed.')
		await delay(1000)
		connect()
	})
}

connect()
