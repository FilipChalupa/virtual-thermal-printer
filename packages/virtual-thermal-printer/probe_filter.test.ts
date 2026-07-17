import { describe, it, expect } from 'vitest'
import { looksLikeEscPos } from './escpos.js'

const bytes = (text: string) => new TextEncoder().encode(text)

describe('looksLikeEscPos', () => {
	it('accepts a job that starts with ESC @ (Initialize Printer)', () => {
		// Both fixture print jobs open with these bytes.
		expect(looksLikeEscPos(new Uint8Array([0x1b, 0x40, 0x41, 0x42]))).toBe(true)
	})

	it('accepts a first chunk that is only the ESC lead byte (split write)', () => {
		expect(looksLikeEscPos(new Uint8Array([0x1b]))).toBe(true)
	})

	it('rejects ESC followed by a non-initialize command byte', () => {
		expect(looksLikeEscPos(new Uint8Array([0x1b, 0x61, 0x01]))).toBe(false) // ESC a
		expect(looksLikeEscPos(new Uint8Array([0x1d, 0x56, 0x00]))).toBe(false) // GS V (no ESC @)
	})

	it('rejects a Redis PING probe', () => {
		expect(looksLikeEscPos(bytes('*1\r\n$4\r\nPING\r\n'))).toBe(false)
	})

	it('rejects a Memcached stats probe', () => {
		expect(looksLikeEscPos(bytes('stats\r\n'))).toBe(false)
	})

	it('rejects a MongoDB isMaster probe', () => {
		// int32 message length prefix followed by the wire-protocol query.
		const probe = new Uint8Array([0x3a, 0x00, 0x00, 0x00, ...bytes('admin.$cmd')])
		expect(looksLikeEscPos(probe)).toBe(false)
	})

	it('rejects PJL and UEL-prefixed PJL probes', () => {
		expect(looksLikeEscPos(bytes('@PJL INFO STATUS\r\n'))).toBe(false)
		// The real UEL probe on the wire begins with ESC (0x1b); the second byte
		// is '%' (0x25), not '@', so it must not pass the ESC-@ gate.
		expect(looksLikeEscPos(bytes('\x1b%-12345X@PJL INFO ID\r\n'))).toBe(false)
	})

	it('rejects HTTP requests', () => {
		expect(looksLikeEscPos(bytes('GET / HTTP/1.1\r\n'))).toBe(false)
		expect(looksLikeEscPos(bytes('POST /api HTTP/1.0'))).toBe(false)
	})

	it('rejects a TLS ClientHello handshake', () => {
		expect(looksLikeEscPos(new Uint8Array([0x16, 0x03, 0x01]))).toBe(false)
	})

	it('rejects a leading null-byte banner grab', () => {
		expect(looksLikeEscPos(new Uint8Array([0x00, 0x00, 0x12]))).toBe(false)
	})

	it('rejects an empty chunk', () => {
		expect(looksLikeEscPos(new Uint8Array([]))).toBe(false)
	})
})
