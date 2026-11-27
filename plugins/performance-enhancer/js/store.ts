/**
 * Runtime store.
 *
 * The settings UI, the diagnostics panel and every performance module read from
 * this small singleton. It keeps the resolved settings, the active profile and a
 * rolling diagnostics snapshot together so a re-render can be triggered from one
 * place with `useSyncExternalStore`.
 */
import { detectDevice } from './device'
import { resolveProfile } from './profiles'
import { resolveSettings } from './shared'
import type { DeviceInfo } from './device'
import type { Profile } from './profiles'
import type { Settings } from './shared'

export interface DiagnosticsSnapshot {
	heapUsedMb: number
	heapTotalMb: number
	trims: number
	bytesReleased: number
	recoveries: number
	dispatchesSeen: number
	dispatchesDropped: number
	lastTrimAt: number
	uptimeMs: number
}

export interface RuntimeState {
	settings: Settings
	device: DeviceInfo
	profile: Profile
	detectedTier: DeviceInfo['tier']
	diagnostics: DiagnosticsSnapshot
}

type Listener = () => void

/** UI listeners (diagnostics, preview). */
const listeners = new Set<Listener>()
/** Settings listeners. Only fired when the settings object is replaced. */
const settingsListeners = new Set<Listener>()
let state: RuntimeState | undefined
let startedAt = Date.now()

function build(input: Partial<Settings> | undefined): RuntimeState {
	const device = detectDevice()
	const settings = resolveSettings(input, device.tier)
	return {
		settings,
		device,
		detectedTier: device.tier,
		profile: resolveProfile(settings.performance.profile, device),
		diagnostics: {
			heapUsedMb: 0,
			heapTotalMb: 0,
			trims: 0,
			bytesReleased: 0,
			recoveries: 0,
			dispatchesSeen: 0,
			dispatchesDropped: 0,
			lastTrimAt: 0,
			uptimeMs: 0,
		},
	}
}

/** Returns the current state, creating it from `input` on first use. */
export function getState(input?: Partial<Settings>): RuntimeState {
	if (!state) state = build(input)
	return state
}

/** Replaces the state after settings are loaded or written. */
export function setSettings(input: Partial<Settings>): RuntimeState {
	state = build(input)
	emit()
	for (const listener of settingsListeners) {
		try {
			listener()
		} catch {}
	}
	return state
}

/**
 * Subscribes to settings changes only.
 *
 * Performance and visual modules use this so a diagnostics update (which fires
 * every few seconds) never rebuilds their hooks.
 */
export function subscribeSettings(listener: Listener): () => void {
	settingsListeners.add(listener)
	return () => {
		settingsListeners.delete(listener)
	}
}

export function patchDiagnostics(patch: Partial<DiagnosticsSnapshot>) {
	const current = getState()
	Object.assign(current.diagnostics, patch)
	current.diagnostics.uptimeMs = Date.now() - startedAt
	emit()
}

export function resetDiagnosticsClock() {
	startedAt = Date.now()
}

/** Reads Hermes heap statistics, when the runtime exposes them. */
export function readHeap(): { heapUsedMb: number; heapTotalMb: number } {
	try {
		const internal = (
			globalThis as unknown as {
				HermesInternal?: { getRuntimeProperties?: () => Record<string, string> }
			}
		).HermesInternal
		const props = internal?.getRuntimeProperties?.()
		if (!props) return { heapUsedMb: 0, heapTotalMb: 0 }
		const used = Number.parseFloat(
			props['HermesInternal.getHeapInfo().usedBytes'] ?? props['GCBeforeHeapSize'] ?? '',
		)
		const total = Number.parseFloat(props['GCAfterHeapSize'] ?? '')
		const toMb = (bytes: number) => (Number.isFinite(bytes) ? bytes / 1024 / 1024 : 0)
		return { heapUsedMb: toMb(used), heapTotalMb: toMb(total) }
	} catch {
		return { heapUsedMb: 0, heapTotalMb: 0 }
	}
}

function emit() {
	for (const listener of listeners) {
		try {
			listener()
		} catch {}
	}
}

export function subscribe(listener: Listener): () => void {
	listeners.add(listener)
	return () => listeners.delete(listener)
}

/** `useSyncExternalStore`-friendly snapshot getter. */
export function getSnapshot(): RuntimeState {
	return getState()
}

/** Formats bytes for the diagnostics panel. */
export function formatBytes(bytes: number): string {
	if (!bytes) return '0 B'
	const units = ['B', 'KB', 'MB', 'GB']
	const index = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)))
	return `${(bytes / 1024 ** index).toFixed(index > 1 ? 1 : 0)} ${units[index]}`
}
