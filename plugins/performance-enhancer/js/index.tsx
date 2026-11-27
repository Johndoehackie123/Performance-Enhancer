/**
 * Performance Enhancer
 *
 * A RAM- and SoC-aware tuning layer for Revenge, with a customizable visual
 * studio (Material, Glassmorphism, Liquid Frost, soft cards, fully custom).
 *
 * Design rules this plugin follows:
 *   - Nothing is patched before the user's settings are known.
 *   - Every hook, timer and listener is registered through `cleanup`, so the
 *     plugin can be toggled at runtime without restarting Discord.
 *   - Missing Discord internals never throw: the affected feature simply stays
 *     inactive and says so in the settings screen.
 */
import { getAssetIdByName } from '@revenge-mod/assets'
import { ToastActionCreators } from '@revenge-mod/discord/actions'
import { onAnyFluxEventDispatched, onFluxEventDispatched } from '@revenge-mod/discord/flux'
import { detectDevice } from './device'
import { installMemory, requestTrim } from './perf/memory'
import { installNetwork } from './perf/network'
import { installStability } from './perf/stability'
import { resolveProfile } from './profiles'
import { DEFAULT_SETTINGS } from './shared'
import {
	getState,
	patchDiagnostics,
	readHeap,
	resetDiagnosticsClock,
	setSettings,
	subscribeSettings,
} from './store'
import { installVisualHooks } from './styles/apply'
import { buildTokens } from './styles/engine'
import { registerThemes } from './styles/themes'
import { SettingsComponent } from './ui/settings'
import type { PerfContext, PerfLogger } from './perf/actions'
import type { Settings, SurfaceId } from './shared'
import type { StyleTokens } from './styles/engine'
import type { RuntimeState } from './store'
import type { PluginApi } from '@revenge-mod/plugins/types'
import type { ThemesApi } from '@revenge-mod/themes-api/types'

interface RuntimeInfo {
	visualCleanup?: () => void
	themesCleanup?: () => void
	stopMemory?: () => void
	tokens?: StyleTokens
	hooked: { surface: SurfaceId | 'avatar'; name: string }[]
	missing: SurfaceId[]
	heapTimer?: ReturnType<typeof setInterval>
	storeUnsub?: () => void
	appliedOnce?: boolean
}

const runtime: RuntimeInfo = { hooked: [], missing: [] }

const fallbackLogger: PerfLogger = {
	log: (...args) => console.log('[performance-enhancer]', ...args),
	warn: (...args) => console.warn('[performance-enhancer]', ...args),
	error: (...args) => console.error('[performance-enhancer]', ...args),
}

let logger: PerfLogger = fallbackLogger

function makeContext(): PerfContext {
	return {
		state: () => getState(),
		updateDiagnostics: patch => patchDiagnostics(patch),
		onFluxEvent: (type, handler) =>
			onFluxEventDispatched(type as never, handler as never) as unknown as () => void,
		onAnyFluxEvent: handler =>
			onAnyFluxEventDispatched(handler as never) as unknown as () => void,
		logger,
	}
}

/* ---------------------------------------------------------------- lifecycle */

