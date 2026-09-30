import { useEffect, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { StatusBar } from 'expo-status-bar'
import { loupe } from './src/loupe'
import { useCartStore } from './src/store'

const API = 'https://jsonplaceholder.typicode.com'
const AUTO_REQUEST_MS = 4000

async function sampleTraffic(tick: number): Promise<string> {
  const results: string[] = []
  const get = await fetch(`${API}/todos/${(tick % 5) + 1}`)
  results.push(`GET todo → ${get.status}`)
  const post = await fetch(`${API}/posts`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ title: 'hello', tick })
  })
  results.push(`POST → ${post.status}`)
  const missing = await fetch(`${API}/definitely-missing`)
  results.push(`GET missing → ${missing.status}`)

  // Raw XMLHttpRequest, like axios uses.
  await new Promise<void>((resolve) => {
    const xhr = new XMLHttpRequest()
    xhr.open('GET', `${API}/users/1`)
    xhr.onload = () => {
      results.push(`XHR user → ${xhr.status}`)
      resolve()
    }
    xhr.onerror = () => {
      results.push('XHR failed')
      resolve()
    }
    xhr.send()
  })
  return results.join('\n')
}

export default function App() {
  const [log, setLog] = useState('Starting…')
  const items = useCartStore((s) => s.items)

  useEffect(() => {
    let tick = 0
    const run = (): void => {
      tick += 1
      console.log('Traffic tick', { tick, cartSize: useCartStore.getState().items.length })
      sampleTraffic(tick)
        .then(setLog)
        .catch((err: Error) => {
          console.warn('Request failed', err.message)
          setLog(`Failed: ${err.message}`)
        })
    }
    run()
    const timer = setInterval(run, AUTO_REQUEST_MS)
    void AsyncStorage.setItem('@example/launchedAt', new Date().toISOString())
    return () => clearInterval(timer)
  }, [])

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Loupe example</Text>
      <Text style={styles.sub}>Loupe connected: {String(loupe.isConnected())}</Text>
      <Text style={styles.sub}>Cart items: {items.length}</Text>
      <View style={styles.row}>
        <Pressable style={styles.button} onPress={() => useCartStore.getState().add(`SKU-${Date.now() % 1000}`)}>
          <Text style={styles.buttonText}>Add to cart</Text>
        </Pressable>
        <Pressable
          style={styles.button}
          onPress={() => {
            try {
              throw new Error('Handled error from the example app')
            } catch (err) {
              loupe.reportError(err)
              console.error('Reported error', err)
            }
          }}
        >
          <Text style={styles.buttonText}>Report error</Text>
        </Pressable>
      </View>
      <ScrollView style={styles.log}>
        <Text style={styles.mono}>{log}</Text>
      </ScrollView>
      <StatusBar style="auto" />
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0b0d12', paddingTop: 80, paddingHorizontal: 20 },
  title: { color: '#fff', fontSize: 24, fontWeight: '700' },
  sub: { color: '#a1a9ba', marginTop: 6 },
  row: { flexDirection: 'row', gap: 10, marginTop: 20 },
  button: { backgroundColor: '#8b6cff', paddingVertical: 10, paddingHorizontal: 14, borderRadius: 8 },
  buttonText: { color: '#fff', fontWeight: '600' },
  log: { marginTop: 20 },
  mono: { color: '#e6e8ee', fontFamily: 'Menlo' }
})
