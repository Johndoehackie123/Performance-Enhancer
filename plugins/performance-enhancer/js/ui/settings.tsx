/**
 * Settings screen.
 *
 * Rendered by Revenge as the plugin's page in Settings > Revenge > Plugins.
 * Every control writes straight to `api.jsonStorage`; the store picks the change
 * up through its subscription, so the live preview, the JSX hooks and the
 * diagnostics panel stay in sync without a reload.
 */
import { useSyncExternalStore } from 'react'
import type { ReactNode } from 'react'
import { ScrollView } from 'react-native'
import { detectDevice } from '../device'
import { PROFILES, autoProfileFor } from '../profiles'
import {
	DEFAULT_SETTINGS,
	type CustomStyle,
	type GlassPreset,
	type ProfileId,
	type Settings,
	type StyleId,
	type SurfaceId,
	type VisualSettings,
} from '../shared'
import { formatBytes, getSnapshot, subscribe } from '../store'
import { GLASS_PRESETS, STYLE_PRESETS, SURFACES, isDarkColor } from '../styles/engine'
import { DiagnosticsActions, StylePreview } from './components'
import {
	Button,
	Card,
	Stack,
	TableRadioGroup,
	TableRadioRow,
	TableRow,
	TableRowGroup,
	TableSwitchRow,
	Text,
	TextInput,
} from './design'
import { Styles, toast } from './helpers'
import type { PluginApi } from '@revenge-mod/plugins/types'

export interface SettingsProps {
	api: PluginApi<{ jsonStorage: Settings }>
	/** Rebuilds the live styling hooks after a visual change. */
	onVisualChange?: () => void
	/** Triggers an immediate memory trim. */
	onTrim?: () => void
	/** Runtime hook report, shown in diagnostics. */
	hooks?: { hooked: number; missing: number }
}

const TIER_LABEL: Record<string, string> = {
	low: 'Low-end',
	mid: 'Mid-range',
	high: 'High-end',
}

/** Merges stored partial settings over the defaults, one section at a time. */
function mergeSettings(stored: Partial<Settings> | undefined): Settings {
	return {
		...DEFAULT_SETTINGS,
		...stored,
		performance: { ...DEFAULT_SETTINGS.performance, ...stored?.performance },
		memory: { ...DEFAULT_SETTINGS.memory, ...stored?.memory },
		stability: { ...DEFAULT_SETTINGS.stability, ...stored?.stability },
		network: { ...DEFAULT_SETTINGS.network, ...stored?.network },
		visual: {
			...DEFAULT_SETTINGS.visual,
			...stored?.visual,
			surfaces: {
				...DEFAULT_SETTINGS.visual.surfaces,
				...stored?.visual?.surfaces,
			},
			custom: { ...DEFAULT_SETTINGS.visual.custom, ...stored?.visual?.custom },
		},
	}
}

