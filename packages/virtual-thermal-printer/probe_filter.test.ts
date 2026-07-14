import { describe, it, expect } from 'vitest'
import { containsHttpRequest, isConnectionProbe } from './escpos.js'

const bytes = (text: string) => new TextEncoder().encode(text)

describe('containsHttpRequest', () => {
	it('detects an HTTP request at the start of a chunk', () => {
		expect(containsHttpRequest(bytes('GET / HTTP/1.1\r\nHost: x'))).toBe(true)
		expect(containsHttpRequest(bytes('POST /api HTTP/1.0'))).toBe(true)
	})

	it('detects an HTTP request that follows binary junk in the same chunk', () => {
		const chunk = new Uint8Array([
			0x01,
			0x02,
			0xff,
			...bytes('GET /metrics HTTP/1.1'),
		])
		expect(containsHttpRequest(chunk)).toBe(true)
	})

	it('ignores ordinary ESC/POS receipt text', () => {
		expect(containsHttpRequest(bytes('Total: 12.00\nThank you!'))).toBe(false)
		expect(containsHttpRequest(new Uint8Array([0x1b, 0x40, 0x41, 0x42]))).toBe(
			false,
		)
	})
})

describe('isConnectionProbe', () => {
	it('detects a TLS handshake', () => {
		expect(isConnectionProbe(new Uint8Array([0x16, 0x03, 0x01]))).toBe(true)
	})

	it('detects a leading null-byte banner grab', () => {
		expect(isConnectionProbe(new Uint8Array([0x00, 0x00, 0x12]))).toBe(true)
	})

	it('detects a PJL fingerprinting probe', () => {
		expect(isConnectionProbe(bytes('@PJL INFO STATUS\r\n'))).toBe(true)
	})

	it('detects a UEL-prefixed PJL probe', () => {
		expect(isConnectionProbe(bytes('\x1b%-12345X@PJL INFO ID\r\n'))).toBe(true)
	})

	it('does not flag normal ESC/POS data', () => {
		expect(isConnectionProbe(new Uint8Array([0x1b, 0x40]))).toBe(false)
		expect(isConnectionProbe(bytes('Hello receipt'))).toBe(false)
	})
})
