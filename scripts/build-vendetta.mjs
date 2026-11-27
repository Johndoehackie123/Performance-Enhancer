#!/usr/bin/env node
/**
 * Builds the plugin bundle that ships in the plugin ZIP.
 *
 *   node scripts/build-vendetta.mjs [--dev]
 *
 * Output: plugins/performance-enhancer/build/js/index.js
 *
 * One artifact serves every client that can load the plugin:
 *
 *   - **Revenge stable** (Revenge Manager / RevengeXposed) evaluates the source
 *     as `(bunny, definePlugin) => { <code>; return plugin?.default ?? plugin; }`
 *     and reads the `plugin` global afterwards.
 *   - **Revenge Next** evaluates it as
 *     `new Function('revenge', 'plugin', 'return ' + src)(revengeApi, opts => opts)?.default`.
 *   - **Valenced** evaluates it the same way with `valenced` as the first
 *     parameter and `globalThis.valenced` as the injected API.
 *
 * For the `return <src>` contract the whole source must be ONE expression whose
 * value is the plugin options (or a namespace carrying `.default`). For the
 * stable contract the source must additionally leave `globalThis.plugin` set.
 * The emitted bundle is therefore a single assignment expression whose right
 * side is an IIFE: the assignment sets the stable global, and the IIFE's value
 * is what the modern loaders return.
 *
 * React, React Native and the JSX runtime are handed to the bundle as LAZY
 * FORWARDING NAMESPACES (`__peLazy`, see GLOBALS): every property read hits
 * the host at that moment — `host.react.*` on the modern runtimes,
 * `host.metro.common.*` on the stable one — so evaluation succeeding while
 * React is still uninitialized is harmless, and the stable orderings are
 * irrelevant. A single bundle works against every API tree.
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
 * Host accessor.
 *
 * `bunny` is the stable loader's own first parameter — the bundle resolves the
 * host lazily so a missing API never throws at import time, and so the modern
 * globals (`valenced` / `revenge`) installed by their pre-init plugin are seen.
 */
const ACCESSOR = '__peHost'

/**
 * How each bare import resolves inside the bundle.
 *
 * The modern runtimes expose React under `host.react.*`; the stable runtime
 * keeps it on `host.metro.common.*`. The stable runtime also re-exports the
 * JSX runtime as `host._jsx`. The first hit wins on every client.
 */
/**
 * The modern runtimes create their plugin scope BEFORE the React module is
 * found (the plugins' preInit phase runs before Discord's metro bundle has
 * evaluated the React module), so asking `react.React` for its value at plugin
 * evaluation time yields `undefined` — permanently, because a plain argument
 * captures the value at that instant. Every crash of this class looked like
 * `TypeError: undefined is not a function` at the first hook call.
 *
 * The fix hands the bundle a Proxy per external whose getters resolve the
 * real host module at ACCESS time (render time), when it exists. The bundler's
 * CJS interop enumerates each external's keys ONCE at evaluation time and
 * copies them into a fresh namespace — whose copied getters delegate right
 * back into the proxy, so reads still land on the live module. Enumeration at
 * that early moment cannot see the not-yet-loaded module, so the proxy reports
 * a fixed, complete key list instead of the module's current (empty) one.
 * Valenced's own production code ships `new Proxy` on this same Hermes, so
 * Proxy is a safe mechanism here.
 */
// Complete export keys of the React namespace (react@17/18). Reads of any key
// the device's copy lacks come back undefined; enumeration needs the full set.
const REACT_KEYS = [
	'Children', 'Component', 'Fragment', 'Profiler', 'StrictMode', 'Suspense',
	'cloneElement', 'createContext', 'createElement', 'createFactory', 'createRef',
	'forwardRef', 'isValidElement', 'lazy', 'memo', 'startTransition',
	'useCallback', 'useContext', 'useDebugValue', 'useDeferredValue', 'useEffect',
	'useId', 'useImperativeHandle', 'useInsertionEffect', 'useLayoutEffect', 'useMemo',
	'useReducer', 'useRef', 'useState', 'useSyncExternalStore', 'useTransition',
	'render', 'hydrate', 'unmountComponentAtNode', 'findDOMNode', 'act', 'version',
]
const REACT_NATIVE_KEYS = [
	'AccessibilityInfo', 'ActivityIndicator', 'Alert', 'Animated', 'AppRegistry', 'AppState',
	'Appearance', 'BackHandler', 'Button', 'CheckBox', 'Clipboard', 'Colors', 'DebugContainer',
	'DevSettings', 'DeviceEventEmitter', 'Dimensions', 'DrawerAndroid', 'Easing', 'FlatList',
	'I18nManager', 'Image', 'ImageBackground', 'InteractionManager', 'Keyboard',
	'LayoutAnimation', 'ListView', 'LogBox', 'Modal', 'NativeEventEmitter', 'NativeModules',
	'NetInfo', 'PanResponder', 'PermissionsAndroid', 'PixelRatio', 'Platform', 'PlatformColor',
	'Pressable', 'ProgressBarAndroid', 'ProgressViewIOS', 'RefreshControl', 'SafeAreaView',
	'ScrollView', 'SectionList', 'Share', 'Slider', 'StatusBar', 'StyleSheet', 'Switch',
	'Text', 'TextInput', 'ToastAndroid', 'Touchable', 'TouchableHighlight',
	'TouchableNativeFeedback', 'TouchableOpacity', 'TouchableWithoutFeedback',
	'UIManager', 'Vibration', 'View', 'VirtualizedList',
	'findNodeHandle', 'isNewArchitectureEnabled', 'TurboModuleRegistry',
]
const JSX_RUNTIME_KEYS = ['jsx', 'jsxs', 'jsxDEV', 'Fragment']
const keysLiteral = keys => `[${keys.map(key => `'${key}'`).join(',')}]`

