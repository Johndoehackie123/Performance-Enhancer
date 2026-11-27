#!/usr/bin/env node
/**
 * Verifies the packaged ZIPs against every client that loads them.
 *
 *   node scripts/verify-stable.mjs [path/to/plugin.zip]
 *
 * With no argument, every `*.zip` under `build/dist` is checked, so CI can run
 * it right after `bun run package`.
 *
 * The checks mirror the loaders, not our own assumptions:
 *
 *   1. Stable (`VdPluginManager`): evaluate `(bunny, definePlugin) => { src;
 *      return plugin?.default ?? plugin; }` against a mock stable host, then
 *      call `onLoad`, `start`, render `SettingsComponent`, and `onUnload`.
 *   2. Revenge Next: `new Function('revenge', 'plugin', 'return ' + src)` must
 *      resolve the options object — exactly what
 *      `bundle/lib/plugins/src/_internal/script.ts` does — then `init`, `start`,
 *      render and `stop` against a mock Next API.
 *   3. Valenced: the same contract with `valenced` as the scope — mirrors
 *      Valenced's `createOptionsFactory`, at the same source lines.
 *   4. Manifest validation mirrors for both clients (Valenced rejects the ZIP
 *      unless `valenced.api` and `discord` are declared and non-optional;
 *      Revenge requires `revenge.api` and `discord`).
 *
 * A release that fails any of these is broken on that client, and the exit
 * code says so.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { unzipSync } from 'fflate'

const DIST = join('build', 'dist')

function findZips(dir) {
	if (!existsSync(dir)) return []
	const out = []
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const path = join(dir, entry.name)
		if (entry.isDirectory()) out.push(...findZips(path))
		else if (entry.name.endsWith('.zip')) out.push(path)
	}
	return out.sort()
}

const zipArgs = process.argv.slice(2)
const zipPaths = zipArgs.length ? zipArgs : findZips(DIST)
if (!zipPaths.length) {
	console.error('No plugin ZIPs found. Run `bun run package` first.')
	process.exit(1)
}

const failures = []
function check(label, name, condition, detail) {
	if (condition) {
		console.log(`  ✓ ${name}`)
	} else {
		console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`)
		failures.push(`${label}: ${name}`)
	}
}

/* ---------------------------------------------------------------- mock hosts */

const ALL_GLOBALS = ['bunny', 'vendetta', 'valenced', 'revenge', 'plugin']

function clearGlobals() {
	for (const name of ALL_GLOBALS) {
		try {
			delete globalThis[name]
		} catch {
			globalThis[name] = undefined
		}
	}
}

/** Stable (Bunny / Vendetta) mock. */
function mockStableHost() {
	const subscriptions = []
	const toasts = []
	const cache = new Map()
	for (let i = 0; i < 400; i++) cache.set(`k${i}`, { size: 300 * 1024 })

	const originalJsx = (type, props) => ({ type, props })
	const jsxRuntime = { jsx: originalJsx, jsxs: originalJsx, Fragment: Symbol('fragment') }
	const React = {
		createElement: originalJsx,
		isValidElement: () => true,
		useMemo: fn => fn(),
		useSyncExternalStore: (_subscribe, get) => get(),
		useReducer: (_reducer, initial) => [initial, () => {}],
		useEffect: () => {},
		Fragment: Symbol('fragment'),
	}
	const ReactNative = {
		AppState: { addEventListener: () => ({ remove() {} }), currentState: 'active' },
		Platform: { constants: { totalCores: 8, maxCpuFrequencyHz: 2.8e9 } },
		ScrollView: 'ScrollView',
		View: 'View',
		Text: 'Text',
		Pressable: 'Pressable',
	}

	const api = {
		_jsx: jsxRuntime,
		metro: {
			common: {
				React,
				ReactNative,
				FluxDispatcher: {
					dispatch() {},
					subscribe(type, callback) {
						subscriptions.push([type, callback])
						return () => {}
					},
				},
			},
			findByProps: (...props) => {
				if (props.includes('queryCache')) return { queryCache: cache }
				if (props.includes('jsx')) return jsxRuntime
				if (props.includes('TableRow')) {
					return { TableRow: () => null, TableRowGroup: () => null, TableSwitchRow: () => null }
				}
				return undefined
			},
		},
		ui: {
			toasts: { showToast: (content, asset) => toasts.push([content, asset]) },
			assets: { getAssetIDByName: () => 42 },
			components: {
				Forms: {
					TableRow: () => null,
					TableRowGroup: () => null,
					TableSwitchRow: () => null,
				},
			},
		},
		patcher: { before: () => () => {}, after: () => () => {}, instead: () => () => {} },
	}

	globalThis.nativeModuleProxy = {
		RTNDeviceManager: {
			getConstants: () => ({
				totalMemory: 8 * 1024 ** 3,
				socName: 'SM8550 Snapdragon 8 Gen 2',
				deviceModel: 'Pixel 8',
				deviceBrand: 'google',
				deviceManufacturer: 'Google',
			}),
		},
	}
	globalThis.HermesInternal = {
		getRuntimeProperties: () => ({
			'HermesInternal.getHeapInfo().usedBytes': String(64 * 1024 * 1024),
		}),
	}

	return { api, subscriptions, toasts, jsxRuntime, originalJsx }
}

