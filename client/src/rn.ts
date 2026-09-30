import type { ReactNativeModule } from './rn.types'

export type { ReactNativeModule }

/**
 * Non-native runtimes (Node, tests, web). React Native bundlers resolve
 * `rn.native.ts` instead, which imports react-native statically.
 */
export function getReactNative(): ReactNativeModule | null {
  return null
}
