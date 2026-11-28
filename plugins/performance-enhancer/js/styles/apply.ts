/**
 * JSX-level styling.
 *
 * Revenge's `afterJSX` hooks are keyed by the exact component reference, so the
 * styling layer first *discovers* Discord's components by name from already
 * initialized Metro modules, then decorates only those components.
 *
 * What this means in practice:
 *   - Nothing ever patches Discord's render functions, so React Compiler builds
 *     keep working and every decoration can be removed cleanly on stop.
 *   - If Discord renames a component, only that surface is skipped: the plugin
 *     keeps running and the settings screen lists which surfaces were found.
 */
import { lookupModules } from '@revenge-mod/modules/finders'
import { withProps } from '@revenge-mod/modules/finders/filters'
import { afterJSX } from '@revenge-mod/react/jsx-runtime'
import { createElement, isValidElement } from 'react'
import {
	AVATAR_COMPONENT_HINTS,
	ROUND_AVATAR_STYLE,
	SURFACE_COMPONENT_HINTS,
	TEXT_COMPONENT_HINTS,
	buildAvatarStyle,
	buildMediaStyle,
	buildNavigationBarStyle,
	buildNavigationActiveStyle,
	navigationKind,
	buildPanelStyle,
	buildRecolorTable,
	recolorStyleValue,
} from './engine'
import type { StyleTokens } from './engine'
import type { SurfaceId } from '../shared'
import type { ReactElement } from 'react'

export interface DiscoveredComponent {
	name: string
	surface: SurfaceId
	component: unknown
}

interface ComponentLike {
	displayName?: string
	name?: string
	type?: { displayName?: string; name?: string }
}

/** Reads a component's display name across function, memo and forwardRef shapes. */
export function componentName(value: unknown): string | undefined {
	if (typeof value === 'function') {
		const fn = value as unknown as ComponentLike
		return fn.displayName ?? fn.name
	}
	if (value && typeof value === 'object') {
		const obj = value as ComponentLike
		return obj.displayName ?? obj.name ?? obj.type?.displayName ?? obj.type?.name
	}
	return undefined
}

/**
 * Scans initialized modules for components whose name contains one of the hints.
 *
 * The scan is bounded so startup stays cheap: it stops after `moduleLimit`
 * default-exporting modules and runs once, without initializing anything.
 */
export function discoverComponents(
	hints: Map<string, SurfaceId>,
	moduleLimit = 600,
): DiscoveredComponent[] {
	const found: DiscoveredComponent[] = []
	const seen = new Set<unknown>()

	try {
		let scanned = 0
		for (const [namespace] of lookupModules(withProps('default'), { initialize: false })) {
			if (scanned++ > moduleLimit) break
			const value = (namespace as { default?: unknown })?.default
			if (!value || seen.has(value)) continue
			seen.add(value)

			const name = componentName(value)
			if (!name) continue

			for (const [hint, surface] of hints) {
				if (name === hint || name.includes(hint)) {
					found.push({ name, surface, component: value })
					break
				}
			}
		}
	} catch {}

	return found
}

/** Builds the hint → surface lookup the discovery uses. */
export function buildHintMap(surfaces: SurfaceId[]): Map<string, SurfaceId> {
	const map = new Map<string, SurfaceId>()
	for (const surface of surfaces) {
		for (const hint of SURFACE_COMPONENT_HINTS[surface]) map.set(hint, surface)
	}
	return map
}

/**
 * Prepends our style to Discord's own `style` prop.
 *
 * If the target does not take a `style` prop at all (some of Discord's
 * components forward their own props instead) the element is left alone rather
 * than passing an unknown prop down the tree.
 */
// Memoised recolor state, shared with the stable hook. Tokens objects are
// memoised in the engine, so reference equality is a valid cache key.
let cachedTokens: StyleTokens | undefined
let cachedTable: Map<string, string> | undefined
function tableFor(tokens: StyleTokens | undefined): Map<string, string> | undefined {
	if (!tokens) {
		cachedTokens = undefined
		cachedTable = undefined
		return undefined
	}
	if (tokens !== cachedTokens) {
		cachedTokens = tokens
		cachedTable = buildRecolorTable(tokens)
	}
	return cachedTable
}

function decorate(
	element: ReactElement<any>,
	overlays: unknown[],
	getTokens?: () => StyleTokens | undefined,
): ReactElement<any> {
	if (!isValidElement(element)) return element
	const props = element.props as Record<string, unknown> | null
	if (!props || typeof props !== 'object') return element

	// A `style` key being present is the signal that the component accepts one.
	if (!('style' in props)) return element

	// Structural recolor of whatever style the element already carries; this is
	// what lets the active palette reach every surface, not just the panels.
	const table = getTokens ? tableFor(getTokens()) : undefined
	const recolored = table ? recolorStyleValue(props.style, table) : props.style

	const next: Record<string, unknown> = { ...props }
	// Later entries win in React Native, so our overlays are applied after the
	// element's own style.
	next.style = overlays.length ? [recolored, ...overlays] : recolored
	return createElement(element.type as any, next as any)
}

export interface InstallVisualOptions {
	getTokens(): StyleTokens | undefined
	/** Surfaces the user enabled. */
	enabledSurfaces(): SurfaceId[]
	roundAvatars(): boolean
	onError?(error: unknown): void
}

