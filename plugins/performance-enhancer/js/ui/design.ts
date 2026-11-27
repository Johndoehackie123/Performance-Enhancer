/**
 * Typed facade over Revenge's design system.
 *
 * `@revenge-mod/types` declares Discord's components as `interface X extends
 * FC<Props>`, which TypeScript refuses to use as JSX element types. Rather than
 * casting at every call site, this module re-declares the exact props of the
 * components we use and narrows the runtime exports once, here.
 *
 * The prop shapes mirror `DiscordModules.Components` for the components below,
 * so a wrong prop still fails the type check.
 */
import { Design } from '@revenge-mod/discord/design'
import type { ComponentProps, FC, ReactNode } from 'react'
import type { PressableProps, StyleProp, TextStyle, ViewStyle } from 'react-native'

export interface TableRowProps {
	label: ReactNode
	subLabel?: ReactNode
	icon?: ReactNode
	trailing?: ReactNode
	arrow?: boolean
	onPress?: PressableProps['onPress']
	disabled?: boolean
	labelLineClamp?: number
	subLabelLineClamp?: number
	start?: boolean
	end?: boolean
	variant?: 'default' | 'danger'
}

export interface TableRowGroupProps {
	title?: string
	description?: string
	hasIcons?: boolean
	accessibilityLabel?: string
	children: ReactNode
}

export interface TableSwitchRowProps
	extends Omit<TableRowProps, 'trailing' | 'arrow'> {
	accessibilityHint?: string
	value: boolean
	onValueChange(value: boolean): void
}

export interface TableRadioGroupProps<T extends string = string> {
	title?: string
	description?: string
	hasIcons?: boolean
	accessibilityLabel?: string
	children: ReactNode
	onChange(value: T): void
	value?: T
	defaultValue?: T
}

export interface TableRadioRowProps<T extends string = string> extends TableRowProps {
	value: T
}

export interface StackProps {
	spacing?: number
	align?: ViewStyle['alignItems']
	justify?: ViewStyle['justifyContent']
	direction?: 'vertical' | 'horizontal'
	style?: StyleProp<ViewStyle>
	children?: ReactNode
}

export interface TextProps {
	variant?: `heading-${string}` | `text-${string}` | `display-${string}` | string
	color?: string
	style?: StyleProp<TextStyle>
	lineClamp?: number
	ellipsizeMode?: 'head' | 'middle' | 'tail' | 'clip'
	tabularNumbers?: boolean
	children?: ReactNode
}

export interface CardProps {
	start?: boolean
	end?: boolean
	variant?: 'primary' | 'secondary' | 'transparent'
	border?: 'faint' | 'normal' | 'strong' | 'subtle' | 'none'
	shadow?: 'none' | 'low' | 'medium' | 'high' | 'border' | 'ledge'
	style?: StyleProp<ViewStyle>
	children: ReactNode
}

export interface ButtonProps {
	text: string
	icon?: number
	loading?: boolean
	iconPosition?: 'start' | 'end'
	size?: 'sm' | 'md' | 'lg'
	variant?:
		| 'primary'
		| 'secondary'
		| 'tertiary'
		| 'destructive'
		| 'active'
		| 'expressive'
		| 'primary-overlay'
		| 'secondary-overlay'
	disabled?: boolean
	grow?: boolean
	style?: StyleProp<ViewStyle>
	onPress?: PressableProps['onPress']
	cornerRadius?: number
}

export interface IconButtonProps {
	icon: number
	label?: string
	size?: 'sm' | 'md' | 'lg'
	variant?: 'primary' | 'secondary' | 'tertiary' | 'destructive' | 'active'
	onPress?: PressableProps['onPress']
	disabled?: boolean
	style?: StyleProp<ViewStyle>
}

export interface SliderProps {
	step: number
	value: number
	minimumValue: number
	maximumValue: number
	onValueChange: (value: number) => void
	onSlidingStart?: () => void
	onSlidingComplete?: (value: number) => void
	startIcon?: ReactNode
	endIcon?: ReactNode
}

export interface TextInputProps {
	value?: string
	placeholder?: string
	label?: string
	description?: string
	errorMessage?: string
	status?: 'default' | 'error'
	multiline?: boolean
	defaultValue?: string
	onChange?: (value: string) => void
	onBlur?: () => void
	onFocus?: () => void
	style?: StyleProp<ViewStyle>
}

export interface TableRowIconProps {
	source?: unknown
	IconComponent?: unknown
	variant?: 'default' | 'danger' | 'secondary' | 'translucent'
}

const design = Design as unknown as Record<string, unknown>

function narrow<P>(name: string): FC<P> {
	const component = design[name]
	if (typeof component !== 'function' && typeof component !== 'object') {
		// Returning a no-op keeps a settings screen from crashing when a component
		// disappears in a future Discord build.
		return (() => null) as unknown as FC<P>
	}
	return component as FC<P>
}

export const Stack = narrow<StackProps>('Stack')
export const Text = narrow<TextProps>('Text')
export const Card = narrow<CardProps>('Card')
export const Button = narrow<ButtonProps>('Button')
export const IconButton = narrow<IconButtonProps>('IconButton')
export const Slider = narrow<SliderProps>('Slider')
export const TextInput = narrow<TextInputProps>('TextInput')
export const TableRow = narrow<TableRowProps>('TableRow')
export const TableRowGroup = narrow<TableRowGroupProps>('TableRowGroup')
export const TableSwitchRow = narrow<TableSwitchRowProps>('TableSwitchRow')
export const TableRadioGroup = narrow<TableRadioGroupProps>('TableRadioGroup')
export const TableRadioRow = narrow<TableRadioRowProps>('TableRadioRow')
export const TableRowIcon = narrow<TableRowIconProps>('TableRowIcon')

/** Discord's `TableRow.Icon`, used for the leading icon of a row. */
export const RowIcon =
	((design.TableRow as { Icon?: unknown } | undefined)?.Icon as FC<TableRowIconProps>) ??
	TableRowIcon

export type DesignProps<T extends keyof typeof Design> = ComponentProps<
	(typeof Design)[T] extends FC<infer P> ? FC<P> : never
>
