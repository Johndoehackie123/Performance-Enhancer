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
import { readFileSync } from 'node:fs'
import { parseArgs } from 'node:util'

const { values } = parseArgs({
	args: process.argv.slice(2),
	options: { plan: { type: 'string', default: 'releases.json' } },
})

const plan = JSON.parse(readFileSync(values.plan, 'utf8'))
const token = process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN

function hasGh() {
	try {
		execFileSync('gh', ['--version'], { stdio: 'ignore' })
		return true
	} catch {
		return false
	}
}

function notes(item) {
	return [
		`## ${item.name} ${item.version}`,
		'',
		'### Install in Revenge',
		'Settings > Revenge > Plugins, add this repository, then install **' + item.name + '**.',
		'',
		'Or sideload the attached ZIP: Settings > Revenge > Plugins > gear icon > Install from file.',
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

		execFileSync(
			'gh',
			[
				'release',
				'create',
				item.tag,
				item.zip,
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

	const zip = readFileSync(item.zip)
	const upload = await fetch(
		`https://uploads.github.com/repos/${repo}/releases/${release.id}/assets?name=${encodeURIComponent(item.file)}`,
		{
			method: 'POST',
			headers: {
				authorization: `Bearer ${token}`,
				'content-type': 'application/zip',
			},
			body: zip,
		},
	)
	if (!upload.ok) throw new Error(`Could not upload ${item.file}: ${upload.status}`)
	console.log(`✓ ${item.tag}`)
}
