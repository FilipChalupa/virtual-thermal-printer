import { serve } from '@hono/node-server'
import { Hono } from 'hono'

const app = new Hono()
app.get('/', (c) => c.text('Hello Node.js!'))

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
