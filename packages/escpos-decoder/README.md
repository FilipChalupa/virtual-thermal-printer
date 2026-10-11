# escpos-decoder

Streaming decoder that turns raw [ESC/POS](https://en.wikipedia.org/wiki/ESC/P#ESC/POS) bytes into typed TypeScript blocks: text with its formatting, printer commands, and images.

It is the parsing core of [Virtual Thermal Printer](https://github.com/FilipChalupa/virtual-thermal-printer), a web-based simulator of receipt printers, and can be used on its own to inspect, test or render print jobs without a physical printer.

## Features

- **Streaming.** Implements the Web Streams `Transformer` interface, so it works with `TransformStream`. Commands split across TCP chunks are reassembled.
- **Typed output.** Every block is a discriminated union (`text`, `command`, `image`) with full type definitions.
- **Formatting state.** Alignment, emphasis, underline, character size and reverse printing are tracked and attached to each text block.
- **Images.** Raster bit images (`GS v 0`) and QR codes (`GS ( k`) are rendered to PNG data URLs.
- **Resilient.** Unknown commands are reported as `command` blocks instead of breaking the stream.

## Installation

```bash
npm install escpos-decoder
```

Requires Node.js 22 or newer.

## Usage

### Decoding a stream

```ts
import { EscPosTransformer } from 'escpos-decoder'
import type { ParsedEscPosBlock } from 'escpos-decoder'

const decoder = new TransformStream<Uint8Array, ParsedEscPosBlock>(
	new EscPosTransformer(),
)

// Any ReadableStream<Uint8Array> works: a TCP socket, a file, a fetch body...
const blocks = rawEscPosStream.pipeThrough(decoder)

for await (const block of blocks) {
	switch (block.type) {
		case 'text':
			console.log(block.content, { bold: block.emphasized })
			break
		case 'image':
			console.log(`image ${block.width}x${block.height}`, block.base64)
			break
		case 'command':
			console.log(block.name, block.details)
			break
	}
}
```

Piping a Node.js socket:

```ts
import { createServer } from 'node:net'
import { Readable } from 'node:stream'
import { EscPosTransformer } from 'escpos-decoder'

createServer((socket) => {
	Readable.toWeb(socket)
		.pipeThrough(new TransformStream(new EscPosTransformer()))
		.pipeTo(
			new WritableStream({
				write(block) {
					console.log(block)
				},
			}),
		)
}).listen(9100)
```

### Decoding a buffer

`parseEscPos` is the lower-level function behind the transformer. It decodes one block from the start of the buffer and tells you how many bytes it consumed. Printer state is passed in explicitly, so you own it.

```ts
import { parseEscPos, Alignment } from 'escpos-decoder'
import type { PrinterState } from 'escpos-decoder'

const state: PrinterState = {
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

let bytes = new Uint8Array([0x1b, 0x40, 0x1b, 0x45, 0x01, 0x48, 0x69, 0x0a])

while (bytes.length > 0) {
	const { data, consumedBytes } = await parseEscPos(bytes, state)
	if (consumedBytes === 0) break // incomplete command, wait for more bytes
	if (data) console.log(data)
	bytes = bytes.subarray(consumedBytes)
}
```

Output (a line feed is emitted as its own text block):

```
{ type: 'command', name: 'Initialize Printer' }
{ type: 'command', name: 'Set Emphasized Mode', details: { emphasized: true } }
{ type: 'text', content: 'Hi', alignment: 0, emphasized: true, underline: 0, charWidth: 1, charHeight: 1, reversePrinting: false }
{ type: 'text', content: '\n', alignment: 0, emphasized: true, underline: 0, charWidth: 1, charHeight: 1, reversePrinting: false }
```

### Types only

The `escpos-decoder/types` entry point exports just the block types and the `Alignment` enum. It has no Node.js dependencies, so it is safe to import in browser code that consumes decoded blocks, for example over a WebSocket.

```ts
import { Alignment } from 'escpos-decoder/types'
import type { ParsedEscPosBlock, EscPosText } from 'escpos-decoder/types'
```

## Output blocks

```ts
type ParsedEscPosBlock = EscPosText | EscPosCommand | EscPosImage

interface EscPosText {
	type: 'text'
	content: string
	alignment: Alignment // Left | Center | Right
	emphasized: boolean
	underline: number // 0, 1 or 2
	charWidth: number // 1 to 8
	charHeight: number // 1 to 8
	reversePrinting: boolean
	font: number // 0 = Font A (12×24 dots), 1 = Font B (9×17 dots)
	rightSpacing: number // extra dots after each character
	leftMargin: number // dots from the left edge
	printAreaWidth: number // dots from the left margin, 0 = rest of the line
	tabStops: number[] // character columns, every 8 by default
}

interface EscPosCommand {
	type: 'command'
	name: string
	details?: { [key: string]: unknown }
}

interface EscPosImage {
	type: 'image'
	width: number
	height: number
	base64: string // data:image/png;base64,...
}
```

## Supported commands

| Command | Bytes | Emits |
|---|---|---|
| Initialize printer | `ESC @` | command, resets formatting state |
| Print and feed paper | `ESC J` | command |
| Print and feed lines | `ESC d` | command |
| Cut paper | `GS V`, `ESC i` | command |
| Set alignment | `ESC a` | command, applied to following text |
| Emphasized mode | `ESC E` | command, applied to following text |
| Underline mode | `ESC -` | command, applied to following text |
| Reverse printing | `GS B` | command, applied to following text |
| Character size | `GS !` | command, applied to following text |
| Font size and style | `ESC !` | command, emphasis, double size and underline applied to following text |
| Select character font | `ESC M` | command, applied to following text |
| Select character code table | `ESC t` | command |
| Left margin | `GS L` | command, applied to following text |
| Print area width | `GS W` | command, applied to following text |
| Absolute print position | `ESC $` | command |
| Right-side character spacing | `ESC SP` | command, applied to following text |
| Horizontal tab positions | `ESC D` | command, applied to following text |
| Raster bit image | `GS v 0` | image |
| Bit image | `ESC *` | command (consumed, not rendered) |
| QR code | `GS ( k` model, size, error correction, store, print | command per function, image on print |
| Barcode | `GS k` | command with type and data |
| Barcode height | `GS h` | command |
| Beep | `ESC B` | command |
| Cash drawer pulse | `ESC p` | command |
| Cancel Chinese character mode | `FS .` | command |

Any other `ESC`, `FS` or `GS` sequence is emitted as an `Unknown ... Command` block with the offending byte in `details`.

Text is decoded as CP852. The `ESC t` code table selection is reported but does not yet change the decoding.

## License

[MIT](LICENSE)
