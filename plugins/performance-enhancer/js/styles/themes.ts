/**
 * Theme registration.
 *
 * When the optional `revenge.api.themes` plugin is present, the visual styles
 * are also exposed as pickable color themes in Settings > Revenge > Themes, so
 * they survive restarts without the plugin needing to patch anything.
 *
 * Registering is best-effort: the API is optional, and a missing or older
 * themes plugin must never stop the rest of the plugin from starting.
 */
import { buildTokens } from './engine'
import type { ThemesApi } from '@revenge-mod/themes-api/types'
import type { DeviceTier, StyleId, VisualSettings } from '../shared'

const GROUP = 'performance-enhancer'

interface ThemeSpec {
	id: StyleId
	name: string
	description: string
	/** Raw palette overrides. */
	raw: Record<string, string>
	/** Per-base semantic overrides. */
	semantic: Record<string, Record<string, string>>
}

function specs(visual: VisualSettings, tier: DeviceTier): ThemeSpec[] {
	const tokensFor = (style: StyleId) =>
		buildTokens({ ...visual, style }, tier)

	const material = tokensFor('material')
	const glass = tokensFor('glass')
	const frost = tokensFor('frost')
	const custom = tokensFor('custom')

	const semantic = (panel: string, accent: string) => {
		const values = {
			BACKGROUND_BASE_LOWEST: panel,
			BACKGROUND_BASE_LOWER: panel,
			BACKGROUND_BASE_LOW: panel,
			BACKGROUND_MODIFIER_ACCENT: accent,
			TEXT_LINK: accent,
			TEXT_BRAND: accent,
		}
		return {
			dark: values,
			darker: values,
			midnight: values,
			light: {
				...values,
				BACKGROUND_BASE_LOWEST: '#f7f8fa',
				BACKGROUND_BASE_LOWER: '#f2f3f5',
				BACKGROUND_BASE_LOW: '#ffffff',
			},
		}
	}

	return [
		{
			id: 'material',
			name: 'Material 3',
			description: 'Tonal elevated surfaces with an indigo accent.',
			raw: {
				BRAND_500: material.accent,
				BRAND_560: material.accent,
			},
			semantic: semantic('#1e1f22', material.accent),
		},
		{
			id: 'glass',
			name: 'Glassmorphism',
			description: 'Translucent panes; pair it with a background image.',
			raw: {
				BRAND_500: glass.accent,
			},
			semantic: {
				dark: {
					BACKGROUND_BASE_LOWEST: '#0f1117',
					BACKGROUND_BASE_LOWER: '#151823',
					BACKGROUND_BASE_LOW: '#1b1f2c',
					TEXT_LINK: glass.accent,
				},
				darker: {
					BACKGROUND_BASE_LOWEST: '#0b0d13',
					BACKGROUND_BASE_LOWER: '#11141d',
					BACKGROUND_BASE_LOW: '#171b26',
					TEXT_LINK: glass.accent,
				},
				midnight: {
					BACKGROUND_BASE_LOWEST: '#05060a',
					BACKGROUND_BASE_LOWER: '#0a0c12',
					BACKGROUND_BASE_LOW: '#0f1218',
					TEXT_LINK: glass.accent,
				},
				light: {
					BACKGROUND_BASE_LOWEST: '#eef1f7',
					BACKGROUND_BASE_LOWER: '#f5f7fb',
					BACKGROUND_BASE_LOW: '#ffffff',
					TEXT_LINK: glass.accent,
				},
			},
		},
		{
			id: 'frost',
			name: 'Liquid Frost',
			description: 'Cool, milky surfaces for a frosted-glass look.',
			raw: {
				BRAND_500: frost.accent,
			},
			semantic: {
				dark: {
					BACKGROUND_BASE_LOWEST: '#10151d',
					BACKGROUND_BASE_LOWER: '#161d27',
					BACKGROUND_BASE_LOW: '#1d2632',
					TEXT_LINK: frost.accent,
				},
				darker: {
					BACKGROUND_BASE_LOWEST: '#0c1017',
					BACKGROUND_BASE_LOWER: '#121821',
					BACKGROUND_BASE_LOW: '#18202b',
					TEXT_LINK: frost.accent,
				},
				midnight: {
					BACKGROUND_BASE_LOWEST: '#070a0e',
					BACKGROUND_BASE_LOWER: '#0c1116',
					BACKGROUND_BASE_LOW: '#11171e',
					TEXT_LINK: frost.accent,
				},
				light: {
					BACKGROUND_BASE_LOWEST: '#f2f6fa',
					BACKGROUND_BASE_LOWER: '#f8fbfd',
					BACKGROUND_BASE_LOW: '#ffffff',
					TEXT_LINK: frost.accent,
				},
			},
		},
		{
			id: 'custom',
			name: 'Custom palette',
			description: 'Your own accent and panel colours from the Style studio.',
			raw: {
				BRAND_500: custom.accent,
			},
			semantic: semantic(visual.custom.panelColor, custom.accent),
		},
	]
}

/**
 * Registers the plugin's color themes.
 *
 * @returns a cleanup function, or `undefined` when the Themes API is absent so
 * callers can tell "registered" from "nothing to clean up".
 */
export function registerThemes(
	themes: ThemesApi | undefined,
	visual: VisualSettings,
	tier: DeviceTier,
): (() => void) | undefined {
	if (!themes || typeof themes.registerTheme !== 'function') return undefined

	try {
		themes.registerGroup(GROUP, {
			name: 'Performance Enhancer',
			description: 'Material, glassmorphism and liquid frost palettes.',
		})
	} catch {}

	for (const spec of specs(visual, tier)) {
		try {
			themes.registerTheme(GROUP, `pe-${spec.id}`, {
				name: spec.name,
				description: spec.description,
				getColors: () => ({
					raw: spec.raw,
					semantic: spec.semantic as never,
				}),
			})
		} catch {
			// A theme shape mismatch must not stop the remaining themes.
		}
	}

	return () => {
		// Themes are owned by the plugin and removed automatically when it stops.
	}
}
