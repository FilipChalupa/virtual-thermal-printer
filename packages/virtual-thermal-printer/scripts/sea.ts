import * as esbuild from 'esbuild'
import { writeFile } from 'node:fs/promises'

await esbuild.build({
	entryPoints: ['main.ts'],
	bundle: true,
	platform: 'node',
	format: 'cjs',
	outfile: 'sea-bundle.cjs',
})

await writeFile('sea-config.json', JSON.stringify({
	main: 'sea-bundle.cjs',
	output: 'sea-prep.blob',
	disableExperimentalSEAWarning: true,
}, null, 2) + '\n')

console.log('SEA bundle ready.')
