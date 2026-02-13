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
	charSize: number
	reversePrinting: boolean
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
	base64: string // Changed from data: number[]
}
