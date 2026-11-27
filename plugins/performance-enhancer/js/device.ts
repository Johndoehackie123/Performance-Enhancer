/**
 * Device capability detection.
 *
 * Discord exposes RAM, CPU frequency and SoC metadata through its `DeviceModule`
 * native module. We combine those with the processor name to bucket the device
 * into a low/mid/high tier, which the auto profile and the UI style defaults use.
 */
import { DeviceModule } from '@revenge-mod/discord/native'
import type { DeviceTier } from './shared'

export interface DeviceInfo {
	/** RAM in gigabytes, as reported by Discord (usually approximate). */
	ramGb: number
	/** Maximum CPU frequency in GHz, 0 when unknown. */
	cpuGhz: number
	soc: string
	model: string
	brand: string
	manufacturer: string
	tier: DeviceTier
	/** Human readable summary used in the settings UI. */
	summary: string
}

const LOW_CPU_GHZ = 2.0
const MID_CPU_GHZ = 2.6

let cached: DeviceInfo | undefined

function num(value: unknown): number {
	const n = typeof value === 'number' ? value : Number.parseFloat(String(value ?? ''))
	return Number.isFinite(n) ? n : 0
}

function classify(ramGb: number, cpuGhz: number, soc: string): DeviceTier {
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

	if (isFlagshipChip) score += 2
	if (isBudgetChip) score -= 2

	if (score >= 3) return 'high'
	if (score >= 0) return 'mid'
	return 'low'
}

/** Reads device information. Safe to call before `init`, never throws. */
export function detectDevice(force = false): DeviceInfo {
	if (cached && !force) return cached

	let constants: ReturnType<typeof DeviceModule.getConstants> | undefined
	try {
		constants = DeviceModule?.getConstants?.()
	} catch {
		constants = undefined
	}

	const ramGb = num(constants?.ramSize)
	const cpuGhz = num(constants?.maxCpuFreq)
	const soc = [constants?.socName, constants?.deviceProduct, constants?.deviceModel]
		.filter(Boolean)
		.join(' ')
	const model = String(constants?.deviceModel ?? '')
	const brand = String(constants?.deviceBrand ?? '')
	const manufacturer = String(constants?.deviceManufacturer ?? '')
	const tier = classify(ramGb, cpuGhz, soc)

	const parts = [
		ramGb > 0 ? `${ramGb.toFixed(1)} GB RAM` : undefined,
		cpuGhz > 0 ? `${cpuGhz.toFixed(1)} GHz` : undefined,
		manufacturer || brand || undefined,
		model || undefined,
	].filter(Boolean)

	cached = {
		ramGb,
		cpuGhz,
		soc,
		model,
		brand,
		manufacturer,
		tier,
		summary: parts.length ? parts.join(' · ') : 'Device information unavailable',
	}
	return cached
}

/** Clears the cached detection, e.g. after a settings reset. */
export function resetDeviceDetection() {
	cached = undefined
}
