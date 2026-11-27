/**
 * Vendetta-flavoured wrapper around the plugin options.
 *
 * Stable Revenge evaluates a plugin's source as
 *
 *     (bunny, definePlugin) => { <bundle>; return plugin?.default ?? plugin; }
 *
 * and then calls `onLoad()` / `start()` on the result, rendering
 * `SettingsComponent` as a plain React component with no props.
 *
 * This helper normalises both generations: it accepts the same options object
 * the Next build passes to `plugin()`, applies the storage defaults
 * synchronously, and returns the shape stable Revenge expects.
 */

/**
 * Deep-clones plain data (objects, arrays, primitives).
 *
 * `structuredClone` is a WHATWG API, not ECMAScript — Hermes, the JS engine in
 * React Native / Discord, deliberately does not implement it, so calling it
 * throws `ReferenceError: Property 'structuredClone' doesn't exist` (see
 * facebook/hermes#684). The plugin's settings are plain JSON, so a recursive
 * copy here does everything we need without relying on a host global.
 */
export function deepClone<T>(value: T): T {
	if (value === null || typeof value !== 'object') return value
	if (Array.isArray(value)) return value.map(item => deepClone(item)) as unknown as T
	const out: Record<string, any> = {}
	for (const key of Object.keys(value as Record<string, any>)) {
		out[key] = deepClone((value as Record<string, any>)[key])
	}
	return out as T
}

/**
 * Declares a plugin.
 *
 * Typed loosely on purpose: the stable runtime has no `jsonStorage` support, so
 * requiring the Next-only option types here would make the stable build unable
 * to type-check.
 */
export function definePlugin<T extends Record<string, any>>(options: T): T {
	return options
}

/** Deep-merges stored settings over the defaults, keeping stored values. */
export function withDefaults<T>(defaults: T, stored: unknown): T {
	if (!stored || typeof stored !== 'object') return deepClone(defaults)
	const merge = (base: any, value: any): any => {
		if (Array.isArray(base) || typeof base !== 'object' || base === null) return value ?? base
		if (!value || typeof value !== 'object') return base
		const out: Record<string, any> = { ...base }
		for (const key of Object.keys(base)) {
			const next = value[key]
			if (next === undefined) continue
			out[key] = merge(base[key], next)
		}
		return out
	}
	return merge(deepClone(defaults), stored) as T
}
