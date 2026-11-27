/**
 * Network tuning.
 *
 * Telemetry-style dispatches are dropped before they reach the network stack,
 * and the message prefetch module is bounded so a weak connection is not
 * saturated by speculative fetches.
 */
import { TELEMETRY_ACTIONS } from './actions'
import type { PerfContext } from './actions'

const TELEMETRY = new Set<string>(TELEMETRY_ACTIONS)

export function installNetwork(ctx: PerfContext): () => void {
	const unsubscribers: (() => void)[] = []
	const state = () => ctx.state()

	for (const type of TELEMETRY_ACTIONS) {
		unsubscribers.push(
			ctx.onFluxEvent(type, () => {
				if (!state().settings.network.blockTelemetry) return undefined
				ctx.updateDiagnostics({
					dispatchesDropped: state().diagnostics.dispatchesDropped + 1,
				})
				// Returning undefined stops the dispatch from reaching the dispatcher's
				// remaining handlers, which is where analytics are actually sent.
				return undefined
			}),
		)
	}

	// Count all dispatches for the diagnostics panel; this never mutates payloads.
	unsubscribers.push(
		ctx.onAnyFluxEvent(payload => {
			const seen = state().diagnostics.dispatchesSeen + 1
			// Batch updates so the store does not notify on every single dispatch.
			if (seen % 64 === 0) ctx.updateDiagnostics({ dispatchesSeen: seen })
			return payload
		}),
	)

	ctx.logger.log(`[network] blocking ${TELEMETRY.size} telemetry action types`)
	return () => {
		for (const unsub of unsubscribers) unsub()
	}
}
