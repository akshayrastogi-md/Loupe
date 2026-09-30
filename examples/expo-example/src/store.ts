import { create } from 'zustand'

interface CartState {
  items: string[]
  add: (sku: string) => void
  clear: () => void
}

export const useCartStore = create<CartState>((set) => ({
  items: [],
  add: (sku) => set((state) => ({ items: [...state.items, sku] })),
  clear: () => set({ items: [] })
}))
