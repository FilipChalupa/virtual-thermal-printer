import { describe, it, expect } from 'vitest'
import { classifyEscPosStart } from './escpos.js'

const bytes = (text: string) => new TextEncoder().encode(text)

describe('classifyEscPosStart', () => {
	it('accepts a job that starts with ESC @ (Initialize Printer)', () => {
		// Both fixture print jobs open with these bytes.
		expect(classifyEscPosStart(new Uint8Array([0x1b, 0x40, 0x41, 0x42]))).toBe(
			'accept',
		)
	})

	it('waits (incomplete) when only the lone ESC has arrived so far', () => {
		expect(classifyEscPosStart(new Uint8Array([0x1b]))).toBe('incomplete')
	})

	it('waits (incomplete) on an empty buffer', () => {
		expect(classifyEscPosStart(new Uint8Array([]))).toBe('incomplete')
	})

	it('rejects ESC followed by a non-initialize command byte', () => {
		expect(classifyEscPosStart(new Uint8Array([0x1b, 0x61, 0x01]))).toBe(
			'reject',
		) // ESC a
		expect(classifyEscPosStart(new Uint8Array([0x1d, 0x56, 0x00]))).toBe(
			'reject',
		) // GS V (no ESC @)
	})

	it('rejects a Redis PING probe', () => {
		expect(classifyEscPosStart(bytes('*1\r\n$4\r\nPING\r\n'))).toBe('reject')
	})

	it('rejects a Memcached stats probe', () => {
		expect(classifyEscPosStart(bytes('stats\r\n'))).toBe('reject')
	})

	it('rejects a MongoDB isMaster probe', () => {
		// int32 message length prefix followed by the wire-protocol query.
		const probe = new Uint8Array([0x3a, 0x00, 0x00, 0x00, ...bytes('admin.$cmd')])
		expect(classifyEscPosStart(probe)).toBe('reject')
	})

	it('rejects PJL and UEL-prefixed PJL probes', () => {
		expect(classifyEscPosStart(bytes('@PJL INFO STATUS\r\n'))).toBe('reject')
		// The real UEL probe on the wire begins with ESC (0x1b); the second byte
		// is '%' (0x25), not '@', so it must not pass the ESC-@ gate.
		expect(classifyEscPosStart(bytes('\x1b%-12345X@PJL INFO ID\r\n'))).toBe(
			'reject',
		)
	})

	it('rejects HTTP requests', () => {
		expect(classifyEscPosStart(bytes('GET / HTTP/1.1\r\n'))).toBe('reject')
		expect(classifyEscPosStart(bytes('POST /api HTTP/1.0'))).toBe('reject')
	})

	it('rejects a TLS ClientHello handshake', () => {
		expect(classifyEscPosStart(new Uint8Array([0x16, 0x03, 0x01]))).toBe(
			'reject',
		)
	})

	it('rejects a leading null-byte banner grab', () => {
		expect(classifyEscPosStart(new Uint8Array([0x00, 0x00, 0x12]))).toBe(
			'reject',
		)
	})
})