export function SettingsComponent({ api, onVisualChange, onTrim, hooks }: SettingsProps) {
	const stored = api.jsonStorage.use()
	const live = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
	const device = detectDevice()
	const settings = mergeSettings(stored)

	const write = <K extends keyof Settings>(key: K, value: Partial<Settings[K]>) => {
		api.jsonStorage.set({ [key]: value } as never)
	}
	const writeVisual = (value: Partial<VisualSettings>) => {
		write('visual', value)
		onVisualChange?.()
	}
	const writeCustom = (value: Partial<CustomStyle>) => {
		writeVisual({ custom: { ...settings.visual.custom, ...value } })
	}

	const diagnostics = live.diagnostics
	const auto = autoProfileFor(device)
	const activeProfile =
		settings.performance.profile === 'auto' ? auto : PROFILES[settings.performance.profile]
	const tierLabel = TIER_LABEL[device.tier] ?? device.tier
	const resetAll = () => {
		const storage = api.jsonStorage as unknown as {
			set(value: Settings, replace?: boolean): unknown
		}
		void storage.set(DEFAULT_SETTINGS, true)
		toast('Performance Enhancer reset', 'success')
		onVisualChange?.()
	}

	return (
		<ScrollView keyboardShouldPersistTaps="handled" style={{ flex: 1 }}>
			<Page>
				{/* --------------------------------------------------------- device */}
				<TableRowGroup title="Device" hasIcons>
					<TableRow
						label={`${tierLabel} · ${device.ramGb ? `${device.ramGb.toFixed(1)} GB RAM` : 'RAM unknown'}`}
						subLabel={device.summary}
					/>
					<TableRow
						label="Chipset"
						subLabel={device.soc || 'SoC information unavailable on this build'}
					/>
				</TableRowGroup>

				{/* -------------------------------------------------------- profile */}
				<TableRadioGroup
					title="Performance profile"
					description={`Auto selects ${auto.label} on this ${tierLabel.toLowerCase()} device.`}
					value={settings.performance.profile}
					onChange={(value: ProfileId) => write('performance', { profile: value })}
				>
					<TableRadioRow
						value="auto"
						label={`Auto · ${auto.label}`}
						subLabel={`Derived from ${tierLabel.toLowerCase()} tier`}
					/>
					<TableRadioRow
						value="battery"
						label="Battery saver"
						subLabel={PROFILES.battery.description}
					/>
					<TableRadioRow
						value="balanced"
						label="Balanced"
						subLabel={PROFILES.balanced.description}
					/>
					<TableRadioRow
						value="aggressive"
						label="Performance"
						subLabel={PROFILES.aggressive.description}
					/>
				</TableRadioGroup>

				<TableRowGroup title="Profile tuning">
					<TableRow label="Active profile" subLabel={activeProfile.description} />
					<TableSwitchRow
						label="Confirm on start"
						subLabel="Show a toast with the applied profile when the plugin starts."
						value={settings.performance.toastOnStart}
						onValueChange={value => write('performance', { toastOnStart: value })}
					/>
				</TableRowGroup>

				{/* --------------------------------------------------------- memory */}
				<TableRowGroup title="Memory">
					<TableSwitchRow
						label="Trim caches in the background"
						subLabel="Releases image and asset caches when you leave the app."
						value={settings.memory.trimOnBackground}
						onValueChange={value => write('memory', { trimOnBackground: value })}
					/>
					<TableSwitchRow
						label="Collect garbage after trims"
						subLabel="Runs the Hermes GC and, on supported builds, the native heap collector."
						value={settings.memory.aggressiveGc}
						onValueChange={value => write('memory', { aggressiveGc: value })}
					/>
					<TableSwitchRow
						label="Keep a large channel cache"
						subLabel={`Retains ${activeProfile.cacheChannels} channels for instant back-navigation.`}
						value={settings.memory.maxCachedChannels >= activeProfile.cacheChannels}
						onValueChange={value =>
							write('memory', {
								maxCachedChannels: value
									? Math.max(settings.memory.maxCachedChannels, activeProfile.cacheChannels)
									: Math.min(settings.memory.maxCachedChannels, activeProfile.cacheChannels),
							})
						}
					/>
				</TableRowGroup>
				<Stack spacing={10} style={{ paddingHorizontal: 16, marginTop: 12 }}>
					<NumberStepper
						label="Image cache limit"
						value={settings.memory.imageCacheLimitMb}
						unit="MB"
						step={4}
						min={4}
						max={256}
						onChange={imageCacheLimitMb => write('memory', { imageCacheLimitMb })}
					/>
					<NumberStepper
						label="Cached channels"
						value={settings.memory.maxCachedChannels}
						unit="channels"
						step={1}
						min={1}
						max={64}
						onChange={maxCachedChannels => write('memory', { maxCachedChannels })}
					/>
				</Stack>

				{/* ------------------------------------------------------ stability */}
				<TableRowGroup title="Stability">
					<TableSwitchRow
						label="Recover from connection failures"
						subLabel="Reconnects the gateway with bounded exponential backoff."
						value={settings.stability.autoRecover}
						onValueChange={value => write('stability', { autoRecover: value })}
					/>
					<TableSwitchRow
						label="Throttle retry storms"
						subLabel={`Caps retries at ${activeProfile.retryAttempts} before surfacing the error.`}
						value={settings.stability.throttleRetries}
						onValueChange={value => write('stability', { throttleRetries: value })}
					/>
					<TableSwitchRow
						label="Diagnostics"
						subLabel="Records dispatch counts and stalls for the panel below."
						value={settings.stability.diagnostics}
						onValueChange={value => write('stability', { diagnostics: value })}
					/>
				</TableRowGroup>

				{/* -------------------------------------------------------- network */}
				<TableRowGroup title="Network">
					<TableSwitchRow
						label="Block telemetry"
						subLabel="Drops analytics and science dispatches before they leave the app."
						value={settings.network.blockTelemetry}
						onValueChange={value => write('network', { blockTelemetry: value })}
					/>
				</TableRowGroup>

				{/* --------------------------------------------------------- styles */}
				<Stack style={{ paddingHorizontal: 16, marginTop: 22 }}>
					<Text variant="text-md/semibold" color="#f2f3f5">
						Style studio
					</Text>
					<Text variant="text-sm/medium" color="#949ba4" style={{ marginTop: 2, marginBottom: 12 }}>
						{`Previewing on the ${tierLabel.toLowerCase()} tier. Blur is disabled on low-end devices.`}
					</Text>
				</Stack>

				<StylePreview visual={settings.visual} tier={device.tier} />

				<TableRadioGroup
					title="Visual style"
					value={settings.visual.style}
					onChange={(value: StyleId) => {
						const preset = STYLE_PRESETS.find(style => style.id === value)
						writeVisual({ style: value, glass: preset?.glass ?? settings.visual.glass })
					}}
				>
					{STYLE_PRESETS.map(preset => (
						<TableRadioRow
							key={preset.id}
							value={preset.id}
							label={preset.label}
							subLabel={preset.description}
						/>
					))}
				</TableRadioGroup>

				{settings.visual.style !== 'off' && settings.visual.style !== 'custom' ? (
					<TableRadioGroup
						title="Frost intensity"
						value={settings.visual.glass}
						onChange={(value: GlassPreset) => writeVisual({ glass: value })}
					>
						{GLASS_PRESETS.map(preset => (
							<TableRadioRow
								key={preset.id}
								value={preset.id}
								label={preset.label}
								subLabel={preset.description}
							/>
						))}
					</TableRadioGroup>
				) : null}

				{settings.visual.style === 'custom' ? (
					<>
						<Stack spacing={14} style={{ paddingHorizontal: 16, marginTop: 12 }}>
							<ColorField
								label="Panel colour"
								value={settings.visual.custom.panelColor}
								onChange={panelColor => writeCustom({ panelColor })}
							/>
							<ColorField
								label="Accent colour"
								value={settings.visual.custom.accentColor}
								onChange={accentColor => writeCustom({ accentColor })}
							/>
							<NumberStepper
								label="Corner radius"
								value={settings.visual.custom.radius}
								unit="dp"
								step={1}
								min={0}
								max={32}
								onChange={radius => writeCustom({ radius })}
							/>
							<PercentStepper
								label="Transparency"
								value={settings.visual.custom.transparency}
								onChange={transparency => writeCustom({ transparency })}
							/>
							<NumberStepper
								label="Border strength"
								value={settings.visual.custom.border}
								unit="dp"
								step={0.5}
								min={0}
								max={4}
								onChange={border => writeCustom({ border })}
							/>
						</Stack>
						<TableRowGroup>
							<TableSwitchRow
								label="Saturate highlights"
								subLabel="Tints the panel with the accent colour instead of white."
								value={settings.visual.custom.saturate}
								onValueChange={saturate => writeCustom({ saturate })}
							/>
						</TableRowGroup>
						<Stack direction="horizontal" spacing={8} style={{ paddingHorizontal: 16, marginTop: 8 }}>
							{PRESET_PALETTES.map(palette => (
								<Button
									key={palette.name}
									size="sm"
									variant="secondary"
									text={palette.name}
									style={{ flex: 1 }}
									onPress={() => writeCustom(palette.values)}
								/>
							))}
						</Stack>
					</>
				) : null}

				<TableRowGroup title="Surfaces" description="Where the style is applied.">
					{SURFACES.map(surface => (
						<TableSwitchRow
							key={surface.id}
							label={surface.label}
							subLabel={surface.description}
							value={settings.visual.surfaces[surface.id as SurfaceId]}
							onValueChange={value =>
								writeVisual({
									surfaces: { ...settings.visual.surfaces, [surface.id]: value },
								})
							}
						/>
					))}
				</TableRowGroup>

				<TableRowGroup title="Extras">
					<TableSwitchRow
						label="Register colour themes"
						subLabel="Adds Material, Glassmorphism and Liquid Frost to Settings > Revenge > Themes."
						value={settings.visual.registerThemes}
						onValueChange={value => writeVisual({ registerThemes: value })}
					/>
					<TableSwitchRow
						label="Round avatars"
						subLabel="Clips avatars and profile pictures into circles."
						value={settings.visual.roundAvatars}
						onValueChange={value => writeVisual({ roundAvatars: value })}
					/>
				</TableRowGroup>

				{/* ----------------------------------------------------- diagnostics */}
				<Card
					variant="secondary"
					border="faint"
					style={{ marginHorizontal: 16, marginTop: 20, padding: 16 }}
				>
					<Text variant="text-md/semibold" color="#f2f3f5">
						Diagnostics
					</Text>
					<Stack spacing={6} style={{ marginTop: 10 }}>
						<DiagnosticRow label="Heap used" value={`${diagnostics.heapUsedMb.toFixed(1)} MB`} />
						<DiagnosticRow
							label="Cache trims"
							value={`${diagnostics.trims} · ${formatBytes(diagnostics.bytesReleased)} released`}
						/>
						<DiagnosticRow label="Recoveries" value={String(diagnostics.recoveries)} />
						<DiagnosticRow
							label="Dispatches"
							value={`${diagnostics.dispatchesSeen} seen · ${diagnostics.dispatchesDropped} dropped`}
						/>
						<DiagnosticRow
							label="Style hooks"
							value={
								hooks
									? `${hooks.hooked} active · ${hooks.missing} missing`
									: 'not reported'
							}
						/>
						<DiagnosticRow
							label="Uptime"
							value={`${Math.round(diagnostics.uptimeMs / 1000)}s`}
						/>
					</Stack>
				</Card>

				<DiagnosticsActions
					onTrim={() => onTrim?.()}
					onReapply={() => {
						onVisualChange?.()
						toast('Style re-applied', 'success')
					}}
				/>

				<Stack style={{ paddingHorizontal: 16, marginTop: 20, marginBottom: 40 }}>
					<Button
						variant="secondary"
						size="sm"
						icon={Styles.refreshIcon()}
						text="Reset all settings"
						onPress={resetAll}
					/>
					<Text variant="text-xs/medium" color="#949ba4" style={{ marginTop: 10 }}>
						{`Accent ${settings.visual.custom.accentColor} · panel ${
							isDarkColor(settings.visual.custom.panelColor) ? 'dark' : 'light'
						} · tier ${device.tier}`}
					</Text>
				</Stack>
			</Page>
		</ScrollView>
	)
}

