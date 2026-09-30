/** The slice of the react-native module the SDK uses. */
export interface ReactNativeModule {
  Platform?: {
    OS?: string
    Version?: string | number
    constants?: {
      Model?: string
      Brand?: string
      reactNativeVersion?: { major: number; minor: number; patch: number }
      isTesting?: boolean
      Fingerprint?: string
      systemName?: string
      interfaceIdiom?: string
    }
  }
  Dimensions?: { get(dim: 'window'): { width: number; height: number; scale: number } }
  NativeModules?: { SourceCode?: { scriptURL?: string; getConstants?: () => { scriptURL?: string } } }
  DevSettings?: { reload(reason?: string): void; openDevMenu?: () => void }
}
