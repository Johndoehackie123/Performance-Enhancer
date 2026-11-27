/**
 * Lazy module resolution.
 *
 * Discord renames internal modules between releases, so instead of patching at
 * import time every module is looked up once, lazily, and only when a feature
 * that needs it is enabled. Nothing here throws when a module is missing: the
 * depending feature simply stays inactive and reports why.
 */
import { getModules, lookupModule } from '@revenge-mod/modules/finders'
import { withProps } from '@revenge-mod/modules/finders/filters'

export interface ImageCacheModule {
	queryCache?: unknown
	_caches?: unknown
	caches?: unknown
	clear?(key?: string): void
}

/** Discord's image loader / query cache. Best-effort, may be undefined. */
export const ImageCache: ImageCacheModule | undefined = (() => {
	try {
		const [module] = lookupModule(
			withProps<ImageCacheModule>('queryCache'),
			{ initialize: false },
		)
		if (module) return module
		const [fallback] = lookupModule(
			withProps<ImageCacheModule>('clear'),
			{ initialize: false },
		)
		return fallback
	} catch {
		return undefined
	}
})()

/** Every image/query cache map that Discord exposed at startup. */
export function imageCacheMaps(): Map<unknown, unknown>[] {
	const maps: Map<unknown, unknown>[] = []
	const cache = ImageCache
	if (!cache) return maps

	const containers: unknown[] = []
	try {
		const queries = (cache as any).queryCache ?? (cache as any)._caches ?? (cache as any).caches
		if (queries) containers.push(queries)
	} catch {}

	for (const container of containers) {
		if (container instanceof Map) maps.push(container as Map<unknown, unknown>)
		else if (container && typeof container === 'object') {
			for (const value of Object.values(container as Record<string, unknown>)) {
				if (value instanceof Map) maps.push(value as Map<unknown, unknown>)
			}
		}
	}
	return maps
}

/** Every image cache map that is currently discoverable. */
export function clearImageCaches(): Map<unknown, unknown>[] {
	return imageCacheMaps()
}

/** Clears Discord's on-disk file/asset cache. Returns 1 when it was cleared. */
export function clearFileCaches(): number {
	const cache = FileCache
	if (!cache) return 0
	try {
		if (typeof cache.clearCache === 'function') {
			cache.clearCache()
			return 1
		}
		if (cache.cache && typeof cache.cache.clear === 'function') {
			cache.cache.clear()
			return 1
		}
	} catch {}
	return 0
}

export interface ImageComponentModule {
	source?: unknown
	ImageComponent?: unknown
	default?: unknown
}

/**
 * Finds the lazily-loaded image component by the props only it reads.
 * Used by the visual layer to round avatars and tune fetch priority.
 */
export function withImageComponent(
	callback: (exports: ImageComponentModule) => void,
): () => void {
	try {
		return getModules(withProps<ImageComponentModule>('source'), callback)
	} catch {
		return () => {}
	}
}

export interface FileCacheModule {
	cache?: { clear?(): void }
	clearCache?(): void
}

/** Discord's file/asset cache module, resolved once at startup. */
export const FileCache: FileCacheModule | undefined = (() => {
	try {
		const [module] = lookupModule(withProps<FileCacheModule>('clearCache'), {
			initialize: false,
		})
		return module
	} catch {
		return undefined
	}
})()

export function withFileCache(callback: (exports: FileCacheModule) => void): () => void {
	try {
		return getModules(withProps<FileCacheModule>('clearCache'), callback)
	} catch {
		return () => {}
	}
}
