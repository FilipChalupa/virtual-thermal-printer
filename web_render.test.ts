import { assert } from '@std/assert/mod.ts'

Deno.test('web render integration test', async (testContext) => {
	const port = `${5000 + Math.floor(Math.random() * 1000)}` // Use a random port for testing
	const serverCommand = new Deno.Command('deno', {
		args: [
			'run',
			'--allow-net',
			'--allow-read',
			'--allow-env',
			'--allow-write', // Allow write for fixture generation (if needed) or other server operations
			'main.ts',
			'--http',
			port,
			'--hostname',
			'127.0.0.1',
		],
		stdout: 'inherit',
		stderr: 'inherit',
	})
	const serverProcess = serverCommand.spawn()

	const baseUrl = `http://127.0.0.1:${port}`
	
		try {
			// Wait for the server to start
			await new Promise((resolve) => setTimeout(resolve, 1000))
	
			await testContext.step('should handle the first ePOS request', async () => {
				const requestBody1 = await Deno.readTextFile('./fixtures/request1.xml')
				const response = await fetch(`${baseUrl}/cgi-bin/epos/service.cgi`, {
					method: 'POST',
					headers: {
						'Content-Type': 'text/xml',
					},
					body: requestBody1,
				})
				assert(response.ok, `HTTP error! status: ${response.status}`)
				const responseText = await response.text()
				assert(
					responseText.includes(
						'<response xmlns="http://www.epson-pos.com/schemas/2011/03/epos-print" success="true"',
					),
					'Expected success response',
				)
			})
	
			await testContext.step('should handle the second ePOS request', async () => {
				const requestBody2 = await Deno.readTextFile('./fixtures/request2.xml')
				const response = await fetch(`${baseUrl}/cgi-bin/epos/service.cgi`, {
					method: 'POST',
					headers: {
						'Content-Type': 'text/xml',
					},
					body: requestBody2,
				})
				assert(response.ok, `HTTP error! status: ${response.status}`)
				const responseText = await response.text()
				assert(
					responseText.includes(
						'<response xmlns="http://www.epson-pos.com/schemas/2011/03/epos-print" success="true"',
					),
					'Expected success response',
				)
			})
		} finally {
			serverProcess.kill()
			await serverProcess.status
		}})
