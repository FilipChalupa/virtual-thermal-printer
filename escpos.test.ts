import { assertEquals } from '@std/assert/mod.ts'
import { Alignment, parseEscPos, PrinterState } from './escpos-transform.ts'
import iconv from 'iconv-lite'

Deno.test('parseEscPos - Initialize Printer', () => {
	const command = new Uint8Array([0x1b, 0x40])
	const state: PrinterState = {
		alignment: Alignment.Center,
		charSize: 1,
		leftMargin: 10,
		printAreaWidth: 100,
	}
	const result = parseEscPos(command, state)
	assertEquals(result.data, { type: 'command', name: 'Initialize Printer' })
	assertEquals(state.alignment, Alignment.Left)
})

Deno.test('parseEscPos - Cut Paper', () => {
	const command = new Uint8Array([0x1d, 0x56])
	const state: PrinterState = {
		alignment: Alignment.Left,
		charSize: 0,
		leftMargin: 0,
		printAreaWidth: 0,
	}
	const result = parseEscPos(command, state)
	assertEquals(result.data, { type: 'command', name: 'Cut Paper', details: { command: 'GS V', cutType: 'Full' } })
})

Deno.test('parseEscPos - Set Alignment', () => {
	const command = new Uint8Array([0x1b, 0x61, 1])
	const state: PrinterState = {
		alignment: Alignment.Left,
		charSize: 0,
		leftMargin: 0,
		printAreaWidth: 0,
	}
	const result = parseEscPos(command, state)
	assertEquals(result.data, {
		type: 'command',
		name: 'Set Alignment',
		details: { alignment: 'Center' },
	})
	assertEquals(state.alignment, Alignment.Center)
})

Deno.test('parseEscPos - Print Text', () => {
	const command = iconv.encode('Hello, World!', 'CP852')
	const state: PrinterState = {
		alignment: Alignment.Left,
		charSize: 0,
		leftMargin: 0,
		printAreaWidth: 0,
	}
	const result = parseEscPos(command, state)
	assertEquals(result.data, { type: 'text', content: 'Hello, World!' })
})

Deno.test('parseEscPos - CP852 Encoded Text', () => {
	const command = iconv.encode('Dva obrázky', 'CP852')
	const state: PrinterState = {
		alignment: Alignment.Left,
		charSize: 0,
		leftMargin: 0,
		printAreaWidth: 0,
	}
	const result = parseEscPos(command, state)
	assertEquals(result.data, { type: 'text', content: 'Dva obrázky' })
})

Deno.test('parseEscPos - Set Char Size', () => {
	const command = new Uint8Array([0x1d, 0x21, 0x11])
	const state: PrinterState = {
		alignment: Alignment.Left,
		charSize: 0,
		leftMargin: 0,
		printAreaWidth: 0,
	}
	const result = parseEscPos(command, state)
	assertEquals(result.data, {
		type: 'command',
		name: 'Set Char Size',
		details: { size: 17 },
	})
	assertEquals(state.charSize, 17)
})

Deno.test('parseEscPos - Set Left Margin', () => {
	const command = new Uint8Array([0x1d, 0x4c, 0x0a, 0x00])
	const state: PrinterState = {
		alignment: Alignment.Left,
		charSize: 0,
		leftMargin: 0,
		printAreaWidth: 0,
	}
	const result = parseEscPos(command, state)
	assertEquals(result.data, {
		type: 'command',
		name: 'Set Left Margin',
		details: { margin: 10 },
	})
	assertEquals(state.leftMargin, 10)
})

Deno.test('parseEscPos - Set Print Area Width', () => {
	const command = new Uint8Array([0x1d, 0x57, 0x80, 0x01])
	const state: PrinterState = {
		alignment: Alignment.Left,
		charSize: 0,
		leftMargin: 0,
		printAreaWidth: 0,
	}
	const result = parseEscPos(command, state)
	assertEquals(result.data, {
		type: 'command',
		name: 'Set Print Area Width',
		details: { width: 384 },
	})
	assertEquals(state.printAreaWidth, 384)
})

Deno.test('parseEscPos - Cut Paper (ESC i)', () => {
	const command = new Uint8Array([0x1b, 0x69])
	const state: PrinterState = {
		alignment: Alignment.Left,
		charSize: 0,
		leftMargin: 0,
		printAreaWidth: 0,
	}
	const result = parseEscPos(command, state)
	assertEquals(result.data, { type: 'command', name: 'Cut Paper', details: { command: 'ESC i', cutType: 'Full' } })
})

Deno.test('parseEscPos - Cut Paper (GS V without argument)', () => {
	const command = new Uint8Array([0x1d, 0x56])
	const state: PrinterState = {
		alignment: Alignment.Left,
		charSize: 0,
		leftMargin: 0,
		printAreaWidth: 0,
	}
	const result = parseEscPos(command, state)
	assertEquals(result.data, { type: 'command', name: 'Cut Paper', details: { command: 'GS V', cutType: 'Full' } })
})

Deno.test('parseEscPos - Cut Paper (GS V 0x00)', () => {
	const command = new Uint8Array([0x1d, 0x56, 0x00])
	const state: PrinterState = {
		alignment: Alignment.Left,
		charSize: 0,
		leftMargin: 0,
		printAreaWidth: 0,
	}
	const result = parseEscPos(command, state)
	assertEquals(result.data, { type: 'command', name: 'Cut Paper', details: { command: 'GS V n', cutType: 'Full' } })
})

Deno.test('parseEscPos - Cut Paper (GS V 0x01)', () => {
	const command = new Uint8Array([0x1d, 0x56, 0x01])
	const state: PrinterState = {
		alignment: Alignment.Left,
		charSize: 0,
		leftMargin: 0,
		printAreaWidth: 0,
	}
	const result = parseEscPos(command, state)
	assertEquals(result.data, { type: 'command', name: 'Cut Paper', details: { command: 'GS V n', cutType: 'Partial' } })
})
