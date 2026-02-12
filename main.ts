import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { serveStatic, upgradeWebSocket } from 'hono/deno'
import { parseArgs } from '@std/cli/parse-args'
import { handleConnection, processEscPosStream } from './escpos.ts'

const flags = parseArgs(Deno.args, {
	string: ['http', 'socket'],
	default: { 'http': '80', 'socket': '9100' },
})

const eposPort = parseInt(flags['http'])
if (isNaN(eposPort) || eposPort < 1 || eposPort > 65535) {
	throw new Error('Invalid HTTP port.')
}
const escposPort = parseInt(flags['socket'])
if (isNaN(escposPort) || escposPort < 1 || escposPort > 65535) {
	throw new Error('Invalid Socket port.')
}

const app = new Hono()

const eposEndpoint = '/cgi-bin/epos/service.cgi'
app.use(eposEndpoint, cors())
app.post(eposEndpoint, async (context) => {
	const requestBody = await context.req.text()

	const commandMatch = requestBody.match(/<command>([^<]+)<\/command>/)
	if (!commandMatch || !commandMatch[1]) {
		return context.text('Invalid ePOS request', 400)
	}

	const hexCommand = commandMatch[1]
	const commandBytes = new Uint8Array(
		hexCommand.match(/.{1,2}/g)!.map((byte) => parseInt(byte, 16)),
	)

	const stream = new ReadableStream({
		start(controller) {
			controller.enqueue(commandBytes)
			controller.close()
		},
	})

	await processEscPosStream(stream, connectedClients)

	return context.text(
		`<?xml version="1.0" encoding="utf-8"?><s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body><response xmlns="http://www.epson-pos.com/schemas/2011/03/epos-print" success="true" code="" status="0" batterystatus="0" printjobid="2" /></s:Body></s:Envelope>`,
		200,
		{ 'Content-Type': 'text/xml' },
	)
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
		root: `${import.meta.dirname}/public`,
	}),
)

Deno.serve(
	{
		port: eposPort,
		onListen(localAddress) {
			console.log(
				`Listening to HTTP on http://${localAddress.hostname}:${localAddress.port}.`,
			)
		},
	},
	app.fetch,
)

if (!Deno.env.get('DENO_DEPLOYMENT_ID')) {
	const escposListener = Deno.listen({
		port: escposPort,
	})
	console.log(`Listening to Socket on 0.0.0.0:${escposPort}.`)

	for await (const conn of escposListener) {
		;(async () => {
			await handleConnection(conn, connectedClients)
		})()
	}
}
