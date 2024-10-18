const delay = (milliseconds) =>
	new Promise((resolve) => setTimeout(resolve, milliseconds))

const connect = () => {
	console.log('Connecting to server…')
	const webSocket = new WebSocket('stream')

	webSocket.addEventListener('open', () => {
		console.log('Connected to server.')
		webSocket.send('Hello from client!')
	})

	webSocket.addEventListener('close', async () => {
		console.warn('Connection closed.')
		await delay(1000)
		connect()
	})
}

connect()
