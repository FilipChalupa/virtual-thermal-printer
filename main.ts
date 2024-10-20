import { Hono } from 'hono'
import { serveStatic, upgradeWebSocket } from 'hono/deno'
import type { WSContext } from 'hono/ws'
import { decodeHex } from 'https://deno.land/std/encoding/hex.ts'
import { Buffer } from 'https://deno.land/std/io/buffer.ts'
import { parseArgs } from 'jsr:@std/cli/parse-args'
import { parseCommands } from './utilities/parseCommands.ts'
import { transformCommandsToCanvases } from './utilities/transformCommandsToCanvases.ts'

const flags = parseArgs(Deno.args, {
	string: ['port'],
	default: { port: '80' },
})

const port = parseInt(flags.port)
if (isNaN(port) || port < 1 || port > 65535) {
	throw new Error('Invalid port')
}

// @TODO: CORS

let lastImagePayload: string | null = null // Maybe remove - debug only

const printerDotsPerLine = 576 // @TODO: Parametrize this

const app = new Hono()

const webSocketClients = new Set<WSContext>()

app.post('/cgi-bin/epos/service.cgi', async (context) => {
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
		lastImagePayload = payload
		for (const client of webSocketClients) {
			client.send(payload)
		}
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
				if (lastImagePayload) {
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
		port,
		onListen(localAddress) {
			console.log(
				`Listening to EPOS on http://${localAddress.hostname}:${localAddress.port}`,
			)
		},
	},
	app.fetch,
)