export interface VisualInstall {
	/** Surfaces (and component names) that were successfully hooked. */
	hooked: { surface: SurfaceId | 'avatar'; name: string }[]
	/** Surfaces with no matching component on this Discord build. */
	missing: SurfaceId[]
	cleanup(): void
}

type OverlayFactory = (
	element: ReactElement<any>,
	componentName: string,
) => unknown[]

/** Registers a decorating hook on a concrete component. */
function hookComponent(
	component: unknown,
	buildOverlays: OverlayFactory,
	componentName: string,
	onError?: (error: unknown) => void,
	getTokens?: () => StyleTokens | undefined,
): (() => void) | undefined {
	try {
		return afterJSX(component as any, element => {
			try {
				const props = (element as ReactElement<any>)?.props
				const overlays = props ? buildOverlays(element as ReactElement<any>, componentName) : []
				return decorate(element as ReactElement<any>, overlays, getTokens)
			} catch (error) {
				onError?.(error)
				return element
			}
		})
	} catch (error) {
		onError?.(error)
		return undefined
	}
}

/**
 * Installs the styling hooks. Every hook is registered against a concrete
 * component, so uninstalling simply unpatches those components.
 */
export function installVisualHooks(options: InstallVisualOptions): VisualInstall {
	const cleanups: (() => void)[] = []
	const hooked: VisualInstall['hooked'] = []
	const missing: SurfaceId[] = []

	const surfaces = options.enabledSurfaces()
	const discovered = discoverComponents(buildHintMap(surfaces))

	const perSurface = new Map<SurfaceId, number>()
	for (const entry of discovered) {
		const count = perSurface.get(entry.surface) ?? 0
		// Cap the patches per surface: message content renders thousands of times
		// per session and every extra prop allocation adds up.
		if (count >= 3) continue

		const overlaysFor: OverlayFactory = (element, name) => {
			const tokens = options.getTokens()
			if (!tokens) return []
			if (entry.surface === 'images') {
				const media = buildMediaStyle(tokens)
				return media ? [media] : []
			}
			if (entry.surface === 'navigation') {
				const kind = navigationKind(name, element.props as Record<string, unknown> | null)
				if (kind === 'bar') {
					const bar = buildNavigationBarStyle(tokens) ?? buildPanelStyle(tokens)
					return bar ? [bar] : []
				}
				if (kind === 'item') {
					const state = (element.props as Record<string, unknown> | undefined)?.accessibilityState as
						| { selected?: boolean; checked?: boolean }
						| undefined
					const selected = !!state && (state.selected === true || state.checked === true)
					const active = selected ? buildNavigationActiveStyle(tokens) : undefined
					return active ? [active] : []
				}
				return []
			}
			const panel = buildPanelStyle(tokens)
			return panel ? [panel] : []
		}

		const unpatch = hookComponent(entry.component, overlaysFor, entry.name, options.onError, options.getTokens)
		if (!unpatch) continue
		perSurface.set(entry.surface, count + 1)
		cleanups.push(unpatch)
		hooked.push({ surface: entry.surface, name: entry.name })
	}

	for (const surface of surfaces) {
		if (!perSurface.has(surface)) missing.push(surface)
	}

	// Text tracking is independent of the surfaces the user enabled; it applies
	// to the app's text components when the active theme asks for tracking.
	{
		const textHints = new Map<string, SurfaceId>(TEXT_COMPONENT_HINTS.map(hint => [hint, 'messages' as SurfaceId]))
		let textHooks = 0
		for (const { name, component } of discoverComponents(textHints, 400)) {
			// Cap high-frequency text patches, like the surface hooks.
			if (textHooks >= 2) break
			const unpatch = hookComponent(
				component,
				() => {
					const tokens = options.getTokens()
					const tracking = tokens && tokens.letterSpacing > 0 ? { letterSpacing: tokens.letterSpacing } : undefined
					return tracking ? [tracking] : []
				},
				name,
				options.onError,
				options.getTokens,
			)
			if (!unpatch) continue
			textHooks++
			cleanups.push(unpatch)
			hooked.push({ surface: 'messages', name: `text:${name}` })
		}
	}

	// Avatars are independent of the surfaces the user enabled.
	if (options.roundAvatars()) {
		const avatarHints = new Map<string, SurfaceId>(
			AVATAR_COMPONENT_HINTS.map(hint => [hint, 'images' as SurfaceId]),
		)
		for (const { name, component } of discoverComponents(avatarHints, 400)) {
			const unpatch = hookComponent(
				component,
				() => {
					const tokens = options.getTokens()
					const style = tokens
						? buildAvatarStyle(tokens.accent, true, tokens.avatarRadius)
						: ROUND_AVATAR_STYLE
					return [style]
				},
				name,
				options.onError,
				options.getTokens,
			)
			if (!unpatch) continue
			cleanups.push(unpatch)
			hooked.push({ surface: 'avatar', name })
		}
	}

	return {
		hooked,
		missing,
		cleanup() {
			for (const cleanup of cleanups) {
				try {
					cleanup()
				} catch {}
			}
			cleanups.length = 0
		},
	}
}
