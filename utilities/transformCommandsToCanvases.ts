import { createCanvas } from 'https://deno.land/x/canvas/mod.ts'
import { parseCommands } from './parseCommands.ts'

type Command = ReturnType<typeof parseCommands>['commands'][number]
type CommandWithoutCut = Command /* @TODO: exclude { name: 'cut' } */

const newLineHeight = 20

export const transformCommandsToCanvases = (
	commands: Array<Command>,
	width: number,
) => {
	const commandGroups: Array<{
		commands: Array<CommandWithoutCut>
		cut: boolean
	}> = []

	const getLastGroupIfUncut = () => {
		const lastGroup = commandGroups.at(-1)
		if (!lastGroup || lastGroup.cut) {
			return null
		}
		return lastGroup
	}

	const addGroup = () => {
		const newGroup = {
			commands: [],
			cut: false,
		}
		commandGroups.push(newGroup)
		return newGroup
	}

	for (const command of commands) {
		const lastGroup = getLastGroupIfUncut() ?? addGroup()
		if (command.name === 'cut') {
			lastGroup.cut = true
			continue
		}
		lastGroup.commands.push(command)
	}

	return commandGroups.map(({ cut, commands }) => ({
		cut,
		canvas: transformCommandsToCanvas(commands, width),
	}))
}

type InvisibleCommandNames =
	| 'initializePrinter'
	| 'openCashDrawer'
	| 'cut'
	| 'beep'

const transformCommandsToCanvas = (
	commands: Array<CommandWithoutCut>,
	width: number,
) => {
	const height = commands.reduce(
		(height, command) =>
			height +
			(command.name === 'image'
				? command.canvas.height
				: command.name === 'newLine'
				? newLineHeight
				: 0),
		0,
	)

	const canvas = createCanvas(width, height)
	const canvasContext = canvas.getContext('2d')
	canvasContext.rect(0, 0, width, height)
	canvasContext.fillStyle = 'white'
	canvasContext.fill()
	let verticalCursorPosition = 0

	for (const command of commands) {
		if (command.name === 'image') {
			canvasContext.drawImage(command.canvas, 0, verticalCursorPosition)
			verticalCursorPosition += command.canvas.height
		} else if (command.name === 'newLine') {
			verticalCursorPosition += newLineHeight
		} else {
			command.name satisfies InvisibleCommandNames
		}
	}

	return canvas
}
