#!/usr/bin/env node
/**
 * Copies the artifacts of a release plan into the pool directory.
 *
 *   node scripts/publish.mjs --plan releases.json --pool published/pool
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseArgs } from 'node:util'

const { values } = parseArgs({
	args: process.argv.slice(2),
	options: {
		plan: { type: 'string', default: 'releases.json' },
		pool: { type: 'string', default: 'pool' },
	},
})

const plan = JSON.parse(readFileSync(values.plan, 'utf8'))
if (!Array.isArray(plan)) throw new Error(`${values.plan}: expected an array`)

mkdirSync(values.pool, { recursive: true })

for (const item of plan) {
	if (!existsSync(item.zip)) throw new Error(`Missing artifact: ${item.zip}`)
	copyFileSync(item.zip, join(values.pool, item.file))
	console.log(`+ ${item.id}@${item.version} -> ${join(values.pool, item.file)}`)
}

console.log(`\n${plan.length} artifact(s) copied into ${values.pool}/`)
