import { Readable } from 'node:stream'
import type { Socket } from 'node:net'
import { EscPosTransformer } from 'escpos-decoder'

const encoder = new TextEncoder()

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
].map((method) => encoder.encode(method))

// Appears in every HTTP request line ("GET /metrics HTTP/1.1"), so it catches
// requests that show up mid-stream after other junk, not just at a chunk start.
const HTTP_REQUEST_LINE = encoder.encode(' HTTP/1.')

const TLS_HANDSHAKE = new Uint8Array([0x16, 0x03])

// Printer Job Language probes. Scanners open a raw :9100 connection and send a
// PJL query to fingerprint the device, e.g. "@PJL INFO STATUS", often prefixed
// with the UEL sequence "ESC %-12345X". Real ESC/POS receipt data never
// contains these signatures.
const PJL_SIGNATURES = ['@PJL', '\x1b%-12345X'].map((signature) =>
	encoder.encode(signature),
)

function chunkStartsWith(chunk: Uint8Array, prefix: Uint8Array): boolean {
	if (chunk.length < prefix.length) {
		return false
	}
	for (let i = 0; i < prefix.length; i++) {
		if (chunk[i] !== prefix[i]) {
			return false
		}
	}
	return true
}

function chunkIncludes(chunk: Uint8Array, needle: Uint8Array): boolean {
	if (needle.length === 0 || chunk.length < needle.length) {
		return false
	}
	outer: for (let i = 0; i <= chunk.length - needle.length; i++) {
		for (let j = 0; j < needle.length; j++) {
			if (chunk[i + j] !== needle[j]) {
				continue outer
			}
		}
		return true
	}
	return false
}

// HTTP request traffic (port scanners, browsers, NVMS-9000 banner grabs) can
// arrive in any chunk, including after binary junk on a held-open connection,
// so this is checked on every chunk rather than only the first one.
export function containsHttpRequest(chunk: Uint8Array): boolean {
	for (const method of HTTP_METHODS) {
		if (chunkStartsWith(chunk, method)) {
			return true
		}
	}
	return chunkIncludes(chunk, HTTP_REQUEST_LINE)
}

// Handshakes / banners / fingerprinting probes that only make sense at the
// very start of a connection. Checked on the first chunk only, since some of
// these byte patterns (TLS ClientHello, leading null bytes) legitimately occur
// inside ESC/POS raster image data mid-stream.
export function isConnectionProbe(chunk: Uint8Array): boolean {
	if (chunk.length === 0) {
		return false
	}
	if (chunkStartsWith(chunk, TLS_HANDSHAKE)) {
		return true
	}
	if (chunk[0] === 0x00 && chunk[1] === 0x00) {
		return true
	}
	for (const signature of PJL_SIGNATURES) {
		if (chunkIncludes(chunk, signature)) {
			return true
		}
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
			if (isConnectionProbe(chunk)) {
				console.log('Probe detected, ignoring connection.')
				controller.terminate()
				return
			}
		}
		if (containsHttpRequest(chunk)) {
			console.log('HTTP request detected, ignoring connection.')
			controller.terminate()
			return
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
