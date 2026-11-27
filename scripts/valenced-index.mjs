#!/usr/bin/env node
/**
 * Generates a Valenced repository index (format 1) from a directory of plugin
 * ZIPs — the Valenced counterpart of `revenge-plugin generate-index`.
 *
 *   node scripts/valenced-index.mjs --dist <dir> --base-url <url> --out <file>
 *
 * The index shape is what Valenced's `parseRepoIndex` expects
 * (valenced/core/src/commonMain/kotlin/app/valenced/plugins/repos/RepoIndex.kt):
 *
 *   {
 *     "format": 1,
 *     "name": "…", "description": "…", "icon"?: "…",
 *     "plugins": {
 *       "<id>": {
 *         "name": "…", "description": "…", "author": "…", "icon"?: "…",
 *         "channels": { "latest": "<version>" },
 *         "versions": {
 *           "<version>": { "url", "sha256", "size", "dependencies": { … } }
 *         }
 *       }
 *     }
 *   }
 *
 * The `dependencies` echoed into the index MUST match the manifest exactly —
 * Valenced aborts the install when they do not. They are copied verbatim from
 * each artifact's manifest to guarantee that.
 *
 * `latest` points at the newest non-prerelease version (or the newest overall
 * when every version is a prerelease).
 */
import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import { unzipSync } from 'fflate'

const VERSION_REGEX = /^(\d+(?:\.\d+)*)(?:-([a-z0-9]+))?$/

function parseVersion(value) {
	const match = VERSION_REGEX.exec(value)
	if (!match) throw new Error(`Invalid version: '${value}'`)
	return { nums: match[1].split('.').map(Number), label: match[2] ?? null }
}

function compareVersions(a, b) {
	const length = Math.max(a.nums.length, b.nums.length)
	for (let i = 0; i < length; i++) {
		const diff = (a.nums[i] ?? 0) - (b.nums[i] ?? 0)
		if (diff) return diff
	}
	return 0
}

function compareFull(a, b) {
	const nums = compareVersions(a, b)
	if (nums !== 0) return nums
	if (a.label === b.label) return 0
	if (a.label === null) return 1
	if (b.label === null) return -1
	return a.label < b.label ? -1 : 1
}

function newest(versions) {
	return versions.reduce(
		(best, current) =>
			best === null || compareFull(parseVersion(current), parseVersion(best)) > 0
				? current
				: best,
		null,
	)
}

function main() {
	const { values } = parseArgs({
		args: process.argv.slice(2),
		options: {
			dist: { type: 'string', default: join('build', 'dist', 'valenced') },
			'base-url': { type: 'string' },
			out: { type: 'string', default: 'index.json' },
			config: { type: 'string', default: 'repo.config.json' },
			name: { type: 'string' },
			description: { type: 'string' },
			icon: { type: 'string' },
		},
	})

	const baseUrl = values['base-url']?.replace(/\/+$/, '')
	if (!baseUrl || !/^https?:\/\//.test(baseUrl)) {
		console.error('--base-url must be an absolute http(s) URL')
		process.exit(1)
	}
	if (!existsSync(values.dist)) {
		console.error(`No such directory: ${values.dist}`)
		process.exit(1)
	}

	let repoConfig = {}
	if (existsSync(values.config)) {
		repoConfig = JSON.parse(readFileSync(values.config, 'utf8'))
	}

	const plugins = {}
	const pluginFiles = {}

	for (const file of readdirSync(values.dist).sort()) {
		if (!file.endsWith('.zip')) continue
		const bytes = readFileSync(join(values.dist, file))
		const digest = createHash('sha256').update(bytes).digest('hex')

		const files = unzipSync(bytes, { filter: entry => entry.name === 'manifest.json' })
		const manifestRaw = files['manifest.json']
		if (!manifestRaw) throw new Error(`${file}: no manifest.json inside`)

		const manifest = JSON.parse(Buffer.from(manifestRaw).toString('utf8'))
		const { id, version } = manifest
		parseVersion(version)

		const expected = `${id}@${version}.zip`
		if (file !== expected) {
			throw new Error(`${file}: file name does not match manifest (expected ${expected})`)
		}

		if (!manifest.dependencies?.['valenced.api']) {
			throw new Error(`${file}: not a Valenced manifest (missing valenced.api dependency)`)
		}

		plugins[id] ??= {
			name: manifest.name ?? id,
			description: manifest.description ?? '',
			author: manifest.author ?? '',
			...(manifest.icon ? { icon: manifest.icon } : {}),
			channels: {},
			versions: {},
		}
		pluginFiles[id] ??= []
		pluginFiles[id].push(version)

		plugins[id].versions[version] = {
			url: `${baseUrl}/${file}`,
			sha256: digest,
			size: bytes.byteLength,
			// Valenced aborts the install when index and manifest disagree.
			dependencies: manifest.dependencies ?? {},
		}
	}

	if (!Object.keys(plugins).length) {
		console.log(`No plugin ZIPs found in ${values.dist}; nothing to index.`)
		process.exit(0)
	}

	for (const [id, plugin] of Object.entries(plugins)) {
		const versions = pluginFiles[id]
		const stable = versions.filter(v => !VERSION_REGEX.exec(v)?.[2])
		plugin.channels.latest = newest(stable.length ? stable : versions)
	}

	const index = {
		format: 1,
		name: values.name ?? repoConfig.name ?? 'Plugins',
		description: values.description ?? repoConfig.description ?? '',
		...(values.icon ?? repoConfig.icon ? { icon: values.icon ?? repoConfig.icon } : {}),
		plugins,
	}

	writeFileSync(values.out, `${JSON.stringify(index, null, '\t')}\n`)
	const count = Object.values(plugins).reduce((n, p) => n + Object.keys(p.versions).length, 0)
	console.log(`✓ Wrote ${values.out}: ${Object.keys(plugins).length} plugin(s), ${count} version(s)`)
}

main()