/**
 * Modern (Next / Valenced) mock — the same API tree, rooted at the global the
 * client installs (`revenge` / `valenced`).
 */
function mockModernHost(namespace) {
	const fluxHandlers = []
	const toasts = []

	const jsxRuntime = (() => {
		const f = (type, props) => ({ type, props })
		return { jsx: f, jsxs: f, Fragment: Symbol('fragment') }
	})()
	const React = {
		createElement: (type, props) => ({ type, props }),
		isValidElement: () => true,
		useMemo: fn => fn(),
		useSyncExternalStore: (_subscribe, get) => get(),
		useReducer: (_reducer, initial) => [initial, () => {}],
		useEffect: () => {},
		Fragment: Symbol('fragment'),
	}
	const ReactNative = {
		AppState: { addEventListener: () => ({ remove() {} }), currentState: 'active' },
		Platform: { constants: { totalCores: 8, maxCpuFrequencyHz: 2.8e9 } },
		ScrollView: 'ScrollView',
		View: 'View',
		Text: 'Text',
		Pressable: 'Pressable',
	}

	const withProps = (...props) => ({ __withProps: props })

	const api = {
		modules: {
			finders: {
				filters: { withProps },
				lookupModule(filter) {
					const props = filter?.__withProps ?? []
					if (props.includes('jsx')) return [jsxRuntime, 420]
					if (props.includes('queryCache')) return [{ queryCache: new Map() }, 421]
					return []
				},
			},
		},
		patcher: { before: () => () => {}, after: () => () => {}, instead: () => () => {} },
		plugins: { restart: async () => {}, stop: async () => {} },
		react: {
			...React,
			React,
			ReactNative,
			ReactJSXRuntime: jsxRuntime,
			jsxRuntime,
			native: ReactNative,
		},
		assets: { getAssetIdByName: () => 42 },
		externals: {},
		utils: {},
		components: {},
		discord: {
			flux: {
				onFluxEventDispatched(type, patch) {
					fluxHandlers.push([type, patch])
					return () => {}
				},
				onAnyFluxEventDispatched(patch) {
					fluxHandlers.push(['*', patch])
					return () => {}
				},
			},
			actions: {
				ToastActionCreators: {
					open: (id, toast) => toasts.push([id, toast]),
				},
			},
		},
	}
	globalThis[namespace] = api

	globalThis.nativeModuleProxy = {
		RTNDeviceManager: {
			getConstants: () => ({
				totalMemory: 8 * 1024 ** 3,
				socName: 'SM8550 Snapdragon 8 Gen 2',
				deviceModel: 'Pixel 8',
				deviceBrand: 'google',
				deviceManufacturer: 'Google',
			}),
		},
	}
	globalThis.HermesInternal = {
		getRuntimeProperties: () => ({
			'HermesInternal.getHeapInfo().usedBytes': String(64 * 1024 * 1024),
		}),
	}

	/** Lifecycle API decoration exactly as the client's jsonStorage plugin does it. */
	function makeLifecycleApi() {
		const cleanups = []
		let stored = { performance: { toastOnStart: true } }
		const lifecycle = {
			cleanup: (...fns) => cleanups.push(...fns),
			plugin: {
				manifest: { id: 'johndoehackie123.performance-enhancer' },
				startedLate: false,
				requireReload() {},
			},
			unscoped: api,
			decorate() {},
			jsonStorage: {
				cache: stored,
				async get() {
					return this.cache
				},
				async set(value) {
					this.cache = value
					return value
				},
			},
		}
		return { lifecycle, cleanups }
	}

	return { api, jsxRuntime, fluxHandlers, toasts, makeLifecycleApi }
}

/* ---------------------------------------------------------- manifest mirrors */

const MANIFEST_FORMAT = 1
const PLUGIN_ID = /^[a-zA-Z0-9.-]+$/
const VERSION_RANGE = /^(\*|>=?\d+(\.\d+)*( <\d+(\.\d+)*)?)$/

