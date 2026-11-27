/**
 * Performance Enhancer — stable Revenge entrypoint.
 *
 * This is the build that ships as `index.js` inside the plugin ZIP. It targets
 * **Revenge / Bunny stable**, the runtime Revenge Manager and RevengeXposed
 * install, which evaluates plugin code as:
 *
 *     (bunny, definePlugin) => { <bundle>; return plugin?.default ?? plugin; }
 *
 * then calls `onLoad()` and `start()` on the result and renders the plugin's
 * `SettingsComponent` with no props. See `docs/runtime-support.md` for why the
 * Next-only build could be added as a repository but never installed.
 *
 * Nothing here is simulated: RAM and SoC come from Discord's own native modules,
 * the caches trimmed are Discord's in-memory image caches, and telemetry is
 * dropped through the Flux dispatcher's own subscription hook.
 */
import { resolveProfile } from '../profiles'
import { DEFAULT_SETTINGS, type Settings } from '../shared'
import { buildTokens } from '../styles/engine'
import { apiOrNull, bindApi, toast } from './bridge'
import { definePlugin } from './define'
import { detectDevice } from './device'
import { installRuntime } from './runtime'
import {
	attachStorage,
	attachStorageFromLoader,
	getDiagnostics,
	getSettings,
	patchDiagnostics,
	readHeap,
	setSettings,
	subscribe,
} from './state'
import { installStyles } from './styles'
import { SettingsScreen } from './ui'
import type { PluginStorage } from './bridge'
import type { RuntimeOptions } from './runtime'

interface Hooks {
	disposeRuntime?: () => void
	disposeStyles?: () => void
	unsubscribeStore?: () => void
	trim: () => { bytes: number; entries: number }
}

const hooks: Hooks = {
	trim: () => ({ bytes: 0, entries: 0 }),
}

/**
 * Captures the loader API as soon as the bundle is evaluated.
 *
 * The loader passes it as the `bunny` parameter, which is in scope for the whole
 * source. Binding here (rather than only in `onLoad`) means the settings screen
 * still resolves the API when Revenge renders it much later.
 */
try {
	const fromLoader = typeof bunny !== 'undefined' ? bunny : (globalThis as any).vendetta
	bindApi(fromLoader)
} catch {}

let loggedIn = false

