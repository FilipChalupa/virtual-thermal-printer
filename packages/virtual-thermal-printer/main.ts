import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { serve } from '@hono/node-server'
import type { ServerType } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { WebSocketServer, WebSocket } from 'ws'
import { parseArgs } from 'node:util'
import { readFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { isSea, getAsset } from 'node:sea'
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

app.get('/health', (context) => context.text('OK'))
app.get('/version', (context) => context.text(appVersion))

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

if (isSea()) {
	const mimeTypes: Record<string, string> = {
		html: 'text/html; charset=utf-8',
		js: 'application/javascript',
		css: 'text/css',
		png: 'image/png',
		mp3: 'audio/mpeg',
		json: 'application/json',
		webmanifest: 'application/manifest+json',
		map: 'application/json',
	}
	app.use('/*', (context) => {
		const assetKey = context.req.path.replace(/^\//, '') || 'index.html'
		const ext = assetKey.split('.').pop() ?? ''
		try {
			const data = getAsset(assetKey) as ArrayBuffer
			return context.body(data, 200, { 'Content-Type': mimeTypes[ext] ?? 'application/octet-stream' })
		} catch {
			try {
				const data = getAsset('index.html') as ArrayBuffer
				return context.body(data, 200, { 'Content-Type': 'text/html; charset=utf-8' })
			} catch {
				return context.text('Not found', 404)
			}
		}
	})
} else {
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	app.use('/*', serveStatic({ root: join(__dirname, 'dist') }) as any)
}

const connectedClients = new Set<WebSocket>()

const server: ServerType = serve(
	{
		fetch: app.fetch,
		port: httpPort,
		hostname: '0.0.0.0',
	},
	(info) => {
		console.log(`Listening to HTTP on http://${info.address}:${info.port}.`)
	},
)

const wss = new WebSocketServer({ noServer: true })

server.on('upgrade', (request, socket, head) => {
	if (request.url === '/stream') {
		wss.handleUpgrade(request, socket, head, (ws) => {
			wss.emit('connection', ws, request)
		})
	} else {
		socket.destroy()
	}
})

wss.on('connection', (ws) => {
	console.log('WebSocket opened.')
	connectedClients.add(ws)
	ws.on('close', () => {
		console.log('WebSocket closed.')
		connectedClients.delete(ws)
	})
	ws.on('error', (err) => {
		console.log('WebSocket error:', err.message)
		connectedClients.delete(ws)
	})
})

const escposServer = createServer((socket) => {
	handleConnection(socket, connectedClients)
})
escposServer.listen(socketPort, '0.0.0.0', () => {
	console.log(`Listening to Socket on port ${socketPort}.`)
})
