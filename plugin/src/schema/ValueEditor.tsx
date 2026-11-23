import { useEffect, useRef, useState } from 'react'
import {
  MVP_FIELD_TYPES,
  fieldHasDefault,
  type SchemaEnum,
  type SchemaField,
} from '../core/schema'
import { CommitInput, NumberInput } from './Inputs'

interface ValueEditorProps {
  field: SchemaField
  enums: Record<string, SchemaEnum>
  disabled?: boolean
  onChange: (value: unknown) => void
  onClear: () => void
}

function defaultForType(type: string, enums: Record<string, SchemaEnum>, enumName?: string): unknown {
  switch (type) {
    case 'bool':
      return false
    case 'int':
    case 'float':
      return 0
    case 'string':
    case 'entityRef':
    case 'assetRef':
      return ''
    case 'enum': {
      const values = enumName ? enums[enumName]?.values : undefined
      return values?.[0] ?? ''
    }
    case 'color':
      return [1, 1, 1]
    case 'vec2':
      return [0, 0]
    case 'vec3':
      return [0, 0, 0]
    default:
      return null
  }
}

function NumericVector(props: {
  value: unknown
  length: number
  disabled?: boolean
  step?: number
  onChange: (value: number[]) => void
}) {
  const values = Array.isArray(props.value) && props.value.length === props.length
    ? props.value.map((item) => (typeof item === 'number' ? item : 0))
    : Array.from({ length: props.length }, (_, index) => (index === 0 ? 1 : 0))
  return (
    <div className="vector-input">
      {values.map((value, index) => (
        <NumberInput
          key={index}
          value={value}
          step={props.step}
          disabled={props.disabled}
          onCommit={(next) => {
            const copy = [...values]
            copy[index] = next
            props.onChange(copy)
          }}
        />
      ))}
    </div>
  )
}

function RawDefaultEditor(props: {
  value: unknown
  disabled?: boolean
  onChange: (value: unknown) => void
}) {
  const serialized = JSON.stringify(props.value ?? null, null, 2)
  const [draft, setDraft] = useState(serialized)
  const [error, setError] = useState<string | null>(null)
  const focused = useRef(false)
  useEffect(() => {
    if (!focused.current) setDraft(serialized)
  }, [serialized])

  return (
    <div className="stack">
      <textarea
        className="text-input textarea mono"
        value={draft}
        disabled={props.disabled}
        onFocus={() => { focused.current = true }}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => {
          focused.current = false
          try {
            const parsed = JSON.parse(draft)
            setError(null)
            props.onChange(parsed)
          } catch (cause) {
            setError(cause instanceof Error ? cause.message : 'Invalid JSON')
          }
        }}
      />
      {error && <p className="field-error">{error}</p>}
    </div>
  )
}

export function ValueEditor(props: ValueEditorProps) {
  const { field, enums, disabled, onChange, onClear } = props
  const hasDefault = fieldHasDefault(field)
  const type = field.type

  const addDefault = () => {
    onChange(defaultForType(type, enums, field.enum))
  }

  if (!hasDefault) {
    return (
      <div className="default-required">
        <span className="badge required">required</span>
        <span className="muted-copy">No default; instances must provide a value.</span>
        <button type="button" className="button tiny" disabled={disabled} onClick={addDefault}>
          Add default
        </button>
      </div>
    )
  }

  return (
    <div className="stack">
      {type === 'bool' && (
        <label className="check-row">
          <input
            type="checkbox"
            checked={Boolean(field.default)}
            disabled={disabled}
            onChange={(event) => onChange(event.target.checked)}
          />
          <span>{field.default ? 'true' : 'false'}</span>
        </label>
      )}

      {type === 'string' && (
        <CommitInput
          value={typeof field.default === 'string' ? field.default : ''}
          disabled={disabled}
          onCommit={onChange}
        />
      )}

      {type === 'int' && (
        <NumberInput
          value={typeof field.default === 'number' ? field.default : 0}
          disabled={disabled}
          step={1}
          onCommit={onChange}
        />
      )}

      {type === 'float' && (
        <NumberInput
          value={typeof field.default === 'number' ? field.default : 0}
          disabled={disabled}
          step={0.1}
          onCommit={onChange}
        />
      )}

      {type === 'enum' && (
        <select
          className="select-input"
          value={typeof field.default === 'string' ? field.default : ''}
          disabled={disabled || !field.enum}
          onChange={(event) => onChange(event.target.value)}
        >
          {!field.enum && <option value="">Choose an enum first</option>}
          {(field.enum ? enums[field.enum]?.values ?? [] : []).map((value) => (
            <option key={value} value={value}>{value}</option>
          ))}
        </select>
      )}

      {type === 'color' && (
        <NumericVector
          value={field.default}
          length={3}
          step={0.01}
          disabled={disabled}
          onChange={onChange}
        />
      )}

      {type === 'vec2' && (
        <NumericVector value={field.default} length={2} disabled={disabled} onChange={onChange} />
      )}

      {type === 'vec3' && (
        <NumericVector value={field.default} length={3} disabled={disabled} onChange={onChange} />
      )}

      {(type === 'entityRef' || type === 'assetRef') && (
        <CommitInput
          value={typeof field.default === 'string' ? field.default : ''}
          disabled={disabled}
          placeholder={type === 'assetRef' ? 'assets/…' : 'entity id or none'}
          onCommit={onChange}
        />
      )}

      {!MVP_FIELD_TYPES.includes(type as (typeof MVP_FIELD_TYPES)[number]) && (
        <RawDefaultEditor value={field.default} disabled={disabled} onChange={onChange} />
      )}

      <div className="row-between">
        <span className="muted-copy">Default value</span>
        <button type="button" className="link-button" disabled={disabled} onClick={onClear}>
          Clear default
        </button>
      </div>
    </div>
  )
}
