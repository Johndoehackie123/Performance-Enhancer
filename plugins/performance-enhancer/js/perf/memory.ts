/**
 * Memory management.
 *
 * Three levers, all reversible:
 *   1. Trim Discord's image/query caches once they grow past the configured limit.
 *   2. Clear the file/asset cache together with the image cache.
 *   3. Run the Hermes garbage collector after a trim when the runtime exposes it.
 *
 * Trims happen when the app is backgrounded (the OS may kill the process at any
 * time after that, so the cache is pure cost), on the system's memory-pressure
 * broadcast, and on request from the settings screen.
 */
import { AppState } from 'react-native'
import { clearFileCaches, imageCacheMaps } from './finders'
import type { PerfContext } from './actions'

interface TrimResult {
	bytes: number
	entries: number
}

/** Hermes exposes `gc` when the runtime is built with the GC API enabled. */
function collectGarbage(enabled: boolean) {
	if (!enabled) return
	try {
		;(globalThis as unknown as { gc?: () => void }).gc?.()
	} catch {}
}

/**
 * Trims Discord's image caches once their measured size passes `limitMb`.
 *
 * Sizes are estimates: entries without a byte count count as zero, so the
 * threshold applies to what can be measured while the entry count always
 * reflects the work done (and is what the diagnostics panel reports).
 */
function trimImageCaches(limitMb: number): TrimResult {
	let bytes = 0
	let entries = 0
	const limit = limitMb * 1024 * 1024

	for (const map of imageCacheMaps()) {
		let size = 0
		try {
			map.forEach(value => {
				const entry = value as { size?: number; bytes?: number } | undefined
				const entrySize = Number(entry?.size ?? entry?.bytes ?? 0)
				size += Number.isFinite(entrySize) ? entrySize : 0
			})
		} catch {}

		// Below the limit the cache is cheaper to keep than to refill.
		if (size > 0 && size <= limit) continue

		try {
			entries += map.size
			map.clear()
			bytes += size
		} catch {}
	}

	return { bytes, entries }
}

/** Installs the memory manager. Returns a cleanup function. */
export function installMemory(ctx: PerfContext): () => void {
	let lastTrim = 0
	const state = () => ctx.state()

	const trim = (reason: string) => {
		const now = Date.now()
		// Several triggers can fire in the same second (background + interval +
		// memory pressure); one trim is enough.
		if (now - lastTrim < 5_000) return
		lastTrim = now

		const settings = state().settings.memory
		const result = trimImageCaches(settings.imageCacheLimitMb)
		const fileCaches = clearFileCaches()
		collectGarbage(settings.aggressiveGc)

		const diagnostics = state().diagnostics
		ctx.updateDiagnostics({
			trims: diagnostics.trims + 1,
			bytesReleased: diagnostics.bytesReleased + result.bytes,
			lastTrimAt: now,
		})
		ctx.logger.log(
			`[memory] trim (${reason}): ${result.entries} image entries, ${fileCaches} file cache(s), ${(result.bytes / 1024 / 1024).toFixed(1)} MB`,
		)
	}

	const unsubFlux = ctx.onFluxEvent('TRIM_MEMORY', payload => {
		trim('system')
		return payload
	})

	let currentState: string = AppState.currentState ?? 'active'
	const subscription = AppState.addEventListener('change', next => {
		const previous = currentState
		currentState = next
		if (
			previous === 'active' &&
			next !== 'active' &&
			state().settings.memory.trimOnBackground
		) {
			trim('background')
		}
	})

	// Manual trim requested by the settings screen.
	const onTrimRequest = () => trim('manual')
	trimRequestHandler = onTrimRequest

	return () => {
		subscription.remove()
		unsubFlux()
		if (trimRequestHandler === onTrimRequest) trimRequestHandler = undefined
		collectGarbage(true)
	}
}

/** Set while the memory manager is installed; called by the settings button. */
let trimRequestHandler: (() => void) | undefined

/**
 * Runs a trim immediately when the manager is installed.
 *
 * @returns whether a trim ran.
 */
export function requestTrim(): boolean {
	if (!trimRequestHandler) return false
	trimRequestHandler()
	return true
}