function DiagnosticRow({ label, value }: { label: string; value: string }) {
	return (
		<Stack direction="horizontal" justify="space-between" align="center">
			<Text variant="text-sm/medium" color="#b5bac1">
				{label}
			</Text>
			<Text variant="text-sm/medium" color="#f2f3f5">
				{value}
			</Text>
		</Stack>
	)
}

function NumberStepper({
	label,
	value,
	unit,
	step,
	min,
	max,
	onChange,
}: {
	label: string
	value: number
	unit: string
	step: number
	min: number
	max: number
	onChange: (value: number) => void
}) {
	const clamp = (next: number) => Math.min(max, Math.max(min, Number(next.toFixed(2))))
	const display = Number.isInteger(value) ? String(value) : value.toFixed(1)
	return (
		<Stack direction="horizontal" justify="space-between" align="center">
			<Stack spacing={2}>
				<Text variant="text-sm/semibold" color="#f2f3f5">
					{label}
				</Text>
				<Text variant="text-xs/medium" color="#949ba4">
					{`${display} ${unit}`}
				</Text>
			</Stack>
			<Stack direction="horizontal" spacing={8} align="center">
				<Button
					size="sm"
					variant="secondary"
					text="−"
					onPress={() => onChange(clamp(value - step))}
				/>
				<Button
					size="sm"
					variant="secondary"
					text="+"
					onPress={() => onChange(clamp(value + step))}
				/>
			</Stack>
		</Stack>
	)
}

