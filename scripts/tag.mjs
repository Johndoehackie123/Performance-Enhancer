#!/usr/bin/env node
/**
 * Creates a GitHub release (and tag) per planned release.
 *
 *   GH_TOKEN=… node scripts/tag.mjs --plan releases.json
 *
 * Uses the GitHub CLI when it is installed, and the REST API otherwise, so it
 * works on any runner. Existing tags are left untouched, which keeps re-runs
 * idempotent.
 */
import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdtempSync, readdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseArgs } from 'node:util'

const { values } = parseArgs({
	args: process.argv.slice(2),
	options: {
		plan: { type: 'string', default: 'releases.json' },
		/** Extra directory whose ZIPs are attached to every created release. */
		'attach-dir': { type: 'string' },
	},
})

const plan = JSON.parse(readFileSync(values.plan, 'utf8'))
const token = process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN

// Additional artifacts attached to every release (e.g. the Valenced build).
// Release asset names must be unique, so a Valenced ZIP colliding with the
// Revenge artifact is staged under a `-valenced` suffix.
function dedupeAssets(paths, existing) {
	const out = []
	const used = new Set(existing.map(path => path.split('/').pop()))
	const staging = mkdtempSync(join(tmpdir(), 'pe-assets-'))
	for (const path of paths) {
		const base = path.split('/').pop()
		if (used.has(base)) {
			const renamed = base.replace(/\.zip$/, '-valenced.zip')
			const dest = join(staging, renamed)
			copyFileSync(path, dest)
			used.add(renamed)
			out.push(dest)
		} else {
			used.add(base)
			out.push(path)
		}
	}
	return out
}

const extraAssetPaths = values['attach-dir']
	? readdirSync(values['attach-dir'])
			.filter(name => name.endsWith('.zip'))
			.map(name => join(values['attach-dir'], name))
	: []

function hasGh() {
	try {
		execFileSync('gh', ['--version'], { stdio: 'ignore' })
		return true
	} catch {
		return false
	}
}

const PAGES = 'https://raw.githubusercontent.com/Johndoehackie123/Performance-Enhancer/gh-pages'

function notes(item) {
	const file = item.file ?? `${item.id}@${item.version}.zip`
	return [
		`## ${item.name} ${item.version}`,
		'',
		'### Revenge stable (Revenge Manager / RevengeXposed)',
		'Settings > Revenge > Plugins > Install a plugin, then paste:',
		'',
		`${PAGES}/pool/${file}`,
		'',
		'### Revenge Next',
		'Settings > Revenge > Plugins > gear icon next to Plugins > Add repository:',
		'',
		`${PAGES}`,
		'(the client appends `index.json` to the repository URL)',
		'',
		'### Valenced',
		'Settings > Valenced > Plugins > Add repository:',
		'',
		`${PAGES}/valenced/index.json`,
		'',
		'Or sideload the Valenced ZIP attached to this release (\'...-valenced.zip\'): Settings > Valenced > Plugins > Install plugin from file.',
	].join('\n')
}

const useGh = hasGh()

for (const item of plan) {
	if (useGh) {
		try {
			execFileSync('gh', ['release', 'view', item.tag], { stdio: 'ignore' })
			console.log(`= ${item.tag} already exists`)
			continue
		} catch {}

		const assets = [
			item.zip,
			...dedupeAssets(extraAssetPaths, [item.zip]),
		].filter(path => existsSync(path))
		execFileSync(
			'gh',
			[
				'release',
				'create',
				item.tag,
				...assets,
				'--title',
				`${item.name} ${item.version}`,
				'--notes',
				notes(item),
			],
			{ stdio: 'inherit' },
		)
		console.log(`✓ ${item.tag}`)
		continue
	}

	// REST fallback.
	if (!token) throw new Error('Set GH_TOKEN or GITHUB_TOKEN to create releases')
	const api = 'https://api.github.com'
	const repo = process.env.GITHUB_REPOSITORY
	if (!repo) throw new Error('GITHUB_REPOSITORY is not set')

	const exists = await fetch(`${api}/repos/${repo}/releases/tags/${item.tag}`, {
		headers: { authorization: `Bearer ${token}` },
	})
	if (exists.ok) {
		console.log(`= ${item.tag} already exists`)
		continue
	}

	const created = await fetch(`${api}/repos/${repo}/releases`, {
		method: 'POST',
		headers: {
			authorization: `Bearer ${token}`,
			'content-type': 'application/json',
		},
		body: JSON.stringify({
			tag_name: item.tag,
			name: `${item.name} ${item.version}`,
			body: notes(item),
		}),
	})
	if (!created.ok) throw new Error(`Could not create ${item.tag}: ${created.status}`)
	const release = await created.json()

	const assets = [
		item.zip,
		...dedupeAssets(extraAssetPaths, [item.zip]),
	].filter(path => existsSync(path))
	for (const path of assets) {
		const fileName = path.split('/').pop()
		const zip = readFileSync(path)
		const upload = await fetch(
			`https://uploads.github.com/repos/${repo}/releases/${release.id}/assets?name=${encodeURIComponent(fileName)}`,
			{
				method: 'POST',
				headers: {
					authorization: `Bearer ${token}`,
					'content-type': 'application/zip',
				},
				body: zip,
			},
		)
		if (!upload.ok) throw new Error(`Could not upload ${fileName}: ${upload.status}`)
	}
	console.log(`✓ ${item.tag}`)
}
