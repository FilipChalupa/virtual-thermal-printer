import { describe, it, expect } from 'vitest'
import iconv from 'iconv-lite'
import { EscPosTransformer, parseEscPos, PrinterState } from './transformer.js'
import { Alignment, ParsedEscPosBlock } from './types.js'

function makeState(): PrinterState {
	return {
		alignment: Alignment.Left,
		charWidth: 1,
		charHeight: 1,
		leftMargin: 0,
		printAreaWidth: 0,
		emphasized: false,
		underline: 0,
		reversePrinting: false,
		qrModel: 2,
		qrModuleSize: 3,
		qrErrorCorrection: 'L',
		qrData: '',
	}
}

function buildQrSequence(data: string): Uint8Array {
	const utf8 = new TextEncoder().encode(data)
	const storeLen = utf8.length + 3 // cn + fn + m + data
	const storeCmd = new Uint8Array(8 + utf8.length)
	storeCmd.set([
		0x1d, 0x28, 0x6b,
		storeLen & 0xff, (storeLen >> 8) & 0xff,
		49, 80, 48,
	])
	storeCmd.set(utf8, 8)

	const model = new Uint8Array([0x1d, 0x28, 0x6b, 0x04, 0x00, 49, 65, 50, 0])
	const size = new Uint8Array([0x1d, 0x28, 0x6b, 0x03, 0x00, 49, 67, 4])
	const ecc = new Uint8Array([0x1d, 0x28, 0x6b, 0x03, 0x00, 49, 69, 49])
	const print = new Uint8Array([0x1d, 0x28, 0x6b, 0x03, 0x00, 49, 81, 48])

	const out = new Uint8Array(
		model.length + size.length + ecc.length + storeCmd.length + print.length,
	)
	let off = 0
	for (const c of [model, size, ecc, storeCmd, print]) {
		out.set(c, off)
		off += c.length
	}
	return out
}

async function collectFromTransformer(
	chunks: Uint8Array[],
): Promise<ParsedEscPosBlock[]> {
	const stream = new ReadableStream<Uint8Array>({
		start(controller) {
			for (const c of chunks) controller.enqueue(c)
			controller.close()
		},
	})
	const out: ParsedEscPosBlock[] = []
	const reader = stream
		.pipeThrough(new TransformStream(new EscPosTransformer()))
		.getReader()
	while (true) {
		const { done, value } = await reader.read()
		if (done) break
		out.push(value)
	}
	return out
}

