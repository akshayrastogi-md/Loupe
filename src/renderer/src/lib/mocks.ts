import { create } from 'zustand'
import type { MockRule, NetworkConditions } from '@shared/protocol'
import type { NetworkEntry } from '@shared/network'
import { useAppStore } from '../store/appStore'
import { toast } from './actions'

/** Which mock rule the Mocks panel should show in its editor. */
export const useMockSelection = create<{ selectedId: string | null; select(id: string | null): void }>((set) => ({
  selectedId: null,
  select: (selectedId) => set({ selectedId })
}))

const newId = (): string => `mock_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`

export function blankMock(): MockRule {
  return {
    id: newId(),
    name: 'New mock',
    enabled: true,
    method: 'ANY',
    matchType: 'contains',
    urlPattern: '',
    status: 200,
    headers: { 'content-type': 'application/json' },
    body: '{\n  "ok": true\n}',
    delayMs: 0
  }
}

export function mockFromEntry(entry: NetworkEntry): MockRule {
  const contentType = entry.response?.headers['content-type']
  let path = entry.request.url
  try {
    path = new URL(entry.request.url).pathname
  } catch {
    // keep the full URL when it cannot be parsed
  }
  return {
    ...blankMock(),
    name: `${entry.request.method} ${path}`,
    method: entry.request.method,
    matchType: 'exact',
    urlPattern: entry.request.url,
    status: entry.response?.status || 200,
    headers: contentType ? { 'content-type': contentType } : {},
    body: entry.response?.body ?? ''
  }
}

export async function saveMocks(mocks: MockRule[]): Promise<boolean> {
  const previous = useAppStore.getState().mocks
  useAppStore.getState().setMocks(mocks)
  try {
    await window.prism.updateMocks(mocks)
    return true
  } catch (err) {
    useAppStore.getState().setMocks(previous)
    toast('error', (err as Error).message)
    return false
  }
}

export async function saveConditions(conditions: NetworkConditions): Promise<void> {
  const previous = useAppStore.getState().conditions
  useAppStore.getState().setConditions(conditions)
  try {
    await window.prism.updateConditions(conditions)
  } catch (err) {
    useAppStore.getState().setConditions(previous)
    toast('error', (err as Error).message)
  }
}

/** Create a mock from a captured request and jump to the editor. */
export async function createMockFromEntry(entry: NetworkEntry): Promise<void> {
  const rule = mockFromEntry(entry)
  const ok = await saveMocks([...useAppStore.getState().mocks, rule])
  if (!ok) return
  useMockSelection.getState().select(rule.id)
  useAppStore.getState().setPanel('mocks')
  toast('success', 'Mock created from request')
}
