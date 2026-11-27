/**
 * Settings screen for the stable (Revenge/Bunny) client.
 *
 * Stable Revenge renders `SettingsComponent` as a plain React component inside a
 * "BUNNY_CUSTOM_PAGE" and passes no props. Everything therefore comes from the
 * loader API and the plugin's own storage, both reached through the bridge.
 *
 * The screen reuses the shared style tokens and defaults, so both builds offer
 * exactly the same styles and knobs. Where a host lacks a component (an older
 * Discord without `TableRadioGroup`, say) the control degrades to a simpler one
 * instead of crashing the settings page.
 */
import * as React from 'react'
import { ScrollView, View } from 'react-native'
import { PROFILES, autoProfileFor } from '../profiles'
import {
	DEFAULT_SETTINGS,
	cloneSettings,
	type GlassPreset,
	type ProfileId,
	type Settings,
	type StyleId,
} from '../shared'
import { GLASS_PRESETS, STYLE_PRESETS, SURFACES } from '../styles/engine'
import { capabilities, design, reactNative, toast } from './bridge'
import { detectDevice } from './device'
import { getDiagnostics, getSettings, setSettings, subscribe, subscribeDiagnostics } from './state'
import type { Capabilities } from './bridge'

const TIER_LABEL: Record<string, string> = {
	low: 'Low-end',
	mid: 'Mid-range',
	high: 'High-end',
}

/** Resolves Discord's row components once per render. */
function rows() {
	const components = design()
	return {
		TableRowGroup: components.TableRowGroup,
		TableRow: components.TableRow,
		TableSwitchRow: components.TableSwitchRow,
		TableRadioGroup: components.TableRadioGroup,
	}
}

const PALETTE = {
	text: '#f2f3f5',
	muted: '#949ba4',
	label: '#b5bac1',
	border: 'rgba(255,255,255,0.10)',
	chip: 'rgba(255,255,255,0.08)',
}

/**
 * Subscribes the component to settings/diagnostics changes.
 *
 * Built on useReducer + useEffect instead of `useSyncExternalStore`: the store
 * hook is React 18-only, and Discord's Android React renderer does not
 * implement it — calling it throws "undefined is not a function" while the
 * screen mounts (verified on Valenced, whose PluginSettings boundary surfaces
 * the error). useReducer/useEffect exist since React 16.8, which every RN
 * renderer ships.
 */
function useStore() {
	const [, forceUpdate] = React.useReducer((counter: number) => counter + 1, 0)
	React.useEffect(() => subscribe(forceUpdate), [forceUpdate])
	return getSettings()
}

/** Re-renders on diagnostics ticks only, so counters stay live while open. */
function useDiagnostics() {
	const [, forceUpdate] = React.useReducer((counter: number) => counter + 1, 0)
	React.useEffect(() => subscribeDiagnostics(forceUpdate), [forceUpdate])
	return getDiagnostics()
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
	const { TableRowGroup } = rows()
	if (TableRowGroup) {
		return (
			<View style={{ marginTop: 16 }}>
				<TableRowGroup title={title}>{children}</TableRowGroup>
			</View>
		)
	}
	return (
		<View style={{ marginTop: 18, paddingHorizontal: 16 }}>
			<Text
				style={{
					color: PALETTE.muted,
					fontSize: 11,
					fontWeight: '600',
					marginBottom: 6,
					letterSpacing: 1.4,
					textTransform: 'uppercase',
				}}
			>
				{title}
			</Text>
			{children}
		</View>
	)
}

function Text({ children, style }: { children: React.ReactNode; style?: any }) {
	const { Text: RNText } = reactNative()
	return <RNText style={style}>{children}</RNText>
}

function Switch(props: {
	label: string
	subLabel?: string
	value: boolean
	onValueChange: (value: boolean) => void
}) {
	const { TableSwitchRow, TableRow } = rows()
	const Row = TableSwitchRow ?? TableRow
	if (Row) {
		return (
			<Row
				label={props.label}
				subLabel={props.subLabel}
				value={props.value}
				onValueChange={props.onValueChange}
			/>
		)
	}
	return (
		<FallbackRow
			label={props.label}
			subLabel={props.subLabel}
			trailing={props.value ? 'On' : 'Off'}
			onPress={() => props.onValueChange(!props.value)}
		/>
	)
}

