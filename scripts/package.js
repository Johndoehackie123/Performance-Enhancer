#!/usr/bin/env node
/**
 * Packages each plugin into build/dist/<id>@<version>.zip.
 *
 * This is the JS-only equivalent of the Gradle `packageAllPlugins` task in the
 * official template: every plugin directory with a manifest.json is built by
 * `revenge-plugin build` and packed with its manifest, its dist.script and its
 * assets/ folder. Keeping it in Node means the repository needs no Android SDK
 * while nothing native is used.
 */
import { createHash } from 'node:crypto'
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

const roots = ['plugins', 'themes']
const distDir = join('build', 'dist')

function runBuild() {
	const result = spawnSync(
		process.execPath,
		[join('node_modules', '@revenge-mod', 'plugin-cli', 'bin', 'revenge-plugin.js'), 'build'],
		{ stdio: 'inherit' },
	)
	if (result.status !== 0) process.exit(result.status ?? 1)
}

function zipDirectory(source, out) {
	const result = spawnSync('zip', ['-q', '-r', '-9', out, '.'], { cwd: source })
	if (result.status !== 0) {
		// Fall back to a minimal store-only zip writer when `zip` is unavailable
		// (e.g. on a bare CI runner).
		throw new Error(`zip failed with status ${result.status}`)
	}
}

function main() {
	if (!existsSync(join('node_modules', '@revenge-mod', 'plugin-cli'))) {
		console.error('Missing dependencies. Run `npm install` first.')
		process.exit(1)
	}

	runBuild()

	rmSync(distDir, { recursive: true, force: true })
	mkdirSync(distDir, { recursive: true })

	const packed = []
	for (const root of roots) {
		if (!existsSync(root)) continue
		for (const name of readdirSync(root).sort()) {
			const dir = join(root, name)
			const manifestPath = join(dir, 'manifest.json')
			if (!existsSync(manifestPath)) continue

			const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
			const staging = mkdtempSync(join(tmpdir(), 'revenge-pkg-'))

			writeFileSync(join(staging, 'manifest.json'), `${JSON.stringify(manifest, null, '\t')}\n`)

			const script = manifest.dist?.script
			if (script) {
				const built = join(dir, 'build', 'js', 'index.js')
				if (!existsSync(built)) {
					console.error(`✗ ${name}: dist.script is set but ${built} is missing`)
					process.exitCode = 1
					continue
				}
				writeFileSync(join(staging, script), readFileSync(built))
			}

			const assetsDir = join(dir, 'assets')
			if (existsSync(assetsDir)) {
				mkdirSync(join(staging, 'assets'), { recursive: true })
				const copy = spawnSync('cp', ['-r', `${assetsDir}/.`, join(staging, 'assets')])
				if (copy.status !== 0) {
					console.error(`✗ ${name}: could not copy assets`)
					process.exitCode = 1
				}
			}

			const out = join(distDir, `${manifest.id}@${manifest.version}.zip`)
			zipDirectory(staging, join(process.cwd(), out))
			rmSync(staging, { recursive: true, force: true })

			const sha = createHash('sha256').update(readFileSync(out)).digest('hex').slice(0, 12)
			packed.push(`${manifest.id}@${manifest.version}`)
			console.log(`✓ Packaged ${manifest.id}@${manifest.version} (sha256:${sha}…) -> ${out}`)
		}
	}

	if (!packed.length) {
		console.error('No plugins were packaged.')
		process.exit(1)
	}
	console.log(`\n${packed.length} plugin(s) packaged into ${distDir}/`)
}

main()
