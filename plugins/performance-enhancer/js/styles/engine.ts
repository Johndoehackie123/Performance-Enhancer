/**
 * Style engine.
 *
 * The visual layer is declarative: every style is described by a small token
 * object, and the hooks turn those tokens into React Native styles. Because the
 * values are plain objects, the same tokens can be applied to every surface and
 * previewed in the settings screen without touching Discord's render functions.
 *
 * Styles implemented here:
 *   material  — elevated, tonal panels with crisp 1px outlines (Material 3 feel)
 *   glass     — translucent panes with a hairline border (glassmorphism)
 *   frost     — heavier blur, frosted film and soft shadows (liquid frost)
 *   card      — subtle rounded cards with a flat outline
 *   custom    — user-defined panel/accent colours, radius, transparency, border
 */
import type { DeviceTier, GlassPreset, StyleId, SurfaceId, VisualSettings } from '../shared'

export interface StyleTokens {
	/** Panel background, RGBA string. */
	background: string
	/** Border colour, RGBA string. */
	borderColor: string
	/** Border width in dp. */
	borderWidth: number
	/** Corner radius in dp. */
	radius: number
	/** Shadow specification; omitted for flat styles. */
	shadow?: {
		color: string
		opacity: number
		radius: number
		offsetY: number
		elevation: number
	}
	/** Recommended background blur radius, where the runtime supports it. */
	blur: number
	/** Accent used for interactive elements, rings and highlights. */
	accent: string
	/** Tint used for media cards and attachment surfaces. */
	media: string
	/* --- Tonal scale derived from the panel & accent (all UI surfaces) --- */
	/** Chat/content background. */
	base: string
	/** Secondary background (sidebars, trays). */
	lowest: string
	/** Deepest background tier. */
	lowestDeep: string
	/** Raised surface (cards, sheets, inputs). */
	elevated: string
	/** Hover/pressed tier. */
	hover: string
	/** Primary readable text colour. */
	text: string
	/** Secondary, de-emphasised text colour. */
	muted: string
	/** Darker accent, for pressed states and borders. */
	accentSoft: string
	/** Low-alpha accent, for selection tints and on-track switches. */
	accentTint: string
	/** Strong-alpha accent, for on-track switches. */
	accentTintStrong: string
}

export interface StylePresetMeta {
	id: StyleId
	label: string
	description: string
	/** Glass preset applied when this style is selected. */
	glass: GlassPreset
}

export const STYLE_PRESETS: StylePresetMeta[] = [
	{
		id: 'off',
		label: 'Discord default',
		description: 'No styling. Switch this on to quickly compare against stock Discord.',
		glass: 'light',
	},
	{
		id: 'material',
		label: 'Material',
		description:
			'Tonal elevated surfaces, crisp outlines and an indigo accent in the spirit of Material 3.',
		glass: 'light',
	},
	{
		id: 'glass',
		label: 'Glassmorphism',
		description:
			'Translucent frosted panes with a hairline highlight, layered over the chat background.',
		glass: 'medium',
	},
	{
		id: 'frost',
		label: 'Liquid frost',
		description:
			'Heavier blur, a milky film and a soft interior glow for a cool, frosted look.',
		glass: 'heavy',
	},
	{
		id: 'card',
		label: 'Soft cards',
		description: 'Rounded, low-contrast cards with a flat outline and a gentle shadow.',
		glass: 'light',
	},
	{
		id: 'custom',
		label: 'Custom',
		description: 'Your own colours, radius, transparency and border strength.',
		glass: 'medium',
	},
]

export const GLASS_PRESETS: { id: GlassPreset; label: string; description: string }[] = [
	{ id: 'light', label: 'Light', description: 'A thin frosted layer with a subtle tint.' },
	{
		id: 'medium',
		label: 'Medium',
		description: 'Balanced transparency for readable text over the chat.',
	},
	{
		id: 'heavy',
		label: 'Heavy',
		description: 'Maximum frost, ideal for bright wallpapers and liquid-frost looks.',
	},
]

export const SURFACES: { id: SurfaceId; label: string; description: string }[] = [
	{
		id: 'messages',
		label: 'Message rows',
		description: 'Panels behind message groups in chat.',
	},
	{
		id: 'navigation',
		label: 'Navigation bar',
		description: 'The bottom tab bar and header bars.',
	},
	{
		id: 'input',
		label: 'Message input',
		description: 'The composer and attachment tray.',
	},
	{
		id: 'sheets',
		label: 'Sheets and modals',
		description: 'Action sheets, alerts and settings panes.',
	},
	{
		id: 'images',
		label: 'Media cards',
		description: 'Embeds, attachments and image cards.',
	},
]

