import * as esbuild from 'esbuild'
import { cp, readFile, writeFile } from 'node:fs/promises'
import { execSync } from 'node:child_process'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const production = process.argv.includes('--production')

// Stamp the served index.html with a build fingerprint so it's obvious which
// version a browser is looking at (view-source shows it near the top). git may
// be unavailable when building from a tarball, so fall back gracefully.
function gitCommit(): string {
	try {
		const commit = execSync('git rev-parse --short HEAD', {
			encoding: 'utf-8',
		}).trim()
		const dirty = execSync('git status --porcelain', { encoding: 'utf-8' })
			.trim().length > 0
		return commit + (dirty ? '-dirty' : '')
	} catch {
		return 'unknown'
	}
}

async function copyIndexHtmlWithBuildInfo() {
	const version = JSON.parse(
		await readFile('package.json', 'utf-8'),
	).version ?? 'unknown'
	const buildInfo =
		`<!-- Virtual Thermal Printer | version ${version} | commit ${gitCommit()} | built ${new Date().toISOString()} -->`
	const html = await readFile('public/index.html', 'utf-8')
	await writeFile(
		'dist/index.html',
		html.replace('<!DOCTYPE html>', `<!DOCTYPE html>\n${buildInfo}`),
	)
}

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
	alias: {
		'escpos-decoder/types': resolve(__dirname, '../../escpos-decoder/src/types.ts'),
	},
})

await copyIndexHtmlWithBuildInfo()
await cp('public/beep.mp3', 'dist/beep.mp3')
await cp('public/webmanifest.json', 'dist/webmanifest.json')
await cp('public/serviceWorker.js', 'dist/serviceWorker.js')
await cp('public/icons/', 'dist/icons/', { recursive: true, force: true })

console.log('Frontend build complete.')

if (production) {
	process.exit(0)
}
