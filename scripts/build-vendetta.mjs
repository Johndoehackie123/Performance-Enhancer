#!/usr/bin/env node
/**
 * Builds the stable-Revenge (Vendetta-format) bundle.
 *
 *   node scripts/build-vendetta.mjs [--dev]
 *
 * Output: plugins/performance-enhancer/build/js/index.js
 *
 * Why a second build exists
 * -------------------------
 * Revenge ships two plugin runtimes:
 *
 *   - **Stable** (Revenge Manager / RevengeXposed, bundle v1.x) evaluates a
 *     plugin as `(bunny, definePlugin) => { <code>; return plugin?.default ?? plugin; }`
 *     and exposes `window.vendetta`. It has no `revenge.*` globals, no
 *     `plugin()` helper and no repository index — plugins are installed from a
 *     URL that serves `manifest.json` + the JS file.
 *   - **Next** loads `index.json` repositories, exposes the `revenge.*` globals,
 *     and provides the `plugin()` helper with `jsonStorage`.
 *
 * The Next bundle references `revenge.react.*` at module scope, so on the stable
 * runtime it throws while the source is still being defined and the loader never
 * reaches `return plugin`. That is why the plugin could be added as a repository
 * but never installed.
 *
 * This build compiles the runtime-adaptive source in `js/vendetta/` against the
 * stable API, using the same Hermes target settings as the official CLI so both
 * bundles behave identically on device.
 */
import { existsSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import { transform } from '@swc/core'
import { rolldown } from 'rolldown'

const ENTRY = join('plugins', 'performance-enhancer', 'js', 'vendetta', 'index.ts')
const OUT_DIR = join('plugins', 'performance-enhancer', 'build', 'js')
const OUT_FILE = join(OUT_DIR, 'index.js')

const { values } = parseArgs({
	args: process.argv.slice(2),
	options: { dev: { type: 'boolean', default: false } },
})

/**
 * Bare imports the stable runtime provides.
 *
 * `bunny` is the loader's own first parameter — `VdPluginManager` evaluates the
 * source as `(bunny, definePlugin) => …` — so the bundle must resolve React
 * through the loader API that is passed in, not through a global that does not
 * exist on this runtime. A second React would break hooks and context, and a
 * missing `vendetta` global would throw before `plugin` is ever defined.
 */
/**
 * How each bare import resolves inside the bundle.
 *
 * `bunny` is the loader's own first parameter — `VdPluginManager` evaluates the
 * source as `(bunny, definePlugin) => …` — so the bundle reads React from the
 * host's copies instead of shipping a second React (which would break hooks and
 * context). When the source is evaluated somewhere without that binding, it
 * falls back to the loader object on `globalThis`, which the bundle seeds itself.
 */
/**
 * Host accessor.
 *
 * `bunny` is the loader's own first parameter — `VdPluginManager` evaluates the
 * source as `(bunny, definePlugin) => …` — so the bundle reads React from the
 * host's copies rather than shipping a second React (that would break hooks and
 * context). Resolution is deferred to call time and tolerates a missing host, so
 * evaluating the source where no Revenge API exists yields the plugin object
 * instead of throwing before `plugin` is defined.
 */
const ACCESSOR = '__peHost'

const GLOBALS = {
	react: `${ACCESSOR}().metro.common.React`,
	'react-native': `${ACCESSOR}().metro.common.ReactNative`,
	/**
	 * Stable Revenge re-exports the JSX runtime as `bunny._jsx`
	 * (`export * as _jsx from "react/jsx-runtime"` in `lib/index.ts`); some
	 * builds also carry a copy under `metro.common`.
	 */
	'react/jsx-runtime': `(${ACCESSOR}()._jsx||${ACCESSOR}().metro.common.ReactJSXRuntime)`,
}

const external = id => id in GLOBALS

/** Same Hermes-safe transform the official CLI uses. */
const hermesPlugin = {
	name: 'hermes-swc',
	async transform(code, id) {
		if (!/\.[jt]sx?$/.test(id) || id.includes('node_modules')) return null
		const ts = /\.[jt]sx?$/.test(id) && id.slice(id.lastIndexOf('.')).includes('ts')
		const result = await transform(code, {
			filename: id,
			jsc: {
				transform: { react: { runtime: 'automatic' } },
				parser: {
					syntax: ts ? 'typescript' : 'ecmascript',
					tsx: ts && id.endsWith('.tsx'),
					jsx: !ts && id.endsWith('.tsx'),
				},
			},
			env: {
				targets: 'fully supports es6',
				include: [
					'transform-arrow-functions',
					'transform-async-generator-functions',
					'transform-block-scoping',
					'transform-classes',
					'transform-duplicate-named-capturing-groups-regex',
					'transform-named-capturing-groups-regex',
				],
				exclude: [
					'transform-async-to-generator',
					'transform-exponentiation-operator',
					'transform-logical-assignment-operators',
					'transform-nullish-coalescing-operator',
					'transform-numeric-separator',
					'transform-object-rest-spread',
					'transform-optional-catch-binding',
					'transform-optional-chaining',
					'transform-parameters',
					'transform-template-literals',
				],
			},
		})
		return { code: result.code, map: result.map }
	},
}

async function main() {
	if (!existsSync(ENTRY)) {
		console.error(`Missing entry: ${ENTRY}`)
		process.exit(1)
	}

	const BUNDLE_BANNER =
		`function ${ACCESSOR}(){` +
		// Never *assign* a stub: that would shadow a loader object that is set a
		// moment later, and the plugin would never see the real API. The fallback
		// is returned for this call only.
		'var host=typeof bunny<"u"?bunny:(globalThis.bunny??globalThis.vendetta);' +
		'return host||{metro:{common:{}}};}' +
		'\n'

	const bundle = await rolldown({
		input: ENTRY,
		platform: 'neutral',
		external,
		plugins: [hermesPlugin],
		resolve: { extensions: ['.tsx', '.ts', '.jsx', '.js', '.mjs', '.json'] },
		transform: {
			target: 'es2020',
			jsx: { runtime: 'automatic', development: false },
			define: { __DEV__: String(values.dev) },
		},
	})

	const { output } = await bundle.generate({
		// `es` output is wrapped by hand so the loader's `bunny` parameter can be
		// threaded in without relying on a global, and so the final `return` is
		// reachable from the evaluator's function body.
		format: 'iife',
		name: 'performanceEnhancer',
		// Resolved from the loader's own parameter, so no global lookup is needed
		// and a second React is never bundled.
		globals: id => GLOBALS[id],
		exports: 'named',
		esModule: false,
		minify: !values.dev,
	}).catch(error => {
		throw error
	})
	await bundle.close()

	const chunk = output[0]
	if (!chunk) throw new Error('Bundler produced no output')

	/**
	 * One expression has to satisfy both loaders:
	 *
	 *   stable: `(bunny,definePlugin)=>{ <src>; return plugin?.default ?? plugin; }`
	 *           — needs a `plugin` binding after the source runs.
	 *   next:   `new Function('revenge','plugin','return ' + src)` — needs the
	 *           source to be a single expression that *evaluates to* the options.
	 *
	 * Assigning the module namespace to `plugin` satisfies both: it is an
	 * assignment expression (so `return` can take it) and it leaves the global
	 * the stable runtime reads. Both loaders then pick `.default`, which is the
	 * options object.
	 */
	const expression = chunk.code.replace(/^var [A-Za-z_$][\w$]*\s*=\s*/, 'globalThis.plugin=')
	if (!expression.startsWith('globalThis.plugin=')) {
		throw new Error('Unexpected bundle shape: could not expose the plugin as an expression')
	}

	/**
	 * Helper + expression.
	 *
	 * The helper is a function declaration, so it does not break the fact that
	 * the *last* statement is the assignment the loaders return / read.
	 */
	const code = `${BUNDLE_BANNER}${expression}`

	await mkdir(OUT_DIR, { recursive: true })
	await writeFile(OUT_FILE, code.endsWith(';') ? code : `${code};`, 'utf8')

	const kb = (chunk.code.length / 1024).toFixed(1)
	console.log(`✓ Built stable (Vendetta) bundle: ${OUT_FILE} (${kb} kB)`)
}

main().catch(error => {
	console.error('✗ Stable bundle build failed:', error)
	process.exit(1)
})
