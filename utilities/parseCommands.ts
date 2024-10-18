import { createCanvas } from '@napi-rs/canvas'

const anyToken = 'any'

const commandPatternStarts = {
	initializePrinter: [0x1b, 0x40],
	openCashDrawer: [0x1b, 0x70, 0x00, anyToken, anyToken],
	newLine: [0x0a],
	cut: [0x1b, 0x69],
	beep: [0x1b, 0x42, anyToken, anyToken],
	image: [0x1d, 0x76, 0x30, 0],
	// @TODO: support more commands
} as const
const patternNames = Object.keys(commandPatternStarts) as Array<
	keyof typeof commandPatternStarts
>

const extractFirstCommand = (commands: Buffer) => {
	const startingCommandName = (() => {
		for (const command of patternNames) {
			const pattern = commandPatternStarts[command]
			if (pattern.length > commands.length) {
				continue
			}
			for (let i = 0; i < pattern.length; i++) {
				if (pattern[i] !== commands[i]) {
					break
				}
				if (i === pattern.length - 1) {
					return command
				}
			}
		}
	})()
	if (!startingCommandName) {
		return null
	}
	const command = (() => {
		if (startingCommandName === 'image') {
			const xL = commands.at(commandPatternStarts.image.length)
			const xH = commands.at(commandPatternStarts.image.length + 1)
			const yL = commands.at(commandPatternStarts.image.length + 2)
			const yH = commands.at(commandPatternStarts.image.length + 3)
			if (
				xL === undefined ||
				xH === undefined ||
				yL === undefined ||
				yH === undefined
			) {
				return null
			}
			const width = xL * 8
			const height = yL + yH * 256
			const bytesOfImage = (width * height) / 8

			const canvas = createCanvas(width, height)
			const context = canvas.getContext('2d')

			for (let index = 0; index < bytesOfImage; index++) {
				const byte = commands.at(commandPatternStarts.image.length + 4 + index)
				if (byte === undefined) {
					return null
				}
				for (let bit = 0; bit < 8; bit++) {
					const x = (index * 8 + bit) % width
					const y = Math.floor((index * 8 + bit) / width)
					const color = byte & (1 << (7 - bit)) ? '#000000' : '#ffffff'
					context.fillStyle = color
					context.fillRect(x, y, 1, 1)
				}
			}

			return {
				name: startingCommandName,
				length: commandPatternStarts.image.length + 4 + bytesOfImage,
				canvas,
			}
		}
		return {
			name: startingCommandName,
			length: commandPatternStarts[startingCommandName].length,
		}
	})() satisfies null | { name: string; length: number }
	if (!command) {
		return null
	}
	const { length, ...rest } = command
	return {
		command: rest,
		restOfCommands: commands.slice(length),
	}
}

export const parseCommands = (commands: Buffer) => {
	const parsedCommands: Array<
		NonNullable<ReturnType<typeof extractFirstCommand>>['command']
	> = []

	let unprocessedCommands = commands
	while (true) {
		const command = extractFirstCommand(unprocessedCommands)
		if (command === null) {
			break
		}
		unprocessedCommands = command.restOfCommands
		parsedCommands.push(command.command)
	}

	return { commands: parsedCommands, unprocessed: unprocessedCommands }
}
