/**
 * Runtime tuning for the stable (Revenge/Bunny) client.
 *
 * The stable runtime has no `revenge.discord.flux` module, so everything here
 * works through what Discord itself exposes: the Flux dispatcher, the
 * image/query caches and the JS runtime's garbage collector.
 *
 * Design rules, same as the Next build:
 *   - nothing is hooked until the user's settings are known;
 *   - every hook returns its own undo function;
 *   - a missing Discord module disables one lever, never the plugin.
 */
import { findByProps, onFlux, reactNative } from './bridge'

export interface RuntimeLogger {
	log(message: string): void
	warn(message: string): void
	error(message: string): void
}

export interface RuntimeOptions {
	getTrimLimitMb(): number
	shouldCollectGarbage(): boolean
	shouldBlockTelemetry(): boolean
	onTrim(bytes: number, entries: number): void
	onDrop(): void
	onSeen(): void
	logger: RuntimeLogger
}

export interface RuntimeHandle {
	/** Undoes every hook, timer and listener. */
	dispose(): void
	/** Trims the caches right now. */
	trim(): { bytes: number; entries: number }
}

/** Flux actions that carry analytics payloads. Dropping them stops the upload. */
const TELEMETRY_ACTIONS = [
	'TRACK',
	'TRACK_WITH_METADATA',
	'SCIENCE',
	'POST_EVENT',
	'IMPRESSION',
	'SCROLL_IMPRESSION',
	'CLIENT_PERFORMANCE_REPORT',
]

/** Hermes exposes `gc` only on builds compiled with the GC API enabled. */
function collectGarbage() {
	try {
		;(globalThis as unknown as { gc?: () => void }).gc?.()
	} catch {}
}

interface CacheEntry {
	size?: number
	bytes?: number
}

/**
 * Finds Discord's image/query caches.
 *
 * Their shape moved between releases (a module export, a Map of Maps, or a plain
 * object), so every candidate is probed and only real `Map` instances are used.
 */
function cacheMaps(): Map<unknown, unknown>[] {
	const maps: Map<unknown, unknown>[] = []
	const candidates: any[] = []

	try {
		const module = findByProps('queryCache') ?? findByProps('_caches') ?? findByProps('caches')
		if (module) candidates.push(module.queryCache, module._caches, module.caches)
	} catch {}

	for (const candidate of candidates) {
		if (candidate instanceof Map) {
			maps.push(candidate as Map<unknown, unknown>)
			continue
		}
		if (candidate && typeof candidate === 'object') {
			for (const value of Object.values(candidate)) {
				if (value instanceof Map) maps.push(value as Map<unknown, unknown>)
			}
		}
	}
	return maps
}

/** Estimates the byte size of a cached entry from whatever field it exposes. */
function entryBytes(value: unknown): number {
	const entry = value as CacheEntry | undefined
	const size = Number(entry?.size ?? entry?.bytes ?? 0)
	return Number.isFinite(size) && size > 0 ? size : 0
}

export function installRuntime(options: RuntimeOptions): RuntimeHandle & { trims: number } {
	const disposers: (() => void)[] = []
	let trims = 0

	const trim = () => {
		const limit = Math.max(4, options.getTrimLimitMb()) * 1024 * 1024
		let bytes = 0
		let entries = 0

		for (const map of cacheMaps()) {
			let mapBytes = 0
			try {
				map.forEach(value => {
					mapBytes += entryBytes(value)
				})
			} catch {}

			// A cache under the limit is left alone: clearing small caches costs
			// more in refetches than it saves.
			if (mapBytes < limit) continue

			try {
				entries += map.size
				map.clear()
			} catch {
				continue
			}
			bytes += mapBytes
		}

		if (entries > 0) {
			trims += 1
			if (options.shouldCollectGarbage()) collectGarbage()
			try {
				options.onTrim(bytes, entries)
			} catch {}
		}
		return { bytes, entries }
	}

	// --- telemetry ---------------------------------------------------------
	if (options.shouldBlockTelemetry()) {
		for (const type of TELEMETRY_ACTIONS) {
			try {
				const subscription = onFlux(type, () => {
					options.onDrop()
					// A falsy return stops the dispatch before Discord's handlers run.
					return undefined
				})
				disposers.push(() => subscription.unsubscribe())
			} catch {}
		}
	}

	// --- trim when the app leaves the foreground ---------------------------
	try {
		const { AppState } = reactNative()
		const subscription = AppState.addEventListener('change', next => {
			if (next === 'background' || next === 'inactive') trim()
		})
		disposers.push(() => {
			try {
				subscription?.remove?.()
			} catch {}
		})
	} catch {}

	// --- periodic trim -----------------------------------------------------
	const timer = setInterval(trim, 90_000)
	disposers.push(() => clearInterval(timer))

	options.logger.log(
		`[perf] runtime ready: ${TELEMETRY_ACTIONS.length} telemetry types, ${cacheMaps().length} cache(s)`,
	)

	return {
		trim,
		trims,
		dispose() {
			for (const dispose of disposers.splice(0)) {
				try {
					dispose()
				} catch {}
			}
		},
	}
}
