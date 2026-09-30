import { Copy, Radio } from 'lucide-react'
import { useAppStore } from '../store/appStore'
import { copyText } from '../lib/actions'

const installSnippet = (port: number): string => `// index.js (or App.tsx) — load before anything else
import AsyncStorage from '@react-native-async-storage/async-storage'
import createPrism from 'prism-devtools-client'

if (__DEV__) {
  const prism = createPrism({
    appName: 'My App',
    asyncStorage: AsyncStorage,${port !== 9393 ? `\n    port: ${port},` : ''}
  }).connect()

  // Redux Toolkit:
  // configureStore({ reducer, enhancers: (d) => d().concat(prism.reduxEnhancer()) })
  // Zustand:
  // prism.trackZustand('app', useAppStore)
}`

export function Welcome() {
  const status = useAppStore((s) => s.status)
  const setSettingsOpen = useAppStore((s) => s.setSettingsOpen)
  const snippet = installSnippet(status.port)

  return (
    <div className="welcome scroll">
      <div className="welcome-inner">
        <div className="welcome-pulse">
          <Radio size={26} />
        </div>
        <h1>Waiting for your React Native app</h1>
        <p className="dim">
          Prism is listening on <span className="mono">{status.listening ? `port ${status.port}` : 'no port'}</span>.
          Add the client SDK to your app and it connects automatically on simulators, emulators and devices on your
          network.
        </p>

        <div className="steps">
          <div className="step">
            <span className="step-num">1</span>
            <div className="grow">
              <div className="step-title">Install the client</div>
              <div className="code-line">
                <code>npm install --save-dev prism-devtools-client</code>
                <button
                  className="icon-btn sm"
                  onClick={() => copyText('npm install --save-dev prism-devtools-client')}
                  aria-label="Copy"
                >
                  <Copy size={12} />
                </button>
              </div>
            </div>
          </div>
          <div className="step">
            <span className="step-num">2</span>
            <div className="grow" style={{ minWidth: 0 }}>
              <div className="row">
                <div className="step-title">Connect it in development</div>
                <span className="spacer" />
                <button className="btn sm ghost" onClick={() => copyText(snippet, 'Snippet copied')}>
                  <Copy size={12} /> Copy
                </button>
              </div>
              <pre className="code">{snippet}</pre>
            </div>
          </div>
          <div className="step">
            <span className="step-num">3</span>
            <div className="grow">
              <div className="step-title">Run your app</div>
              <div className="dim" style={{ fontSize: 12.5 }}>
                iOS simulator works out of the box. Android emulator: click <strong>adb reverse</strong> in Device, or
                the host is detected from Metro automatically. Physical devices: enable{' '}
                <a
                  href="#"
                  onClick={(e) => {
                    e.preventDefault()
                    setSettingsOpen(true)
                  }}
                >
                  LAN connections
                </a>{' '}
                in settings
                {status.addresses.length > 1 && (
                  <>
                    {' '}
                    (this machine: <span className="mono">{status.addresses.slice(1).join(', ')}</span>)
                  </>
                )}
                .
              </div>
            </div>
          </div>
        </div>
        <p className="faint" style={{ fontSize: 12 }}>
          Want to look around first? Run <code>npm run demo</code> in the Prism repo to connect a simulated app.
        </p>
      </div>
    </div>
  )
}
