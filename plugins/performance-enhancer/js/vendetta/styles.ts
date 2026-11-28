/**
 * Visual style hooks for the stable (Revenge/Bunny) client.
 *
 * Stable Revenge patches `React.createElement`; its own JSX patching helper only
 * fires for components it knows by display name. Styling needs every element, so
 * this module hooks the JSX runtime that Discord's compiled components actually
 * call (`jsx` / `jsxs`) and falls back to `React.createElement`.
 *
 * Every style edit lands live: tokens are re-read per element from the settings
 * store (memoised, so this is cheap), which means changing the custom palette in
 * the studio repaints already-rendered surfaces on their next render instead of
 * requiring a plugin reload.
 *
 * What gets applied, per element, in order:
 *   1. **Structural recolor** — any color in Discord's stock palettes (modern
 *      and legacy) is swapped for the tonal scale derived from the active
 *      style's panel/accent. Only color keys are touched; layout never moves.
 *      Registered `StyleSheet` IDs and non-object styles pass through.
 *   2. **Avatar rounding** — independent of the style.
 *   3. **Surface overlays** — panel/media sheets for the surfaces the user
 *      enabled in the studio.
 *
 * A style is applied only to elements that already carry a `style` prop. That
 * one rule prevents the plugin from inventing layout; a bad detector degrades
 * to "no visual change" instead of a broken screen.
 */
import { apiOrNull, jsxRuntime, react } from './bridge'
import { remixNavigationChildren } from '../styles/navigation-remix'
import {
	buildAvatarStyle,
	buildMediaStyle,
	buildNavigationActiveStyle,
	buildNavigationBarStyle,
	navigationKind,
	buildPanelStyle,
	buildRecolorTable,
	recolorStyleValue,
} from '../styles/engine'
import type { StyleTokens } from '../styles/engine'
import type { SurfaceId } from '../shared'
import type { Logger } from './bridge'

export interface StyleOptions {
	getTokens(): StyleTokens | undefined
	enabledSurfaces(): SurfaceId[]
	roundAvatars(): boolean
	/** Accent ring around circular avatars. */
	avatarRing?(): boolean
	onHooked(count: number, missing: number): void
	logger: Logger
}

export interface StyleHandle {
	dispose(): void
	hooked: number
	missing: number
}

/** Props that identify a surface. Matched against the component's props. */
const SURFACE_PROPS: Record<SurfaceId, string[]> = {
	messages: ['message', 'messageContent', 'channelMessageProps'],
	navigation: ['header', 'navigation', 'route', 'tabIndex'],
	input: ['textValue', 'placeholderTextColor', 'chatInputProps'],
	sheets: ['sheetKey', 'bottomSheetRef', 'actionSheetProps'],
	images: ['mediaItem', 'attachment', 'embed', 'imageUrl'],
}

/** Component names that are safe to restyle when props are inconclusive. */
const AVATAR_HINTS = ['Avatar', 'UserAvatar', 'RoundAvatar', 'AvatarImage']

/** Turns a JSX element type into a comparable name. */
function nameOf(type: any): string {
	if (typeof type === 'function') return type.name ?? ''
	if (typeof type === 'string') return type
	return (type?.type?.name ?? type?.render?.name ?? '') as string
}

/** Whether an element belongs to one of the enabled surfaces. */
function surfaceOf(props: Record<string, unknown>, typeName: string, enabled: SurfaceId[]) {
	for (const surface of enabled) {
		const keys = SURFACE_PROPS[surface]
		if (keys.some(key => key in props)) return surface
		// Some surfaces are only identifiable by component name.
		if (surface === 'messages' && /Message/i.test(typeName)) return 'messages'
		if (surface === 'sheets' && /(ActionSheet|BottomSheet)/i.test(typeName)) return 'sheets'
	}
	return undefined
}

/** Merges our style into an existing style value without dropping it. */
function mergeStyle(existing: unknown, overlay: Record<string, unknown>) {
	if (Array.isArray(existing)) return [...existing, overlay]
	if (existing && typeof existing === 'object') return [existing, overlay]
	return overlay
}