/** The options object the loader receives. */
const options = definePlugin({
	/**
	 * Applied when the loader creates the plugin's storage. Stable Revenge
	 * deep-merges this into whatever is already on disk.
	 */
	settings: DEFAULT_SETTINGS,

	/**
	 * First lifecycle call. Discord's modules are resolvable here, but nothing is
	 * hooked yet: a plugin that fails during `onLoad` can still be uninstalled
	 * cleanly.
	 */
	onLoad(this: { id?: string; storage?: PluginStorage }) {
		// The API is the object the loader passed in; capturing it here means the
		// settings screen works even though it renders much later.
		const loaderApi = apiOrNull() ?? (globalThis as any).vendetta
		bindApi(loaderApi)

		attachStorage(this?.storage as PluginStorage | undefined)
		attachStorageFromLoader()
		patchDiagnostics({ heapUsedMb: readHeap() })
		logOnce()
	},

	/**
	 * Called when the plugin is enabled, installed, or booted while enabled.
	 * Everything registered here is released in `onUnload`.
	 */
	start(this: { storage?: PluginStorage }) {
		const loaderApi = apiOrNull() ?? (globalThis as any).vendetta
		bindApi(loaderApi)
		attachStorage(this?.storage as PluginStorage | undefined)
		attachStorageFromLoader()

		const runtimeOptions: RuntimeOptions = {
			getTrimLimitMb: () => getSettings().memory.imageCacheLimitMb,
			shouldCollectGarbage: () => getSettings().memory.aggressiveGc,
			shouldBlockTelemetry: () => getSettings().network.blockTelemetry,
			onTrim(bytes) {
				const before = getDiagnostics()
				patchDiagnostics({
					trims: before.trims + 1,
					bytesReleased: before.bytesReleased + bytes,
					heapUsedMb: readHeap(),
				})
			},
			onDrop() {
				patchDiagnostics({ dropped: getDiagnostics().dropped + 1 })
			},
			onSeen() {},
			logger: {
				log: message => log(message),
				warn: message => warn(message),
				error: message => error(message),
			},
		}

		const runtime = installRuntime(runtimeOptions)
		hooks.disposeRuntime = () => runtime.dispose()
		hooks.trim = runtime.trim

		const mountStyles = () => {
			hooks.disposeStyles?.()
			const visuals = getSettings().visual
			const handle = installStyles({
				getTokens: () => {
					const current = getSettings().visual
					if (current.style === 'off') return undefined
					return buildTokens(current, detectDevice().tier)
				},
				enabledSurfaces: () =>
					(Object.keys(getSettings().visual.surfaces) as (keyof typeof visuals.surfaces)[]).filter(
						id => getSettings().visual.surfaces[id],
					),
				roundAvatars: () => getSettings().visual.roundAvatars,
				onHooked: (hooked, missing) =>
					patchDiagnostics({ hooked, missing }),
				logger: runtimeOptions.logger,
			})
			hooks.disposeStyles = () => handle.dispose()
		}
		mountStyles()

		// Rebuild the style hooks whenever a setting that affects them changes.
		hooks.unsubscribeStore?.()
		hooks.unsubscribeStore = subscribe(mountStyles)

		patchDiagnostics({ heapUsedMb: readHeap(), startedAt: Date.now() })

		const settings = getSettings()
		const device = detectDevice()
		const profile = resolveProfile(settings.performance.profile, device)
		log(`[perf] tier=${device.tier} profile=${profile.label} · ${device.summary}`)

		if (settings.performance.toastOnStart) {
			toast(`Performance Enhancer · ${profile.label}`, 'SparklesIcon')
		}
	},

	/** Called when the plugin is disabled, reloaded or uninstalled. */
	onUnload() {
		release()
	},

	/** Rendered in Settings → Revenge → Plugins as the "Configure" page. */
	SettingsComponent: SettingsScreen,
})

function release() {
	try {
		hooks.unsubscribeStore?.()
		hooks.unsubscribeStore = undefined
		hooks.disposeStyles?.()
		hooks.disposeStyles = undefined
		hooks.disposeRuntime?.()
		hooks.disposeRuntime = undefined
		hooks.trim = () => ({ bytes: 0, entries: 0 })
	} catch {}
}

/* --------------------------------------------------------------- diagnostics */

function log(message: string) {
	try {
		console.log(`[performance-enhancer] ${message}`)
	} catch {}
}

function warn(message: string) {
	try {
		console.warn(`[performance-enhancer] ${message}`)
	} catch {}
}

function error(message: string) {
	try {
		console.error(`[performance-enhancer] ${message}`)
	} catch {}
}

function logOnce() {
	if (loggedIn) return
	loggedIn = true
	const device = detectDevice()
	log(`loaded on ${device.summary} (${device.tier} tier)`)
}

/**
 * Snapshot for DevTools and the diagnostics panel.
 *
 * Exported so a user (or a bug report) can inspect what the plugin actually
 * detected without reading the settings screen.
 */
export function getRuntimeInfo() {
	const settings = getSettings()
	const device = detectDevice()
	return {
		tier: device.tier,
		device: {
			ramGb: device.ramGb,
			cpuGhz: device.cpuGhz,
			cores: device.cores,
			soc: device.soc,
			sources: device.sources,
		},
		profile: resolveProfile(settings.performance.profile, device),
		diagnostics: getDiagnostics(),
		style: settings.visual.style,
	}
}

/** Trims the caches now; used by the settings screen and for smoke tests. */
export function trimNow() {
	const result = hooks.trim()
	const before = getDiagnostics()
	patchDiagnostics({
		trims: before.trims + 1,
		bytesReleased: before.bytesReleased + result.bytes,
	})
	return result
}

/** Re-reads the device and re-applies settings without a reload. */
export function refresh() {
	const current = getSettings()
	setSettings(current)
}

/** Keeps the default export reachable when the loader unwraps `plugin`. */
export default options