describe('parseEscPos', () => {
	it('Initialize Printer', async () => {
		const command = new Uint8Array([0x1b, 0x40])
		const state = makeState()
		state.alignment = Alignment.Center
		const result = await parseEscPos(command, state)
		expect(result.data).toEqual({ type: 'command', name: 'Initialize Printer' })
		expect(state.alignment).toBe(Alignment.Left)
	})

	it('Cut Paper', async () => {
		const command = new Uint8Array([0x1d, 0x56])
		const result = await parseEscPos(command, makeState())
		expect(result.data).toEqual({
			type: 'command',
			name: 'Cut Paper',
			details: { command: 'GS V', cutType: 'Full' },
		})
	})

	it('Set Alignment', async () => {
		const command = new Uint8Array([0x1b, 0x61, 1])
		const state = makeState()
		const result = await parseEscPos(command, state)
		expect(result.data).toEqual({
			type: 'command',
			name: 'Set Alignment',
			details: { alignment: 'Center' },
		})
		expect(state.alignment).toBe(Alignment.Center)
	})

	it('Print Text', async () => {
		const command = iconv.encode('Hello, World!', 'CP852')
		const result = await parseEscPos(command, makeState())
		expect(result.data).toEqual({
			type: 'text',
			content: 'Hello, World!',
			alignment: Alignment.Left,
			emphasized: false,
			underline: 0,
			charWidth: 1,
			charHeight: 1,
			reversePrinting: false,
		})
	})

	it('CP852 Encoded Text', async () => {
		const command = iconv.encode('Dva obrázky', 'CP852')
		const result = await parseEscPos(command, makeState())
		expect(result.data).toEqual({
			type: 'text',
			content: 'Dva obrázky',
			alignment: Alignment.Left,
			emphasized: false,
			underline: 0,
			charWidth: 1,
			charHeight: 1,
			reversePrinting: false,
		})
	})

	it('Set Char Size', async () => {
		const command = new Uint8Array([0x1d, 0x21, 0x11])
		const state = makeState()
		const result = await parseEscPos(command, state)
		expect(result.data).toEqual({
			type: 'command',
			name: 'Set Char Size',
			details: { width: 2, height: 2 },
		})
		expect(state.charWidth).toBe(2)
		expect(state.charHeight).toBe(2)
	})

	it('Set Left Margin', async () => {
		const command = new Uint8Array([0x1d, 0x4c, 0x0a, 0x00])
		const state = makeState()
		const result = await parseEscPos(command, state)
		expect(result.data).toEqual({
			type: 'command',
			name: 'Set Left Margin',
			details: { margin: 10 },
		})
		expect(state.leftMargin).toBe(10)
	})

	it('Set Print Area Width', async () => {
		const command = new Uint8Array([0x1d, 0x57, 0x80, 0x01])
		const state = makeState()
		const result = await parseEscPos(command, state)
		expect(result.data).toEqual({
			type: 'command',
			name: 'Set Print Area Width',
			details: { width: 384 },
		})
		expect(state.printAreaWidth).toBe(384)
	})

	it('Cut Paper (ESC i)', async () => {
		const command = new Uint8Array([0x1b, 0x69])
		const result = await parseEscPos(command, makeState())
		expect(result.data).toEqual({
			type: 'command',
			name: 'Cut Paper',
			details: { command: 'ESC i', cutType: 'Full' },
		})
	})

	it('Cut Paper (GS V without argument)', async () => {
		const command = new Uint8Array([0x1d, 0x56])
		const result = await parseEscPos(command, makeState())
		expect(result.data).toEqual({
			type: 'command',
			name: 'Cut Paper',
			details: { command: 'GS V', cutType: 'Full' },
		})
	})

	it('Cut Paper (GS V 0x00)', async () => {
		const command = new Uint8Array([0x1d, 0x56, 0x00])
		const result = await parseEscPos(command, makeState())
		expect(result.data).toEqual({
			type: 'command',
			name: 'Cut Paper',
			details: { command: 'GS V n', cutType: 'Full' },
		})
	})

	it('Cut Paper (GS V 0x01)', async () => {
		const command = new Uint8Array([0x1d, 0x56, 0x01])
		const result = await parseEscPos(command, makeState())
		expect(result.data).toEqual({
			type: 'command',
			name: 'Cut Paper',
			details: { command: 'GS V n', cutType: 'Partial' },
		})
	})

	it('QR Code sequence emits one image', async () => {
		const bytes = buildQrSequence('https://example.com')
		const blocks = await collectFromTransformer([bytes])
		const images = blocks.filter((b) => b.type === 'image')
		expect(images).toHaveLength(1)
		const img = images[0]
		if (img.type !== 'image') throw new Error('expected image')
		expect(img.width).toBeGreaterThan(0)
		expect(img.height).toBeGreaterThan(0)
		expect(img.base64.startsWith('data:image/png;base64,')).toBe(true)
	})

	it('QR Code split across chunks still emits one image', async () => {
		const bytes = buildQrSequence('https://example.com')
		const mid = Math.floor(bytes.length / 2)
		const blocks = await collectFromTransformer([
			bytes.subarray(0, mid),
			bytes.subarray(mid),
		])
		const images = blocks.filter((b) => b.type === 'image')
		expect(images).toHaveLength(1)
	})
})
