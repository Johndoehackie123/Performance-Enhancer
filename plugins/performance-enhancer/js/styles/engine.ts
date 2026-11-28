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
import type { DeviceTier, GlassPreset, NavigationStyleId, StyleId, SurfaceId, VisualSettings } from '../shared'

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
	/* --- Layout language of the active theme (internal-only effects) --- */
	/** Vertical padding added inside styled surfaces. */
	paddingV: number
	/** Horizontal padding added inside styled surfaces. */
	paddingH: number
	/** Corner radius applied to avatar containers (9999 = circle). */
	avatarRadius: number
	/** Letter tracking applied to text (0 = Discord default). */
	letterSpacing: number
	/* --- Navigation treatment (bottom tab bar) --- */
	/** Resolved navigation style — 'auto' is already mapped to a concrete one. */
	navigation: 'default' | 'tonal' | 'island' | 'dock' | 'card' | 'minimal'
	/** Corner radius of floating navigation bars. */
	navRadius: number
	/** Opacity of the active tab capsule, 0–100. */
	pillStrength: number
	/** Skips shadow/elevation work on styled surfaces. */
	reduceEffects: boolean
	/** Draws translucent fills solid. */
	reduceTransparency: boolean
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
	navigation: ['MainTabBar', 'TabBar', 'BottomTabBar', 'NavigationBar', 'NavigatorHeader', 'TabBarItem', 'BottomTabItem'],
	input: ['ChatInput', 'ChatInputRoot', 'MessageInput', 'ChatInputContainer'],
	sheets: ['ActionSheet', 'ActionSheetContent', 'BottomSheet', 'BottomSheetContent'],
	images: ['MediaItem', 'EmbedImage', 'AttachmentImage', 'MessageImage'],
}

/** Names Discord's text components typically carry, for the modern runtime. */
export const TEXT_COMPONENT_HINTS = ['Text'] as const

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

/** Channel-wise lerp between two hex colours. `amount` is the share of `b`. */
export function mixColors(a: string, b: string, amount: number): string {
	const parse = (hex: string, fallback: [number, number, number]) => {
		const value = hex.replace('#', '').padEnd(6, '0').slice(0, 6)
		if (!/^[0-9a-fA-F]{6}$/.test(value)) return fallback
		return [
			Number.parseInt(value.slice(0, 2), 16),
			Number.parseInt(value.slice(2, 4), 16),
			Number.parseInt(value.slice(4, 6), 16),
		] as [number, number, number]
	}
	const [ra, ga, ba] = parse(a, [0, 0, 0])
	const [rb, gb, bb] = parse(b, [0, 0, 0])
	const p = Math.min(1, Math.max(0, amount))
	const mix = (x: number, y: number) => Math.round(x + (y - x) * p)
	const r = mix(ra, rb)
	const g = mix(ga, gb)
	const b2 = mix(ba, bb)
	return `#${[r, g, b2].map(c => c.toString(16).padStart(2, '0')).join('')}`
}

/**
 * The layout language of each theme: corner family, inset spacing, avatar
 * geometry and text tracking.
 *
 * Only internal, non-flexing properties are ever applied (padding on styled
 * surfaces, avatar corner radius, letter tracking), so a theme can never
 * break scrolling, insets or flex flow. Layout mirrors the source design
 * languages: Material 3's shape scale, glassmorphism's panes, Liquid Glass's
 * detached capsules and visionOS spacing, and the tighter soft-card grid.
 */
export const THEME_LAYOUTS: Record<
	StyleId,
	{ paddingV: number; paddingH: number; avatarRadius: number; letterSpacing: number }