/** A plain row, used when Discord's rows are unavailable. */
function FallbackRow(props: {
	label: string
	subLabel?: string
	trailing?: string
	onPress?: () => void
}) {
	const { Pressable } = reactNative()
	return (
		<Pressable
			onPress={props.onPress}
			style={{
				flexDirection: 'row',
				justifyContent: 'space-between',
				alignItems: 'center',
				paddingVertical: 12,
				borderBottomWidth: 1,
				borderBottomColor: PALETTE.border,
			}}
		>
			<View style={{ flex: 1, paddingRight: 12 }}>
				<Text style={{ color: PALETTE.text, fontSize: 15 }}>{props.label}</Text>
				{props.subLabel ? (
					<Text style={{ color: PALETTE.muted, fontSize: 12, marginTop: 2 }}>
						{props.subLabel}
					</Text>
				) : null}
			</View>
			{props.trailing ? (
				<Text style={{ color: PALETTE.label, fontSize: 13 }}>{props.trailing}</Text>
			) : null}
		</Pressable>
	)
}

/** A single-select list. Uses Discord's radio group when available. */
function Choice<T extends string>(props: {
	title: string
	value: T
	options: { id: T; label: string; description?: string }[]
	onChange: (value: T) => void
}) {
	const { TableRadioGroup } = rows()
	if (TableRadioGroup?.Row) {
		return (
			<TableRadioGroup title={props.title} value={props.value} onChange={props.onChange}>
				{props.options.map(option => (
					<TableRadioGroup.Row
						key={option.id}
						label={option.label}
						subLabel={option.description}
						value={option.id}
					/>
				))}
			</TableRadioGroup>
		)
	}
	return (
		<Section title={props.title}>
			{props.options.map(option => (
				<FallbackRow
					key={option.id}
					label={`${props.value === option.id ? '● ' : '○ '}${option.label}`}
					subLabel={option.description}
					onPress={() => props.onChange(option.id)}
				/>
			))}
		</Section>
	)
}

