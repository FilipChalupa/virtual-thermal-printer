export enum Alignment {
	Left,
	Center,
	Right,
}

export type ParsedEscPosBlock = EscPosText | EscPosCommand | EscPosImage

export interface EscPosText {
	type: 'text'
	content: string
	alignment: Alignment
	emphasized: boolean
	underline: number
	charWidth: number
	charHeight: number
	reversePrinting: boolean
	/** 0 = Font A (12×24 dots), 1 = Font B (9×17 dots). */
	font: number
	/** Extra dots after each character (ESC SP), before double-width scaling. */
	rightSpacing: number
	/** Dots from the left edge where lines start (GS L). */
	leftMargin: number
	/** Printable width in dots from the left margin (GS W); 0 = rest of the line. */
	printAreaWidth: number
	/** Horizontal tab stops in dots from the line start (ESC D). */
	tabStops: number[]
	/** Line spacing in dots (ESC 3); null = the printer's default (ESC 2). */
	lineSpacing: number | null
	/** Double-strike mode (ESC G); printers render it like emphasized. */
	doubleStrike: boolean
	/** Upside-down printing (ESC {): the line is rotated 180°. */
	upsideDown: boolean
	/** 90° clockwise rotation of each character (ESC V). */
	rotated: boolean
}

export interface EscPosCommand {
	type: 'command'
	name: string
	details?: { [key: string]: unknown }
}

export interface EscPosImage {
	type: 'image'
	width: number
	height: number
	base64: string
	/** Alignment (ESC a) when the image was printed. */
	alignment: Alignment
}