/** Discord component names the styling layer looks for, per surface. */
export const SURFACE_COMPONENT_HINTS: Record<SurfaceId, string[]> = {
	messages: ['MessageContent', 'ChatMessageContent', 'MessageRow', 'MessageGroup'],
	navigation: ['MainTabBar', 'TabBar', 'BottomTabBar', 'NavigationBar', 'NavigatorHeader'],
	input: ['ChatInput', 'ChatInputRoot', 'MessageInput', 'ChatInputContainer'],
	sheets: ['ActionSheet', 'ActionSheetContent', 'BottomSheet', 'BottomSheetContent'],
	images: ['MediaItem', 'EmbedImage', 'AttachmentImage', 'MessageImage'],
}

export const AVATAR_COMPONENT_HINTS = ['Avatar', 'UserAvatar', 'RoundAvatar']

export function isDarkColor(hex: string): boolean {
	const value = hex.replace('#', '')
	if (value.length < 6) return true
	const r = Number.parseInt(value.slice(0, 2), 16)
	const g = Number.parseInt(value.slice(2, 4), 16)
	const b = Number.parseInt(value.slice(4, 6), 16)
	return r * 0.299 + g * 0.587 + b * 0.114 < 140
}

/** Appends (or replaces) an alpha channel on a `#RRGGBB` colour. */
export function withAlpha(hex: string, alpha: number): string {
	const value = hex.replace('#', '').padEnd(6, '0').slice(0, 6)
	const a = Math.round(Math.min(1, Math.max(0, alpha)) * 255)
		.toString(16)
		.padStart(2, '0')
	return `#${value}${a}`
}

/** Mixes two hex/rgba colours channel-wise. `amount` < 0 darkens, > 0 lightens. */
export function shade(hex: string, amount: number): string {
	const value = hex.replace('#', '')
	if (value.length < 6) return hex
	const target = amount < 0 ? 0 : 255
	const p = Math.min(1, Math.abs(amount) / 100)
	const mix = (channel: number) => Math.round(channel + (target - channel) * p)
	const r = mix(Number.parseInt(value.slice(0, 2), 16))
	const g = mix(Number.parseInt(value.slice(2, 4), 16))
	const b = mix(Number.parseInt(value.slice(4, 6), 16))
	return `#${[r, g, b].map(c => c.toString(16).padStart(2, '0')).join('')}`
}

export interface TonalScale {
	base: string
	lowest: string
	lowestDeep: string
	elevated: string
	hover: string
	text: string
	muted: string
	accent: string
	accentSoft: string
	accentTint: string
	accentTintStrong: string
}

/** Derives a coherent tonal scale from the panel & accent colours. */
export function buildTonalScale(panel: string, accent: string, text: string): TonalScale {
	const dark = isDarkColor(panel)
	return {
		base: shade(panel, dark ? -6 : -3),
		lowest: shade(panel, dark ? -18 : -7),
		hover: shade(panel, dark ? 10 : 5),
		elevated: shade(panel, dark ? 14 : 6),
		lowestDeep: shade(panel, dark ? -32 : -12),
		text,
		muted: withAlpha(text, 0.64),
		accent,
		accentSoft: shade(accent, dark ? -22 : -12),
		accentTint: withAlpha(accent, 0.16),
		accentTintStrong: withAlpha(accent, 0.5),
	}
}

/**
 * Substitution table from Discord's structural palette to the active scale.
 *
 * Anchoring to exact hex values (both the modern and the legacy palettes)
 * means recolouring can never repaint content it shouldn't — only the
 * background/border/text colours Discord itself uses for its furniture.
 */
export function buildRecolorTable(scale: TonalScale | StyleTokens): Map<string, string> {
	const dark: [string, string][] = [
		// Modern dark theme
		['#313338', scale.base],
		['#2b2d31', scale.lowest],
		['#1e1f22', scale.lowestDeep],
		['#111214', scale.lowestDeep],
		['#232428', scale.lowest],
		['#26272d', scale.lowest],
		['#2e3035', scale.elevated],
		['#383a40', scale.hover],
		['#404249', scale.hover],
		// Legacy dark theme
		['#36393f', scale.lowest],
		['#2f3136', scale.lowest],
		['#202225', scale.lowestDeep],
		['#18191c', scale.lowestDeep],
		['#242629', scale.elevated],
		// Text
		['#f2f3f5', scale.text],
		['#dbdee1', scale.text],
		['#e3e5e8', scale.text],
		['#b5bac1', scale.muted],
		['#949ba4', scale.muted],
		['#80848e', scale.muted],
		['#87898c', scale.muted],
		['#96989d', scale.muted],
		// Blurple family → the active accent
		['#5865f2', scale.accent],
		['#4752c4', scale.accentSoft],
		['#3c45a5', scale.accentSoft],
		['#7289da', scale.accent],
		['#677bc4', scale.accent],
		['#5b6eae', scale.accentSoft],
	]
	return new Map(dark)
}

