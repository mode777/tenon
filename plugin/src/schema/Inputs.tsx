import { useEffect, useRef, useState } from 'react'

export function CommitInput(props: {
  value: string
  disabled?: boolean
  placeholder?: string
  multiline?: boolean
  className?: string
  onCommit: (value: string) => void
}) {
  const [draft, setDraft] = useState(props.value)
  const focused = useRef(false)

  useEffect(() => {
    if (!focused.current) setDraft(props.value)
  }, [props.value])

  const commit = () => {
    if (draft !== props.value) props.onCommit(draft)
  }

  if (props.multiline) {
    return (
      <textarea
        className={`text-input textarea ${props.className ?? ''}`}
        value={draft}
        disabled={props.disabled}
        placeholder={props.placeholder}
        onFocus={() => { focused.current = true }}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => { focused.current = false; commit() }}
      />
    )
  }

  return (
    <input
      className={`text-input ${props.className ?? ''}`}
      value={draft}
      disabled={props.disabled}
      placeholder={props.placeholder}
      onFocus={() => { focused.current = true }}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => { focused.current = false; commit() }}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault()
          commit()
          event.currentTarget.blur()
        }
        if (event.key === 'Escape') {
          setDraft(props.value)
          event.currentTarget.blur()
        }
      }}
    />
  )
}

export function NumberInput(props: {
  value: number
  disabled?: boolean
  step?: number
  onCommit: (value: number) => void
}) {
  const [draft, setDraft] = useState(String(props.value))
  const focused = useRef(false)

  useEffect(() => {
    if (!focused.current) setDraft(String(props.value))
  }, [props.value])

  const commit = () => {
    const parsed = Number(draft)
    if (Number.isFinite(parsed) && parsed !== props.value) props.onCommit(parsed)
    else setDraft(String(props.value))
  }

  return (
    <input
      className="text-input number-input"
      type="number"
      step={props.step ?? 1}
      value={draft}
      disabled={props.disabled}
      onFocus={() => { focused.current = true }}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => { focused.current = false; commit() }}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault()
          commit()
          event.currentTarget.blur()
        }
        if (event.key === 'Escape') {
          setDraft(String(props.value))
          event.currentTarget.blur()
        }
      }}
    />
  )
}
