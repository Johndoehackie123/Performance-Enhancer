/**
 * Presentational pieces for the settings screen.
 *
 * Everything here is pure: it renders from props and never reads Discord
 * modules directly, so the screen keeps working on builds where some internals
 * moved. The only Discord dependency is the design system facade.
 */
import { useMemo } from 'react'
import { STYLE_PRESETS, buildPanelStyle, buildTokens, describeStyle } from '../styles/engine'
import { Button, Card, Stack, Text } from './design'
import type { StyleTokens } from '../styles/engine'
import type { DeviceTier, VisualSettings } from '../shared'

export interface PreviewProps {
	visual: VisualSettings
	tier: DeviceTier
}

/** Live preview of the selected style, rendered with the real token engine. */
export function StylePreview({ visual, tier }: PreviewProps) {
	const tokens = useMemo(() => buildTokens(visual, tier), [visual, tier])
	const panel = useMemo(() => buildPanelStyle(tokens), [tokens])
	const label = STYLE_PRESETS.find(style => style.id === visual.style)?.label ?? 'Style'

	return (
		<Card
			variant="secondary"
			border="faint"
			style={{ marginHorizontal: 16, marginBottom: 16, padding: 16 }}
		>
			<Stack spacing={12}>
				<Stack direction="horizontal" justify="space-between" align="center">
					<Text variant="text-md/semibold" color="#f2f3f5">
						{label}
					</Text>
					<Text variant="text-xs/medium" color="#b5bac1">
						{describeStyle(visual)}
					</Text>
				</Stack>

				{/* The preview pane uses the exact tokens the live surfaces use. */}
				<Stack
					style={[
						{ padding: 14 },
						panel ?? { backgroundColor: 'rgba(255,255,255,0.04)', borderRadius: 12 },
					]}
				>
					<Stack spacing={10}>
						<PreviewRow tokens={tokens} />
						<PreviewRow tokens={tokens} secondary />
					</Stack>
				</Stack>

				<Swatches tokens={tokens} />
			</Stack>
		</Card>
	)
}

function PreviewRow({ tokens, secondary }: { tokens: StyleTokens; secondary?: boolean }) {
	return (
		<Stack direction="horizontal" align="center" spacing={10}>
			<Stack
				style={{
					width: 28,
					height: 28,
					borderRadius: 9999,
					backgroundColor: tokens.accent,
					opacity: secondary ? 0.6 : 1,
				}}
			/>
			<Stack spacing={5} style={{ flex: 1 }}>
				<Stack
					style={{
						height: 8,
						width: secondary ? '55%' : '70%',
						borderRadius: 4,
						backgroundColor: 'rgba(255,255,255,0.55)',
						opacity: secondary ? 0.5 : 1,
					}}
				/>
				<Stack
					style={{
						height: 6,
						width: secondary ? '35%' : '45%',
						borderRadius: 3,
						backgroundColor: 'rgba(255,255,255,0.28)',
					}}
				/>
			</Stack>
		</Stack>
	)
}

function Swatches({ tokens }: { tokens: StyleTokens }) {
	const items: { label: string; color: string }[] = [
		{ label: 'panel', color: tokens.background },
		{ label: 'border', color: tokens.borderColor },
		{ label: 'accent', color: tokens.accent },
		{ label: 'media', color: tokens.media },
	]
	return (
		<Stack direction="horizontal" spacing={8}>
			{items.map(item => (
				<Stack key={item.label} spacing={4} align="center" style={{ flex: 1 }}>
					<Stack
						style={{
							height: 22,
							width: '100%',
							borderRadius: 6,
							backgroundColor: item.color,
							borderWidth: 1,
							borderColor: 'rgba(255,255,255,0.14)',
						}}
					/>
					<Text variant="text-xxs/medium" color="#949ba4">
						{item.label}
					</Text>
				</Stack>
			))}
		</Stack>
	)
}

export interface DiagnosticsProps {
	lines: { label: string; value: string }[]
	onTrim: () => void
	onReapply: () => void
}

/** Read-only diagnostics list with two actions. */
export function DiagnosticsActions({ onTrim, onReapply }: Omit<DiagnosticsProps, 'lines'>) {
	return (
		<Stack direction="horizontal" spacing={8} style={{ marginTop: 12, paddingHorizontal: 16 }}>
			<Button
				variant="secondary"
				size="sm"
				text="Trim now"
				style={{ flex: 1 }}
				onPress={onTrim}
			/>
			<Button
				variant="secondary"
				size="sm"
				text="Re-apply style"
				style={{ flex: 1 }}
				onPress={onReapply}
			/>
		</Stack>
	)
}