export function installStyles(options: StyleOptions): StyleHandle {
	let hooked = 0

	// Memoised recolor state. `getTokens()` is memoised in the engine, so the
	// same visual yields the same tokens object and this compare is a pointer
	// check; a palette edit invalidates it naturally.
	let cachedTokens: StyleTokens | undefined
	let cachedTable: Map<string, string> | undefined
	// Shared cache for the structural walker: identical style objects recur
	// thousands of times per render pass, so per-key lookups dominate. It is
	// rebuilt whenever the palette changes so stale recolors never stick.
	let styleCache = new Map<object, unknown>()

	// Enabled surfaces are re-read on a short timer: the settings closure
	// allocates a fresh array on every call, which would run thousands of
	// times per second during scroll.
	let enabledCache: { at: number; value: SurfaceId[] } | undefined
	const enabledNow = () => {
		const now = Date.now()
		if (enabledCache && now - enabledCache.at < 250) return enabledCache.value
		const value = options.enabledSurfaces()
		enabledCache = { at: now, value }
		return value
	}

	const tableFor = (tokens: StyleTokens | undefined) => {
		if (!tokens) {
			cachedTokens = undefined
			cachedTable = undefined
			return undefined
		}
		if (tokens !== cachedTokens) {
			cachedTokens = tokens
			cachedTable = buildRecolorTable(tokens)
			styleCache = new Map()
		}
		return cachedTable
	}

	// Diagnostics are reported from a slow timer, never from the render path.
	// Reporting synchronously feeds the settings screen's diagnostics
	// subscription: re-render -> re-decorate -> report -> re-render, which
	// freezes the page. Five seconds keeps the counter honest without the
	// screen ever spinning on it.
	let lastReported = 0
	const timer = setInterval(() => {
		if (hooked === lastReported) return
		lastReported = hooked
		try {
			options.onHooked(hooked, 0)
		} catch {}
	}, 5000)
	try {
		// Hermes timers support unref; a missing unref must not break install.
		;(timer as unknown as { unref?: () => void }).unref?.()
	} catch {}

	/** Returns the replacement props, or `undefined` to leave the element alone. */
	const decorate = (type: any, props: any) => {
		if (!props || typeof props !== 'object') return undefined
		if (!('style' in props)) return undefined

		const tokens = options.getTokens()
		const table = tableFor(tokens)

		// 1. Structural recolor of whatever style the element carries.
		let next: unknown = props.style
		let changed = false
		if (table) {
			const recolored = recolorStyleValue(props.style, table, styleCache)
			if (recolored !== props.style) {
				next = recolored
				changed = true
			}
		}

		// 2. Avatar rounding (independent of the style).
		const typeName = nameOf(type)
		if (options.roundAvatars() && AVATAR_HINTS.some(hint => typeName.includes(hint))) {
			const accent = tokens?.accent ?? '#5865f2'
			next = mergeStyle(
				next,
				buildAvatarStyle(accent, options.avatarRing?.() ?? false, tokens?.avatarRadius),
			)
			changed = true
		}
		// 2b. Text tracking from the theme's layout language. Host `Text`
		// components are identified by their exact string type.
		if (tokens && tokens.letterSpacing > 0 && type === 'Text') {
			next = mergeStyle(next, { letterSpacing: tokens.letterSpacing })
			changed = true
		}
		// Navigation treatment. Independent of the surface heuristics — RN tab
		// containers rarely carry route-ish props, so the bar is found by
		// component name, the RN tab role and navigator props instead. When the
		// bar IS found, its whole subtree is remixed atomically: every tab item
		// inside gets the proper treatment and the capsule, and nothing outside
		// the bar is touched.
		let childrenRemixed: unknown
		if (tokens && enabledNow().includes('navigation')) {
			const kind = navigationKind(typeName, props)
			if (kind === 'bar') {
				const bar = buildNavigationBarStyle(tokens) ?? buildPanelStyle(tokens)
				if (bar) {
					next = mergeStyle(next, bar as Record<string, unknown>)
					changed = true
				}
				const React = react() as
					| { createElement?: (type: any, cfg: any, ...c: any[]) => any; isValidElement?: (n: any) => boolean }
					| undefined
				if (React?.createElement && React.isValidElement) {
					try {
						const remixed = remixNavigationChildren(props.children, tokens, {
							createElement: React.createElement.bind(React),
							isValidElement: React.isValidElement.bind(React),
						})
						if (remixed !== props.children) {
							childrenRemixed = remixed
							changed = true
						}
					} catch {}
				}
			} else if (kind === 'item') {
				// Items outside the bar subtree (react-navigation creates items inside
				// the bar, but Discord may hoist them): capsule only, never margins.
				const state = props.accessibilityState as { selected?: boolean; checked?: boolean } | undefined
				const selected =
					typeof props.focused === 'boolean'
						? props.focused
						: !!state && (state.selected === true || state.checked === true)
				if (selected) {
					const active = buildNavigationActiveStyle(tokens)
					if (active) {
						next = mergeStyle(next, active as Record<string, unknown>)
						changed = true
					}
				}
			}
		}

		if (tokens) {
			// 3. Surface overlays for the enabled surfaces only.
			const surface = surfaceOf(props, typeName, enabledNow())
			if (surface && surface !== 'navigation') {
				const base = surface === 'images' ? buildMediaStyle(tokens) : buildPanelStyle(tokens)
				if (base) {
					next = mergeStyle(next, base as Record<string, unknown>)
					changed = true
				}
			}
		}

		if (!changed) return undefined
		hooked += 1
		if (childrenRemixed !== undefined) return { ...props, style: next, children: childrenRemixed }
		return { ...props, style: next }
	}

	const disposers: (() => void)[] = []
	const runtime = jsxRuntime()

	const makeHook = (original: (...args: any[]) => any) => {
		return function patched(this: unknown, type: any, props: any, ...rest: any[]) {
			try {
				const next = decorate(type, props)
				if (next) return original.call(this, type, next, ...rest)
			} catch {}
			return original.call(this, type, props, ...rest)
		}
	}

	if (runtime && typeof runtime.jsx === 'function') {
		const originalJsx = runtime.jsx
		const originalJsxs = runtime.jsxs
		try {
			runtime.jsx = makeHook(originalJsx)
			runtime.jsxs =
				typeof originalJsxs === 'function' ? makeHook(originalJsxs) : originalJsxs
			disposers.push(() => {
				try {
					runtime.jsx = originalJsx
					runtime.jsxs = originalJsxs
				} catch {}
			})
		} catch (error) {
			// A read-only JSX module (or a frozen proxy) must not fail the install.
			options.logger.warn(`[perf] could not wrap the JSX runtime: ${String(error)}`)
		}
	} else {
		options.logger.warn('[perf] JSX runtime not found; styles will use createElement only')
	}

	// Fallback (and the only path on older builds): React.createElement.
	try {
		const host = apiOrNull() as any
		const React = (host?.react?.React ?? host?.metro?.common?.React) as any
		if (React?.createElement && !runtime) {
			const original = React.createElement
			React.createElement = function patched(type: any, props: any, ...rest: any[]) {
				try {
					const next = decorate(type, props)
					if (next) return original(type, next, ...rest)
				} catch {}
				return original(type, props, ...rest)
			}
			disposers.push(() => {
				React.createElement = original
			})
		}
	} catch {}

	options.onHooked(0, 0)

	return {
		get hooked() {
			return hooked
		},
		missing: 0,
		dispose() {
			clearInterval(timer)
			for (const dispose of disposers.splice(0)) {
				try {
					dispose()
				} catch {}
			}
			try {
				options.onHooked(hooked, 0)
			} catch {}
		},
	}
}
