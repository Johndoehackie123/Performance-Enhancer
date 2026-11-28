/**
 * Tab bar subtree remix.
 *
 * The bottom tab bar is one self-contained subtree (container → row → tab
 * items). Hooking the *container* and rewriting its children in one pass is
 * the only way to restyle the whole navigation surface atomically: items
 * receive the active-tab capsule, inactive items keep their look, and the
 * treatment can never leak onto buttons elsewhere in the app.
 *
 * Safety rules:
 *   - bounded depth and node count; bail out with the original node on any
 *     unexpected shape (portals, fragments, strings, dead fibers);
 *   - unselected items are returned by reference — no needless re-renders;
 *   - the bar container itself is never treated as an item (no capsules on
 *     the bar, no item semantics on containers).
 */
import type { StyleTokens } from './engine'
import { buildNavigationActiveStyle } from './engine'

export interface RemixDeps {
	createElement: (type: any, props: any, ...children: any[]) => any
	isValidElement: (node: any) => boolean
}

const MAX_DEPTH = 12
const MAX_NODES = 150

/** Best-effort component name across function, memo and forwardRef shapes. */
function nameOf(type: unknown): string {
	if (typeof type === 'string') return type
	if (typeof type === 'function') {
		const fn = type as { displayName?: string; name?: string }
		return fn.displayName ?? fn.name ?? ''
	}
	if (type && typeof type === 'object') {
		const obj = type as { displayName?: string; name?: string; type?: { displayName?: string; name?: string } }
		return obj.displayName ?? obj.name ?? obj.type?.displayName ?? obj.type?.name ?? ''
	}
	return ''
}

const TOUCHABLES = /^(Pressable|TouchableOpacity|TouchableHighlight|TouchableWithoutFeedback|Touchable)$/

/** True for anything inside a tab bar that behaves as a selectable tab. */
function isTabItem(typeName: string, props: Record<string, unknown>): boolean {
	if (props.accessibilityRole === 'tab') return true
	// react-navigation passes a boolean `focused` prop to tab items.
	if (typeof props.focused === 'boolean') return true
	if (/item/i.test(typeName) && /tab|navigation|nav/i.test(typeName)) return true
	if (TOUCHABLES.test(typeName)) return true
	const state = props.accessibilityState as { selected?: boolean; checked?: boolean } | undefined
	if (state && (state.selected === true || state.checked === true)) return true
	return false
}

function isSelected(props: Record<string, unknown>): boolean {
	if (typeof props.focused === 'boolean') return props.focused
	const state = props.accessibilityState as { selected?: boolean; checked?: boolean } | undefined
	return !!state && (state.selected === true || state.checked === true)
}

/**
 * Rebuilds a tab-bar subtree with the active item(s) wearing the capsule.
 * Returns the original subtree by reference when nothing changed.
 */
export function remixNavigationChildren(
	readRoot: unknown,
	tokens: StyleTokens,
	deps: RemixDeps,
): unknown {
	const capsule = buildNavigationActiveStyle(tokens) as Record<string, unknown> | undefined
	if (!capsule) return readRoot
	let budget = MAX_NODES

	const visit = (node: unknown, depth: number, inItem: boolean): unknown => {
		if (depth > MAX_DEPTH || budget-- <= 0) return node
		if (node === null || node === undefined || typeof node === 'string' || typeof node === 'number')
			return node
		if (Array.isArray(node)) {
			let changed = false
			const out = new Array(node.length)
			for (let i = 0; i < node.length; i++) {
				out[i] = visit(node[i], depth + 1, inItem)
				if (out[i] !== node[i]) changed = true
			}
			return changed ? out : node
		}
		if (typeof node !== 'object') return node
		if (!deps.isValidElement(node)) {
			// Portals and fragments that are not elements: walk children if any.
			const holder = node as { props?: { children?: unknown }; children?: unknown }
			const child = holder.props?.children ?? holder.children
			if (child !== undefined) visit(child, depth + 1, inItem)
			return node
		}
		const element = node as {
			type: unknown
			props: Record<string, unknown> & { children?: unknown }
			key?: unknown
			ref?: unknown
		}
		const props = element.props
		if (!props || typeof props !== 'object') return node

		const typeName = nameOf(element.type)
		const carriesStyle = TOUCHABLES.test(typeName) || 'style' in props

		// Decide item-ness before visiting children so nested content keeps
		// its own identity while the item wrapper picks up the capsule.
		let overlay: Record<string, unknown> | undefined
		if (!inItem && carriesStyle && isTabItem(typeName, props) && isSelected(props)) {
			overlay = capsule
		}

		let style = props.style
		if (overlay) {
			if (Array.isArray(style)) style = [...style, overlay]
			else if (style && typeof style === 'object') style = [style, overlay]
			else style = overlay
		}

		const childInItem = inItem || isTabItem(typeName, props)
		const remixedChildren = visit(props.children, depth + 1, childInItem)

		if (style === props.style && remixedChildren === props.children) return node

		try {
			const config: Record<string, unknown> = { ...props, style, children: remixedChildren }
			// createElement reads key/ref from the config object — restore them.
			if (element.key !== undefined) config.key = element.key
			if (element.ref !== undefined) config.ref = element.ref
			return deps.createElement(element.type, config)
		} catch {
			return node
		}
	}

	try {
		return visit(readRoot, 0, false)
	} catch {
		return readRoot
	}
}
