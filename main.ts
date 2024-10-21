import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { serveStatic, upgradeWebSocket } from 'hono/deno'
import type { WSContext } from 'hono/ws'
import { decodeHex } from 'https://deno.land/std/encoding/hex.ts'
import { Buffer } from 'https://deno.land/std/io/buffer.ts'
import { parseArgs } from 'jsr:@std/cli/parse-args'
import { parseCommands } from './utilities/parseCommands.ts'
import { transformCommandsToCanvases } from './utilities/transformCommandsToCanvases.ts'

const flags = parseArgs(Deno.args, {
	string: ['epos-port', 'escpos-port'],
	boolean: ['recall'],
	default: { 'epos-port': '80', 'escpos-port': '9100', recall: false },
})

const eposPort = parseInt(flags['epos-port'])
if (isNaN(eposPort) || eposPort < 1 || eposPort > 65535) {
	throw new Error('Invalid Epos port')
}
const escposPort = parseInt(flags['escpos-port'])
if (isNaN(escposPort) || escposPort < 1 || escposPort > 65535) {
	throw new Error('Invalid Escpos port')
}

let lastImagePayload: string | null = null // Maybe remove - debug only

const printerDotsPerLine = 576 // @TODO: Parametrize this

const app = new Hono()

const webSocketClients = new Set<WSContext>()

const instancesSynchronizationChannel = new BroadcastChannel('synchronization')

const broadcastImagePayload = (payload: string) => {
	lastImagePayload = payload
	broadcastImagePayloadToWebSocketClients(payload)
	instancesSynchronizationChannel.postMessage(payload)
}

const broadcastImagePayloadToWebSocketClients = (payload: string) => {
	for (const client of webSocketClients) {
		client.send(payload)
	}
}

instancesSynchronizationChannel.addEventListener('message', (event) => {
	const payload = event.data
	lastImagePayload = payload
	broadcastImagePayloadToWebSocketClients(payload)
})

const eposEndpoint = '/cgi-bin/epos/service.cgi'
app.use(eposEndpoint, cors())
app.post(eposEndpoint, async (context) => {
	const { commands } = parseCommands(
		await (async () => {
			// @TODO: Validate headers and body
			const body = await (await context.req.blob()).text()
			const commandsAsHexString = body
				.match(new RegExp('<command>(.*)</command>'))
				?.at(1)
			if (!commandsAsHexString) {
				throw new Error('Invalid commands')
			}
			const binaryCommands = new Buffer(decodeHex(commandsAsHexString))
			return binaryCommands.bytes()
		})(),
	)
	const canvases = transformCommandsToCanvases(commands, printerDotsPerLine)
	canvases.forEach((canvas) => {
		const payload = JSON.stringify({
			type: 'image',
			url: canvas.canvas.toDataURL(),
		})
		broadcastImagePayload(payload)
	})

	context.header('Content-Type', 'text/xml')
	return context.body(
		'<?xml version="1.0" encoding="utf-8"?><s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Header><parameter xmlns="http://www.epson-pos.com/schemas/2011/03/epos-print"><devid>local_printer</devid><printjobid></printjobid></parameter></s:Header><s:Body><response success="true" code="" status="251658262" battery="0" xmlns="http://www.epson-pos.com/schemas/2011/03/epos-print"></response></s:Body></s:Envelope>',
	)
})
app.get(
	'/stream',
	upgradeWebSocket(() => {
		return {
			onOpen: (_event, context) => {
				console.log('Connection opened')
				webSocketClients.add(context)
			},
			onMessage(event, context) {
				console.log(`Message from client: ${event.data}`)
				context.send(
					JSON.stringify({
						type: 'message',
						message: 'Hello from server!',
					}),
				)
				if (lastImagePayload && flags.recall) {
					for (const client of webSocketClients) {
						client.send(lastImagePayload)
					}
				}
			},
			onClose: (_event, context) => {
				console.log('Connection closed')
				webSocketClients.delete(context)
			},
		}
	}),
)
app.use(
	'/*',
	serveStatic({
		root: './public',
	}),
)

Deno.serve(
	{
		port: eposPort,
		onListen(localAddress) {
			console.log(
				`Listening to EPOS on http://${localAddress.hostname}:${localAddress.port}.`,
			)
		},
	},
	app.fetch,
)

const listener = Deno.listen({
	port: escposPort,
})
console.log(`Listening to ESCPOS on 0.0.0.0:${escposPort}.`)
for await (const r of listener) {
	r.localAddr
	r.remoteAddr
}