function checkManifest(label, manifest, expectations) {
	// Shared structural rules (both clients).
	check(label, 'manifest format is 1', manifest.format === MANIFEST_FORMAT, `got ${manifest.format}`)
	check(
		label,
		'plugin id is valid',
		PLUGIN_ID.test(manifest.id) && !manifest.id.includes('..') && !manifest.id.startsWith('.'),
		manifest.id,
	)
	check(
		label,
		'version parses',
		typeof manifest.version === 'string' && /^\d+\.\d+\.\d+(-[a-z0-9]+)?$/.test(manifest.version),
		manifest.version,
	)

	// Mandatory, non-optional reserved dependencies.
	for (const reserved of expectations.required) {
		const dep = manifest.dependencies?.[reserved]
		check(label, `declares mandatory '${reserved}' dependency`, Boolean(dep))
		check(
			label,
			`'${reserved}' is not optional`,
			dep ? !dep.optional : false,
		)
		const range = dep?.version ?? '*'
		check(
			label,
			`'${reserved}' version range parses (${range})`,
			range === '*' || VERSION_RANGE.test(range),
			range,
		)
	}
}

/* ------------------------------------------------------------------- source */

/**
 * Globals the shipped bundle may never reference.
 *
 * Hermes (the JS engine in React Native / Discord) deliberately does not
 * implement WHATWG APIs such as `structuredClone`, and is missing or lagging
 * on some ES2022+ additions. Referencing any of these throws at runtime on
 * device — exactly what shipped in 1.2.0 (`ReferenceError: Property
 * 'structuredClone' doesn't exist`, facebook/hermes#684). The bundle is
 * checked so this class of bug fails CI instead of the user's client.
 */
const BANNED_GLOBALS = [
	'structuredClone',
	'Object.hasOwn(',
	'.at(',
	'.replaceAll(',
	'.findLast(',
	'.findLastIndex(',
	'.allSettled(',
	'Object.groupBy',
	'Map.groupBy',
	'Promise.withResolvers',
	'Array.fromAsync',
	'FinalizationRegistry',
	'WeakRef',
	'btoa(',
	'atob(',
]

