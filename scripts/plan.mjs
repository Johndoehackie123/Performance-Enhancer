#!/usr/bin/env node
/**
 * Release planner.
 *
 *   node scripts/plan.mjs --pool <dir> [--dist build/dist] [--out releases.json]
 *
 * A plugin is released when the pool does not contain `<id>@<version>.zip` for
 * the version in its manifest. The plan is a JSON array consumed by the release
 * workflow:
 *
 *   [{ "name", "id", "version", "tag", "zip", "file" }]
 *
 * Writes `count=<n>` to $GITHUB_OUTPUT when running in Actions.
 */
import {
	appendFileSync,
	existsSync,
	readdirSync,
	readFileSync,
	writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import { parseArgs } from 'node:util'

const VERSION = /^(\d+(?:\.\d+)*)(?:-([a-z0-9]+))?$/

function parseVersion(value) {
	const match = VERSION.exec(value)
	if (!match) throw new Error(`Invalid version: '${value}'`)
	return { nums: match[1].split('.').map(Number), label: match[2] ?? null }
}

function compare(a, b) {
	const length = Math.max(a.nums.length, b.nums.length)
	for (let i = 0; i < length; i++) {
		const diff = (a.nums[i] ?? 0) - (b.nums[i] ?? 0)
		if (diff) return diff
	}
	if (a.label === b.label) return 0
	if (a.label === null) return 1
	if (b.label === null) return -1
	return a.label < b.label ? -1 : 1
}

function newest(versions) {
	return versions.reduce(
		(best, current) =>
			best === null || compare(parseVersion(current), parseVersion(best)) > 0 ? current : best,
		null,
	)
}

function main() {
	const { values } = parseArgs({
		args: process.argv.slice(2),
		options: {
			pool: { type: 'string', default: 'pool' },
			dist: { type: 'string', default: 'build/dist' },
			out: { type: 'string', default: 'releases.json' },
			'plugins-dir': { type: 'string', multiple: true, default: ['plugins', 'themes'] },
		},
	})

	const published = new Map()
	if (existsSync(values.pool)) {
		for (const file of readdirSync(values.pool)) {
			const match = /^(.+)@(.+)\.zip$/.exec(file)
			if (!match) continue
			const [, id, version] = match
			if (!published.has(id)) published.set(id, [])
			published.get(id).push(version)
		}
	}

	const plan = []
	for (const root of values['plugins-dir']) {
		if (!existsSync(root)) continue
		for (const name of readdirSync(root).sort()) {
			const manifestPath = join(root, name, 'manifest.json')
			if (!existsSync(manifestPath)) continue

			const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
			const { id, version } = manifest
			parseVersion(version)

			const released = published.get(id) ?? []
			if (released.includes(version)) {
				console.log(`= ${id}@${version} already published`)
				continue
			}

			const latest = newest(released)
			if (latest && compare(parseVersion(version), parseVersion(latest)) < 0) {
				throw new Error(
					`${name}: ${version} is older than the published ${latest}. Refusing to downgrade.`,
				)
			}

			const zip = join(values.dist, `${id}@${version}.zip`)
			if (!existsSync(zip)) {
				throw new Error(`${name}: expected artifact ${zip}. Run \`npm run package\` first.`)
			}

			plan.push({
				name: manifest.name,
				id,
				version,
				tag: `${name}-v${version}`,
				zip,
				file: `${id}@${version}.zip`,
			})
			console.log(`+ ${id}@${version} -> ${zip}`)
		}
	}

	writeFileSync(values.out, `${JSON.stringify(plan, null, 2)}\n`)
	console.log(`\n${plan.length} release(s) planned -> ${values.out}`)

	if (process.env.GITHUB_OUTPUT) {
		appendFileSync(process.env.GITHUB_OUTPUT, `count=${plan.length}\n`)
	}
}

try {
	main()
} catch (error) {
	console.error(`::error::${error instanceof Error ? error.message : error}`)
	process.exit(1)
}
