import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { serveStatic, upgradeWebSocket } from 'hono/deno'
import { parseArgs } from '@std/cli/parse-args'

const flags = parseArgs(Deno.args, {
	string: ['epos-port', 'escpos-port'],
	boolean: ['recall'],
	default: { 'epos-port': '8000', 'escpos-port': '9100', recall: false },
})

const eposPort = parseInt(flags['epos-port'])
if (isNaN(eposPort) || eposPort < 1 || eposPort > 65535) {
	throw new Error('Invalid Epos port.')
}
const escposPort = parseInt(flags['escpos-port'])
if (isNaN(escposPort) || escposPort < 1 || escposPort > 65535) {
	throw new Error('Invalid Escpos port.')
}

const app = new Hono()

const eposEndpoint = '/cgi-bin/epos/service.cgi'
app.use(eposEndpoint, cors())
app.post(eposEndpoint, async (_context) => {
	// @TODO
})
// deno-lint-ignore no-explicit-any
const connectedClients = new Set<any>()

app.get(
	'/stream',
	upgradeWebSocket((_c) => {
		return {
			onOpen: (
				_evt, // deno-lint-ignore no-explicit-any
				ws: any,
			) => {
				console.log('WebSocket opened.')
				connectedClients.add(ws)
			},
			onMessage: (
				_evt, // deno-lint-ignore no-explicit-any
				_ws: any,
			) => {
				// Do nothing for now
			},
			onClose: (
				_evt, // deno-lint-ignore no-explicit-any
				ws: any,
			) => {
				console.log('WebSocket closed.')
				connectedClients.delete(ws)
			},
			onError: (
				evt, // deno-lint-ignore no-explicit-any
				ws: any,
			) => {
				console.log('WebSocket error:', (evt as ErrorEvent).message)
				connectedClients.delete(ws)
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

const escposListener = Deno.listen({
	port: escposPort,
})
console.log(`Listening to ESCPOS on 0.0.0.0:${escposPort}.`)

import { handleConnection } from './escpos.ts'

for await (const conn of escposListener) {
	;(async () => {
		await handleConnection(conn, connectedClients)
	})()
}
