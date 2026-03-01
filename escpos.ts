import {
	EscPosTransformer,
	PrinterState as _PrinterState,
} from './escpos-transform.ts'

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
	'PRI ', // HTTP/2
].map((method) => new TextEncoder().encode(method))

const TLS_HANDSHAKE = new Uint8Array([0x16, 0x03])

function isProbe(chunk: Uint8Array): boolean {
	if (chunk.length === 0) {
		return false
	}

	// Check for HTTP methods
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

	// Check for TLS handshake
	if (chunk.length >= TLS_HANDSHAKE.length) {
		if (chunk[0] === TLS_HANDSHAKE[0] && chunk[1] === TLS_HANDSHAKE[1]) {
			return true
		}
	}

	// Check for null bytes at the start, often used by scanners
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
				// Probe detected, stop processing this stream
				controller.terminate()
				return
			}
		}
		controller.enqueue(chunk)
	}
}

export async function processEscPosStream(
	// deno-lint-ignore no-explicit-any
	stream: ReadableStream<any>,
	// deno-lint-ignore no-explicit-any
	connectedClients: Set<any>,
) {
	// Create an instance of the TransformStream
	const escPosTransformer = new TransformStream(new EscPosTransformer())

	try {
		// Pipe the incoming connection stream through the ESC/POS transformer
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
	connection: Deno.Conn, // deno-lint-ignore no-explicit-any
	connectedClients: Set<any>,
) {
	const remoteAddress = connection.remoteAddr
	const remoteAddressString = remoteAddress.transport === 'tcp'
		? `${remoteAddress.hostname}:${remoteAddress.port}`
		: 'unknown'
	console.log(`New connection from ${remoteAddressString}.`)

	try {
		await processEscPosStream(
			connection.readable.pipeThrough(
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
			connection.close()
		} catch (_error) {
			// Connection might already be closed
		}
	}

	console.log(`Connection from ${remoteAddressString} closed.`)
}
