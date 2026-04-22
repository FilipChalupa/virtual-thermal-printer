import { parseArgs } from 'node:util'
import { join } from 'node:path'
import { readFile, writeFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))

const { values: flags } = parseArgs({
	args: process.argv.slice(2),
	options: {
		part: { type: 'string', default: 'patch' },
	},
})

const part = flags.part

if (part !== 'patch' && part !== 'minor' && part !== 'major') {
	console.error('Invalid version part. Use "patch", "minor", or "major".')
	process.exit(1)
}

const pkgPath = join(__dirname, '..', 'package.json')
const pkgJson = JSON.parse(await readFile(pkgPath, 'utf-8'))

const [major, minor, patch] = (pkgJson.version as string).split('.').map(Number)

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

pkgJson.version = newVersion
await writeFile(pkgPath, JSON.stringify(pkgJson, null, '\t') + '\n')

console.log(`Version bumped to ${newVersion}`)

spawnSync('git', ['add', 'package.json'], { stdio: 'inherit' })
spawnSync('git', ['commit', '-m', `v${newVersion}`], { stdio: 'inherit' })
spawnSync('git', ['tag', '-a', `v${newVersion}`, '-m', `Version ${newVersion}`], { stdio: 'inherit' })

console.log(`Created git tag v${newVersion}`)
