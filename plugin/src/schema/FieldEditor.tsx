import {
  DEFERRED_FIELD_TYPES,
  MVP_FIELD_TYPES,
  TYPE_DESCRIPTIONS,
  TYPE_LABELS,
  type SchemaEnum,
  type SchemaField,
  type ValidationIssue,
} from '../core/schema'
import { CommitInput } from './Inputs'
import { ValueEditor } from './ValueEditor'

interface FieldEditorProps {
  name: string
  field: SchemaField
  origin: string
  inherited: boolean
  override: boolean
  canEdit: boolean
  enums: Record<string, SchemaEnum>
  issues: ValidationIssue[]
  onChange: (patch: Partial<SchemaField>) => void
  onChangeType: (type: string) => void
  onRename: (name: string) => void
  onDelete: () => void
  onClearDefault: () => void
  onRemoveOverride: () => void
  onMove: (direction: -1 | 1) => void
}

const ALL_TYPE_OPTIONS = [...MVP_FIELD_TYPES, ...DEFERRED_FIELD_TYPES]

function typeLabel(type: string): string {
  return TYPE_LABELS[type] ?? type
}

export function FieldEditor(props: FieldEditorProps) {
  const { name, field, origin, inherited, override, canEdit, enums, issues } = props
  const isDeferred = DEFERRED_FIELD_TYPES.includes(field.type as (typeof DEFERRED_FIELD_TYPES)[number])
  const isKnown = ALL_TYPE_OPTIONS.includes(field.type as (typeof ALL_TYPE_OPTIONS)[number])
  const enumValues = field.enum ? enums[field.enum]?.values ?? [] : []

  return (
    <div className="inspector-body">
      <div className="inspector-title">
        <div>
          <p className="eyebrow">{inherited ? 'Inherited field' : 'Field'}</p>
          <h3>{name}</h3>
        </div>
        {canEdit && !inherited && (
          <button type="button" className="icon-button danger" title="Delete field" onClick={props.onDelete}>
            ×
          </button>
        )}
      </div>

      <div className="origin-row">
        <span className={`badge ${inherited ? 'muted' : 'own'}`}>{inherited ? 'inherited' : 'own'}</span>
        {override && <span className="badge override">override</span>}
        <code className="origin-code">{origin}</code>
      </div>

      {issues.length > 0 && (
        <div className="issue-stack">
          {issues.map((issue, index) => (
            <p key={`${issue.code}-${index}`} className={`field-error ${issue.severity}`}>
              {issue.message}
            </p>
          ))}
        </div>
      )}

      <label className="field-label">
        Name
        <CommitInput
          value={name}
          disabled={!canEdit || inherited}
          onCommit={props.onRename}
        />
      </label>

      <div className="field-label">
        Type
        {isKnown && !isDeferred ? (
          <select
            className="select-input"
            value={field.type}
            disabled={!canEdit || inherited}
            onChange={(event) => props.onChangeType(event.target.value)}
          >
            {MVP_FIELD_TYPES.map((type) => (
              <option key={type} value={type}>{TYPE_LABELS[type] ?? type}</option>
            ))}
          </select>
        ) : (
          <div className="type-readonly">
            <span className="type-pill">{typeLabel(field.type)}</span>
            <span className="muted-copy">
              {isDeferred ? 'Preserved. Authoring arrives after M1.' : 'Unknown type; preserved as-is.'}
            </span>
          </div>
        )}
        <span className="field-hint">{TYPE_DESCRIPTIONS[field.type] ?? 'Preserved field type.'}</span>
      </div>

      {field.type === 'enum' && (
        <label className="field-label">
          Enum
          <select
            className="select-input"
            value={field.enum ?? ''}
            disabled={!canEdit || inherited}
            onChange={(event) => props.onChange({ enum: event.target.value })}
          >
            <option value="">Choose an enum</option>
            {Object.keys(enums).sort((a, b) => a.localeCompare(b)).map((enumName) => (
              <option key={enumName} value={enumName}>{enumName}</option>
            ))}
          </select>
          {field.enum && enumValues.length === 0 && (
            <span className="field-error">This enum has no values yet.</span>
          )}
        </label>
      )}

      <div className="field-label">
        Default
        <ValueEditor
          field={field}
          enums={enums}
          disabled={!canEdit}
          onChange={(value) => props.onChange({ default: value })}
          onClear={props.onClearDefault}
        />
      </div>

      <label className="field-label">
        Documentation
        <textarea
          className="text-input textarea"
          value={field.doc ?? ''}
          disabled={!canEdit}
          placeholder="What this field means for an author."
          onChange={(event) => props.onChange({ doc: event.target.value })}
        />
      </label>

      {inherited && override && canEdit && (
        <button type="button" className="button ghost full" onClick={props.onRemoveOverride}>
          Remove default override
        </button>
      )}

      {canEdit && !inherited && (
        <div className="inspector-actions">
          <button type="button" className="button ghost tiny" onClick={() => props.onMove(-1)}>Move up</button>
          <button type="button" className="button ghost tiny" onClick={() => props.onMove(1)}>Move down</button>
        </div>
      )}
    </div>
  )
}
