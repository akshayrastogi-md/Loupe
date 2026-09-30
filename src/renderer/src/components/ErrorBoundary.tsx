import { Component, type ErrorInfo, type ReactNode } from 'react'
import { RotateCcw, TriangleAlert } from 'lucide-react'

interface Props {
  children: ReactNode
  /** Changing this key resets the boundary (e.g. switching panels). */
  resetKey: string
}

interface State {
  error: Error | null
}

/** Contains a crashing panel so the rest of the app keeps working. */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Surfaces in the main-process log via electron-log's renderer error capture.
    console.error('Panel crashed:', error, info.componentStack)
  }

  componentDidUpdate(prev: Props): void {
    if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null })
  }

  render(): ReactNode {
    const { error } = this.state
    if (!error) return this.props.children
    return (
      <div className="empty">
        <div className="empty-icon" style={{ color: 'var(--red)' }}>
          <TriangleAlert size={22} />
        </div>
        <h3>This panel hit an error</h3>
        <p className="mono" style={{ maxWidth: 560 }}>
          {error.message}
        </p>
        <button className="btn" onClick={() => this.setState({ error: null })}>
          <RotateCcw size={13} /> Try again
        </button>
      </div>
    )
  }
}
