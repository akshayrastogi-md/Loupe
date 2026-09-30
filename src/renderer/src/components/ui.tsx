import { useState, type ReactNode } from 'react'
import { ChevronRight, Search, X } from 'lucide-react'

export function Tabs<T extends string>({
  tabs,
  value,
  onChange,
  right
}: {
  tabs: ReadonlyArray<{ id: T; label: string; count?: number }>
  value: T
  onChange: (id: T) => void
  right?: ReactNode
}) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          role="tab"
          aria-selected={value === tab.id}
          className={`tab${value === tab.id ? ' active' : ''}`}
          onClick={() => onChange(tab.id)}
        >
          {tab.label}
          {tab.count !== undefined && <span className="faint">{tab.count}</span>}
        </button>
      ))}
      <span className="spacer" />
      {right && <div className="row">{right}</div>}
    </div>
  )
}

export function SearchInput({
  value,
  onChange,
  placeholder = 'Filter',
  width,
  inputRef
}: {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  width?: number
  inputRef?: React.Ref<HTMLInputElement>
}) {
  return (
    <label className="search">
      <Search size={13} />
      <input
        ref={inputRef}
        className="input"
        style={width ? { width } : undefined}
        value={value}
        placeholder={placeholder}
        spellCheck={false}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => e.key === 'Escape' && onChange('')}
        data-search
      />
      {value && (
        <button
          className="icon-btn sm"
          style={{ position: 'absolute', right: 3 }}
          onClick={() => onChange('')}
          aria-label="Clear filter"
        >
          <X size={12} />
        </button>
      )}
    </label>
  )
}

export function Chips<T extends string>({
  options,
  value,
  onToggle
}: {
  options: ReadonlyArray<{ id: T; label: string; count?: number }>
  value: readonly T[]
  onToggle: (id: T | null) => void
}) {
  return (
    <div className="chips">
      <button className={`chip${value.length === 0 ? ' active' : ''}`} onClick={() => onToggle(null)}>
        All
      </button>
      {options.map((opt) => (
        <button
          key={opt.id}
          className={`chip${value.includes(opt.id) ? ' active' : ''}`}
          onClick={() => onToggle(opt.id)}
        >
          {opt.label}
          {opt.count !== undefined && opt.count > 0 && <span className="count">{opt.count}</span>}
        </button>
      ))}
    </div>
  )
}

export function Switch({ on, onChange, label }: { on: boolean; onChange: (on: boolean) => void; label?: string }) {
  return (
    <button
      role="switch"
      aria-checked={on}
      aria-label={label}
      className={`switch${on ? ' on' : ''}`}
      onClick={() => onChange(!on)}
    />
  )
}

export function EmptyState({ icon, title, children }: { icon: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <div className="empty-icon">{icon}</div>
      <h3>{title}</h3>
      {children && <p>{children}</p>}
    </div>
  )
}

export function Section({
  title,
  count,
  defaultOpen = true,
  actions,
  children
}: {
  title: string
  count?: number
  defaultOpen?: boolean
  actions?: ReactNode
  children: ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="section">
      <div className="row" style={{ paddingRight: 10 }}>
        <button className="section-head" onClick={() => setOpen(!open)}>
          <ChevronRight
            size={13}
            style={{ transform: open ? 'rotate(90deg)' : undefined, transition: 'transform 100ms' }}
          />
          {title}
          {count !== undefined && <span className="count">({count})</span>}
        </button>
        {actions}
      </div>
      {open && <div className="section-body">{children}</div>}
    </div>
  )
}

export function KeyValue({
  entries,
  empty = 'None'
}: {
  entries: ReadonlyArray<readonly [string, ReactNode]>
  empty?: string
}) {
  if (!entries.length) return <div className="faint">{empty}</div>
  return (
    <dl className="kv">
      {entries.map(([k, v], i) => (
        <div key={`${k}-${i}`} style={{ display: 'contents' }}>
          <dt>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  )
}

export function Modal({
  title,
  onClose,
  children,
  footer,
  width
}: {
  title: ReactNode
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
  width?: number
}) {
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        className="modal"
        role="dialog"
        aria-modal
        style={width ? { width } : undefined}
        onKeyDown={(e) => e.key === 'Escape' && onClose()}
      >
        <div className="modal-head">
          {title}
          <span className="spacer" />
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <X size={15} />
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  )
}
