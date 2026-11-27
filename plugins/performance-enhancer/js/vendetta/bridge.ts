/**
 * Runtime bridge.
 *
 * Performance Enhancer ships in two shapes from one source tree:
 *
 *   - `index.js` (this target) is the **stable Revenge / Bunny** plugin that
 *     Revenge Manager and RevengeXposed load today. That runtime evaluates a
 *     plugin as `(bunny, definePlugin) => { ... }` and exposes `window.vendetta`.
 *   - `build/js/index.js` targets **Revenge Next**, which loads `index.json`
 *     repositories and exposes the `revenge.*` globals.
 *
 * Nothing here fabricates an API. Every capability is probed, and a host that
 * does not provide one simply hides the corresponding control instead of
 * throwing while the plugin loads.
 */
import type * as ReactNamespace from 'react'
import type * as ReactNativeNamespace from 'react-native'

export type { ReactNamespace, ReactNativeNamespace }

/** Loader-provided logger; Revenge passes one named after the plugin. */
export interface Logger {
	log(...args: unknown[]): void
	info?(...args: unknown[]): void
	warn(...args: unknown[]): void
	error(...args: unknown[]): void
}

/** The per-plugin persistent store the stable loader injects. */
export interface PluginStorage {
	/** Loaded settings, already deep-merged with the declared defaults. */
	cache?: Record<string, any>
	/** Persists the given object. */
	set?(value: Record<string, any>): void
	/** Marks the store as changed for observers. */
	refresh?(): void
	/** Subscribes to changes. */
	use?(listener?: () => void): () => void
}

/** The slice of `window.vendetta` this plugin relies on. */
export interface VendettaApi {
	metro: {
		findByProps(...props: string[]): any
		findByPropsAll?(...props: string[]): any[]
		findByStoreName?(name: string): any
		findByName?(name: string, defaultExport?: boolean): any
		findByDisplayName?(name: string, defaultExport?: boolean): any
		common: {
			React: typeof ReactNamespace
			ReactNative: typeof ReactNativeNamespace
			/** Discord's Flux dispatcher. Probed; not every build exposes it here. */
			FluxDispatcher?: {
				dispatch(payload: any): void
				subscribe(type: string, callback: (payload: any) => void): () => void
				unsubscribe?(type: string, callback: (payload: any) => void): () => void
			}
			/** Settings row components (`TableRow`, `TableRowGroup`, …). */
			components?: Record<string, any>
			constants?: any
		}
	}
	ui: {
		toasts: { showToast(content: string, asset?: number): void }
		assets: { getAssetIDByName(name: string): number }
		components: { Forms: any; General?: any; [key: string]: any }
		alerts?: {
			showConfirmationAlert?(options: any): void
			showCustomAlert?(component: any, props: any): void
		}
	}
	commands?: { registerCommand?(command: any): () => void }
	themes?: any
	patcher: {
		before(target: string, parent: any, callback: (...args: any[]) => void): () => void
		after(target: string, parent: any, callback: (args: any[], ret: any) => any): () => void
		instead(target: string, parent: any, callback: (args: any[], orig: (...a: any[]) => any) => any): () => void
	}
	utils?: Record<string, any>
	logger?: Logger
	settings?: any
}

/** Set once the loader hands the plugin its API. */
let vendettaApi: VendettaApi | undefined

/** The API object the loader passes to the plugin factory. */
export function bindApi(api: unknown): VendettaApi | undefined {
	if (api && typeof api === 'object') vendettaApi = api as VendettaApi
	return vendettaApi
}

/**
 * Resolves the loader API.
 *
 * The loader passes it to the factory; the global is the same object. Looking it
 * up lazily keeps the settings screen working even though the loader renders
 * that component long after evaluating the factory.
 */
export function api(): VendettaApi {
	if (vendettaApi) return vendettaApi
	const fromGlobal = (globalThis as unknown as { vendetta?: VendettaApi }).vendetta
	if (fromGlobal) {
		vendettaApi = fromGlobal
		return vendettaApi
	}
	throw new Error('[perf] Revenge API unavailable in this runtime')
}

export function apiOrNull(): VendettaApi | undefined {
	try {
		return api()
	} catch {
		return undefined
	}
}

/* ------------------------------------------------------------------ modules */

/** Looks a Discord module up by prop. Never throws. */
export function findByProps(...props: string[]): any | undefined {
	try {
		return api().metro.findByProps(...props)
	} catch {
		return undefined
	}
}

