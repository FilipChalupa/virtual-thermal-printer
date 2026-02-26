import { assert } from '@std/assert/mod.ts'

Deno.test('web render integration test', async (testContext) => {
	const httpPort = `${5000 + Math.floor(Math.random() * 1000)}` // Use a random HTTP port for testing
	const socketPort = `${6000 + Math.floor(Math.random() * 1000)}` // Use a random Socket port for testing
	const serverCommand = new Deno.Command('deno', {
		args: [
			'run',
			'--allow-net',
			'--allow-read',
			'--allow-env',
			'--allow-write', // Allow write for fixture generation (if needed) or other server operations
			'main.ts',
			'--http',
			httpPort,
			'--socket',
			socketPort,
			'--hostname',
			'127.0.0.1',
		],
		stdout: 'inherit',
		stderr: 'inherit',
	})
	const serverProcess = serverCommand.spawn()

	const baseUrl = `http://127.0.0.1:${httpPort}`

	const waitForServerReady = async (url: string, retries = 10, delay = 500) => {
		for (let i = 0; i < retries; i++) {
			try {
				const response = await fetch(url)
				if (response.ok) {
					console.log('Server is ready.')
					return true
				}
			} catch (_e) {
				// console.log(`Server not ready, retrying... (${i + 1}/${retries})`);
			}
			await new Promise((resolve) => setTimeout(resolve, delay))
		}
		throw new Error('Server did not become ready in time.')
	}

	try {
		await waitForServerReady(baseUrl)

		await testContext.step('should return OK for /health', async () => {
			const response = await fetch(`${baseUrl}/health`)
			assert(response.ok, `HTTP error! status: ${response.status}`)
			const responseText = await response.text()
			assert(responseText === 'OK', `Expected OK, got ${responseText}`)
		})

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

		await testContext.step(
			'should handle the second ePOS request',
			async () => {
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
			},
		)
	} finally {
		// Small delay to allow the server to shut down cleanly
		await new Promise((resolve) => setTimeout(resolve, 500))
		serverProcess.kill()
		await serverProcess.status
	}
})
