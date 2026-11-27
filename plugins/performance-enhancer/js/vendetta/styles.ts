/**
 * Visual style hooks for the stable (Revenge/Bunny) client.
 *
 * Stable Revenge patches `React.createElement`; its own JSX patching helper only
 * fires for components it knows by display name. Styling needs every element, so
 * this module hooks the JSX runtime that Discord's compiled components actually
 * call (`jsx` / `jsxs`) and falls back to `React.createElement`.
 *
 * A style is applied only to elements that already carry a `style` prop. That
 * one rule prevents the plugin from changing Discord's layout: it can restyle a
 * surface, but it can never introduce one, so a bad selector degrades to "no
 * visual change" instead of a broken screen.
 */
import { api, jsxRuntime } from './bridge'
import { buildMediaStyle, buildPanelStyle, ROUND_AVATAR_STYLE } from '../styles/engine'
import type { StyleTokens } from '../styles/engine'
import type { SurfaceId } from '../shared'
import type { Logger } from './bridge'

export interface StyleOptions {
	getTokens(): StyleTokens | undefined
	enabledSurfaces(): SurfaceId[]
	roundAvatars(): boolean
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

/** Merges our tokens into an existing style value without dropping it. */
function mergeStyle(existing: unknown, overlay: Record<string, unknown>) {
	if (Array.isArray(existing)) return [...existing, overlay]
	if (existing && typeof existing === 'object') return [existing, overlay]
	return overlay
}

export function installStyles(options: StyleOptions): StyleHandle {
	const enabled = options.enabledSurfaces()
	const tokens = options.getTokens()
	let hooked = 0

	/** Returns the replacement props, or `undefined` to leave the element alone. */
	const decorate = (type: any, props: any) => {
		if (!props || typeof props !== 'object') return undefined
		if (!('style' in props)) return undefined

		const typeName = nameOf(type)

		if (options.roundAvatars() && AVATAR_HINTS.some(hint => typeName.includes(hint))) {
			hooked += 1
			return {
				...props,
				style: mergeStyle(props.style, ROUND_AVATAR_STYLE),
			}
		}

		if (!tokens) return undefined
		const surface = surfaceOf(props, typeName, enabled)
		if (!surface) return undefined

		// Images get the media tint; every other surface gets the panel treatment.
		// Both builders return `undefined` for the "off" style, which means the
		// element is left exactly as Discord rendered it.
		const base = surface === 'images' ? buildMediaStyle(tokens) : buildPanelStyle(tokens)
		if (!base) return undefined

		hooked += 1
		return { ...props, style: mergeStyle(props.style, base as Record<string, unknown>) }
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
		runtime.jsx = makeHook(originalJsx)
		runtime.jsxs = typeof originalJsxs === 'function' ? makeHook(originalJsxs) : originalJsxs
		disposers.push(() => {
			runtime.jsx = originalJsx
			runtime.jsxs = originalJsxs
		})
	} else {
		options.logger.warn('[perf] JSX runtime not found; styles will use createElement only')
	}

	// Fallback (and the only path on older builds): React.createElement.
	try {
		const React = api().metro.common.React as any
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

	options.onHooked(hooked, 0)

	return {
		get hooked() {
			return hooked
		},
		missing: 0,
		dispose() {
			for (const dispose of disposers.splice(0)) {
				try {
					dispose()
				} catch {}
			}
		},
	}
}
