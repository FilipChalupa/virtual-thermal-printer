import { Hono } from 'hono'
import type { Context } from 'hono'
import { cors } from 'hono/cors'
import { serve } from '@hono/node-server'
import type { AddressInfo } from 'node:net'
import { serveStatic } from '@hono/node-server/serve-static'
import { createNodeWebSocket } from '@hono/node-server/ws'
import { parseArgs } from 'node:util'
import { readFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { handleConnection, processEscPosStream } from './escpos.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

const appVersion = (() => {
	try {
		const pkgJson = JSON.parse(
			readFileSync(join(__dirname, 'package.json'), 'utf-8'),
		)
		if (typeof pkgJson.version === 'string') {
			return pkgJson.version
		}
	} catch (event) {
		console.error(
			'Failed to read app version from package.json:',
			event instanceof Error ? event.message : event,
		)
	}
	return 'unknown'
})()
console.log(`App version: ${appVersion}`)

const { values: flags } = parseArgs({
	args: process.argv.slice(2),
	options: {
		http: { type: 'string', default: '80' },
		socket: { type: 'string', default: '9100' },
	},
})

function validatePort(portValue: string | number, portName: string): number {
	const port = typeof portValue === 'string' ? parseInt(portValue) : portValue
	if (isNaN(port) || port < 1 || port > 65535) {
		throw new Error(`Invalid ${portName} port.`)
	}
	return port
}

const httpPort = validatePort(flags['http'] ?? '80', 'HTTP')
const socketPort = validatePort(flags['socket'] ?? '9100', 'Socket')

const app = new Hono()
const { injectWebSocket, upgradeWebSocket } = createNodeWebSocket({ app })

app.get('/health', (context) => context.text('OK'))

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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const connectedClients = new Set<any>()

app.get(
	'/stream',
	upgradeWebSocket((_c: Context) => {
		return {
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			onOpen: (_evt: any, ws: any) => {
				console.log('WebSocket opened.')
				connectedClients.add(ws)
			},
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			onMessage: (_evt: any, _ws: any) => {
				// Do nothing for now
			},
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			onClose: (_evt: any, ws: any) => {
				console.log('WebSocket closed.')
				connectedClients.delete(ws)
			},
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			onError: (evt: any, ws: any) => {
				console.log('WebSocket error:', (evt as ErrorEvent).message)
				connectedClients.delete(ws)
			},
		}
	}),
)

app.use(
	'/*',
	serveStatic({ root: join(__dirname, 'dist') }),
)

const server = serve(
	{
		fetch: app.fetch,
		port: httpPort,
		hostname: '0.0.0.0',
	},
	(info: AddressInfo) => {
		console.log(
			`Listening to HTTP on http://${info.address}:${info.port}.`,
		)
	},
)
injectWebSocket(server)

const escposServer = createServer((socket) => {
	handleConnection(socket, connectedClients)
})
escposServer.listen(socketPort, '0.0.0.0', () => {
	console.log(`Listening to Socket on port ${socketPort}.`)
})
