import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { serveStatic, upgradeWebSocket } from 'hono/deno'
import { parseArgs } from '@std/cli/parse-args'
import { handleConnection, processEscPosStream } from './escpos.ts'

const appVersion = (() => {
	try {
		const denoConfig = JSON.parse(
			Deno.readTextFileSync(`${import.meta.dirname}/deno.json`),
		)
		if (denoConfig) {
			const { version } = denoConfig
			if (typeof version === 'string') {
				return version
			}
		}
	} catch (event) {
		console.error(
			'Failed to read app version from deno.json:',
			event instanceof Error ? event.message : event,
		)
	}
	return 'unknown'
})()
console.log(`App version: ${appVersion}`)

const flags = parseArgs(Deno.args, {
	string: ['http', 'socket'],
	default: { 'http': '80', 'socket': '9100' },
})

function validatePort(portValue: string | number, portName: string): number {
	const port = typeof portValue === 'string' ? parseInt(portValue) : portValue
	if (isNaN(port) || port < 1 || port > 65535) {
		throw new Error(`Invalid ${portName} port.`)
	}
	return port
}

const httpPort = validatePort(flags['http'], 'HTTP')
const socketPort = validatePort(flags['socket'], 'Socket')

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
		root: `${import.meta.dirname}/dist`,
	}),
)

Deno.serve(
	{
		port: httpPort,
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
		port: socketPort,
	})
	console.log(`Listening to Socket on port ${socketPort}.`)

	for await (const conn of escposListener) {
		;(async () => {
			await handleConnection(conn, connectedClients)
		})()
	}
}