> = {
	off: { paddingV: 0, paddingH: 0, avatarRadius: 9999, letterSpacing: 0 },
	// M3 shape scale: medium 12dp containers, comfortable tap density.
	material: { paddingV: 4, paddingH: 10, avatarRadius: 9999, letterSpacing: 0 },
	// Glassmorphism: generous insets, never-cramped panes.
	glass: { paddingV: 7, paddingH: 13, avatarRadius: 9999, letterSpacing: 0.1 },
	// Liquid Glass (iOS 26): detached breathing room, softly wide tracking.
	frost: { paddingV: 9, paddingH: 15, avatarRadius: 9999, letterSpacing: 0.3 },
	// Soft cards: chunky card padding; squircle avatars echo the geometry.
	card: { paddingV: 9, paddingH: 13, avatarRadius: 11, letterSpacing: 0.1 },
	// Custom: user-shaped radius, neutral spacing.
	custom: { paddingV: 7, paddingH: 12, avatarRadius: 9999, letterSpacing: 0 },
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

export interface TonalOptions {
	/** Stronger de-emphasised text, for busy backdrops. */
	highContrast?: boolean
	/** Material 3 style tonal elevation: raised tiers take on the accent hue. */
	tonal?: boolean
}

/** Derives a coherent tonal scale from the panel & accent colours. */
export function buildTonalScale(
	panel: string,
	accent: string,
	text: string,
	options: TonalOptions = {},
): TonalScale {
	const dark = isDarkColor(panel)
	const { highContrast = false, tonal = false } = options
	// Material 3 elevation ladder: raised tiers are tinted toward the primary
	// at increasing opacity (5% / 8% / 11% ≈ tones L1/L2/L3), not just lightened.
	const raised = (lift: number, accentShare: number) =>
		tonal ? mixColors(panel, accent, accentShare) : shade(panel, dark ? lift : lift / 2)
	return {
		base: shade(panel, dark ? -6 : -3),
		lowest: shade(panel, dark ? -18 : -7),
		hover: raised(10, 0.12),
		elevated: raised(14, 0.09),
		lowestDeep: shade(panel, dark ? -32 : -12),
		text,
		muted: withAlpha(text, highContrast ? 0.78 : 0.64),
		accent,
		accentSoft: shade(accent, dark ? -22 : -12),
		accentTint: withAlpha(accent, 0.16),
		accentTintStrong: withAlpha(accent, 0.5),
	}
}

interface ShadowSpec {
	color: string
	opacity: number
	radius: number
	offsetY: number
	elevation: number
}

/**
 * Scales a shadow by the user's elevation control.
 *
 * `elevation` 0 removes the shadow entirely (flat / low-power look), 50 keeps
 * the preset value and 100 roughly doubles the opacity and height.
 */
export function scaleShadow<T extends ShadowSpec | undefined>(shadow: T, elevation: number): T {
	if (!shadow) return shadow
	const strength = Math.min(100, Math.max(0, elevation)) / 50
	if (strength <= 0) return undefined as T
	const clamp = (value: number, min: number, max: number) =>
		Math.min(max, Math.max(min, value))
	return {
		...shadow,
		opacity: clamp(shadow.opacity * strength, 0, 0.85),
		radius: Math.round(shadow.radius * (0.55 + 0.45 * strength)),
		offsetY: Math.round(shadow.offsetY * strength),
		elevation: Math.round(shadow.elevation * strength),
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

type RawTokens = Omit<
	StyleTokens,
	'navigation' | 'navRadius' | 'pillStrength' | 'reduceEffects' | 'reduceTransparency'
>

const OFF_TOKENS: RawTokens = {
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
	paddingV: 0,
	paddingH: 0,
	avatarRadius: 9999,
	letterSpacing: 0,
}

/** Strips the alpha channel from a 9-character `#rrggbbaa` colour. */
function solidifyColor(color: string): string {
	if (color.startsWith('#') && color.length === 9) return color.slice(0, 7)
	return color
}

/**
 * Maps the navigation choice onto the concrete navigation kind for a theme.
 * 'auto' follows the visual theme, per the researched design languages:
 * Material 3 ships an edge bar with an active tonal pill, glassmorphism /
 * Liquid Glass ship a floating translucent dock, soft cards ship a chunky
 * card container and everything else gets a quiet hairline edge bar.
 */
export function resolveNavigationStyle(
	navigation: NavigationStyleId,
	style: StyleId,
): 'default' | 'tonal' | 'island' | 'dock' | 'card' | 'minimal' {
	if (navigation !== 'auto') return navigation
	switch (style) {
		case 'material':
			return 'tonal'
		case 'glass':
		case 'frost':
			return 'dock'
		case 'card':
			return 'card'
		case 'custom':
		case 'off':
		default:
			return 'minimal'
	}
}

/** Adds `rgba(...)` syntax around an `#rrggbb` colour. */
export function hexToRgba(hex: string, alpha: number): string {
	const value = hex.replace('#', '').padEnd(6, '0').slice(0, 6)
	const r = Number.parseInt(value.slice(0, 2), 16)
	const g = Number.parseInt(value.slice(2, 4), 16)
	const b = Number.parseInt(value.slice(4, 6), 16)
	if (![r, g, b].every(n => Number.isFinite(n))) return hex
	return `rgba(${r}, ${g}, ${b}, ${Math.min(1, Math.max(0, alpha))})`
}

/**
 * Classifies an element as the navigation *bar* or a navigation *tab item*.
 *
 * The two must never receive each other's treatment: floating bars detach
 * with margins, tab items must stay flex-sized or the bar's layout breaks.
 * Detection works off the component name, the RN tab role and navigator
 * props, because RN's accessibility tree is the only cross-build signal the
 * JSX hooks receive.
 */
export function navigationKind(
	typeName: string,
	props?: Record<string, unknown> | null,
): 'bar' | 'item' | undefined {
	const t = typeName || ''
	const role = props?.accessibilityRole
	const state = props?.accessibilityState as { selected?: boolean; checked?: boolean } | undefined
	const selected = !!state && (state.selected === true || state.checked === true)
	// Tab items first: explicit tab role, *Item names in a nav context, or a
	// selected element whose name mentions tabs. Host touchables carrying a
	// selected state are almost always tab-like controls too — give them the
	// capsule; the worst case is an accent pill on a pressed control.
	if (role === 'tab') return 'item'
	if (/item/i.test(t) && /tab|navigation|nav/i.test(t)) return 'item'
	if (selected && /tab/i.test(t)) return 'item'
	if (selected && /^(Pressable|TouchableOpacity|TouchableHighlight|TouchableWithoutFeedback|Touchable)/.test(t)) return 'item'
	// The bar itself: container names and navigator props.
	if (/tabbar|bottomtab|navigationbar|navigatorheader|maintabbar|toptabs/i.test(t)) return 'bar'
	if (props) {
		if (['tabBar', 'bottomTabBar', 'focused'].some(key => key in props)) return 'bar'
		if ('header' in props && /nav/i.test(t)) return 'bar'
		if ('tabIndex' in props) return 'bar'
	}
	return undefined
}

/** The selectable navigation treatments, in picker order. */
export const NAVIGATION_STYLES: { id: NavigationStyleId; label: string; description: string }[] = [
	{ id: 'auto', label: 'Auto', description: 'Follows the visual theme.' },
	{ id: 'default', label: 'Discord default', description: 'The stock bottom tab bar, untouched.' },
	{ id: 'tonal', label: 'Tonal Pill', description: 'Material 3 edge bar with a filled tonal active indicator.' },
	{ id: 'island', label: 'Floating Island', description: 'Liquid Glass detached floating capsule.' },
	{ id: 'dock', label: 'Glass Dock', description: 'iOS-style translucent floating dock.' },
	{ id: 'card', label: 'Card Bar', description: 'Chunky soft-card container with a card capsule.' },
	{ id: 'minimal', label: 'Minimal Line', description: 'Hairline edge bar; active tab shown by accent tint.' },
]

const clamp0_100 = (n: unknown, fallback: number) => {
	const value = typeof n === 'number' && Number.isFinite(n) ? n : fallback
	return Math.min(100, Math.max(0, Math.round(value)))
}
const clamp0_32 = (n: unknown, fallback: number) => {
	const value = typeof n === 'number' && Number.isFinite(n) ? n : fallback
	return Math.min(32, Math.max(0, Math.round(value)))
}

/** Builds the raw style tokens for a visual configuration. Pure and cheap. */
function computeTokensRaw(visual: VisualSettings, tier: DeviceTier): RawTokens {
	if (visual.style === 'off') return OFF_TOKENS

	const base = panelFor(visual)
	const custom = visual.custom
	// "Saturate highlights": tint the custom panel toward the accent hue
	// instead of leaving it neutral, per the glassmorphism saturate() guidance.
	const panel =
		visual.style === 'custom' && custom.saturate
			? mixColors(base.panel, base.accent, 0.18)
			: base.panel
	const accent = base.accent
	const text = visual.contrast
		? isDarkColor(panel)
			? '#ffffff'
			: '#000000'
		: base.text
	const radius =
		visual.style === 'custom' ? custom.radius : visual.style === 'card' ? 18 : visual.style === 'frost' ? 22 : visual.style === 'glass' ? 18 : visual.style === 'material' ? 16 : 14
	const media = withAlpha(panel, 0.75)
	const scale = buildTonalScale(panel, accent, text, {
		highContrast: visual.contrast,
		tonal: visual.style === 'material',
	})
	const layout = visual.themeLayout !== false ? THEME_LAYOUTS[visual.style] : THEME_LAYOUTS.off

	switch (visual.style) {
		case 'material':
			return {
				...scale,
				...layout,
				background: withAlpha(panel, 0.96),
				borderColor: withAlpha('#938f99', 0.24),
				borderWidth: 1,
				radius,
				shadow: scaleShadow(
					{
						color: '#000000',
						opacity: 0.28,
						radius: 10,
						offsetY: 4,
						elevation: tier === 'low' ? 0 : 4,
					},
					visual.elevation,
				),
				blur: 0,
				accent,
				media,
			}
		case 'glass':
			return {
				...scale,
				...layout,
				background: withAlpha(panel, glassAlpha(visual.glass)),
				borderColor: isDarkColor(panel) ? 'rgba(255,255,255,0.22)' : 'rgba(0,0,0,0.12)',
				borderWidth: 1,
				radius,
				shadow: scaleShadow(
					{
						color: '#000000',
						opacity: 0.18,
						radius: 16,
						offsetY: 6,
						elevation: tier === 'low' ? 0 : 6,
					},
					visual.elevation,
				),
				blur: blurFor(visual.glass, tier),
				accent,
				media,
			}
		case 'frost':
			return {
				...scale,
				...layout,
				background: withAlpha(panel, glassAlpha(visual.glass) * 0.86),
				borderColor: isDarkColor(panel) ? 'rgba(255,255,255,0.34)' : 'rgba(0,0,0,0.16)',
				borderWidth: 1,
				radius,
				shadow: scaleShadow(
					{
						color: '#0b1020',
						opacity: 0.24,
						radius: 26,
						offsetY: 10,
						elevation: tier === 'low' ? 0 : 8,
					},
					visual.elevation,
				),
				blur: blurFor('heavy', tier),
				accent,
				media,
			}
		case 'card':
			return {
				...scale,
				...layout,
				background: withAlpha(panel, 0.88),
				borderColor: withAlpha(text, 0.12),
				borderWidth: 1,
				radius,
				shadow: scaleShadow(
					{
						color: '#000000',
						opacity: 0.12,
						radius: 6,
						offsetY: 2,
						elevation: tier === 'low' ? 0 : 2,
					},
					visual.elevation,
				),
				blur: 0,
				accent,
				media,
			}
		case 'custom':
			return {
				...scale,
				...layout,
				background: withAlpha(panel, 1 - custom.transparency),
				borderColor: withAlpha(accent, 0.35),
				borderWidth: custom.border,
				radius,
				shadow:
					custom.transparency > 0.15
						? scaleShadow(
								{
									color: '#000000',
									opacity: 0.22,
									radius: 18,
									offsetY: 6,
									elevation: tier === 'low' ? 0 : 6,
								},
								visual.elevation,
							)
						: undefined,
				blur: tier === 'low' ? 0 : Math.round(custom.transparency * 24),
				accent,
				media,
			}
	}
}

/**
 * Applies the cross-theme flags on top of a freshly built token set:
 * navigation resolution, effect reduction and transparency reduction.
 */
function computeTokens(visual: VisualSettings, tier: DeviceTier): StyleTokens {
	const raw = computeTokensRaw(visual, tier)
	const reduceTransparency = visual.reduceTransparency === true
	const reduceEffects = visual.reduceEffects === true || tier === 'low'
	const solid = (color: string) => (reduceTransparency ? solidifyColor(color) : color)
	return {
		...raw,
		background: solid(raw.background),
		media: solid(raw.media),
		base: solid(raw.base),
		lowest: solid(raw.lowest),
		lowestDeep: solid(raw.lowestDeep),
		elevated: solid(raw.elevated),
		hover: solid(raw.hover),
		shadow: reduceEffects ? undefined : raw.shadow,
		blur: reduceEffects ? 0 : raw.blur,
		navigation: resolveNavigationStyle(visual.navigation ?? 'auto', visual.style),
		navRadius: clamp0_32(visual.navRadius, 24),
		pillStrength: clamp0_100(visual.pillStrength, 60),
		reduceEffects,
		reduceTransparency,
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
		...(tokens.paddingV > 0 ? { paddingVertical: tokens.paddingV } : {}),
		...(tokens.paddingH > 0 ? { paddingHorizontal: tokens.paddingH } : {}),
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

/**
 * Bottom navigation bar, per the resolved navigation style.
 *
 * Floating treatments detach horizontally (margins are declarative RN style
 * props, so the screen's flex tree is untouched) and lift with the live
 * elevation slider. Edge treatments stay flush and only draw a hairline.
 * Returns `undefined` for 'default' so Discord's stock bar ships untouched.
 */
export function buildNavigationBarStyle(tokens: StyleTokens) {
	if (tokens.navigation === 'default') return undefined
	const floatInset = { marginHorizontal: 14, marginBottom: 12 }
	const floatShadow = tokens.shadow ? { ...tokens.shadow } : undefined
	const lift = floatShadow
		? {
				elevation: Math.max(floatShadow.elevation, 6),
				shadowColor: floatShadow.color,
				shadowOpacity: floatShadow.opacity,
				shadowRadius: floatShadow.radius,
				shadowOffset: { width: 0, height: floatShadow.offsetY },
			}
		: undefined
	switch (tokens.navigation) {
		case 'tonal':
			return {
				backgroundColor: tokens.elevated,
				borderTopWidth: 1,
				borderTopColor: hexToRgba(tokens.accent, 0.22),
			}
		case 'island':
			return {
				backgroundColor: tokens.elevated,
				borderRadius: tokens.navRadius,
				borderWidth: 1,
				borderColor: tokens.borderColor,
				...floatInset,
				...lift,
			}
		case 'dock': {
			const fill = tokens.reduceTransparency
				? mixColors(tokens.lowest, '#ffffff', 0.12)
				: hexToRgba(mixColors(tokens.lowest, '#ffffff', 0.12), 0.78)
			return {
				backgroundColor: fill,
				borderRadius: tokens.navRadius,
				borderWidth: 1,
				borderColor: 'rgba(255,255,255,0.24)',
				...floatInset,
				...lift,
			}
		}
		case 'card':
			return {
				backgroundColor: tokens.elevated,
				borderRadius: tokens.navRadius,
				borderWidth: 1,
				borderColor: tokens.borderColor,
				...floatInset,
				...lift,
			}
		case 'minimal':
			return {
				backgroundColor: tokens.lowestDeep,
				borderTopWidth: 1,
				borderTopColor: hexToRgba(tokens.accent, 0.28),
			}
	}
}

/**
 * Active-tab capsule. Applied to elements whose `accessibilityState.selected`
 * is true (RN sets this on selectable tab items), never to the bar itself.
 */
export function buildNavigationActiveStyle(tokens: StyleTokens) {
	if (tokens.navigation === 'default' || tokens.navigation === 'minimal') return undefined
	const alpha = 0.12 + (0.45 * tokens.pillStrength) / 100
	const fill = hexToRgba(tokens.accent, alpha)
	const base = { backgroundColor: fill, paddingHorizontal: 10, paddingVertical: 3 }
	switch (tokens.navigation) {
		case 'tonal':
		case 'island':
			return { ...base, borderRadius: 999 }
		case 'dock':
			return {
				...base,
				borderRadius: 999,
				borderWidth: 1,
				borderColor: 'rgba(255,255,255,0.3)',
			}
		case 'card':
			return { ...base, borderRadius: Math.min(tokens.navRadius, 14) }
	}
}

/** Round avatar style, used when `roundAvatars` is enabled. */
export const ROUND_AVATAR_STYLE = { borderRadius: 9999 }

/** Avatar style with an optional accent ring, tinted from the live accent. */
export function buildAvatarStyle(accent: string, ring: boolean, avatarRadius = 9999) {
	const radius = avatarRadius > 0 ? avatarRadius : 9999
	if (!ring) return { borderRadius: radius }
	return {
		borderRadius: radius,
		borderWidth: 1.5,
		borderColor: accent,
	}
}

/** A compact description used by the settings preview card. */
export function describeStyle(visual: VisualSettings): string {
	const preset = STYLE_PRESETS.find(style => style.id === visual.style)
	if (!preset) return ''
	if (visual.style === 'off') return preset.description
	return `${preset.label} · ${visual.glass} frost`
}
