import {
	Alignment,
	ParsedEscPosBlock,
	parseEscPos,
	PrinterState,
} from './escpos.ts'
import { Buffer } from '@std/io/buffer'

/**
 * A Transformer that parses incoming Uint8Array chunks of ESC/POS commands
 * into structured EscPosBlock objects.
 */
export class EscPosTransformer
	implements Transformer<Uint8Array, ParsedEscPosBlock> {
	#accumulatedBuffer: Buffer
	#printerState: PrinterState

	constructor() {
		this.#accumulatedBuffer = new Buffer()
		this.#printerState = {
			alignment: Alignment.Left,
			charSize: 0,
			leftMargin: 0,
			printAreaWidth: 0,
		}
	}

	async transform(
		chunk: Uint8Array,
		controller: TransformStreamDefaultController<ParsedEscPosBlock>,
	) {
		// Write newly read data to the accumulated buffer
		this.#accumulatedBuffer.writeSync(chunk)

		while (true) {
			const parsedResult = parseEscPos(
				this.#accumulatedBuffer.bytes(),
				this.#printerState,
			)

			if (parsedResult.consumedBytes > 0) {
				if (parsedResult.data) {
					controller.enqueue(parsedResult.data)
				}
				// Remove consumed bytes from the accumulated buffer
				const remainingBytes = this.#accumulatedBuffer.bytes().subarray(
					parsedResult.consumedBytes,
				)
				this.#accumulatedBuffer = new Buffer(remainingBytes)
			} else {
				// No complete command parsed, wait for more data
				break
			}
		}
	}

	// The flush method is called when the input stream is closed.
	// It allows processing any remaining buffered data.
	async flush(controller: TransformStreamDefaultController<ParsedEscPosBlock>) {
		// Attempt to parse any remaining data in the buffer
		while (this.#accumulatedBuffer.length > 0) {
			const parsedResult = parseEscPos(
				this.#accumulatedBuffer.bytes(),
				this.#printerState,
			)

			if (parsedResult.consumedBytes > 0) {
				if (parsedResult.data) {
					controller.enqueue(parsedResult.data)
				}
				const remainingBytes = this.#accumulatedBuffer.bytes().subarray(
					parsedResult.consumedBytes,
				)
				this.#accumulatedBuffer = new Buffer(remainingBytes)
			} else {
				// If there's still unparsed data, but parseEscPos couldn't make progress,
				// it means there's an incomplete command at the end of the stream.
				// We could choose to error here, or emit a special 'partial' event.
				// For now, we'll just stop trying to parse.
				if (this.#accumulatedBuffer.length > 0) {
					console.warn(
						`Incomplete ESC/POS command(s) at end of stream. Remaining bytes: ${this.#accumulatedBuffer.length}`,
					)
				}
				break
			}
		}
	}
}
