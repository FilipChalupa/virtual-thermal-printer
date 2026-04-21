import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { readFile } from 'node:fs/promises'
import { spawn, type ChildProcess } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))

async function waitForServerReady(url: string, retries = 20, delay = 500) {
	for (let i = 0; i < retries; i++) {
		try {
			const response = await fetch(url)
			if (response.ok) {
				return
			}
		} catch {
			// not ready yet
		}
		await new Promise((resolve) => setTimeout(resolve, delay))
	}
	throw new Error('Server did not become ready in time.')
}

describe('web render integration test', () => {
	let serverProcess: ChildProcess
	let baseUrl: string

	beforeAll(async () => {
		const httpPort = `${5000 + Math.floor(Math.random() * 1000)}`
		const socketPort = `${6000 + Math.floor(Math.random() * 1000)}`
		baseUrl = `http://127.0.0.1:${httpPort}`

		serverProcess = spawn(
			process.execPath,
			['--import', 'tsx/esm', join(__dirname, 'main.ts'), '--http', httpPort, '--socket', socketPort],
			{ stdio: 'inherit' },
		)

		await waitForServerReady(`${baseUrl}/health`)
	}, 30_000)

	afterAll(async () => {
		serverProcess.kill()
		await new Promise((resolve) => serverProcess.on('close', resolve))
	})

	it('should return OK for /health', async () => {
		const response = await fetch(`${baseUrl}/health`)
		expect(response.ok).toBe(true)
		expect(await response.text()).toBe('OK')
	})

	it('should handle the first ePOS request', async () => {
		const requestBody = await readFile(join(__dirname, 'fixtures/request1.xml'), 'utf-8')
		const response = await fetch(`${baseUrl}/cgi-bin/epos/service.cgi`, {
			method: 'POST',
			headers: { 'Content-Type': 'text/xml' },
			body: requestBody,
		})
		expect(response.ok).toBe(true)
		expect(await response.text()).toContain(
			'<response xmlns="http://www.epson-pos.com/schemas/2011/03/epos-print" success="true"',
		)
	})

	it('should handle the second ePOS request', async () => {
		const requestBody = await readFile(join(__dirname, 'fixtures/request2.xml'), 'utf-8')
		const response = await fetch(`${baseUrl}/cgi-bin/epos/service.cgi`, {
			method: 'POST',
			headers: { 'Content-Type': 'text/xml' },
			body: requestBody,
		})
		expect(response.ok).toBe(true)
		expect(await response.text()).toContain(
			'<response xmlns="http://www.epson-pos.com/schemas/2011/03/epos-print" success="true"',
		)
	})
})
