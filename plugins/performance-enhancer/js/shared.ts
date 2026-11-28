/**
 * Shared types and defaults for Performance Enhancer.
 *
 * Everything user-facing is stored in one JSON file through `jsonStorage`, so
 * settings survive plugin updates and are readable from every lifecycle stage.
 */

/** Performance profile IDs. `auto` resolves against the detected device tier. */
export type ProfileId = 'auto' | 'battery' | 'balanced' | 'aggressive'

/** Visual style IDs offered by the Style studio. */
export type StyleId = 'off' | 'material' | 'glass' | 'frost' | 'card' | 'custom'

/** UI surfaces a style is allowed to affect. */
export type SurfaceId = 'messages' | 'navigation' | 'input' | 'sheets' | 'images'

/** Bottom-navigation treatment. 'auto' follows the active visual theme. */
export type NavigationStyleId =
	| 'auto'
	| 'default'
	| 'tonal'
	| 'island'
	| 'dock'
	| 'card'
	| 'minimal'

/** Glass morphism intensity presets. */
export type GlassPreset = 'light' | 'medium' | 'heavy'

/** Capability tier inferred from RAM and SoC class. */
export type DeviceTier = 'low' | 'mid' | 'high'

export interface CustomStyle {
	/** Panel color for the `custom` style. */
	panelColor: string
	/** Accent color for the `custom` style. */
	accentColor: string
	/** Corner radius for styled panels. */
	radius: number
	/** 0 = flat color, 1 = maximum frost/transparency. */
	transparency: number
	/** Border strength of styled panels. */
	border: number
	/** Adds saturation to panels instead of the default neutral tint. */
	saturate: boolean
}

export interface VisualSettings {
	style: StyleId
	glass: GlassPreset
	surfaces: Record<SurfaceId, boolean>
	custom: CustomStyle
	/** Registers color themes in the Revenge Themes screen. */
	registerThemes: boolean
	/** Rounds incoming avatar images. */
	roundAvatars: boolean
	/** Shadow/elevation strength of styled panels, 0-100 (50 is the preset value). */
	elevation: number
	/** Raises secondary text contrast for busy backgrounds. */
	contrast: boolean
	/** Draws an accent ring around circular avatars. */
	avatarRing: boolean
	/** Each theme also re-shapes the app (padding, avatar geometry, tracking). */
	themeLayout: boolean
	/** Bottom navigation treatment; 'auto' follows the active theme. */
	navigation: NavigationStyleId
	/** Opacity of the active tab capsule, 0–100. */
	pillStrength: number
	/** Corner radius of floating navigation bars, 0–32. */
	navRadius: number
	/** Skips shadow/elevation work on styled surfaces (low-end GPUs). */
	reduceEffects: boolean
	/** Draws translucent fills solid for readability and GPU savings. */
	reduceTransparency: boolean
}

export interface PerformanceSettings {
	profile: ProfileId
	/** Fired once when the plugin starts, shows a toast with the applied profile. */
	toastOnStart: boolean
}

export interface MemorySettings {
	/** Trims Discord caches once the app goes to the background. */
	trimOnBackground: boolean
	/** Bounds on the amount of cached message channels. */
	maxCachedChannels: number
	/** Clears image disk cache entries above this size (MiB). */
	imageCacheLimitMb: number
	/** Runs the garbage collector after trims when the runtime exposes one. */
	aggressiveGc: boolean
}

export interface StabilitySettings {
	/** Recovers from non-fatal gateway and Flux failures. */
	autoRecover: boolean
	/** Stops plugins that report the same error repeatedly. */
	circuitBreaker: boolean
	/** Suppresses retry storms on flaky networks. */
	throttleRetries: boolean
	/** Logs a heartbeat with memory and format statistics. */
	diagnostics: boolean
}

export interface NetworkSettings {
	/** Blocks telemetry and science dispatches. */
	blockTelemetry: boolean
}