const RECOLOR_KEYS = new Set([
	'backgroundColor',
	'background',
	'borderColor',
	'borderTopColor',
	'borderBottomColor',
	'borderLeftColor',
	'borderRightColor',
	'borderStartColor',
	'borderEndColor',
	'color',
	'shadowColor',
	'textShadowColor',
	'textDecorationColor',
	'overlayColor',
	'outlineColor',
	'borderBlockColor',
])

function normaliseColor(value: unknown): string | undefined {
	if (typeof value !== 'string') return undefined
	const trimmed = value.trim().toLowerCase()
	if (trimmed.startsWith('#')) {
		// Expand #rgb/#rgba so lookup is uniform.
		if (trimmed.length === 4) {
			return `#${trimmed[1]}${trimmed[1]}${trimmed[2]}${trimmed[2]}${trimmed[3]}${trimmed[3]}`
		}
		if (trimmed.length === 5) {
			return `#${trimmed[1]}${trimmed[1]}${trimmed[2]}${trimmed[2]}${trimmed[3]}${trimmed[3]}`
		}
		if (trimmed.length === 9) return trimmed.slice(0, 7)
		return trimmed
	}
	return undefined
}

/**
 * Memoised, tolerant walker for React Native style values.
 *
 * Handles objects and arbitrarily nested arrays of objects; registered style
 * numbers and anything unexpected passes through untouched. Returns the same
 * reference when nothing changed so callers can skip re-rendering.
 */
export function recolorStyleValue(
	value: unknown,
	table: Map<string, string>,
	cache = new Map<object, unknown>(),
	depth = 0,
): unknown {
	if (depth > 8) return value
	if (!value || typeof value !== 'object') return value
	if (cache.has(value as object)) return cache.get(value as object)

	let result: unknown = value
	if (Array.isArray(value)) {
		let changed = false
		const next = new Array(value.length)
		for (let i = 0; i < value.length; i++) {
			const child = recolorStyleValue(value[i], table, cache, depth + 1)
			next[i] = child
			if (child !== value[i]) changed = true
		}
		if (changed) result = next
	} else {
		const record = value as Record<string, unknown>
		let patch: Record<string, unknown> | undefined
		for (const key of Object.keys(record)) {
			if (!RECOLOR_KEYS.has(key)) continue
			const normal = normaliseColor(record[key])
			const replacement = normal ? table.get(normal) : undefined
			if (replacement) {
				if (!patch) patch = { ...record }
				patch[key] = replacement
			}
		}
		if (patch) result = patch
	}

	if (cache.size > 512) cache.clear()
	cache.set(value as object, result)
	return result
}

function panelFor(visual: VisualSettings): { panel: string; accent: string; text: string } {
	const custom = visual.style === 'custom'
	const panel = custom ? visual.custom.panelColor : '#1e1f22'
	const accent = custom ? visual.custom.accentColor : '#5865f2'
	return { panel, accent, text: isDarkColor(panel) ? '#f2f3f5' : '#060607' }
}

function glassAlpha(preset: GlassPreset): number {
	switch (preset) {
		case 'light':
			return 0.72
		case 'heavy':
			return 0.42
		default:
			return 0.58
	}
}

function blurFor(preset: GlassPreset, tier: DeviceTier): number {
	// Low-end devices skip backdrop blur entirely: it is the most expensive
	// effect we can ask the compositor for.
	if (tier === 'low') return 0
	return preset === 'heavy' ? 24 : preset === 'light' ? 8 : 16
}

const OFF_TOKENS: StyleTokens = {
	background: 'transparent',
	borderColor: 'transparent',
	borderWidth: 0,
	radius: 0,
	blur: 0,
	accent: '#5865f2',
	media: 'transparent',
	base: '#313338',
	lowest: '#2b2d31',
	lowestDeep: '#1e1f22',
	elevated: '#2e3035',
	hover: '#383a40',
	text: '#f2f3f5',
	muted: 'rgba(242,243,245,0.64)',
	accentSoft: '#4752c4',
	accentTint: 'rgba(88,101,242,0.16)',
	accentTintStrong: 'rgba(88,101,242,0.5)',
}

