#!/usr/bin/env node
/**
 * Repository index helpers, with two command styles:
 *
 *   node scripts/index.mjs index --dist build/dist --base-url <url> --out index.json
 *       Thin wrapper over `revenge-plugin generate-index`.
 *
 *   node scripts/index.mjs scan --dist build/dist [--out pool.json]
 *       Writes { "<id>@<version>": { sha256, size } } for the given/ZIP directory.
 *       Used by CI to detect artifacts that changed without a version bump.
 *
 * The project pins `@revenge-mod/plugin-cli` as a git dependency so the CLI is
 * always current; this wrapper exists to keep the command surface in one place
 * and to give CI a deterministic digest format.
 */
import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { parseArgs } from 'node:util'

const [command, ...argv] = process.argv.slice(2)

function digest(file) {
	const bytes = readFileSync(file)
	return {
		sha256: createHash('sha256').update(bytes).digest('hex'),
		size: bytes.length,
	}
}

function scan() {
	const { values } = parseArgs({
		args: argv,
		options: {
			dist: { type: 'string', default: 'build/dist' },
			out: { type: 'string', default: 'pool.json' },
		},
	})

	if (!existsSync(values.dist)) {
		console.error(`No such directory: ${values.dist}`)
		process.exit(1)
	}

	const entries = {}
	for (const name of readdirSync(values.dist).sort()) {
		if (!name.endsWith('.zip')) continue
		const { sha256, size } = digest(join(values.dist, name))
		entries[name.replace(/\.zip$/, '')] = { sha256, size, file: name }
	}

	writeFileSync(values.out, `${JSON.stringify(entries, null, 2)}\n`)
	console.log(`✓ Wrote ${values.out}: ${Object.keys(entries).length} artifact(s)`)
}

function index() {
	if (!existsSync(join('node_modules', '@revenge-mod', 'plugin-cli'))) {
		console.error('Missing dependencies. Run `npm install` first.')
		process.exit(1)
	}
	const cli = join('node_modules', '@revenge-mod', 'plugin-cli', 'bin', 'revenge-plugin.js')
	const result = spawnSync(process.execPath, [cli, 'generate-index', ...argv], {
		stdio: 'inherit',
	})
	process.exit(result.status ?? 1)
}

switch (command) {
	case 'index':
		await index()
		break
	case 'scan':
		scan()
		break
	default:
		console.log(`Usage: node scripts/index.mjs <index|scan> [options]`)
		process.exit(command ? 1 : 0)
}
