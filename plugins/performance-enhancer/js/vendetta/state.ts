/**
 * Settings state for the stable build.
 *
 * Stable Revenge gives a plugin `plugin.storage`: a plain object persisted by the
 * loader (MMKV under the hood), with the defaults declared on the plugin already
 * deep-merged in. This module keeps the live copy, persists every change, and
 * holds the diagnostics counters the settings screen reads.
 */
import { DEFAULT_SETTINGS, resolveSettings, type Settings } from '../shared'
import { apiOrNull } from './bridge'
import { detectDevice } from './device'
import { withDefaults } from './define'
import type { PluginStorage } from './bridge'

let storage: PluginStorage | undefined
let current: Settings | undefined
const listeners = new Set<() => void>()
const diagnosticsListeners = new Set<() => void>()

export interface Diagnostics {
	heapUsedMb: number
	trims: number
	bytesReleased: number
	dropped: number
	hooked: number
	missing: number
	startedAt: number
}

const diagnostics: Diagnostics = {
	heapUsedMb: 0,
	trims: 0,
	bytesReleased: 0,
	dropped: 0,
	hooked: 0,
	missing: 0,
	startedAt: Date.now(),
}

function build(stored: unknown): Settings {
	return resolveSettings(withDefaults(DEFAULT_SETTINGS, stored), detectDevice().tier)
}

/** Wires the loader-provided storage. Safe to call more than once. */
export function attachStorage(pluginStorage: PluginStorage | undefined) {
	if (!pluginStorage) return
	storage = pluginStorage
	current = build(pluginStorage.cache)
	try {
		// Persist the merged shape so a newly added default reaches the file.
		storage.set?.(current as unknown as Record<string, any>)
	} catch {}
	emit()
}

/**
 * Falls back to `window.vendetta.plugin.storage` for the rare host that creates
 * the storage without handing it to the factory.
 */
export function attachStorageFromLoader() {
	if (storage) return
	const fromLoader = (globalThis as any).vendetta?.plugin?.storage as PluginStorage | undefined
	if (fromLoader) attachStorage(fromLoader)
}

interface ModernJsonStorage {
	cache?: Record<string, any>
	get?(): Promise<any>
	set?(value: any, replace?: boolean): Promise<any>
}

/**
 * Wires the JSON storage the modern runtimes (Revenge Next / Valenced) create
 * for plugins that declare `jsonStorage` in their options.
 *
 * The store is read asynchronously, so this is async: `init` awaits it, which is
 * what makes the settings complete by the time `start` runs. The adapter
 * satisfies the same `PluginStorage` interface as stable Revenge's loader
 * storage, so the rest of the plugin never has to know which client it runs on.
 */
export async function attachModernStorage(api: { jsonStorage?: ModernJsonStorage } | undefined) {
	const store = api?.jsonStorage
	if (!store) return
	try {
		if (typeof store.get === 'function') await store.get()
	} catch {}
	const cache = store.cache && typeof store.cache === 'object' ? store.cache : undefined
	attachStorage({
		cache: cache ?? {},
		set(value: Record<string, any>) {
			try {
				void Promise.resolve(store.set?.(value, true)).catch(() => {})
			} catch {}
		},
		refresh() {},
	})
}

export function getSettings(): Settings {
	if (!current) current = build(storage?.cache)
	return current
}

/** Replaces the settings and persists them. */
export function setSettings(next: Settings) {
	current = build(next)
	try {
		storage?.set?.(current as unknown as Record<string, any>)
		storage?.refresh?.()
	} catch {}
	emit()
}

export function subscribe(listener: () => void): () => void {
	listeners.add(listener)
	return () => {
		listeners.delete(listener)
	}
}

export function getDiagnostics(): Diagnostics {
	return diagnostics
}

/**
 * Merges a diagnostics patch.
 *
 * Diagnostics change constantly (every trim, every dropped dispatch), so they get
 * their own listener set. Firing the settings listeners here would rebuild the
 * style hooks on every counter tick.
 */
export function patchDiagnostics(patch: Partial<Diagnostics>) {
	Object.assign(diagnostics, patch)
	for (const listener of diagnosticsListeners) {
		try {
			listener()
		} catch {}
	}
}

export function subscribeDiagnostics(listener: () => void): () => void {
	diagnosticsListeners.add(listener)
	return () => {
		diagnosticsListeners.delete(listener)
	}
}

/** Reads the Hermes heap used, in MB. Returns 0 when unavailable. */
export function readHeap(): number {
	try {
		const internal = (
			globalThis as unknown as {
				HermesInternal?: { getRuntimeProperties?: () => Record<string, string> }
			}
		).HermesInternal
		const props = internal?.getRuntimeProperties?.()
		if (!props) return 0
		const raw = Number.parseFloat(
			props['HermesInternal.getHeapInfo().usedBytes'] ?? props.GCBeforeHeapSize ?? '',
		)
		return Number.isFinite(raw) ? raw / 1024 / 1024 : 0
	} catch {
		return 0
	}
}

function emit() {
	for (const listener of listeners) {
		try {
			listener()
		} catch {}
	}
}

/** True once the loader has handed the plugin its API. */
export function hasApi(): boolean {
	return Boolean(apiOrNull())
}
