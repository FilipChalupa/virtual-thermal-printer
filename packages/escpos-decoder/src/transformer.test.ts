import { describe, it, expect } from 'vitest'
import iconv from 'iconv-lite'
import { defaultTabStops, EscPosTransformer, parseEscPos, PrinterState } from './transformer.js'
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
		font: 0,
		rightSpacing: 0,
		tabStops: defaultTabStops,
		lineSpacing: null,
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
			font: 0,
			rightSpacing: 0,
			leftMargin: 0,
			printAreaWidth: 0,
			tabStops: defaultTabStops,
			lineSpacing: null,
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
			font: 0,
			rightSpacing: 0,
			leftMargin: 0,
			printAreaWidth: 0,
			tabStops: defaultTabStops,
			lineSpacing: null,
		})
	})

	it('Print and Feed Paper (ESC J)', async () => {
		const command = new Uint8Array([0x1b, 0x4a, 0x30])
		const result = await parseEscPos(command, makeState())
		expect(result).toEqual({
			data: { type: 'command', name: 'Print and Feed Paper', details: { feed: 48 } },
			consumedBytes: 3,
		})
	})

	it('Print and Feed Lines (ESC d) consumes its parameter byte', async () => {
		const command = new Uint8Array([0x1b, 0x64, 0x03, 0x41])
		const result = await parseEscPos(command, makeState())
		expect(result).toEqual({
			data: { type: 'command', name: 'Print and Feed Lines', details: { lines: 3, lineSpacing: null } },
			consumedBytes: 3,
		})
	})

	it('Print and Feed Lines (ESC d) waits for its parameter byte', async () => {
		const command = new Uint8Array([0x1b, 0x64])
		const result = await parseEscPos(command, makeState())
		expect(result).toEqual({ data: null, consumedBytes: 0 })
	})

	it('Set Underline Mode accepts ASCII parameters', async () => {
		for (const [byte, expected] of [[0x00, 0], [0x01, 1], [0x02, 2], [0x30, 0], [0x31, 1], [0x32, 2]]) {
			const state = makeState()
			await parseEscPos(new Uint8Array([0x1b, 0x2d, byte]), state)
			expect(state.underline).toBe(expected)
		}
	})

	it('Set Emphasized Mode uses only the lowest bit', async () => {
		const state = makeState()
		await parseEscPos(new Uint8Array([0x1b, 0x45, 0x31]), state)
		expect(state.emphasized).toBe(true)
		await parseEscPos(new Uint8Array([0x1b, 0x45, 0x30]), state)
		expect(state.emphasized).toBe(false)
	})

	it('Set Reverse Printing uses only the lowest bit', async () => {
		const state = makeState()
		await parseEscPos(new Uint8Array([0x1d, 0x42, 0x31]), state)
		expect(state.reversePrinting).toBe(true)
		await parseEscPos(new Uint8Array([0x1d, 0x42, 0x30]), state)
		expect(state.reversePrinting).toBe(false)
	})

	it('Set Font (ESC !) updates style and size', async () => {
		const state = makeState()
		await parseEscPos(new Uint8Array([0x1b, 0x21, 0x08 | 0x10 | 0x20 | 0x80]), state)
		expect(state).toMatchObject({ emphasized: true, charHeight: 2, charWidth: 2, underline: 1 })
		await parseEscPos(new Uint8Array([0x1b, 0x21, 0x00]), state)
		expect(state).toMatchObject({ emphasized: false, charHeight: 1, charWidth: 1, underline: 0 })
	})

	it('Select Character Font (ESC M) accepts ASCII parameters', async () => {
		for (const [byte, expected] of [[0x00, 0], [0x01, 1], [0x30, 0], [0x31, 1], [0x02, 0]]) {
			const state = makeState()
			await parseEscPos(new Uint8Array([0x1b, 0x4d, byte]), state)
			expect(state.font).toBe(expected)
		}
	})

	it('Set Font (ESC !) selects Font B with bit 0', async () => {
		const state = makeState()
		await parseEscPos(new Uint8Array([0x1b, 0x21, 0x01]), state)
		expect(state.font).toBe(1)
	})

	it('Set Right-Side Character Spacing (ESC SP)', async () => {
		const state = makeState()
		await parseEscPos(new Uint8Array([0x1b, 0x20, 0x04]), state)
		expect(state.rightSpacing).toBe(4)
	})

	it('Set Horizontal Tab Positions (ESC D)', async () => {
		const state = makeState()
		const result = await parseEscPos(new Uint8Array([0x1b, 0x44, 10, 20, 0x00, 0x41]), state)
		expect(result).toEqual({
			data: {
				type: 'command',
				name: 'Set Horizontal Tab Positions',
				details: { stops: [10, 20], positions: [120, 240] },
			},
			consumedBytes: 5,
		})
		expect(state.tabStops).toEqual([120, 240])
	})

	it('Set Horizontal Tab Positions (ESC D NUL) clears all stops', async () => {
		const state = makeState()
		const result = await parseEscPos(new Uint8Array([0x1b, 0x44, 0x00]), state)
		expect(result.consumedBytes).toBe(3)
		expect(state.tabStops).toEqual([])
	})

	it('Set Horizontal Tab Positions (ESC D) waits for its NUL', async () => {
		const state = makeState()
		const result = await parseEscPos(new Uint8Array([0x1b, 0x44, 10, 20]), state)
		expect(result).toEqual({ data: null, consumedBytes: 0 })
		expect(state.tabStops).toEqual(defaultTabStops)
	})

	it('Set Horizontal Tab Positions (ESC D) uses the character width at that moment', async () => {
		const state = makeState()
		await parseEscPos(new Uint8Array([0x1b, 0x4d, 0x01]), state) // Font B, 9 dots
		await parseEscPos(new Uint8Array([0x1b, 0x20, 0x01]), state) // + 1 dot spacing
		await parseEscPos(new Uint8Array([0x1d, 0x21, 0x10]), state) // double width
		await parseEscPos(new Uint8Array([0x1b, 0x44, 4, 0x00]), state)
		expect(state.tabStops).toEqual([80])
		await parseEscPos(new Uint8Array([0x1b, 0x40]), state)
		expect(state.tabStops[0]).toBe(96)
	})

	it('Line spacing (ESC 3, ESC 2)', async () => {
		const state = makeState()
		await parseEscPos(new Uint8Array([0x1b, 0x33, 0x18]), state)
		expect(state.lineSpacing).toBe(24)
		const result = await parseEscPos(new Uint8Array([0x0a]), state)
		expect(result.data).toMatchObject({ content: '\n', lineSpacing: 24 })
		await parseEscPos(new Uint8Array([0x1b, 0x32]), state)
		expect(state.lineSpacing).toBe(null)
	})

	it('Print and Feed Lines (ESC d) carries the line spacing', async () => {
		const state = makeState()
		await parseEscPos(new Uint8Array([0x1b, 0x33, 40]), state)
		const result = await parseEscPos(new Uint8Array([0x1b, 0x64, 2]), state)
		expect(result.data).toEqual({
			type: 'command',
			name: 'Print and Feed Lines',
			details: { lines: 2, lineSpacing: 40 },
		})
	})

	it('Relative print position (ESC \\) is signed', async () => {
		const forward = await parseEscPos(new Uint8Array([0x1b, 0x5c, 0x10, 0x00]), makeState())
		expect(forward.data).toMatchObject({ details: { offset: 16 } })
		const backward = await parseEscPos(new Uint8Array([0x1b, 0x5c, 0xf0, 0xff]), makeState())
		expect(backward.data).toMatchObject({ details: { offset: -16 } })
	})

	it('Page mode commands', async () => {
		const state = makeState()
		const names = []
		for (const bytes of [
			[0x1b, 0x4c],
			[0x1b, 0x57, 0, 0, 10, 0, 0x40, 0x02, 0xc8, 0x00],
			[0x1b, 0x54, 0x31],
			[0x1d, 0x24, 0x20, 0x00],
			[0x1d, 0x5c, 0xf8, 0xff],
			[0x1b, 0x0c],
			[0x18],
			[0x0c],
			[0x1b, 0x53],
		]) {
			const result = await parseEscPos(new Uint8Array(bytes), state)
			expect(result.consumedBytes).toBe(bytes.length)
			names.push(result.data)
		}
		expect(names).toEqual([
			{ type: 'command', name: 'Select Page Mode' },
			{ type: 'command', name: 'Set Page Area', details: { x: 0, y: 10, width: 576, height: 200 } },
			{ type: 'command', name: 'Select Print Direction', details: { direction: 1 } },
			{ type: 'command', name: 'Set Absolute Vertical Position', details: { position: 32 } },
			{ type: 'command', name: 'Set Relative Vertical Position', details: { offset: -8 } },
			{ type: 'command', name: 'Print Page' },
			{ type: 'command', name: 'Cancel Page Data' },
			{ type: 'command', name: 'Form Feed' },
			{ type: 'command', name: 'Select Standard Mode' },
		])
	})

	it('Parameters of non-rendering commands do not leak into text', async () => {
		const transformer = new EscPosTransformer()
		const blocks: ParsedEscPosBlock[] = []
		const controller = { enqueue: (block: ParsedEscPosBlock) => blocks.push(block) } as TransformStreamDefaultController<ParsedEscPosBlock>
		const bytes = [
			0x1b, 0x47, 0x41, // ESC G 'A' (double-strike)
			0x1b, 0x52, 0x42, // ESC R 'B' (international set)
			0x1b, 0x63, 0x35, 0x43, // ESC c 5 'C' (panel buttons)
			0x1d, 0x48, 0x44, // GS H 'D' (HRI position)
			0x1d, 0x50, 0x45, 0x46, // GS P 'E' 'F' (motion units)
			0x1c, 0x70, 0x47, 0x48, // FS p 'G' 'H' (NV image)
			0x1b, 0x28, 0x41, 0x02, 0x00, 0x49, 0x4a, // ESC ( A pL pH 'I' 'J' (beeper)
			0x1b, 0x26, 0x02, 0x41, 0x41, 0x01, 0x4b, 0x4c, // ESC & y=2 'A'..'A' x=1 'K' 'L'
			0x10, 0x04, 0x01, // DLE EOT 1 (status request)
			0x00, 0x0e, // NUL, SO
			0x4f, 0x4b, // 'OK'
		]
		await transformer.transform(new Uint8Array(bytes), controller)
		const text = blocks.filter((block) => block.type === 'text')
		expect(text.map((block) => block.type === 'text' && block.content)).toEqual(['OK'])
	})

	it('Barcode format A waits for its NUL, format B uses its length byte', async () => {
		const partial = await parseEscPos(new Uint8Array([0x1d, 0x6b, 0x04, 0x31, 0x32]), makeState())
		expect(partial).toEqual({ data: null, consumedBytes: 0 })
		const formatA = await parseEscPos(new Uint8Array([0x1d, 0x6b, 0x04, 0x31, 0x32, 0x00, 0x41]), makeState())
		expect(formatA).toEqual({
			data: { type: 'command', name: 'Print Barcode', details: { barcodeType: 4, barcodeData: '12' } },
			consumedBytes: 6,
		})
		const formatB = await parseEscPos(new Uint8Array([0x1d, 0x6b, 0x49, 0x03, 0x41, 0x00, 0x42, 0x43]), makeState())
		expect(formatB).toEqual({
			data: { type: 'command', name: 'Print Barcode', details: { barcodeType: 73, barcodeData: 'A\u0000B' } },
			consumedBytes: 7,
		})
	})

	it('Text blocks carry the layout state', async () => {
		const state = makeState()
		await parseEscPos(new Uint8Array([0x1d, 0x4c, 0x20, 0x00]), state)
		await parseEscPos(new Uint8Array([0x1d, 0x57, 0x00, 0x02]), state)
		await parseEscPos(new Uint8Array([0x1b, 0x4d, 0x01]), state)
		const result = await parseEscPos(new Uint8Array([0x41, 0x0a]), state)
		expect(result.data).toMatchObject({
			content: 'A', font: 1, leftMargin: 32, printAreaWidth: 512,
		})
	})

	it('Initialize Printer resets the layout state', async () => {
		const state = makeState()
		await parseEscPos(new Uint8Array([0x1b, 0x4d, 0x01]), state)
		await parseEscPos(new Uint8Array([0x1b, 0x20, 0x04]), state)
		await parseEscPos(new Uint8Array([0x1b, 0x44, 0x00]), state)
		await parseEscPos(new Uint8Array([0x1b, 0x40]), state)
		expect(state).toMatchObject({ font: 0, rightSpacing: 0, tabStops: defaultTabStops })
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