const GLOBALS = {
	react: `__peLazy(function(){return ${ACCESSOR}().react?.React??${ACCESSOR}().metro?.common?.React},${keysLiteral(REACT_KEYS)})`,
	'react-native': `__peLazy(function(){return ${ACCESSOR}().react?.ReactNative??${ACCESSOR}().react?.native??${ACCESSOR}().metro?.common?.ReactNative},${keysLiteral(REACT_NATIVE_KEYS)})`,
	'react/jsx-runtime': `__peLazy(function(){return ${ACCESSOR}().react?.ReactJSXRuntime??${ACCESSOR}().react?.jsxRuntime??${ACCESSOR}()._jsx??${ACCESSOR}().metro?.common?.ReactJSXRuntime},${keysLiteral(JSX_RUNTIME_KEYS)})`,
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

/**
 * The accessor, declared inline inside the emission wrapper.
 *
 * Never *assigns* a stub to a global: the fallback is returned for this call
 * only, so a loader that installs its API a moment later is never shadowed.
 */
const ACCESSOR_DECL =
	`function ${ACCESSOR}(){` +
	'var host=typeof bunny<"u"?bunny:(typeof valenced<"u"?valenced:(typeof revenge<"u"?revenge:(globalThis.bunny??globalThis.vendetta??globalThis.valenced??globalThis.revenge)));' +
	'return host??{metro:{common:{}}};}' +
	'\nfunction __peLazy(resolve,keys){var keySet=null;function has(key){if(!keys)return true;if(!keySet){keySet={};for(var i=0;i<keys.length;i++)keySet[keys[i]]=1}return!!keySet[key]}return new Proxy({},{get(_,key){try{var m=resolve();return m==null?undefined:m[key]}catch{return undefined}},has(_,key){return has(key)},ownKeys(){var out=keys?keys.slice():[];try{var m=resolve();if(m&&!keys)out=Reflect.ownKeys(m)}catch{}return out},getOwnPropertyDescriptor(_,key){if(!has(key))return undefined;return{enumerable:true,configurable:true,get:function(){try{var m=resolve();return m==null?undefined:m[key]}catch{return undefined}}}}})}'

async function main() {
	if (!existsSync(ENTRY)) {
		console.error(`Missing entry: ${ENTRY}`)
		process.exit(1)
	}

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
		// `es` output is wrapped by hand so the loader's own parameters can be
		// threaded in without relying on a global that may not exist yet.
		format: 'iife',
		name: 'performanceEnhancer',
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

	const rhs = chunk.code.replace(/^var [A-Za-z_$][\w$]*\s*=\s*/, '').replace(/;\s*$/, '')
	if (rhs === chunk.code) {
		throw new Error('Unexpected bundle shape: could not strip the leading binding')
	}

	/**
	 * One expression satisfies every loader:
	 *
	 *   stable: `(bunny,definePlugin)=>{ <src>; return plugin?.default ?? plugin; }`
	 *     — the assignment sets `globalThis.plugin` (the global is what `plugin`
	 *       resolves to in the loader's body) before control returns.
	 *   modern: `new Function('revenge'|'valenced', 'plugin', 'return ' + src)`
	 *     — the whole source is a single assignment expression, whose value is
	 *       the IIFE's value: the module namespace. `.default` is the options.
	 *
	 * The accessor is a function declaration inside the wrapper, so nothing
	 * leaks into the loader's scope and no statement precedes the assignment.
	 */
	const code = `globalThis.plugin=(function(){${ACCESSOR_DECL}\nreturn ${rhs}})();`

	await mkdir(OUT_DIR, { recursive: true })
	await writeFile(OUT_FILE, code, 'utf8')

	const size = Buffer.byteLength(code)
	console.log(`✓ Built universal bundle: ${OUT_FILE} (${(size / 1024).toFixed(1)} kB)`)
}

main().catch(error => {
	console.error('✗ Bundle build failed:', error)
	process.exit(1)
})
