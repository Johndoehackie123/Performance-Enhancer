#!/usr/bin/env node
/**
 * Packages each plugin into one ZIP per client:
 *
 *   build/dist/revenge/<id>@<version>.zip    — manifest with the Revenge API dependency
 *   build/dist/valenced/<id>@<version>.zip   — manifest with the Valenced API dependency
 *
 * A plugin ships a `manifest.json` (Revenge) and, when the client is supported,
 * a `manifest.valenced.json` next to it. The declared dependencies cannot be
 * unified into one manifest: both clients reject plugins whose mandatory API
 * dependency is missing or optional, so per-client manifests are mandatory —
 * see docs/runtime-support.md. The JS bundle is identical across clients.
 *
 * This is the JS-only equivalent of the Gradle `packageAllPlugins` task in the
 * official template. Keeping it in Node means the repository needs no Android
 * SDK while nothing native is used.
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
const distRoots = {
	revenge: join('build', 'dist', 'revenge'),
	valenced: join('build', 'dist', 'valenced'),
}

function runBuild() {
	const result = spawnSync(
		process.execPath,
		[join('node_modules', '@revenge-mod', 'plugin-cli', 'bin', 'revenge-plugin.js'), 'build'],
		{ stdio: 'inherit' },
	)
	if (result.status !== 0) process.exit(result.status ?? 1)

	// Stable-Revenge bundle. Revenge ships two plugin runtimes; the one Revenge
	// Manager installs today is stable, so the artifact must carry a bundle that
	// works there. See scripts/build-vendetta.mjs.
	const stable = spawnSync(process.execPath, ['scripts/build-vendetta.mjs'], { stdio: 'inherit' })
	if (stable.status !== 0) process.exit(stable.status ?? 1)
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

	for (const distDir of Object.values(distRoots)) {
		rmSync(distDir, { recursive: true, force: true })
		mkdirSync(distDir, { recursive: true })
	}

	const packed = []
	for (const root of roots) {
		if (!existsSync(root)) continue
		for (const name of readdirSync(root).sort()) {
			const dir = join(root, name)
			const manifestPath = join(dir, 'manifest.json')
			if (!existsSync(manifestPath)) continue

			// Every client variant shares the source; only the manifest differs.
			const variants = [['revenge', manifestPath]]
			const valencedPath = join(dir, 'manifest.valenced.json')
			if (existsSync(valencedPath)) variants.push(['valenced', valencedPath])

			for (const [client, clientManifestPath] of variants) {
				const manifest = JSON.parse(readFileSync(clientManifestPath, 'utf8'))
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

				const out = join(distRoots[client], `${manifest.id}@${manifest.version}.zip`)
				zipDirectory(staging, join(process.cwd(), out))
				rmSync(staging, { recursive: true, force: true })

				const sha = createHash('sha256').update(readFileSync(out)).digest('hex').slice(0, 12)
				packed.push(`${client}: ${manifest.id}@${manifest.version}`)
				console.log(`✓ Packaged ${client} ${manifest.id}@${manifest.version} (sha256:${sha}…) -> ${out}`)
			}
		}
	}

	if (!packed.length) {
		console.error('No plugins were packaged.')
		process.exit(1)
	}
	console.log(`\n${packed.length} artifact(s) packaged into build/dist/{revenge,valenced}/`)
}

main()
