import type { PrismBridge } from '../shared/types'

declare global {
  interface Window {
    prism: PrismBridge
  }
}

export {}
