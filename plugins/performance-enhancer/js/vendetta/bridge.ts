/**
 * Runtime bridge.
 *
 * One source tree, three hosts:
 *
 *   - **Revenge stable** (Revenge Manager / RevengeXposed, bundle v1.x) evaluates a
 *     plugin as `(bunny, definePlugin) => { ... }`, exposes `window.vendetta` and
 *     passes the API as the `bunny` parameter.
 *   - **Revenge Next** loads `index.json` repositories, exposes `globalThis.revenge`
 *     and evaluates plugins as `new Function('revenge', 'plugin', 'return ' + src)`.
 *   - **Valenced** is the Valenced fork of the same architecture: `globalThis.valenced`,
 *     `new Function('valenced', 'plugin', ...)`, identical API tree, mandatory
 *     `valenced.api` + `discord` dependencies.
 *
 * Next and Valenced share one shape (`host.modules.finders`, `host.discord.flux`,
 * `host.assets`, `host.react`), so both are handled by the same probes. The stable
 * shape (`host.metro`, `host.ui`, a FluxDispatcher) is probed as the fallback.
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

interface ModernFinders {
	lookupModule?: (filter: any) => [exports: any, id: number] | readonly []
	lookupModules?: (filter: any) => Generator<[exports: any, id: number]>
	getModules?: (filter: any) => any[]
	filters?: { withProps?: (...props: string[]) => any }
}

/**
 * The resolved loader API.
 *
 * Every section is optional and the shape is loose on purpose: the same code
 * runs against Bunny (stable), Next and Valenced, and their API trees only
 * partially overlap. Probes must tolerate any missing branch.
 */
export interface VendettaApi {
	// stable (Bunny)
	metro?: {
		findByProps?(...props: string[]): any
		findByPropsAll?(...props: string[]): any[]
		findByStoreName?(name: string): any
		findByName?(name: string, defaultExport?: boolean): any
		findByDisplayName?(name: string, defaultExport?: boolean): any
		common?: {
			React?: typeof ReactNamespace
			ReactNative?: typeof ReactNativeNamespace
			FluxDispatcher?: {
				dispatch(payload: any): void
				subscribe(type: string, callback: (payload: any) => void): () => void
				unsubscribe?(type: string, callback: (payload: any) => void): () => void
			}
			components?: Record<string, any>
			constants?: any
			ReactJSXRuntime?: { jsx?: any; jsxs?: any; Fragment?: any }
		}
	}
	ui?: {
		toasts?: { showToast(content: string, asset?: number): void }
		assets?: { getAssetIDByName(name: string): number }
		components?: { Forms?: any; General?: any; [key: string]: any }
		alerts?: {
			showConfirmationAlert?(options: any): void
			showCustomAlert?(component: any, props: any): void
		}
	}
	commands?: { registerCommand?(command: any): () => void }
	patcher?: {
		before?(target: any, parent: any, callback: (...args: any[]) => void): () => void
		after?(target: any, parent: any, callback: (args: any[], ret: any) => any): () => void
		instead?(target: any, parent: any, callback: (args: any[], orig: (...a: any[]) => any) => any): any
	}
	themes?: any
	utils?: Record<string, any>
	logger?: Logger
	settings?: any
	_jsx?: { jsx?: any; jsxs?: any; Fragment?: any }
	// modern (Next / Valenced)
	modules?: { finders?: ModernFinders }
	discord?: {
		flux?: {
			onFluxEventDispatched?: (type: string, patch: (payload: any) => any) => () => void
			onAnyFluxEventDispatched?: (patch: (payload: any) => any) => () => void
		}
		actions?: { ToastActionCreators?: { open?(id: string, toast: any): void } }
		design?: Record<string, any>
		native?: Record<string, any>
	}
	assets?: { getAssetIdByName?(name: string): number | undefined }
	components?: Record<string, any>
	react?: any
	externals?: Record<string, any>
	[key: string]: any
}

/** Set once the loader hands the plugin its API. */
let vendettaApi: VendettaApi | undefined

/** The API object the loader passes to the plugin factory. */
export function bindApi(api: unknown): VendettaApi | undefined {
	if (api && typeof api === 'object') vendettaApi = api as VendettaApi
	return vendettaApi
}

/** The host global, if any injected it. Checks stable first, then modern. */
function globalHost(): VendettaApi | undefined {
	const g = globalThis as unknown as Record<string, VendettaApi | undefined>
	return g.bunny ?? g.vendetta ?? g.valenced ?? g.revenge
}

/**
 * Resolves the loader API.
 *
 * The loader passes it as a parameter, the global holds the same object, and
 * looking it up lazily keeps the settings screen working even though the loader
 * renders that component long after evaluating the plugin factory.
 */
export function api(): VendettaApi {
	if (vendettaApi) return vendettaApi
	const fromGlobal = globalHost()
	if (fromGlobal) {
		vendettaApi = fromGlobal
		return vendettaApi
	}
	throw new Error('[perf] plugin API unavailable in this runtime')
}

export function apiOrNull(): VendettaApi | undefined {
	try {
		return api()
	} catch {
		return undefined
	}
}

/** True when the host speaks the Next/Valenced API tree (modules.finders). */
export function isModernHost(host: VendettaApi | undefined): boolean {
	return Boolean(host?.modules?.finders?.lookupModule)
}

/* ------------------------------------------------------------------ modules */

