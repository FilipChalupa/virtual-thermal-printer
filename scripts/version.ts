import { parseArgs } from '@std/cli/parse-args'
import { join } from '@std/path/join'

const flags = parseArgs(Deno.args, {
	string: ['part'],
	default: { part: 'patch' },
})

const part = flags.part

if (part !== 'patch' && part !== 'minor' && part !== 'major') {
	console.error('Invalid version part. Use "patch", "minor", or "major".')
	Deno.exit(1)
}

const denoJsonPath = join(Deno.cwd(), 'deno.json')
const denoJson = JSON.parse(await Deno.readTextFile(denoJsonPath))

const [major, minor, patch] = denoJson.version.split('.').map(Number)

let newVersion: string

switch (part) {
	case 'patch':
		newVersion = `${major}.${minor}.${patch + 1}`
		break
	case 'minor':
		newVersion = `${major}.${minor + 1}.0`
		break
	case 'major':
		newVersion = `${major + 1}.0.0`
		break
}

denoJson.version = newVersion
await Deno.writeTextFile(denoJsonPath, JSON.stringify(denoJson, null, '	'))

console.log(`Version bumped to ${newVersion}`)

const gitAdd = new Deno.Command('git', {
	args: ['add', 'deno.json'],
})
await gitAdd.output()

const gitCommit = new Deno.Command('git', {
	args: ['commit', '-m', `v${newVersion}`],
})
await gitCommit.output()

const gitTag = new Deno.Command('git', {
	args: ['tag', `v${newVersion}`],
})
await gitTag.output()

console.log(`Created git tag v${newVersion}`)
