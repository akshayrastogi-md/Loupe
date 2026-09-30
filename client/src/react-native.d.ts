// Minimal ambient types so the SDK builds without installing react-native.
declare module 'react-native' {
  export const Dimensions: unknown
  export const DevSettings: unknown
  export const NativeModules: unknown
  export const Platform: unknown
}
