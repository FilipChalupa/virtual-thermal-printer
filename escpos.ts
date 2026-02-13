import {
	EscPosTransformer,
	PrinterState as _PrinterState,
} from './escpos-transform.ts'

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
	conn: Deno.Conn, // deno-lint-ignore no-explicit-any
	connectedClients: Set<any>,
) {
	const remoteAddr = conn.remoteAddr
	const remoteAddrString = remoteAddr.transport === 'tcp'
		? `${remoteAddr.hostname}:${remoteAddr.port}`
		: 'unknown'
	console.log(`New connection from ${remoteAddrString}.`)

	await processEscPosStream(conn.readable, connectedClients)

	console.log(`Connection from ${remoteAddrString} closed.`)
}