function PercentStepper({
	label,
	value,
	onChange,
}: {
	label: string
	value: number
	onChange: (value: number) => void
}) {
	const step = (delta: number) =>
		onChange(Math.min(1, Math.max(0, Number((value + delta).toFixed(2)))))
	return (
		<Stack direction="horizontal" justify="space-between" align="center">
			<Stack spacing={2}>
				<Text variant="text-sm/semibold" color="#f2f3f5">
					{label}
				</Text>
				<Text variant="text-xs/medium" color="#949ba4">
					{`${Math.round(value * 100)}%`}
				</Text>
			</Stack>
			<Stack direction="horizontal" spacing={8} align="center">
				<Button size="sm" variant="secondary" text="−" onPress={() => step(-0.05)} />
				<Button size="sm" variant="secondary" text="+" onPress={() => step(0.05)} />
			</Stack>
		</Stack>
	)
}

function ColorField({
	label,
	value,
	onChange,
}: {
	label: string
	value: string
	onChange: (value: string) => void
}) {
	return (
		<Stack spacing={8}>
			<Text variant="text-sm/semibold" color="#f2f3f5">
				{label}
			</Text>
			<Stack direction="horizontal" spacing={10} align="center">
				<Stack
					style={{
						width: 30,
						height: 30,
						borderRadius: 8,
						backgroundColor: value,
						borderWidth: 1,
						borderColor: 'rgba(255,255,255,0.2)',
					}}
				/>
				<Stack style={{ flex: 1 }}>
					<TextInput
						value={value}
						placeholder="#1e1f22"
						onChange={next => {
							if (/^#?[0-9a-fA-F]{0,8}$/.test(next)) onChange(next.startsWith('#') ? next : `#${next}`)
						}}
					/>
				</Stack>
			</Stack>
			<Stack direction="horizontal" spacing={6}>
				{SWATCHES.map(swatch => (
					<Button
						key={swatch}
						size="sm"
						variant="secondary"
						text={swatch.replace('#', '')}
						onPress={() => onChange(swatch)}
					/>
				))}
			</Stack>
		</Stack>
	)
}

const SWATCHES = ['#1e1f22', '#5865f2', '#57f287', '#eb459e', '#faa61a', '#2b2d31']

const PRESET_PALETTES: { name: string; values: Partial<CustomStyle> }[] = [
	{
		name: 'Midnight',
		values: { panelColor: '#0f1117', accentColor: '#5865f2', transparency: 0.45, radius: 16 },
	},
	{
		name: 'Sakura',
		values: { panelColor: '#2a1b24', accentColor: '#eb459e', transparency: 0.5, radius: 20 },
	},
	{
		name: 'Frost',
		values: { panelColor: '#16202b', accentColor: '#57f287', transparency: 0.6, radius: 14 },
	},
]

export default SettingsComponent

/** `Page` comes from Revenge's component library; imported lazily so the
 * settings screen still renders if the component library moved. */
function Page({ children }: { children: ReactNode }) {
	return <Stack style={{ paddingBottom: 24 }}>{children}</Stack>
}
