// Named imports keep react-native's lazy module getters lazy.
import { Dimensions, DevSettings, NativeModules, Platform } from 'react-native'
import type { ReactNativeModule } from './rn.types'

export type { ReactNativeModule }

const reactNative = { Dimensions, DevSettings, NativeModules, Platform } as unknown as ReactNativeModule

export function getReactNative(): ReactNativeModule {
  return reactNative
}
