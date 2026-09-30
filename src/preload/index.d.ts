import type { LoupeBridge } from '../shared/types'

declare global {
  interface Window {
    loupe: LoupeBridge
  }
}

export {}
