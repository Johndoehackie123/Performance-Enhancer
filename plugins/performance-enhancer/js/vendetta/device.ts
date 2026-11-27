/**
 * Device capability detection for the stable (Revenge/Bunny) runtime.
 *
 * Stable Revenge does not expose `revenge.discord.native`, so the numbers come
 * from the React Native modules Discord itself ships:
 *
 *   - `RTNDeviceManager` / `NativeDeviceModule` — SoC name, model, brand.
 *   - `RTNClientInfoManager` — OS and device strings.
 *   - `Platform.constants` — total RAM and per-core clock where available.
 *
 * Every source is optional. A device that reports nothing still gets a usable
 * tier: the classifier treats "unknown" as mid-range rather than guessing low,
 * so we never silently cripple a flagship.
 */
import type { DeviceTier } from '../shared'
import { reactNative } from './bridge'

export interface DeviceInfo {
	/** RAM in gigabytes, 0 when the host does not report it. */
	ramGb: number
	/** Highest CPU clock in GHz, 0 when unknown. */
	cpuGhz: number
	/** Number of cores, 0 when unknown. */
	cores: number
	soc: string
	model: string
	brand: string
	manufacturer: string
	tier: DeviceTier
	/** Where the numbers came from, so the UI can be honest about guesses. */
	sources: string[]
	summary: string
}

const LOW_CPU_GHZ = 2.0
const MID_CPU_GHZ = 2.6

let cached: DeviceInfo | undefined

function num(value: unknown): number {
	const n = typeof value === 'number' ? value : Number.parseFloat(String(value ?? ''))
	return Number.isFinite(n) ? n : 0
}

/** Walks `window.nativeModuleProxy` for a native module under any known name. */
function nativeModule(...names: string[]): any | undefined {
	const proxy = (globalThis as unknown as { nativeModuleProxy?: Record<string, any> })
		.nativeModuleProxy
	const turbo = (globalThis as unknown as { __turboModuleProxy?: (name: string) => any })
		.__turboModuleProxy
	for (const name of names) {
		try {
			if (turbo) {
				const module = turbo(name)
				if (module) return module
			}
			if (proxy?.[name]) return proxy[name]
		} catch {}
	}
	return undefined
}

function constantsOf(module: any): Record<string, any> {
	try {
		const constants = module?.getConstants?.()
		return constants && typeof constants === 'object' ? constants : {}
	} catch {
		return {}
	}
}

function classify(ramGb: number, cpuGhz: number, cores: number, soc: string): DeviceTier {
	const normalized = soc.toLowerCase()

	// Budget/entry chips that are frequently paired with 2-4 GB of RAM.
	const isBudgetChip =
		/(helio [gap]|mt6\d|snapdragon (4\d\d|6[0-6]\d)|exynos 8[0-5]\d\d|unisoc|t[36]10|kirin 7\d\d)/.test(
			normalized,
		)
	// Flagship chips from the last few generations.
	const isFlagshipChip =
		/(snapdragon 8|sm8\d\d\d|dimensity 9\d\d\d|tensor g[3-9]|exynos 2[2-4]\d\d|a1[5-9]|a[2-9]\d)/.test(
			normalized,
		)

	let score = 0
	if (ramGb >= 5.5) score += 2
	else if (ramGb >= 3.4) score += 1
	else if (ramGb > 0) score -= 1

	if (cpuGhz >= MID_CPU_GHZ) score += 2
	else if (cpuGhz >= LOW_CPU_GHZ) score += 1
	else if (cpuGhz > 0) score -= 1

	if (cores >= 8) score += 1
	else if (cores > 0 && cores <= 4) score -= 1

	if (isFlagshipChip) score += 2
	if (isBudgetChip) score -= 2

	if (score >= 3) return 'high'
	if (score >= 0) return 'mid'
	return 'low'
}

/** Reads device information. Never throws. */
export function detectDevice(force = false): DeviceInfo {
	if (cached && !force) return cached

	const sources: string[] = []
	const deviceModule = nativeModule('NativeDeviceModule', 'RTNDeviceManager', 'DCDDeviceManager')
	const clientModule = nativeModule(
		'NativeClientInfoModule',
		'RTNClientInfoManager',
		'InfoDictionaryManager',
	)
	const deviceConstants = constantsOf(deviceModule)
	const clientConstants = constantsOf(clientModule)

	// RAM: React Native's Platform constants carry `totalMemory` on Android.
	let ramGb = num(
		(deviceConstants as any).totalMemory ??
			(deviceConstants as any).ramSize ??
			(clientConstants as any).totalMemory,
	)
	if (ramGb > 0) {
		// Android reports bytes; some builds report megabytes or gigabytes.
		if (ramGb > 1e6) ramGb /= 1024 ** 3
		else if (ramGb > 1024) ramGb /= 1024
		sources.push('native')
	}

	let totalCores = 0
	let cpuGhz = 0
	try {
		const platform = reactNative().Platform as any
		const constants = platform?.constants ?? {}
		totalCores = num(constants.totalCores ?? constants.deviceCoreCount)
		cpuGhz = num(constants.maxCpuFrequencyHz ?? constants.deviceMaxCpuFrequencyHz)
		if (cpuGhz > 1e6) cpuGhz /= 1e9
		if (totalCores || cpuGhz) sources.push('platform')
	} catch {}

	if (!ramGb) {
		ramGb = num((deviceConstants as any).deviceTotalMemory)
		if (ramGb > 1e6) ramGb /= 1024 ** 3
		if (ramGb > 0) sources.push('device')
	}

	const soc = [
		(deviceConstants as any).socName,
		(deviceConstants as any).deviceProduct,
		(deviceConstants as any).deviceCpuModel,
	].filter(Boolean).join(' ')
	const model = String((deviceConstants as any).deviceModel ?? '')
	const brand = String((deviceConstants as any).deviceBrand ?? '')
	const manufacturer = String(
		(deviceConstants as any).deviceManufacturer ?? (deviceConstants as any).deviceVendor ?? '',
	)

	const tier = classify(ramGb, cpuGhz, totalCores, soc)

	const parts = [
		ramGb > 0 ? `${ramGb.toFixed(1)} GB RAM` : undefined,
		cpuGhz > 0 ? `${cpuGhz.toFixed(1)} GHz` : undefined,
		totalCores > 0 ? `${totalCores} cores` : undefined,
		manufacturer || brand || undefined,
		model || undefined,
	].filter(Boolean)

	cached = {
		ramGb,
		cpuGhz,
		cores: totalCores,
		soc,
		model,
		brand,
		manufacturer,
		tier,
		sources,
		summary: parts.length ? parts.join(' · ') : 'Device information unavailable',
	}
	return cached
}

export function resetDeviceDetection() {
	cached = undefined
}
