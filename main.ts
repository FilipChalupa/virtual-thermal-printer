import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { serveStatic, upgradeWebSocket } from 'hono/deno'
import { parseArgs } from 'jsr:@std/cli/parse-args'

const flags = parseArgs(Deno.args, {
	string: ['epos-port', 'escpos-port'],
	boolean: ['recall'],
	default: { 'epos-port': '80', 'escpos-port': '9100', recall: false },
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
app.post(eposEndpoint, async (context) => {
	// @TODO
})
app.get(
	'/stream',
	upgradeWebSocket(() => {
		//
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
				`Listening on http://${localAddress.hostname}:${localAddress.port}.`,
			)
		},
	},
	app.fetch,
)

const listener = Deno.listen({
	port: escposPort,
})
console.log(`Listening to ESCPOS on 0.0.0.0:${escposPort}.`)

listener // @TODO: handle escpos connections