export default plugin<{ jsonStorage: Settings }>({
	jsonStorage: {
		load: true,
		default: DEFAULT_SETTINGS,
	},

	/**
	 * `init` is the earliest stage where Discord modules and React are safe.
	 * Settings are already loaded because of `load: true`.
	 */
	init({ jsonStorage, logger: pluginLogger }) {
		logger = pluginLogger
		const device = detectDevice()
		const state = setSettings(jsonStorage.cache ?? DEFAULT_SETTINGS)
		resetDiagnosticsClock()
		patchDiagnostics(readHeap())
		logger.log(
			`[perf] tier=${device.tier} profile=${state.profile.label} · ${device.summary}`,
		)

		runtime.storeUnsub?.()
		runtime.storeUnsub = subscribeSettings(() => applyFromSettings())
	},

	start({ cleanup, plugin: instance }) {
		const ctx = makeContext()

		// Settings changes made in the UI flow through the settings subscription
		// installed in `init`; the first application happens here.
		applyFromSettings()

		runtime.stopMemory?.()
		runtime.stopMemory = installMemory(ctx)
		cleanup(runtime.stopMemory)
		cleanup(installStability(ctx))
		cleanup(installNetwork(ctx))

		runtime.heapTimer = setInterval(() => patchDiagnostics(readHeap()), 15_000)
		cleanup(() => {
			if (runtime.heapTimer) clearInterval(runtime.heapTimer)
			runtime.heapTimer = undefined
		})

		cleanup(() => {
			runtime.storeUnsub?.()
			runtime.storeUnsub = undefined
			runtime.visualCleanup?.()
			runtime.visualCleanup = undefined
			runtime.themesCleanup?.()
			runtime.themesCleanup = undefined
			runtime.hooked = []
			runtime.missing = []
		})

		if (getState().settings.performance.toastOnStart) {
			try {
				ToastActionCreators.open('performance-enhancer', {
					text: `Performance Enhancer · ${getState().profile.label}`,
					icon: getAssetIdByName('SparklesIcon'),
					variant: 'success',
				})
			} catch (error) {
				logger.warn(`[perf] toast failed: ${String(error)}`)
			}
		}

		logger.log(
			`[perf] style=${getState().settings.visual.style} hooks=${runtime.hooked.length} missing=${runtime.missing.length}`,
		)
		// Plugins enabled mid-session keep working; only theme registration needs
		// a reload because Discord caches its theme at boot.
		if (instance.startedLate && runtime.themesCleanup) instance.requireReload()
	},

	stop() {
		runtime.storeUnsub?.()
		runtime.storeUnsub = undefined
		runtime.visualCleanup?.()
		runtime.visualCleanup = undefined
		runtime.themesCleanup?.()
		runtime.themesCleanup = undefined
		runtime.hooked = []
		runtime.missing = []
	},

	SettingsComponent({ api }: { api: PluginApi<{ jsonStorage: Settings }> }) {
		return (
			<SettingsComponent
				api={api as never}
				hooks={{ hooked: runtime.hooked.length, missing: runtime.missing.length }}
				onVisualChange={() => applyFromSettings()}
				onTrim={() => {
					if (!requestTrim()) logger.log('[perf] trim requested before the manager started')
				}}
			/>
		)
	},
})

/* ------------------------------------------------------------------ helpers */

/**
 * Reads the current settings and rebuilds everything that depends on them.
 * Idempotent; safe to call at any time.
 */
function applyFromSettings() {
	const state = getState()
	const settings = state.settings
	const device = state.device
	const visual = settings.visual

	runtime.tokens = buildTokens(visual, device.tier)

	runtime.visualCleanup?.()
	runtime.hooked = []
	runtime.missing = []
	try {
		const installed = installVisualHooks({
			getTokens: () => runtime.tokens,
			enabledSurfaces: () =>
				(Object.keys(visual.surfaces) as SurfaceId[]).filter(id => visual.surfaces[id]),
			roundAvatars: () => visual.roundAvatars,
			onError: error => logger.warn(`[perf] visual hook error: ${String(error)}`),
		})
		runtime.visualCleanup = installed.cleanup
		runtime.hooked = installed.hooked
		runtime.missing = installed.missing
	} catch (error) {
		logger.warn(`[perf] could not install visual hooks: ${String(error)}`)
	}

	runtime.themesCleanup?.()
	runtime.themesCleanup = undefined
	if (visual.registerThemes) {
		try {
			const themes = (revenge as unknown as { themes?: ThemesApi }).themes
			const cleanup = themes ? registerThemes(themes, visual, device.tier) : undefined
			runtime.themesCleanup = cleanup || undefined
		} catch (error) {
			logger.warn(`[perf] theme registration failed: ${String(error)}`)
		}
	}

	runtime.appliedOnce = true
}

/** Snapshot for the diagnostics panel. */
export function getRuntimeInfo() {
	const state: RuntimeState = getState()
	return {
		hooked: runtime.hooked,
		missing: runtime.missing,
		tier: state.device.tier,
		profile: resolveProfile(state.settings.performance.profile, state.device),
	}
}
