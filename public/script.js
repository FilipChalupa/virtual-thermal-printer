const imagesCountLimit = 10
const images = document.querySelector('#images')
const disconnected = document.querySelector('#disconnected')

const delay = (milliseconds) =>
	new Promise((resolve) => setTimeout(resolve, milliseconds))

const connect = () => {
	console.log('Connecting to server…')
	const webSocket = new WebSocket('stream')

	webSocket.addEventListener('open', () => {
		console.log('Connected to server.')
		disconnected.setAttribute('hidden', true)
		webSocket.send('Hello from client!')
	})

	webSocket.addEventListener('message', (event) => {
		const data = JSON.parse(event.data)
		if (data.type === 'image') {
			Array.from(images.childNodes)
				.slice(imagesCountLimit - 1)
				.forEach((child) => {
					child.remove()
				})
			const wrapper = document.createElement('div')
			const image = document.createElement('img')
			image.src = data.url
			wrapper.appendChild(image)
			images.prepend(wrapper)
		} else {
			console.log('Message from server:', event.data)
		}
	})

	webSocket.addEventListener('close', async () => {
		console.warn('Connection closed.')
		disconnected.removeAttribute('hidden')
		await delay(1000)
		connect()
	})
}

connect()
