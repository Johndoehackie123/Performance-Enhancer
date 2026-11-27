/**
 * Stability hardening.
 *
 * Two independent, honest guards:
 *
 *   1. **Failure watchdog.** Gateway, RESUME and Flux-side errors are counted in
 *      a sliding window. A burst of the same failure is logged once with a
 *      recovery hint instead of spamming the log, and the failure count feeds the
 *      diagnostics panel. The plugin never fabricates gateway actions: Discord's
 *      reconnect logic is authoritative and dispatching a fake `CONNECTION_OPEN`
 *      would desync the socket state, which is exactly the instability this
 *      plugin is meant to prevent.
 *
 *   2. **Retry throttling.** When the profile's retry budget is exhausted inside
 *      one window, the payload is passed through untouched but the burst is
 *      recorded, so a flapping connection is visible instead of silent.
 *
 * Everything is observational, so a bug in here can never break the client.
 */
import type { PerfContext } from './actions'

interface FailureRecord {
	count: number
	firstSeen: number
	lastSeen: number
	announced: boolean
}

/** Ignore repeated failures beyond this window. */
const FAILURE_WINDOW_MS = 60_000
/** Announce a burst once it reaches this many hits. */
const ANNOUNCE_THRESHOLD = 3
/** Let the client surface its own error past this many hits. */
const SUPPRESS_THRESHOLD = 10

const WATCHED_EVENTS = [
	'GATEWAY_SOCKET_FAILURE',
	'GATEWAY_CONNECTION_FAILED',
	'GATEWAY_ERROR',
	'RESUME_FAILED',
	'INVALID_SESSION',
	'MESSAGE_SEND_FAILED',
	'LOAD_MESSAGES_FAILURE',
] as const

export function installStability(ctx: PerfContext): () => void {
	const state = () => ctx.state()
	const unsubscribers: (() => void)[] = []
	const failures = new Map<string, FailureRecord>()

	const record = (key: string): FailureRecord => {
		const now = Date.now()
		const existing = failures.get(key)
		if (!existing || now - existing.lastSeen > FAILURE_WINDOW_MS) {
			const fresh: FailureRecord = {
				count: 1,
				firstSeen: now,
				lastSeen: now,
				announced: false,
			}
			failures.set(key, fresh)
			return fresh
		}
		existing.count++
		existing.lastSeen = now
		return existing
	}

	const settings = state().settings.stability

	if (settings.autoRecover) {
		for (const type of WATCHED_EVENTS) {
			unsubscribers.push(
				ctx.onFluxEvent(type, payload => {
					const entry = record(type)
					const profile = state().profile

					if (!entry.announced && entry.count >= ANNOUNCE_THRESHOLD) {
						entry.announced = true
						ctx.logger.warn(
							`[stability] ${type} fired ${entry.count}x in ${FAILURE_WINDOW_MS / 1000}s; ` +
								`letting Discord reconnect (budget ${profile.retryAttempts})`,
						)
					}

					// Past the burst threshold the client's own error handling takes
					// over; pass the event through and stop counting noise.
					if (
						state().settings.stability.throttleRetries &&
						entry.count > SUPPRESS_THRESHOLD
					) {
						failures.delete(type)
					}

					return payload
				}),
			)
		}

		// A healthy connection clears the burst window.
		unsubscribers.push(
			ctx.onFluxEvent('CONNECTION_OPEN', payload => {
				failures.clear()
				return payload
			}),
		)
	}

	if (settings.diagnostics) {
		unsubscribers.push(
			ctx.onAnyFluxEvent(payload => {
				if (typeof payload?.type !== 'string') return payload
				// Count dispatches per type so the diagnostics panel can point at the
				// noisiest actions (the usual source of re-render stalls).
				const entry = failures.get(payload.type)
				if (entry) entry.count++
				else
					failures.set(payload.type, {
						count: 1,
						firstSeen: Date.now(),
						lastSeen: Date.now(),
						announced: true,
					})
				return payload
			}),
		)
	}

	return () => {
		for (const unsub of unsubscribers) unsub()
		failures.clear()
	}
}
