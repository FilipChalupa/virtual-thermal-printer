import { Readable } from 'node:stream'
import type { Socket } from 'node:net'
import { EscPosTransformer } from 'escpos-decoder'

const ESC = 0x1b
const INITIALIZE_PRINTER = 0x40 // '@' - the byte after ESC in "ESC @"

// Positive validation instead of a per-protocol blocklist: a genuine ESC/POS
// print job opens with "ESC @" (Initialize Printer). Every ESC/POS library
// emits it first and both of this project's fixtures start with it. Port
// scanners probing :9100 for other services all open with something else, so
// none pass this gate:
//   Redis     "*1\r\n$4\r\nPING\r\n"          -> '*'  (0x2a)
//   Memcached "stats\r\n"                       -> 's'  (0x73)
//   MongoDB   "..admin.$cmd..isMaster.."        -> message-length prefix
//   PJL       "@PJL INFO STATUS"                 -> '@'  (0x40)
//   PJL+UEL   "ESC %-12345X@PJL.."              -> ESC then '%' (0x25), not '@'
//   HTTP      "GET / HTTP/1.1"                   -> 'G'  (0x47)
//   TLS       ClientHello                        -> 0x16
//   Null-byte banner grab                        -> 0x00
// Requiring "ESC @" specifically (rather than any control byte) is what closes
// the UEL case, whose "ESC %" opening would otherwise pass an ESC-lead check.
// Trade-off: a print job that skips the initialize command would be rejected
// too, but that is vanishingly rare and an acceptable price for dropping every
// scanner protocol without chasing signatures.
export type EscPosStartVerdict = 'accept' | 'reject' | 'incomplete'

// Classify a connection's leading bytes. 'incomplete' means we cannot decide
// yet and need more bytes — only possible when a split TCP write delivers just
// the lone ESC of "ESC @" so far. The buffer is held (never forwarded) until it
// resolves to 'accept' or 'reject', so a probe that fragments a leading ESC
// byte cannot slip through on the "wait-and-see" byte.
export function classifyEscPosStart(leading: Uint8Array): EscPosStartVerdict {
	if (leading.length === 0) {
		return 'incomplete'
	}
	if (leading[0] !== ESC) {
		return 'reject'
	}
	if (leading.length < 2) {
		return 'incomplete'
	}
	return leading[1] === INITIALIZE_PRINTER ? 'accept' : 'reject'
}

class ProbeFilterTransformer implements Transformer<Uint8Array, Uint8Array> {
	#decided = false
	#pending: Uint8Array = new Uint8Array(0)

	transform(
		chunk: Uint8Array,
		controller: TransformStreamDefaultController<Uint8Array>,
	) {
		if (this.#decided) {
			controller.enqueue(chunk)
			return
		}

		// Accumulate leading bytes until we can tell whether the connection opens
		// with "ESC @". Nothing is forwarded downstream until we're sure.
		const merged = new Uint8Array(this.#pending.length + chunk.length)
		merged.set(this.#pending)
		merged.set(chunk, this.#pending.length)
		this.#pending = merged

		switch (classifyEscPosStart(this.#pending)) {
			case 'incomplete':
				return
			case 'reject':
				console.log(
					'Connection did not start as ESC/POS, ignoring (probe/scan).',
				)
				controller.terminate()
				return
			case 'accept':
				this.#decided = true
				controller.enqueue(this.#pending)
				this.#pending = new Uint8Array(0)
				return
		}
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