/** Normalizes `#rgb`/`#rrggbb` to lowercase `#rrggbb`, or undefined when invalid. */
function normalizeHex(input: string): string | undefined {
	const raw = input.trim().replace(/^#/, '')
	const full = raw.length === 3 ? raw.split('').map(part => part + part).join('') : raw
	return /^[0-9a-fA-F]{6}$/.test(full) ? `#${full.toLowerCase()}` : undefined
}

const ACCENT_PRESETS = ['#5865f2', '#eb459e', '#57f287', '#f0b232', '#2d7df6', '#da373c']
const PANEL_PRESETS = ['#1e1f22', '#0f1117', '#2a1b24', '#16202b', '#111111']

/** A hex color row: swatch preview, validated input, preset chips. */
function ColorRow(props: {
	label: string
	value: string
	presets?: string[]
	onChange: (value: string) => void
}) {
	const { TextInput, Pressable } = reactNative()
	const [draft, setDraft] = React.useState(props.value)
	const valid = normalizeHex(draft) !== undefined
	React.useEffect(() => {
		setDraft(props.value)
	}, [props.value])
	const commit = (text: string) => {
		setDraft(text)
		const normalized = normalizeHex(text)
		if (normalized) props.onChange(normalized)
	}
	const preview = normalizeHex(props.value) ?? PALETTE.chip
	return (
		<View
			style={{
				paddingVertical: 10,
				borderBottomWidth: 1,
				borderBottomColor: PALETTE.border,
			}}
		>
			<View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
				<Text style={{ color: PALETTE.text, fontSize: 15, flex: 1, paddingRight: 12 }}>
					{props.label}
				</Text>
				<View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
					<View
						style={{
							width: 20,
							height: 20,
							borderRadius: 6,
							backgroundColor: preview,
							borderWidth: 1,
							borderColor: PALETTE.border,
						}}
					/>
					{TextInput ? (
						<TextInput
							value={draft}
							onChangeText={commit}
							autoCapitalize="none"
							autoCorrect={false}
							spellCheck={false}
							maxLength={7}
							placeholder="#5865f2"
							placeholderTextColor={PALETTE.muted}
							style={{
								minWidth: 96,
								paddingHorizontal: 10,
								paddingVertical: 5,
								borderRadius: 8,
								borderWidth: 1,
								borderColor: valid ? PALETTE.border : '#da373c',
								color: PALETTE.text,
								backgroundColor: PALETTE.chip,
								fontSize: 13,
							}}
						/>
					) : (
						<Text style={{ color: PALETTE.label, fontSize: 13 }}>{props.value}</Text>
					)}
				</View>
			</View>
			{props.presets?.length ? (
				<View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
					{props.presets.map(color => (
						<Pressable
							key={color}
							onPress={() => {
								setDraft(color)
								props.onChange(color)
							}}
							hitSlop={6}
							style={{
								width: 26,
								height: 26,
								borderRadius: 7,
								backgroundColor: color,
								borderWidth: props.value.toLowerCase() === color ? 2 : 1,
								borderColor: props.value.toLowerCase() === color ? PALETTE.text : PALETTE.border,
							}}
						/>
					))}
				</View>
			) : null}
		</View>
	)
}

/** ± stepper for numeric settings, rendered as a row trailing control. */
function Stepper(props: {
	label: string
	value: number
	unit: string
	step: number
	min: number
	max: number
	onChange: (value: number) => void
}) {
	const { TableRow } = rows()
	const clamp = (value: number) => Math.min(props.max, Math.max(props.min, value))
	const trailing = (
		<View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
			<Chip label="−" onPress={() => props.onChange(clamp(props.value - props.step))} />
			<Text style={{ color: PALETTE.text, fontSize: 13 }}>
				{props.value} {props.unit}
			</Text>
			<Chip label="+" onPress={() => props.onChange(clamp(props.value + props.step))} />
		</View>
	)
	if (TableRow) return <TableRow label={props.label} trailing={trailing} />
	return (
		<View
			style={{
				flexDirection: 'row',
				justifyContent: 'space-between',
				alignItems: 'center',
				paddingVertical: 12,
				borderBottomWidth: 1,
				borderBottomColor: PALETTE.border,
			}}
		>
			<Text style={{ color: PALETTE.text, fontSize: 15 }}>{props.label}</Text>
			{trailing}
		</View>
	)
}

function Chip({ label, onPress }: { label: string; onPress: () => void }) {
	const { Pressable } = reactNative()
	return (
		<Pressable
			onPress={onPress}
			hitSlop={10}
			style={{
				paddingHorizontal: 12,
				paddingVertical: 4,
				borderRadius: 8,
				backgroundColor: PALETTE.chip,
			}}
		>
			<Text style={{ color: PALETTE.text, fontSize: 15 }}>{label}</Text>
		</Pressable>
	)
}

/** One label/value line in the diagnostics card. */
function Stat({ label, value }: { label: string; value: string }) {
	return (
		<View
			style={{
				flexDirection: 'row',
				justifyContent: 'space-between',
				paddingVertical: 3,
			}}
		>
			<Text style={{ color: PALETTE.label, fontSize: 13 }}>{label}</Text>
			<Text style={{ color: PALETTE.text, fontSize: 13 }}>{value}</Text>
		</View>
	)
}

export function SettingsScreen(_props?: unknown) {
	const settings = useStore()
	const device = React.useMemo(() => detectDevice(), [])
	const caps: Capabilities = React.useMemo(() => capabilities(), [])
	const diagnostics = useDiagnostics()
	const auto = autoProfileFor(device)

	const patch = (update: Partial<Settings>) => {
		const next: Settings = {
			...settings,
			...update,
			performance: { ...settings.performance, ...update.performance },
			memory: { ...settings.memory, ...update.memory },
			stability: { ...settings.stability, ...update.stability },
			network: { ...settings.network, ...update.network },
			visual: {
				...settings.visual,
				...update.visual,
				surfaces: { ...settings.visual.surfaces, ...update.visual?.surfaces },
				custom: { ...settings.visual.custom, ...update.visual?.custom },
			},
		}
		setSettings(next)
	}

	return (
		<ScrollView contentContainerStyle={{ paddingBottom: 48 }}>
			<View style={{ paddingHorizontal: 16, paddingTop: 16 }}>
				<Text style={{ color: PALETTE.text, fontSize: 21, fontWeight: '700' }}>
					Performance Enhancer
				</Text>
				<Text style={{ color: PALETTE.muted, fontSize: 12, marginTop: 6 }}>
					{device.summary}
				</Text>
				<Text style={{ color: PALETTE.label, fontSize: 12, marginTop: 2 }}>
					{TIER_LABEL[device.tier] ?? device.tier} tier · auto picks {auto.label}
				</Text>
			</View>

			<Section title="Profile">
				<Choice<ProfileId>
					title="Performance profile"
					value={settings.performance.profile}
					options={[
						{
							id: 'auto',
							label: `Auto · ${auto.label}`,
							description: 'Follows the detected device tier.',
						},
						{ id: 'battery', label: PROFILES.battery.label, description: PROFILES.battery.description },
						{ id: 'balanced', label: PROFILES.balanced.label, description: PROFILES.balanced.description },
						{
							id: 'aggressive',
							label: PROFILES.aggressive.label,
							description: PROFILES.aggressive.description,
						},
					]}
					onChange={profile => patch({ performance: { ...settings.performance, profile } })}
				/>
				<Switch
					label="Confirm the profile on start"
					subLabel="Shows a short toast whenever the plugin starts."
					value={settings.performance.toastOnStart}
					onValueChange={toastOnStart =>
						patch({ performance: { ...settings.performance, toastOnStart } })
					}
				/>
			</Section>

			<Section title="Memory">
				<Switch
					label="Trim caches in the background"
					subLabel="Clears Discord's image cache when the app leaves the foreground."
					value={settings.memory.trimOnBackground}
					onValueChange={trimOnBackground =>
						patch({ memory: { ...settings.memory, trimOnBackground } })
					}
				/>
				<Switch
					label="Collect garbage after a trim"
					subLabel="Runs the Hermes garbage collector when the runtime exposes it."
					value={settings.memory.aggressiveGc}
					onValueChange={aggressiveGc => patch({ memory: { ...settings.memory, aggressiveGc } })}
				/>
				<Stepper
					label="Image cache limit"
					value={settings.memory.imageCacheLimitMb}
					unit="MB"
					step={8}
					min={8}
					max={256}
					onChange={imageCacheLimitMb =>
						patch({ memory: { ...settings.memory, imageCacheLimitMb } })
					}
				/>
				<Stepper
					label="Cached channels"
					value={settings.memory.maxCachedChannels}
					unit="ch"
					step={1}
					min={4}
					max={32}
					onChange={maxCachedChannels =>
						patch({ memory: { ...settings.memory, maxCachedChannels } })
					}
				/>
			</Section>

			<Section title="Stability">
				<Switch
					label="Recover from errors"
					subLabel="Re-establishes gateway and Flux subscriptions after non-fatal failures."
					value={settings.stability.autoRecover}
					onValueChange={autoRecover =>
						patch({ stability: { ...settings.stability, autoRecover } })
					}
				/>
				<Switch
					label="Circuit breaker"
					subLabel="Stops a failing component after repeated errors instead of looping forever."
					value={settings.stability.circuitBreaker}
					onValueChange={circuitBreaker =>
						patch({ stability: { ...settings.stability, circuitBreaker } })
					}
				/>
				<Switch
					label="Throttle retry storms"
					subLabel="Caps repeated retries before an error is surfaced."
					value={settings.stability.throttleRetries}
					onValueChange={throttleRetries =>
						patch({ stability: { ...settings.stability, throttleRetries } })
					}
				/>
				<Switch
					label="Heartbeat logging"
					subLabel="Logs a memory and GC heartbeat once a minute. Useful when reporting bugs."
					value={settings.stability.diagnostics}
					onValueChange={diagnostics =>
						patch({ stability: { ...settings.stability, diagnostics } })
					}
				/>
			</Section>

			<Section title="Network">
				<Switch
					label="Block telemetry"
					subLabel="Drops analytics and science dispatches before they leave the app."
					value={settings.network.blockTelemetry}
					onValueChange={blockTelemetry =>
						patch({ network: { ...settings.network, blockTelemetry } })
					}
				/>
			</Section>

			<Section title="Visual style">
				<Choice<StyleId>
					title="Style"
					value={settings.visual.style}
					options={STYLE_PRESETS.map(preset => ({
						id: preset.id,
						label: preset.label,
						description: preset.description,
					}))}
					onChange={style => {
						const preset = STYLE_PRESETS.find(entry => entry.id === style)
						patch({
							visual: {
								...settings.visual,
								style,
								glass: preset?.glass ?? settings.visual.glass,
							},
						})
						toast(`${preset?.label ?? 'Style'} style applied`)
					}}
				/>
				{settings.visual.style !== 'off' && settings.visual.style !== 'custom' ? (
					<Choice<GlassPreset>
						title="Frost intensity"
						value={settings.visual.glass}
						options={GLASS_PRESETS.map(preset => ({
							id: preset.id,
							label: preset.label,
							description: preset.description,
						}))}
						onChange={glass => patch({ visual: { ...settings.visual, glass } })}
					/>
				) : null}
			</Section>

			{settings.visual.style === 'custom' ? (
				<Section title="Custom style">
					<ColorRow
						label="Panel color"
						value={settings.visual.custom.panelColor}
						presets={PANEL_PRESETS}
						onChange={panelColor =>
							patch({
								visual: {
									...settings.visual,
									custom: { ...settings.visual.custom, panelColor },
								},
							})
						}
					/>
					<ColorRow
						label="Accent color"
						value={settings.visual.custom.accentColor}
						presets={ACCENT_PRESETS}
						onChange={accentColor =>
							patch({
								visual: {
									...settings.visual,
									custom: { ...settings.visual.custom, accentColor },
								},
							})
						}
					/>
					<Stepper
						label="Corner radius"
						value={settings.visual.custom.radius}
						unit="dp"
						step={1}
						min={0}
						max={32}
						onChange={radius =>
							patch({
								visual: {
									...settings.visual,
									custom: { ...settings.visual.custom, radius },
								},
							})
						}
					/>
					<Stepper
						label="Transparency"
						value={Math.round(settings.visual.custom.transparency * 100)}
						unit="%"
						step={5}
						min={0}
						max={100}
						onChange={percent =>
							patch({
								visual: {
									...settings.visual,
									custom: { ...settings.visual.custom, transparency: percent / 100 },
								},
							})
						}
					/>
					<Stepper
						label="Border strength"
						value={settings.visual.custom.border}
						unit="dp"
						step={0.5}
						min={0}
						max={4}
						onChange={border =>
							patch({
								visual: {
									...settings.visual,
									custom: { ...settings.visual.custom, border },
								},
							})
						}
					/>
					<Switch
						label="Saturate highlights"
						subLabel="Tints panels with the accent colour instead of white."
						value={settings.visual.custom.saturate}
						onValueChange={saturate =>
							patch({
								visual: {
									...settings.visual,
									custom: { ...settings.visual.custom, saturate },
								},
							})
						}
					/>
				</Section>
			) : null}

			<Section title="Surfaces">
				{SURFACES.map(surface => (
					<Switch
						key={surface.id}
						label={surface.label}
						subLabel={surface.description}
						value={settings.visual.surfaces[surface.id]}
						onValueChange={value =>
							patch({
								visual: {
									...settings.visual,
									surfaces: { ...settings.visual.surfaces, [surface.id]: value },
								},
							})
						}
					/>
				))}
			</Section>

			<Section title="Extras">
				<Switch
					label="Round avatars"
					subLabel="Clips avatars and profile pictures into circles."
					value={settings.visual.roundAvatars}
					onValueChange={roundAvatars =>
						patch({ visual: { ...settings.visual, roundAvatars } })
					}
				/>
				<Switch
					label="Themes screen integration"
					subLabel="Registers the Liquid Frost palette in the Revenge Themes screen."
					value={settings.visual.registerThemes}
					onValueChange={registerThemes =>
						patch({ visual: { ...settings.visual, registerThemes } })
					}
				/>
			</Section>

			<Section title="Diagnostics">
				<Stat label="Heap used" value={`${diagnostics.heapUsedMb.toFixed(1)} MB`} />
				<Stat
					label="Cache trims"
					value={`${diagnostics.trims} · ${formatBytes(diagnostics.bytesReleased)}`}
				/>
				<Stat label="Dropped dispatches" value={String(diagnostics.dropped)} />
				<Stat label="Style hooks" value={String(diagnostics.hooked)} />
				<Stat
					label="Uptime"
					value={`${Math.round((Date.now() - diagnostics.startedAt) / 1000)}s`}
				/>
			</Section>

			<Section title="About">
				<Stat label="Runtime" value={caps.patcher && caps.flux ? 'full' : 'limited'} />
				<Stat label="Settings rows" value={caps.design ? 'native' : 'fallback'} />
				<View style={{ paddingVertical: 10 }}>
					<Text style={{ color: PALETTE.muted, fontSize: 12, lineHeight: 17 }}>
						Changes apply live — no reload needed. If a surface does not change, reload
						Discord once from the plugin menu.
					</Text>
				</View>
			</Section>

			<Section title="Reset">
				<FallbackRow
					label="Reset all settings"
					subLabel="Restores every option to its default value."
					trailing="Reset"
					onPress={() => {
						setSettings(cloneSettings(DEFAULT_SETTINGS))
						toast('Performance Enhancer settings restored')
					}}
				/>
			</Section>

			<View style={{ alignItems: 'center', paddingVertical: 18 }}>
				<Text style={{ color: PALETTE.muted, fontSize: 11 }}>
					Performance Enhancer · adaptive tuning for Discord
				</Text>
			</View>
		</ScrollView>
	)
}

function formatBytes(bytes: number): string {
	if (!bytes) return '0 B'
	const units = ['B', 'KB', 'MB', 'GB']
	const index = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)))
	return `${(bytes / 1024 ** index).toFixed(index > 1 ? 1 : 0)} ${units[index]}`
}

