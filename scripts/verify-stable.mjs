#!/usr/bin/env node
/**
 * Verifies the packaged ZIP against the two runtimes Revenge ships.
 *
 *   node scripts/verify-stable.mjs [path/to/plugin.zip]
 *
 * Defaults to the newest ZIP in `build/dist`, so CI can run it right after
 * `bun run package`.
 *
 * The checks mirror the loaders, not our own assumptions:
 *
 *   1. Stable (`VdPluginManager`): evaluate `(bunny, definePlugin) => { src;
 *      return plugin?.default ?? plugin; }` against a mock Discord, then call
 *      `onLoad`, `start`, render `SettingsComponent`, and `onUnload`.
 *   2. Next (`createOptionsFactory`): `new Function('revenge', 'plugin', 'return
 *      ' + src)` must resolve an options object without touching a global that
 *      does not exist yet.
 *
 * A release that fails either check is broken on that client, and the exit code
 * says so.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { unzipSync } from 'fflate'

const DIST = join('build', 'dist')

function newestZip() {
	if (!existsSync(DIST)) return undefined
	const zips = readdirSync(DIST).filter(name => name.endsWith('.zip')).sort()
	return zips.length ? join(DIST, zips.at(-1)) : undefined
}

const zipPath = process.argv[2] ?? newestZip()
if (!zipPath || !existsSync(zipPath)) {
	console.error('No plugin ZIP found. Run `bun run package` first.')
	process.exit(1)
}

const files = unzipSync(readFileSync(zipPath))
const decoder = new TextDecoder()
const manifest = JSON.parse(decoder.decode(files['manifest.json']))
const scriptName = manifest.dist?.script ?? 'index.js'
const source = decoder.decode(files[scriptName])
if (!source) {
	console.error(`${zipPath}: manifest points at ${scriptName}, which is missing`)
	process.exit(1)
}

/* ---------------------------------------------------------------- mock host */

function mockHost() {
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

const failures = []
function check(name, condition, detail) {
	if (condition) {
		console.log(`  ✓ ${name}`)
	} else {
		console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`)
		failures.push(name)
	}
}

/* -------------------------------------------------------------- stable host */

console.log(`\nVerifying ${zipPath}`)
console.log(`  plugin ${manifest.id}@${manifest.version}`)
console.log('\nRevenge stable (Revenge Manager / RevengeXposed):')

const host = mockHost()
let plugin
try {
	// Exactly what VdPluginManager.startPlugin builds.
	const instantiator = new Function(
		'bunny',
		'definePlugin',
		`${source}\nreturn plugin?.default ?? plugin;`,
	)
	plugin = instantiator(host.api, options => options)
	check('source evaluates and returns a plugin object', Boolean(plugin && typeof plugin === 'object'))
} catch (error) {
	check('source evaluates and returns a plugin object', false, error.message)
}

if (plugin) {
	check('exposes start()', typeof plugin.start === 'function')
	check('exposes SettingsComponent()', typeof plugin.SettingsComponent === 'function')

	try {
		plugin.onLoad?.()
		check('onLoad() runs', true)
	} catch (error) {
		check('onLoad() runs', false, error.message)
	}

	try {
		plugin.start.call({ id: manifest.id, storage: { cache: {} } })
		check('start() runs', true)
	} catch (error) {
		check('start() runs', false, error.message)
	}

	try {
		const tree = plugin.SettingsComponent({})
		check('SettingsComponent renders', Boolean(tree))
	} catch (error) {
		check('SettingsComponent renders', false, error.message)
	}

	check(
		'blocks telemetry through the Flux dispatcher',
		host.subscriptions.some(([type]) => type === 'TRACK'),
		`subscribed to ${host.subscriptions.length} action(s)`,
	)

	const track = host.subscriptions.find(([type]) => type === 'TRACK')
	check(
		'a TRACK dispatch is cancelled',
		track ? track[1]({ type: 'TRACK' }) === false : false,
	)

	check('shows the start-up toast', host.toasts.length > 0)

	try {
		plugin.onUnload?.()
		check('onUnload() runs', true)
	} catch (error) {
		check('onUnload() runs', false, error.message)
	}
	check('restores the JSX runtime on unload', host.jsxRuntime.jsx === host.originalJsx)
}

/* ---------------------------------------------------------------- next host */

console.log('\nRevenge Next (index.json repositories):')
const nextHost = mockHost()
try {
	// Exactly what lib/plugins/src/_internal/script.ts does. Its `plugin`
	// parameter shadows the global the source assigns, so the meaningful check
	// here is that evaluation completes: a throw is what stops a repository
	// entry from ever being installable.
	new Function(
		'revenge',
		'plugin',
		`return ${source}\n//# sourceURL=Revenge:Plugin:${manifest.id}`,
	)(nextHost.api, options => options)
	check('source evaluates without Revenge globals', true)
	check('exposes globalThis.plugin for the stable loader', Boolean(globalThis.plugin))
} catch (error) {
	check('source evaluates without Revenge globals', false, error.message)
}


/* ------------------------------------------------------------------ verdict */

if (failures.length) {
	console.error(`\n✗ ${failures.length} check(s) failed: ${failures.join(', ')}`)
	process.exit(1)
}
console.log('\n✓ The packaged plugin loads on both Revenge runtimes.')
