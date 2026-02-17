import * as esbuild from 'esbuild'
import { copy } from '@std/fs'

const production = Deno.args.includes('--production')

// Bundle CSS
await esbuild.build({
	entryPoints: ['public/style.css'],
	bundle: true,
	outfile: 'dist/style.css',
	minify: production,
	sourcemap: !production,
	loader: { '.png': 'file' },
})

// Bundle JavaScript
await esbuild.build({
	entryPoints: ['public/script.ts'],
	bundle: true,
	outfile: 'dist/script.js',
	minify: production,
	sourcemap: !production,
})

// Copy HTML
await copy('public/index.html', 'dist/index.html', { overwrite: true })

await copy('public/beep.mp3', 'dist/beep.mp3', { overwrite: true })
await copy('public/webmanifest.json', 'dist/webmanifest.json', {
	overwrite: true,
})
await copy('public/serviceWorker.js', 'dist/serviceWorker.js', {
	overwrite: true,
})
await copy('public/icons/', 'dist/icons/', { overwrite: true })

console.log('Frontend build complete.')

if (production) {
	Deno.exit(0)
}
