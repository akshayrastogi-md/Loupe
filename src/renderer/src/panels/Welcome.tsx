import { Copy, Radio } from 'lucide-react'
import { useAppStore } from '../store/appStore'
import { copyText } from '../lib/actions'

const installSnippet = (port: number): string => `// index.js (or App.tsx) — load before anything else
import AsyncStorage from '@react-native-async-storage/async-storage'
import createLoupe from 'loupe-rn'

if (__DEV__) {
  const loupe = createLoupe({
    appName: 'My App',
    asyncStorage: AsyncStorage,${port !== 9393 ? `\n    port: ${port},` : ''}
  }).connect()

  // Redux Toolkit:
  // configureStore({ reducer, enhancers: (d) => d().concat(loupe.reduxEnhancer()) })
  // Zustand:
  // loupe.trackZustand('app', useAppStore)
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
        {status.listening ? (
          <p className="dim">
            Loupe is listening on <span className="mono">port {status.port}</span>. Add the client SDK to your app and
            it connects automatically on simulators, emulators and devices on your network.
          </p>
        ) : (
          <div className="welcome-error" role="alert">
            <strong>Loupe can’t accept connections:</strong> {status.error ?? 'the server is not running'}.{' '}
            {status.error?.includes('in use') && 'Another copy of Loupe (or another tool) may be using it. '}
            <button className="btn sm" onClick={() => setSettingsOpen(true)}>
              Change port
            </button>
          </div>
        )}

        <div className="steps">
          <div className="step">
            <span className="step-num">1</span>
            <div className="grow">
              <div className="step-title">Install the client</div>
              <div className="code-line">
                <code>npm install --save-dev loupe-rn</code>
                <button
                  className="icon-btn sm"
                  onClick={() => copyText('npm install --save-dev loupe-rn')}
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
          Want to look around first? Run <code>npm run demo</code> in the Loupe repo to connect a simulated app.
        </p>
      </div>
    </div>
  )
}
