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
export function looksLikeEscPos(chunk: Uint8Array): boolean {
	if (chunk.length === 0 || chunk[0] !== ESC) {
		return false
	}
	// A split TCP write can deliver just the ESC of "ESC @" in the first chunk;
	// accept the lone ESC and let the second byte arrive in the next chunk.
	if (chunk.length === 1) {
		return true
	}
	return chunk[1] === INITIALIZE_PRINTER
}

class ProbeFilterTransformer implements Transformer<Uint8Array, Uint8Array> {
	#firstChunkChecked = false

	transform(
		chunk: Uint8Array,
		controller: TransformStreamDefaultController<Uint8Array>,
	) {
		// Wait for the first non-empty chunk before deciding.
		if (!this.#firstChunkChecked && chunk.length > 0) {
			this.#firstChunkChecked = true
			if (!looksLikeEscPos(chunk)) {
				console.log(
					'Connection did not start as ESC/POS, ignoring (probe/scan).',
				)
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
