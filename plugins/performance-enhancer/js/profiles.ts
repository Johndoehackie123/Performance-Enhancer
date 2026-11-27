/**
 * Performance profiles.
 *
 * A profile is a set of concrete knobs derived from the user's chosen profile
 * and the detected device tier. Nothing in here touches Discord; modules that
 * apply the values import the type and read from the store.
 */
import type { DeviceInfo } from './device'
import type { ProfileId } from './shared'

export interface Profile {
	id: Exclude<ProfileId, 'auto'>
	label: string
	description: string
	/**
	 * Fraction of `ImageComponent` fetches that keep their prefetch priority.
	 * Lower values mean fewer eager decodes for off-screen media.
	 */
	imagePrefetchRatio: number
	/** Whether animated emoji/stickers keep animating without interaction. */
	animateMedia: boolean
	/** Maximum channels allowed in the message cache. */
	cacheChannels: number
	/** Minimum delay between background cache trims (ms). */
	trimIntervalMs: number
	/** Whether the garbage collector is invoked after trims. */
	collectGarbage: boolean
	/** Retry attempts for failed gateway/flux operations before surfacing an error. */
	retryAttempts: number
	/** Whether non-critical analytics dispatches are dropped. */
	dropTelemetry: boolean
}

export const PROFILES: Record<Exclude<ProfileId, 'auto'>, Profile> = {
	battery: {
		id: 'battery',
		label: 'Battery saver',
		description:
			'Squeezes the most runtime out of the device: minimal media decoding, a small cache and no background collection.',
		imagePrefetchRatio: 0,
		animateMedia: false,
		cacheChannels: 3,
		trimIntervalMs: 90_000,
		collectGarbage: false,
		retryAttempts: 2,
		dropTelemetry: true,
	},
	balanced: {
		id: 'balanced',
		label: 'Balanced',
		description:
			'Smooth scrolling and normal animations, with caches sized so mid-range phones stay responsive.',
		imagePrefetchRatio: 0.5,
		animateMedia: true,
		cacheChannels: 8,
		trimIntervalMs: 45_000,
		collectGarbage: true,
		retryAttempts: 3,
		dropTelemetry: true,
	},
	aggressive: {
		id: 'aggressive',
		label: 'Performance',
		description:
			'Prefetches aggressively and keeps a large cache. Best on 8 GB+ flagship devices.',
		imagePrefetchRatio: 1,
		animateMedia: true,
		cacheChannels: 16,
		trimIntervalMs: 20_000,
		collectGarbage: true,
		retryAttempts: 4,
		dropTelemetry: true,
	},
}

const TIER_DEFAULT_PROFILE: Record<DeviceInfo['tier'], Exclude<ProfileId, 'auto'>> = {
	low: 'battery',
	mid: 'balanced',
	high: 'aggressive',
}

/** Resolves `auto` to the tier default and returns the concrete profile. */
export function resolveProfile(profile: ProfileId, device: DeviceInfo): Profile {
	const id = profile === 'auto' ? TIER_DEFAULT_PROFILE[device.tier] : profile
	return PROFILES[id]
}

/** The profile `auto` would pick on this device; used by the settings UI. */
export function autoProfileFor(device: DeviceInfo): Profile {
	return PROFILES[TIER_DEFAULT_PROFILE[device.tier]]
}
