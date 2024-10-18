import { serve } from '@hono/node-server'
import { createNodeWebSocket } from '@hono/node-ws'
import { readFileSync } from 'fs'
import { Hono } from 'hono'
import { serveStatic } from 'hono/serve-static'
import type { WSContext } from 'hono/ws'
import { parseCommands } from './utilities/parseCommands.ts'
import { transformCommandsToCanvases } from './utilities/transformCommandsToCanvases.ts'

// @TODO: CORS

const printerDotsPerLine = 576 // @TODO: Parametrize this

const app = new Hono()

const { injectWebSocket, upgradeWebSocket } = createNodeWebSocket({ app })

const webSocketClients = new Set<WSContext>()

app.post('/cgi-bin/epos/service.cgi', async (context) => {
	// @TODO: Validate headers and body
	const body = await (await context.req.blob()).text()
	const commandsAsHexString = body
		.match(new RegExp('<command>(.*)</command>'))
		?.at(1)
	if (!commandsAsHexString) {
		throw new Error('Invalid commands')
	}
	const binaryCommands = Buffer.from(commandsAsHexString, 'hex')
	const { commands } = parseCommands(binaryCommands)
	const canvases = transformCommandsToCanvases(commands, printerDotsPerLine)
	canvases.forEach((canvas) => {
		webSocketClients.forEach((client) => {
			client.send(
				JSON.stringify({ type: 'image', url: canvas.canvas.toDataURL() }),
			)
		})
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
			onOpen: (event, context) => {
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
			},
			onClose: (event, context) => {
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
		getContent: async (path) => {
			return readFileSync(path, 'utf-8')
		},
	}),
)

const server = serve(
	{
		fetch: app.fetch,
		port:
			80 *
			100 /* The intended port is 80 but Linux gives permission denied on such a privileged port */,
	},
	(info) => {
		console.log(`Listening to EPOS on http://localhost:${info.port}`)
	},
)
injectWebSocket(server)
