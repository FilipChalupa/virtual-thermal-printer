import * as esbuild from 'esbuild'
import { writeFile, readdir } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'

await esbuild.build({
	entryPoints: ['main.ts'],
	bundle: true,
	platform: 'node',
	format: 'cjs',
	outfile: 'sea-bundle.cjs',
	define: {
		// In CJS SEA context import.meta is unavailable — remap to __filename which
		// Node.js SEA sets to the binary path.
		'import.meta.url': '__importMetaUrl',
	},
	banner: {
		js: "var __importMetaUrl = require('url').pathToFileURL(__filename).href;",
	},
})

async function* walkDir(dir: string): AsyncGenerator<string> {
	for (const entry of await readdir(dir, { withFileTypes: true })) {
		const full = join(dir, entry.name)
		if (entry.isDirectory()) yield* walkDir(full)
		else yield full
	}
}

const assets: Record<string, string> = {}
for await (const file of walkDir('dist')) {
	const key = relative('dist', file).split(sep).join('/')
	assets[key] = file
}

await writeFile('sea-config.json', JSON.stringify({
	main: 'sea-bundle.cjs',
	output: 'sea-prep.blob',
	disableExperimentalSEAWarning: true,
	assets,
}, null, 2) + '\n')

console.log(`SEA bundle ready. Embedded ${Object.keys(assets).length} assets.`)
