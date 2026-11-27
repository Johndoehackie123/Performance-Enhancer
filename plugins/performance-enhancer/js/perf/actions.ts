/**
 * Shared contract between the plugin entrypoint and the individual modules.
 *
 * Keeping this file free of Discord imports means `memory.ts`, `stability.ts`
 * and friends can be type-checked and unit-tested without the runtime.
 */
import type { RuntimeState } from '../store'

export interface PerfLogger {
	log(...args: unknown[]): void
	warn(...args: unknown[]): void
	error(...args: unknown[]): void
}

export interface PerfContext {
	/** Always resolves to the latest store state. */
	state(): RuntimeState
	/** Merges a diagnostics patch and notifies subscribers. */
	updateDiagnostics(patch: Partial<RuntimeState['diagnostics']>): void
	/**
	 * Registers a Flux event handler. Returning `undefined` drops the dispatch,
	 * returning the payload passes it through.
	 */
	onFluxEvent(type: string, handler: (payload: any) => any): () => void
	/** Subscribes to every Flux dispatch. */
	onAnyFluxEvent(handler: (payload: any) => any): () => void
	logger: PerfLogger
}

/**
 * Flux action types that carry telemetry or analytics payloads. Discord wraps
 * these in different shapes between releases, so several spellings are matched.
 */
export const TELEMETRY_ACTIONS = [
	'TRACK',
	'TRACK_WITH_METADATA',
	'SCIENCE',
	'POST_EVENT',
	'IMPRESSION',
	'SCROLL_IMPRESSION',
	'CLIENT_PERFORMANCE_REPORT',
] as const
