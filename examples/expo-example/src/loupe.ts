import AsyncStorage from '@react-native-async-storage/async-storage'
import createLoupe from 'loupe-rn'
import { useCartStore } from './store'

// Inert in release builds: `enabled` defaults to __DEV__.
export const loupe = createLoupe({ appName: 'Loupe Example', asyncStorage: AsyncStorage }).connect()

loupe.trackZustand('cart', useCartStore)

loupe.registerCommand({
  id: 'clear-cart',
  title: 'Clear cart',
  description: 'Empties the Zustand cart store.',
  handler: () => {
    useCartStore.getState().clear()
    return 'Cart cleared'
  }
})

loupe.registerCommand({
  id: 'add-items',
  title: 'Add items',
  description: 'Adds N items to the cart.',
  args: [{ name: 'count', type: 'number' }],
  handler: ({ count }) => {
    const n = Math.min(20, Number(count) || 1)
    for (let i = 0; i < n; i++) useCartStore.getState().add(`SKU-${i}`)
    return { added: n, total: useCartStore.getState().items.length }
  }
})