export function react(): typeof ReactNamespace {
	return api().metro.common.React
}

export function reactNative(): typeof ReactNativeNamespace {
	return api().metro.common.ReactNative
}

/* ------------------------------------------------------------------- toasts */

/** Shows a toast. Never throws: toasts are cosmetic. */
export function toast(content: string, assetName?: string) {
	try {
		const instance = api()
		let asset: number | undefined
		if (assetName) asset = assetId(assetName)
		instance.ui.toasts.showToast(content, asset)
	} catch {}
}

/* ------------------------------------------------------------------- assets */

export function assetId(name: string): number | undefined {
	try {
		const id = api().ui.assets.getAssetIDByName(name)
		return typeof id === 'number' ? id : undefined
	} catch {
		return undefined
	}
}

/* --------------------------------------------------------------- flux events */

export interface FluxSubscription {
	unsubscribe(): void
}

/**
 * Subscribes to a Flux action type.
 *
 * A handler may return `undefined` to drop the dispatch before Discord's own
 * subscribers (analytics included) ever see it.
 */
export function onFlux(type: string, handler: (payload: any) => any): FluxSubscription {
	const dispatcher = fluxDispatcher()
	if (!dispatcher) throw new Error('[perf] Flux dispatcher unavailable')
	const guarded = (payload: any) => {
		try {
			const result = handler(payload)
			// `false` blocks the dispatch in Discord's Flux implementation.
			return result === undefined ? false : result
		} catch {
			return undefined
		}
	}
	const unsubscribe = dispatcher.subscribe(type, guarded)
	return {
		unsubscribe() {
			try {
				if (typeof unsubscribe === 'function') unsubscribe()
				else dispatcher.unsubscribe?.(type, guarded)
			} catch {}
		},
	}
}

/* --------------------------------------------------------------- components */

/**
 * Discord's settings row components.
 *
 * They ship in the `Forms` bundle (`ui.components.Forms`), but the individual
 * components moved between releases, so every candidate is probed.
 */
export function design(): Record<string, any> {
	const instance = apiOrNull()
	if (!instance) return {}
	const fromForms = instance.ui?.components?.Forms
	const fromMetro = findByProps('TableRowGroup', 'TableRow')
	return { ...(fromForms ?? {}), ...(fromMetro ?? {}) }
}

/**
 * The JSX runtime Discord's compiled components call.
 *
 * Stable Revenge exposes it as `metropolis`/`jsxRuntime` on some builds and
 * only as the Metro module on others, so both paths are probed.
 */
export function jsxRuntime(): { jsx?: any; jsxs?: any } | undefined {
	const instance = apiOrNull() as any
	// `bunny._jsx` is Revenge's own re-export; the Metro module is what Discord's
	// compiled components actually call, so it is preferred for patching.
	const fromMetro = findByProps('jsx', 'jsxs')
	if (fromMetro?.jsx) return fromMetro
	if (instance?._jsx?.jsx) return instance._jsx
	if (instance?.metro?.common?.ReactJSXRuntime?.jsx) return instance.metro.common.ReactJSXRuntime
	return undefined
}

/** Discord's Flux dispatcher, wherever this build keeps it. */
export function fluxDispatcher(): VendettaApi['metro']['common']['FluxDispatcher'] | undefined {
	const fromCommon = apiOrNull()?.metro?.common?.FluxDispatcher
	if (fromCommon?.subscribe) return fromCommon
	const found = findByProps('subscribe', '_subscriptions', 'dispatch') ??
		findByProps('dispatch', 'subscribe', 'isDispatching') ??
		findByProps('subscribe', 'dispatch')
	return found?.subscribe ? (found as any) : undefined
}

/** `TableRow.Icon` lives on the component itself on most builds. */
export function rowIcon(): any {
	const { TableRow } = design()
	return (TableRow as any)?.Icon
}

/* ------------------------------------------------------------- capabilities */

export interface Capabilities {
	toasts: boolean
	design: boolean
	flux: boolean
	assets: boolean
	patcher: boolean
}

/** What this host can actually do. Drives the "limited build" labels. */
export function capabilities(): Capabilities {
	const instance = apiOrNull()
	const rows = design()
	return {
		toasts: Boolean(instance?.ui?.toasts?.showToast),
		design: Boolean(rows.TableRowGroup && rows.TableRow),
		flux: Boolean(fluxDispatcher()),
		assets: Boolean(instance?.ui?.assets?.getAssetIDByName),
		patcher: Boolean(instance?.patcher?.after),
	}
}