/** Builds the style tokens for a visual configuration. Pure and cheap. */
function computeTokens(visual: VisualSettings, tier: DeviceTier): StyleTokens {
	if (visual.style === 'off') return OFF_TOKENS

	const { panel, accent, text } = panelFor(visual)
	const custom = visual.custom
	const radius = visual.style === 'custom' ? custom.radius : visual.style === 'card' ? 18 : 14
	const media = withAlpha(panel, 0.75)
	const scale = buildTonalScale(panel, accent, text)

	switch (visual.style) {
		case 'material':
			return {
				...scale,
				background: withAlpha(panel, 0.96),
				borderColor: withAlpha('#938f99', 0.24),
				borderWidth: 1,
				radius,
				shadow: {
					color: '#000000',
					opacity: 0.28,
					radius: 10,
					offsetY: 4,
					elevation: tier === 'low' ? 0 : 4,
				},
				blur: 0,
				accent,
				media,
			}
		case 'glass':
			return {
				...scale,
				background: withAlpha(panel, glassAlpha(visual.glass)),
				borderColor: isDarkColor(panel) ? 'rgba(255,255,255,0.22)' : 'rgba(0,0,0,0.12)',
				borderWidth: 1,
				radius: radius + 2,
				shadow: {
					color: '#000000',
					opacity: 0.18,
					radius: 16,
					offsetY: 6,
					elevation: tier === 'low' ? 0 : 6,
				},
				blur: blurFor(visual.glass, tier),
				accent,
				media,
			}
		case 'frost':
			return {
				...scale,
				background: withAlpha(panel, glassAlpha(visual.glass) * 0.86),
				borderColor: isDarkColor(panel) ? 'rgba(255,255,255,0.34)' : 'rgba(0,0,0,0.16)',
				borderWidth: 1,
				radius: radius + 4,
				shadow: {
					color: '#0b1020',
					opacity: 0.24,
					radius: 26,
					offsetY: 10,
					elevation: tier === 'low' ? 0 : 8,
				},
				blur: blurFor('heavy', tier),
				accent,
				media,
			}
		case 'card':
			return {
				...scale,
				background: withAlpha(panel, 0.88),
				borderColor: withAlpha(text, 0.12),
				borderWidth: 1,
				radius,
				shadow: {
					color: '#000000',
					opacity: 0.12,
					radius: 6,
					offsetY: 2,
					elevation: tier === 'low' ? 0 : 2,
				},
				blur: 0,
				accent,
				media,
			}
		case 'custom':
			return {
				...scale,
				background: withAlpha(panel, 1 - custom.transparency),
				borderColor: withAlpha(accent, 0.35),
				borderWidth: custom.border,
				radius,
				shadow:
					custom.transparency > 0.15
						? {
								color: '#000000',
								opacity: 0.22,
								radius: 18,
								offsetY: 6,
								elevation: tier === 'low' ? 0 : 6,
							}
						: undefined,
				blur: tier === 'low' ? 0 : Math.round(custom.transparency * 24),
				accent,
				media,
			}
	}
}

const tokenCache = new WeakMap<VisualSettings, Map<DeviceTier, StyleTokens>>()

/**
 * Memoised token builder.
 *
 * The settings store hands out the same `visual` object between edits, so the
 * cache hits on every element render; a new object is built only when the
 * user actually changes something.
 */
export function buildTokens(visual: VisualSettings, tier: DeviceTier): StyleTokens {
	let byTier = tokenCache.get(visual)
	const cached = byTier?.get(tier)
	if (cached) return cached
	const tokens = computeTokens(visual, tier)
	if (!byTier) {
		byTier = new Map()
		tokenCache.set(visual, byTier)
	}
	byTier.set(tier, tokens)
	return tokens
}

/** React Native panel style for a surface. Returns `undefined` when off. */
export function buildPanelStyle(tokens: StyleTokens) {
	if (tokens.radius === 0 && tokens.background === 'transparent') return undefined
	return {
		backgroundColor: tokens.background,
		borderRadius: tokens.radius,
		borderWidth: tokens.borderWidth,
		borderColor: tokens.borderColor,
		...(tokens.shadow
			? {
					elevation: tokens.shadow.elevation,
					shadowColor: tokens.shadow.color,
					shadowOpacity: tokens.shadow.opacity,
					shadowRadius: tokens.shadow.radius,
					shadowOffset: { width: 0, height: tokens.shadow.offsetY },
				}
			: {}),
	}
}

/** Media surfaces get a lighter tint so images keep their contrast. */
export function buildMediaStyle(tokens: StyleTokens) {
	if (tokens.radius === 0) return undefined
	return {
		backgroundColor: tokens.media,
		borderRadius: tokens.radius,
		borderWidth: tokens.borderWidth,
		borderColor: tokens.borderColor,
		overflow: 'hidden' as const,
	}
}

/** Round avatar style, used when `roundAvatars` is enabled. */
export const ROUND_AVATAR_STYLE = { borderRadius: 9999 }

/** A compact description used by the settings preview card. */
export function describeStyle(visual: VisualSettings): string {
	const preset = STYLE_PRESETS.find(style => style.id === visual.style)
	if (!preset) return ''
	if (visual.style === 'off') return preset.description
	return `${preset.label} · ${visual.glass} frost`
}
