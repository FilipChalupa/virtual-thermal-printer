import { serve } from '@hono/node-server'
import { createNodeWebSocket } from '@hono/node-ws'
import { readFileSync } from 'fs'
import { Hono } from 'hono'
import { serveStatic } from 'hono/serve-static'
import type { WSContext } from 'hono/ws'

const app = new Hono()

const { injectWebSocket, upgradeWebSocket } = createNodeWebSocket({ app })

const webSocketClients = new Set<WSContext>()

app.get('/cgi-bin/epos/service.cgi', (context) => {
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
				context.send('Hello from server!')
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