export interface Settings {
	version: number
	performance: PerformanceSettings
	memory: MemorySettings
	stability: StabilitySettings
	network: NetworkSettings
	visual: VisualSettings
	/** Set by the migration in `resolveSettings`. */
	detectedTier?: DeviceTier
}

export const SETTINGS_VERSION = 1

export const DEFAULT_SETTINGS: Settings = {
	version: SETTINGS_VERSION,
	performance: {
		profile: 'auto',
		toastOnStart: true,
	},
	memory: {
		trimOnBackground: true,
		maxCachedChannels: 8,
		imageCacheLimitMb: 48,
		aggressiveGc: true,
	},
	stability: {
		autoRecover: true,
		circuitBreaker: true,
		throttleRetries: true,
		diagnostics: false,
	},
	network: {
		blockTelemetry: true,
	},
	visual: {
		style: 'material',
		glass: 'medium',
		surfaces: {
			messages: true,
			navigation: true,
			input: true,
			sheets: true,
			images: false,
		},
		custom: {
			panelColor: '#1e1f22',
			accentColor: '#5865f2',
			radius: 14,
			transparency: 0.4,
			border: 1,
			saturate: false,
		},
		registerThemes: true,
		roundAvatars: false,
		elevation: 50,
		contrast: false,
		avatarRing: false,
		themeLayout: true,
		navigation: 'auto',
		pillStrength: 60,
		navRadius: 24,
		reduceEffects: false,
		reduceTransparency: false,
	},
}

/** Deep clone helper; settings only contain JSON values. */
export function cloneSettings(settings: Settings): Settings {
	return JSON.parse(JSON.stringify(settings)) as Settings
}

/**
 * Merges persisted settings over the defaults so newly added keys always have
 * a value. Unknown keys from older versions are kept out of the result.
 */
export function resolveSettings(
	input: Partial<Settings> | undefined,
	tier: DeviceTier,
): Settings {
	const base = cloneSettings(DEFAULT_SETTINGS)
	if (!input || typeof input !== 'object') {
		base.detectedTier = tier
		return base
	}

	const merge = (defaults: Record<string, any>, value: unknown): Record<string, any> => {
		if (!value || typeof value !== 'object') return defaults
		const out: Record<string, any> = { ...defaults }
		for (const key of Object.keys(defaults)) {
			const next = (value as Record<string, unknown>)[key]
			if (next === undefined) continue
			const current = defaults[key]
			out[key] =
				current && typeof current === 'object' && !Array.isArray(current)
					? merge(current as Record<string, any>, next)
					: next
		}
		return out
	}

	const merged = merge(base as unknown as Record<string, any>, input) as unknown as Settings
	merged.version = SETTINGS_VERSION
	merged.detectedTier = tier
	// Guard against non-finite numbers coming from hand-edited storage files.
	merged.memory.maxCachedChannels = clampInt(merged.memory.maxCachedChannels, 1, 64, 8)
	merged.memory.imageCacheLimitMb = clampInt(merged.memory.imageCacheLimitMb, 4, 512, 48)
	merged.visual.custom.radius = clampInt(merged.visual.custom.radius, 0, 32, 14)
	merged.visual.custom.transparency = clampNumber(
		merged.visual.custom.transparency,
		0,
		1,
		0.4,
	)
	merged.visual.custom.border = clampNumber(merged.visual.custom.border, 0, 4, 1)
	merged.visual.elevation = clampNumber(merged.visual.elevation, 0, 100, 50)
	merged.visual.navRadius = clampInt(merged.visual.navRadius, 0, 32, 24)
	merged.visual.pillStrength = clampInt(merged.visual.pillStrength, 0, 100, 60)
	return merged
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
	const n = typeof value === 'number' ? value : Number(value)
	if (!Number.isFinite(n)) return fallback
	return Math.min(max, Math.max(min, n))
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
	return Math.round(clampNumber(value, min, max, fallback))
}
