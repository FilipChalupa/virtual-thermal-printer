import { Readable } from 'node:stream'
import type { Socket } from 'node:net'
import { EscPosTransformer } from 'escpos-decoder'

const HTTP_METHODS = [
	'GET ',
	'POST ',
	'HEAD ',
	'OPTIONS ',
	'PUT ',
	'DELETE ',
	'CONNECT ',
	'TRACE ',
	'PATCH ',
	'PRI ',
].map((method) => new TextEncoder().encode(method))

const TLS_HANDSHAKE = new Uint8Array([0x16, 0x03])

function isProbe(chunk: Uint8Array): boolean {
	if (chunk.length === 0) {
		return false
	}

	for (const method of HTTP_METHODS) {
		if (chunk.length >= method.length) {
			let match = true
			for (let i = 0; i < method.length; i++) {
				if (chunk[i] !== method[i]) {
					match = false
					break
				}
			}
			if (match) {
				return true
			}
		}
	}

	if (chunk.length >= TLS_HANDSHAKE.length) {
		if (chunk[0] === TLS_HANDSHAKE[0] && chunk[1] === TLS_HANDSHAKE[1]) {
			return true
		}
	}

	if (chunk.length >= 2 && chunk[0] === 0x00 && chunk[1] === 0x00) {
		return true
	}

	return false
}

class ProbeFilterTransformer implements Transformer<Uint8Array, Uint8Array> {
	#firstChunkChecked = false

	transform(
		chunk: Uint8Array,
		controller: TransformStreamDefaultController<Uint8Array>,
	) {
		if (!this.#firstChunkChecked) {
			this.#firstChunkChecked = true
			if (isProbe(chunk)) {
				console.log('Probe detected, ignoring connection.')
				controller.terminate()
				return
			}
		}
		controller.enqueue(chunk)
	}
}

export async function processEscPosStream(
	stream: ReadableStream<Uint8Array>,
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	connectedClients: Set<any>,
) {
	const escPosTransformer = new TransformStream(new EscPosTransformer())

	try {
		const parsedBlocks = stream.pipeThrough(escPosTransformer)

		const reader = parsedBlocks.getReader()
		try {
			while (true) {
				const { done, value: block } = await reader.read()
				if (done) break

				const dataToSend = JSON.stringify(block)
				for (const client of connectedClients) {
					client.send(dataToSend)
				}
			}
		} finally {
			reader.releaseLock()
		}
	} catch (error) {
		console.error('Error in handling connection or parsing stream:', error)
	}
}

export async function handleConnection(
	socket: Socket,
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	connectedClients: Set<any>,
) {
	const remoteAddressString = socket.remoteAddress && socket.remotePort
		? `${socket.remoteAddress}:${socket.remotePort}`
		: 'unknown'
	console.log(`New connection from ${remoteAddressString}.`)

	try {
		const readable = Readable.toWeb(socket) as ReadableStream<Uint8Array>
		await processEscPosStream(
			readable.pipeThrough(
				new TransformStream(new ProbeFilterTransformer()),
			),
			connectedClients,
		)
	} catch (error) {
		if (!(error instanceof Error && error.message.includes('terminate'))) {
			console.error(
				`Error handling connection from ${remoteAddressString}:`,
				error,
			)
		}
	} finally {
		try {
			socket.destroy()
		} catch (_error) {
			// Socket might already be closed
		}
	}

	console.log(`Connection from ${remoteAddressString} closed.`)
}