/** Looks a Discord module up by prop. Never throws. */
export function findByProps(...props: string[]): any | undefined {
	const host = apiOrNull()
	if (!host) return undefined
	try {
		// Stable (Bunny)
		if (typeof host.metro?.findByProps === 'function') {
			return host.metro.findByProps(...props)
		}
		// Modern (Next/Valenced)
		const finders = host.modules?.finders
		const withProps = finders?.filters?.withProps
		if (typeof finders?.lookupModule === 'function' && typeof withProps === 'function') {
			const result = finders.lookupModule(withProps(...props))
			const match = Array.isArray(result) && result.length ? result[0] : undefined
			if (match) return match
		}
		return undefined
	} catch {
		return undefined
	}
}

/** The host's React copy. Stable keeps it on metro.common; modern under react. */
export function react(): any {
	return apiOrNull()?.react?.React ?? apiOrNull()?.metro?.common?.React
}

/** The host's React Native copy. */
export function reactNative(): any {
	const host = apiOrNull()
	return host?.react?.ReactNative ?? host?.metro?.common?.ReactNative
}

/* ------------------------------------------------------------------- toasts */

/** Shows a toast. Never throws: toasts are cosmetic. */
export function toast(content: string, assetName?: string) {
	try {
		const instance = apiOrNull()
		if (!instance) return
		const asset = assetName ? assetId(assetName) : undefined
		// Modern (Valenced / Next): Discord's own toast action creators.
		const open = instance.discord?.actions?.ToastActionCreators?.open
		if (typeof open === 'function') {
			open('performance-enhancer', { text: content, icon: asset, variant: 'success' })
			return
		}
		// Stable (Bunny)
		instance.ui?.toasts?.showToast(content, asset)
	} catch {}
}

/* ------------------------------------------------------------------- assets */

export function assetId(name: string): number | undefined {
	try {
		const instance = apiOrNull()
		if (!instance) return undefined
		const modern = instance.assets?.getAssetIdByName?.(name)
		if (typeof modern === 'number') return modern
		const stable = instance.ui?.assets?.getAssetIDByName?.(name)
		return typeof stable === 'number' ? stable : undefined
	} catch {
		return undefined
	}
}

/* --------------------------------------------------------------- flux events */

export interface FluxSubscription {
	unsubscribe(): void
}

/** The modern flux API, when the host ships one. */
function fluxModern(host: VendettaApi | undefined) {
	const flux = host?.discord?.flux
	return typeof flux?.onFluxEventDispatched === 'function' ? flux : undefined
}

/**
 * Subscribes to a Flux action type.
 *
 * A handler may return `undefined` to drop the dispatch before Discord's own
 * subscribers (analytics included) ever see it.
 */
export function onFlux(type: string, handler: (payload: any) => any): FluxSubscription {
	const host = apiOrNull()
	const modern = fluxModern(host)
	if (modern) {
		const unsubscribe = modern.onFluxEventDispatched!(type, (payload: any) => {
			// A falsy return blocks the dispatch entirely.
			try {
				return handler(payload)
			} catch {
				// Never break Discord's dispatch on our error: pass it through.
				return payload
			}
		})
		return {
			unsubscribe() {
				try {
					unsubscribe?.()
				} catch {}
			},
		}
	}

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
 * They ship in the `Forms` bundle on stable (`ui.components.Forms`), and as a
 * metro module on every client, so every candidate is probed. Hosts that have
 * neither get plain-React fallbacks in the settings screen.
 */
export function design(): Record<string, any> {
	const instance = apiOrNull()
	if (!instance) return {}
	const fromForms = instance.ui?.components?.Forms
	const fromDesign = instance.discord?.design
	const fromMetro = findByProps('TableRowGroup', 'TableRow')
	return { ...(fromDesign ?? {}), ...(fromForms ?? {}), ...(fromMetro ?? {}) }
}

/**
 * The JSX runtime Discord's compiled components call.
 *
 * Both runtimes keep it as a metro module whose `jsx`/`jsxs` properties are
 * read at call time, so patching that module restyles every component —
 * `findByProps` resolves it on every supported client.
 */
export function jsxRuntime(): { jsx?: any; jsxs?: any } | undefined {
	const instance = apiOrNull()
	const fromMetro = findByProps('jsx', 'jsxs')
	if (fromMetro?.jsx) return fromMetro
	if (instance?._jsx?.jsx) return instance._jsx
	if (instance?.react?.ReactJSXRuntime?.jsx) return instance.react.ReactJSXRuntime
	if (instance?.react?.jsxRuntime?.jsx) return instance.react.jsxRuntime
	if (instance?.metro?.common?.ReactJSXRuntime?.jsx) return instance.metro.common.ReactJSXRuntime
	return undefined
}

/** Discord's Flux dispatcher, where the stable runtime keeps it. */
export function fluxDispatcher(): any {
	const fromCommon = apiOrNull()?.metro?.common?.FluxDispatcher
	if (fromCommon?.subscribe) return fromCommon
	const found =
		findByProps('subscribe', '_subscriptions', 'dispatch') ??
		findByProps('dispatch', 'subscribe', 'isDispatching') ??
		findByProps('subscribe', 'dispatch')
	return found?.subscribe ? found : undefined
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
	const modern = isModernHost(instance)
	return {
		toasts: modern
			? typeof instance?.discord?.actions?.ToastActionCreators?.open === 'function'
			: Boolean(instance?.ui?.toasts?.showToast),
		design: Boolean(rows.TableRowGroup && rows.TableRow),
		flux: modern
			? Boolean(fluxModern(instance))
			: Boolean(fluxDispatcher()),
		assets: modern
			? typeof instance?.assets?.getAssetIdByName === 'function'
			: Boolean(instance?.ui?.assets?.getAssetIDByName),
		patcher: Boolean(instance?.patcher?.after),
	}
}