function checkSource(label, source, manifest, sizeBytes) {
	check(label, 'source is a single expression statement', /^globalThis\.plugin=/.test(source.trimStart()))
	check(
		label,
		'source is reasonably small',
		sizeBytes > 0 && sizeBytes < 1024 * 1024,
		`${sizeBytes} B`,
	)
	check(
		label,
		'no stray references to other clients\' loaders',
		!/\brequire\(['"]revenge/.test(source) && !/\brequire\(['"]valenced/.test(source),
	)
	for (const token of BANNED_GLOBALS) {
		check(label, `no reference to unsupported global \'${token}\'`, !source.includes(token))
	}
}

/* ----------------------------------------------------------------- stable run */

function runStable(label, source) {
	const host = mockStableHost()

	let plugin
	try {
		// Exactly what VdPluginManager.startPlugin builds.
		const instantiator = new Function(
			'bunny',
			'definePlugin',
			`${source}\nreturn plugin?.default ?? plugin;`,
		)
		plugin = instantiator(host.api, options => options)
		check(label, 'source evaluates and returns a plugin object', Boolean(plugin && typeof plugin === 'object'))
	} catch (error) {
		check(label, 'source evaluates and returns a plugin object', false, error.message)
		return
	}

	check(label, 'exposes start()', typeof plugin.start === 'function')
	check(label, 'exposes onUnload()', typeof plugin.onUnload === 'function')
	check(label, 'exposes SettingsComponent()', typeof plugin.SettingsComponent === 'function')

	try {
		plugin.onLoad?.()
		check(label, 'onLoad() runs', true)
	} catch (error) {
		check(label, 'onLoad() runs', false, error.message)
	}

	try {
		plugin.start.call({ id: 'johndoehackie123.performance-enhancer', storage: { cache: {} } })
		check(label, 'start() runs', true)
	} catch (error) {
		check(label, 'start() runs', false, error.message)
	}

	try {
		const tree = plugin.SettingsComponent({})
		check(label, 'SettingsComponent renders', Boolean(tree))
	} catch (error) {
		check(label, 'SettingsComponent renders', false, error.message)
	}

	check(
		label,
		'blocks telemetry through the Flux dispatcher',
		host.subscriptions.some(([type]) => type === 'TRACK'),
		`subscribed to ${host.subscriptions.length} action(s)`,
	)

	const track = host.subscriptions.find(([type]) => type === 'TRACK')
	check(
		label,
		'a TRACK dispatch is cancelled',
		track ? track[1]({ type: 'TRACK' }) === false : false,
	)

	check(label, 'shows the start-up toast', host.toasts.length > 0)

	try {
		plugin.onUnload?.()
		check(label, 'onUnload() runs', true)
	} catch (error) {
		check(label, 'onUnload() runs', false, error.message)
	}
	check(label, 'restores the JSX runtime on unload', host.jsxRuntime.jsx === host.originalJsx)
}

/* ---------------------------------------------------------------- modern run */

async function runModern(label, source, namespace) {
	const host = mockModernHost(namespace)
	const sourceUrl = `${namespace === 'valenced' ? 'Valenced' : 'Revenge'}:Plugin:johndoehackie123.performance-enhancer`

	let options
	try {
		// Exactly what bundle/lib/plugins/src/_internal/script.ts does.
		options = new Function(
			namespace,
			'plugin',
			`return ${source}\n//# sourceURL=${sourceUrl}`,
		)(host.api, o => o)?.default
		check(label, 'createOptionsFactory-style evaluation returns the options object', Boolean(options && typeof options === 'object'))
	} catch (error) {
		check(label, 'createOptionsFactory-style evaluation returns the options object', false, error.message)
		return
	}
	if (!options) return

	check(label, 'exposes init()', typeof options.init === 'function')
	check(label, 'exposes start()', typeof options.start === 'function')
	check(label, 'exposes stop()', typeof options.stop === 'function')
	check(label, 'exposes SettingsComponent()', typeof options.SettingsComponent === 'function')

	const { lifecycle, cleanups } = host.makeLifecycleApi()
	try {
		await options.init(lifecycle)
		check(label, 'init(api) runs', true)
	} catch (error) {
		check(label, 'init(api) runs', false, error.message)
	}

	try {
		options.start(lifecycle)
		check(label, 'start(api) runs', true)
	} catch (error) {
		check(label, 'start(api) runs', false, error.message)
	}

	check(
		label,
		'registers telemetry patches through discord.flux',
		host.fluxHandlers.some(([type]) => type === 'TRACK'),
		`flux handlers: ${host.fluxHandlers.map(([t]) => t).join(',') || 'none'}`,
	)

	const track = host.fluxHandlers.find(([type]) => type === 'TRACK')?.[1]
	const payload = { type: 'TRACK' }
	check(
		label,
		'a TRACK dispatch is blocked by the telemetry patch',
		track ? track(payload) == null || track(payload) === false : false,
	)

	check(label, 'shows the start-up toast', host.toasts.length > 0)

	try {
		const tree = options.SettingsComponent({})
		check(label, 'SettingsComponent renders', Boolean(tree))
	} catch (error) {
		check(label, 'SettingsComponent renders', false, error.message)
	}

	try {
		await options.stop(lifecycle)
		check(label, 'stop(api) runs', true)
	} catch (error) {
		check(label, 'stop(api) runs', false, error.message)
	}
	check(
		label,
		'releases cleanups on stop',
		cleanups.length > 0,
		`${cleanups.length} cleanup(s) registered`,
	)
}

/* -------------------------------------------------------------------- main */

for (const zipPath of zipPaths) {
	const files = unzipSync(readFileSync(zipPath))
	const decoder = new TextDecoder()

	clearGlobals()
	const manifest = JSON.parse(decoder.decode(files['manifest.json']))
	const scriptName = manifest.dist?.script ?? 'index.js'
	const source = files[scriptName] ? decoder.decode(files[scriptName]) : ''

	const client = manifest.dependencies?.['valenced.api']
		? 'valenced'
		: manifest.dependencies?.['revenge.api']
			? 'revenge'
			: 'unknown'
	const label = `${client} ${manifest.version ?? '?'}`

	console.log(`\nVerifying ${zipPath}`)
	console.log(`  plugin ${manifest.id}@${manifest.version} (${client} manifest)`)

	check(label, 'dist.script is present', Boolean(source), scriptName)
	if (!source) continue

	if (client === 'valenced') {
		checkManifest(label, manifest, { required: ['valenced.api', 'discord'] })
	} else if (client === 'revenge') {
		checkManifest(label, manifest, { required: ['revenge.api', 'discord'] })
	} else {
		check(label, 'declares a known mandatory API dependency', false, 'neither valenced.api nor revenge.api')
	}

	checkSource(label, source, manifest, source.length)

	console.log('\nRevenge stable (Revenge Manager / RevengeXposed):')
	clearGlobals()
	runStable(label, source)
	clearGlobals()

	console.log('\nRevenge Next (repository install):')
	await runModern(label, source, 'revenge')
	clearGlobals()

	console.log('\nValenced (repository / sideload install):')
	await runModern(label, source, 'valenced')
	clearGlobals()
}

clearGlobals()

/* ------------------------------------------------------------------ verdict */

if (failures.length) {
	console.error(`\n✗ ${failures.length} check(s) failed:\n  - ${failures.join('\n  - ')}`)
	process.exit(1)
}
console.log(`\n✓ All packaged artifacts load on Revenge stable, Revenge Next and Valenced.`)
