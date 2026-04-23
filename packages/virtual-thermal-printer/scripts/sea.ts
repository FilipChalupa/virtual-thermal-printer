import * as esbuild from 'esbuild'
import { writeFile, readFile, readdir } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'

const pkgJson = JSON.parse(await readFile('package.json', 'utf-8'))
const appVersion: string = pkgJson.version ?? 'unknown'

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
		// Bake the version in at build time so the binary doesn't need package.json at runtime.
		__APP_VERSION__: JSON.stringify(appVersion),
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
