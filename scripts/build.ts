import * as esbuild from 'esbuild'
import { cp } from 'node:fs/promises'

const production = process.argv.includes('--production')

await esbuild.build({
	entryPoints: ['public/style.css'],
	bundle: true,
	outfile: 'dist/style.css',
	minify: production,
	sourcemap: !production,
	loader: { '.png': 'file' },
})

await esbuild.build({
	entryPoints: ['public/script.ts'],
	bundle: true,
	outfile: 'dist/script.js',
	minify: production,
	sourcemap: !production,
})

await cp('public/index.html', 'dist/index.html')
await cp('public/beep.mp3', 'dist/beep.mp3')
await cp('public/webmanifest.json', 'dist/webmanifest.json')
await cp('public/serviceWorker.js', 'dist/serviceWorker.js')
await cp('public/icons/', 'dist/icons/', { recursive: true, force: true })

console.log('Frontend build complete.')

if (production) {
	process.exit(0)
}
