import type { DeviceInfo, Platform } from './protocol'
import { PROTOCOL_VERSION } from './protocol'
import { SDK_VERSION } from './version'
import { getReactNative, type ReactNativeModule } from './rn'

export { getReactNative, SDK_VERSION }

export function getBundleUrl(rn: ReactNativeModule | null = getReactNative()): string | undefined {
  const sourceCode = rn?.NativeModules?.SourceCode
  return sourceCode?.scriptURL ?? sourceCode?.getConstants?.().scriptURL
}

/** Metro's bundle URL host is the dev machine, which is also where Loupe runs. */
export function detectHost(rn: ReactNativeModule | null = getReactNative()): string {
  const url = getBundleUrl(rn)
  const match = url?.match(/^https?:\/\/([^:/]+)/)
  return match?.[1] ?? 'localhost'
}

const IOS_IDIOMS: Record<string, string> = {
  phone: 'iPhone',
  pad: 'iPad',
  tv: 'Apple TV',
  mac: 'Mac',
  vision: 'Vision Pro'
}
const iosIdiomName = (idiom: string | undefined): string | undefined =>
  idiom ? (IOS_IDIOMS[idiom] ?? idiom) : undefined

const toPlatform = (os: string | undefined): Platform =>
  os === 'ios' || os === 'android' || os === 'web' ? os : 'unknown'

export function collectDeviceInfo(appName: string, rn: ReactNativeModule | null = getReactNative()): DeviceInfo {
  const platform = rn?.Platform
  const constants = platform?.constants
  const version = constants?.reactNativeVersion
  const window = rn?.Dimensions?.get('window')
  const model = constants?.Model
  const isEmulator = /sdk|emulator|simulator/i.test(`${model ?? ''} ${constants?.Fingerprint ?? ''}`)
  return {
    appName,
    platform: toPlatform(platform?.OS),
    osVersion: platform?.Version !== undefined ? String(platform.Version) : undefined,
    deviceName: model ? [constants?.Brand, model].filter(Boolean).join(' ') : iosIdiomName(constants?.interfaceIdiom),
    rnVersion: version ? `${version.major}.${version.minor}.${version.patch}` : undefined,
    sdkVersion: SDK_VERSION,
    isEmulator: isEmulator || undefined,
    hermes: typeof (globalThis as { HermesInternal?: unknown }).HermesInternal === 'object',
    bundleUrl: getBundleUrl(rn),
    screen: window ? { width: window.width, height: window.height, scale: window.scale } : undefined,
    protocolVersion: PROTOCOL_VERSION
  }
}
