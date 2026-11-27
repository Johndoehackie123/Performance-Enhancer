/**
 * Small helpers shared by the settings screen.
 */
import { getAssetIdByName } from '@revenge-mod/assets'
import { ToastActionCreators } from '@revenge-mod/discord/actions'

/** Resolves a Discord icon id, tolerating builds without the asset. */
export function iconId(name: string): number | undefined {
	try {
		const id = getAssetIdByName(name)
		return typeof id === 'number' ? id : undefined
	} catch {
		return undefined
	}
}

/** Shows a Discord toast. Never throws: toasts are cosmetic. */
export function toast(text: string, variant: 'default' | 'success' | 'critical' = 'default') {
	try {
		ToastActionCreators.open('performance-enhancer', {
			text,
			icon: iconId('SparklesIcon'),
			variant,
		} as never)
	} catch {}
}

export const Styles = {
	refreshIcon: () => iconId('RetryIcon'),
	sparklesIcon: () => iconId('SparklesIcon'),
}
