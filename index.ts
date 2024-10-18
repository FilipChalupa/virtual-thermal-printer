import { serve } from '@hono/node-server'
import { readFileSync } from 'fs'
import { Hono } from 'hono'
import { serveStatic } from 'hono/serve-static'

const app = new Hono()
app.get('/cgi-bin/epos/service.cgi', (context) => {
	context.header('Content-Type', 'text/xml')
	return context.body(
		'<?xml version="1.0" encoding="utf-8"?><s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Header><parameter xmlns="http://www.epson-pos.com/schemas/2011/03/epos-print"><devid>local_printer</devid><printjobid></printjobid></parameter></s:Header><s:Body><response success="true" code="" status="251658262" battery="0" xmlns="http://www.epson-pos.com/schemas/2011/03/epos-print"></response></s:Body></s:Envelope>',
	)
})
app.use(
	'/*',
	serveStatic({
		root: './public',
		getContent: async (path) => {
			return readFileSync(path, 'utf-8')
		},
	}),
)

serve(
	{
		fetch: app.fetch,
		port:
			80 *
			100 /* The intended port is 80 but Linux gives permission denied on such a privileged port */,
	},
	(info) => {
		console.log(`Listening EPOS on http://localhost:${info.port}`)
	},
)
