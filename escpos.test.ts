import { describe, it, expect } from 'vitest'
import iconv from 'iconv-lite'
import { parseEscPos, PrinterState } from './escpos-transform.js'
import { Alignment } from './shared/types.js'

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
	}
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
})
