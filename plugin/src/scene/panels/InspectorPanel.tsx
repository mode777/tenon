import { useEffect, useMemo, useState } from 'react'
import { cloneJson } from '../../core/schema'
import {
  displayScenePath,
  entityById,
  entityEvents,
  entityIsSceneInstance,
  entityLabel,
  entityProperties,
  entitySubtree,
  enumForField,
  normalizeTransform,
  slotNamesForInstance,
  type EntityProperty,
  type SceneDocument,
  type SceneEntity,
  type SceneValidationContext,
} from '../../core/scene'
import type { LoadedWorkspace } from '../../core/workspace'
import type { SceneCommand } from '../scene-commands'
import { fieldTypeLabel, schemaLabel } from '../scene-labels'
import { concreteDefinitions, sceneOptions } from '../scene-workspace'

function formatNumber(value: number): string {
  return Number.isFinite(value) ? String(value) : '0'
}

function TextInput({
  value,
  onChange,
  disabled,
  placeholder,
  ariaLabel,
}: {
  value: string
  onChange: (value: string) => void
  disabled?: boolean
  placeholder?: string
  ariaLabel?: string
}) {
  const [draft, setDraft] = useState(value)
  const [editing, setEditing] = useState(false)
  useEffect(() => {
    if (!editing) setDraft(value)
  }, [editing, value])
  return (
    <input
      type="text"
      value={editing ? draft : value}
      placeholder={placeholder}
      aria-label={ariaLabel}
      disabled={disabled}
      onFocus={() => {
        setDraft(value)
        setEditing(true)
      }}
      onBlur={() => {
        setEditing(false)
        setDraft(value)
      }}
      onChange={(event) => {
        const next = event.target.value
        setDraft(next)
        onChange(next)
      }}
    />
  )
}

function NumberInput({
  value,
  onChange,
  step = 0.1,
  disabled,
}: {
  value: number
  onChange: (value: number) => void
  step?: number
  disabled?: boolean
}) {
  const [draft, setDraft] = useState(formatNumber(value))
  const [editing, setEditing] = useState(false)
  useEffect(() => {
    if (!editing) setDraft(formatNumber(value))
  }, [editing, value])
  return (
    <input
      type="number"
      step={step}
      value={editing ? draft : formatNumber(value)}
      disabled={disabled}
      onFocus={() => {
        setDraft(formatNumber(value))
        setEditing(true)
      }}
      onBlur={() => {
        setEditing(false)
        setDraft(formatNumber(value))
      }}
      onChange={(event) => {
        const text = event.target.value
        setDraft(text)
        const parsed = Number(text)
        if (Number.isFinite(parsed)) onChange(parsed)
      }}
    />
  )
}

function JsonPreview({ value }: { value: unknown }) {
  return <code className="scene-json-value">{JSON.stringify(value)}</code>
}

function FieldValueEditor({
  prop,
  scene,
  entityId,
  context,
  assets,
  disabled,
  onChange,
}: {
  prop: EntityProperty
  scene: SceneDocument
  entityId: string
  context: SceneValidationContext
  assets: string[]
  disabled: boolean
  onChange: (value: unknown) => void
}) {
  const field = prop.field
  if (field.type === 'bool') {
    return (
      <input
        type="checkbox"
        checked={prop.value === true}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
    )
  }
  if (field.type === 'int' || field.type === 'float') {
    return (
      <NumberInput
        value={typeof prop.value === 'number' ? prop.value : 0}
        step={field.type === 'int' ? 1 : 0.1}
        disabled={disabled}
        onChange={onChange}
      />
    )
  }
  if (field.type === 'string') {
    return (
      <TextInput
        value={typeof prop.value === 'string' ? prop.value : ''}
        disabled={disabled}
        onChange={onChange}
      />
    )
  }
  if (field.type === 'enum') {
    const lookup = enumForField(field, prop.originDefinitionId, context)
    const values = lookup?.enumDef.values ?? []
    const current = typeof prop.value === 'string' ? prop.value : ''
    return (
      <select
        value={current}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      >
        {(!current || !values.includes(current)) && (
          <option value={current} disabled={!current}>
            {current || '—'}
          </option>
        )}
        {values.map((value) => (
          <option key={value} value={value}>
            {value}
          </option>
        ))}
      </select>
    )
  }
  if (field.type === 'entityRef') {
    const options = scene.entities.filter((entity) => entity.id !== entityId)
    return (
      <select
        value={typeof prop.value === 'string' ? prop.value : ''}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value || null)}
      >
        <option value="">—</option>
        {options.map((entity) => (
          <option key={entity.id} value={entity.id}>
            {entity.id} · {entityLabel(entity)}
          </option>
        ))}
      </select>
    )
  }
  if (field.type === 'assetRef') {
    const current = typeof prop.value === 'string' ? prop.value : ''
    const normalized = current ? displayScenePath(current) : ''
    const missing =
      normalized && !assets.some((asset) => displayScenePath(asset) === normalized)
    if (assets.length === 0) {
      return (
        <TextInput
          value={current}
          placeholder="assets/…"
          disabled={disabled}
          onChange={(value) => onChange(value || null)}
        />
      )
    }
    return (
      <select
        value={current}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value || null)}
      >
        <option value="">—</option>
        {missing && <option value={current}>{current} (missing)</option>}
        {assets.map((asset) => (
          <option key={asset} value={displayScenePath(asset)}>
            {displayScenePath(asset)}
          </option>
        ))}
      </select>
    )
  }
  if (field.type === 'color' || field.type === 'vec2' || field.type === 'vec3') {
    const size =
      field.type === 'vec2'
        ? 2
        : field.type === 'color' && Array.isArray(prop.value) && prop.value.length === 4
          ? 4
          : 3
    const defaults = field.type === 'color' ? [1, 1, 1, 1] : [0, 0, 0]
    const value = Array.isArray(prop.value) ? prop.value : defaults
    return (
      <div className="scene-vector">
        {Array.from({ length: size }, (_, index) => (
          <NumberInput
            key={index}
            value={typeof value[index] === 'number' ? value[index] : (defaults[index] ?? 0)}
            disabled={disabled}
            onChange={(next) => {
              const copy = [...value]
              copy[index] = next
              onChange(copy)
            }}
          />
        ))}
      </div>
    )
  }
  return <JsonPreview value={prop.value} />
}

function SceneSettings({
  scene,
  context,
  canWrite,
  onCommand,
}: {
  scene: SceneDocument
  context: SceneValidationContext
  canWrite: boolean
  onCommand: (command: SceneCommand) => void
}) {
  const available = useMemo(() => {
    const options = [
      { namespace: context.builtin.namespace, version: context.builtin.version },
      ...Object.values(context.schemas).map((bundle) => ({
        namespace: bundle.namespace,
        version: bundle.version,
      })),
    ]
    return options.sort((a, b) => a.namespace.localeCompare(b.namespace))
  }, [context])
  const nextOption = available.find(
    (option) => !scene.requires.some((entry) => entry.startsWith(`${option.namespace}@`)),
  )
  return (
    <div className="scene-inspector-body">
      <section className="scene-section">
        <h3>Scene</h3>
        <label className="scene-field">
          <span>ID</span>
          <TextInput
            value={scene.id}
            ariaLabel="Scene ID"
            disabled={!canWrite}
            onChange={(id) => onCommand({ type: 'set-scene-id', id })}
          />
        </label>
      </section>
      <section className="scene-section">
        <div className="scene-section-heading">
          <h3>Schema requirements</h3>
          <button
            type="button"
            className="button tiny ghost"
            disabled={!canWrite || !nextOption}
            onClick={() => onCommand({ type: 'add-requirement' })}
          >
            Add requirement
          </button>
        </div>
        {scene.requires.length === 0 ? (
          <p className="scene-empty-note">No schemas required. Scenes normally require basic3d.</p>
        ) : (
          <ul className="scene-requirement-list">
            {scene.requires.map((entry, index) => (
              <li key={index}>
                <TextInput
                  value={entry}
                  ariaLabel={`Schema requirement ${index + 1}`}
                  disabled={!canWrite}
                  onChange={(value) => onCommand({ type: 'set-requirement', index, value })}
                />
                <button
                  type="button"
                  className="button tiny ghost"
                  disabled={!canWrite}
                  onClick={() => onCommand({ type: 'remove-requirement', index })}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
        {nextOption && (
          <p className="scene-hint">
            Next available: {nextOption.namespace}@{nextOption.version}
          </p>
        )}
      </section>
      <section className="scene-section">
        <h3>Public surface</h3>
        <p className="scene-hint">
          Select an entity to edit it. Promotions and slots are in the Inspection panel.
        </p>
      </section>
    </div>
  )
}

function EntityInspector({
  scene,
  entity,
  context,
  assets,
  canWrite,
  parentOptions,
  sceneOptions: instanceOptions,
  onCommand,
}: {
  scene: SceneDocument
  entity: SceneEntity
  context: SceneValidationContext
  assets: string[]
  canWrite: boolean
  parentOptions: SceneEntity[]
  sceneOptions: Array<{ path: string; label: string }>
  onCommand: (command: SceneCommand) => void
}) {
  const properties = useMemo(
    () => entityProperties(scene, entity, context),
    [scene, entity, context],
  )
  const events = useMemo(() => entityEvents(scene, entity, context), [scene, entity, context])
  const parent = entity.parent ? entityById(scene, entity.parent) : undefined
  const parentIsInstance = parent ? entityIsSceneInstance(parent) : false
  const slots = parent && parentIsInstance ? slotNamesForInstance(scene, parent, context) : []
  const transform = normalizeTransform(entity.transform)
  const definitionOptions = useMemo(() => concreteDefinitions(context), [context])
  const sceneChoices = useMemo(() => {
    if (!entity.scene) return instanceOptions
    const current = displayScenePath(entity.scene)
    if (instanceOptions.some((option) => option.path === `/${current}`)) return instanceOptions
    return [
      ...instanceOptions,
      { path: `/${current}`, label: `${current} (missing)` },
    ].sort((a, b) => a.path.localeCompare(b.path))
  }, [entity.scene, instanceOptions])
  const isRoot = entity.id === scene.root

  return (
    <div className="scene-inspector-body">
      <section className="scene-section">
        <div className="scene-entity-title">
          <div>
            <h3>{entityLabel(entity)}</h3>
            <code>{entity.id}</code>
          </div>
          <div className="scene-title-actions">
            <button
              type="button"
              className="button tiny ghost"
              disabled={!canWrite || isRoot}
              onClick={() => onCommand({ type: 'duplicate-entity', entityId: entity.id })}
            >
              Duplicate
            </button>
            <button
              type="button"
              className="button tiny danger"
              disabled={!canWrite || isRoot}
              onClick={() => onCommand({ type: 'delete-entity', entityId: entity.id })}
            >
              Delete
            </button>
          </div>
        </div>
        <label className="scene-field">
          <span>Name</span>
          <TextInput
            value={entity.name ?? ''}
            ariaLabel="Entity name"
            placeholder={entityLabel(entity)}
            disabled={!canWrite}
            onChange={(value) =>
              onCommand({ type: 'set-entity-name', entityId: entity.id, value })
            }
          />
        </label>
        {entity.scene ? (
          <label className="scene-field">
            <span>Scene</span>
            <select
              aria-label="Scene document"
              value={displayScenePath(entity.scene)}
              disabled={!canWrite}
              onChange={(event) =>
                onCommand({
                  type: 'set-entity-scene',
                  entityId: entity.id,
                  value: event.target.value,
                })
              }
            >
              {sceneChoices.map((option) => (
                <option key={option.path} value={displayScenePath(option.path)}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <label className="scene-field">
            <span>Definition</span>
            <select
              aria-label="Entity definition"
              value={entity.type ?? ''}
              disabled={!canWrite}
              onChange={(event) =>
                onCommand({
                  type: 'set-entity-type',
                  entityId: entity.id,
                  value: event.target.value,
                })
              }
            >
              {definitionOptions.map((option) => (
                <option key={option.type} value={option.type}>
                  {option.type}
                </option>
              ))}
            </select>
          </label>
        )}
        {isRoot ? (
          <p className="scene-hint">
            The root is an entity, not a scene instance. It defines the scene's base properties.
          </p>
        ) : (
          <>
            <label className="scene-field">
              <span>Parent</span>
              <select
                aria-label="Parent"
                value={entity.parent ?? ''}
                disabled={!canWrite}
                onChange={(event) =>
                  onCommand({
                    type: 'set-entity-parent',
                    entityId: entity.id,
                    parentId: event.target.value,
                  })
                }
              >
                {parentOptions.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.id} · {entityLabel(option)}
                    {entityIsSceneInstance(option) ? ' (instance)' : ''}
                  </option>
                ))}
              </select>
            </label>
            {parentIsInstance && (
              <label className="scene-field">
                <span>Slot</span>
                <select
                  aria-label="Slot"
                  value={entity.slot ?? ''}
                  disabled={!canWrite || slots.length === 0}
                  onChange={(event) =>
                    onCommand({
                      type: 'set-entity-slot',
                      entityId: entity.id,
                      slot: event.target.value,
                    })
                  }
                >
                  <option value="">—</option>
                  {slots.map((slot) => (
                    <option key={slot} value={slot}>
                      {slot}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {parentIsInstance && slots.length === 0 && (
              <p className="scene-warning">
                This scene instance exposes no slots. Declare a slot in the referenced scene first.
              </p>
            )}
          </>
        )}
      </section>

      <section className="scene-section">
        <div className="scene-section-heading">
          <h3>Transform</h3>
          <button
            type="button"
            className="button tiny ghost"
            disabled={
              !canWrite ||
              (transform.position.every((value) => value === 0) &&
                transform.rotation.every((value) => value === 0) &&
                transform.scale.every((value) => value === 1))
            }
            onClick={() =>
              onCommand({
                type: 'set-transform',
                entityId: entity.id,
                transform: {
                  position: [0, 0, 0],
                  rotation: [0, 0, 0],
                  scale: [1, 1, 1],
                },
              })
            }
          >
            Reset
          </button>
        </div>
        {(
          [
            ['position', 'Position', 'position'],
            ['rotation', 'Rotation (°)', 'rotation'],
            ['scale', 'Scale', 'scale'],
          ] as const
        ).map(([key, label, component]) => (
          <div className="scene-transform-row" key={key}>
            <span>{label}</span>
            <div className="scene-vector">
              {(['X', 'Y', 'Z'] as const).map((axis, index) => (
                <label key={axis}>
                  <span>{axis}</span>
                  <NumberInput
                    value={transform[component][index]}
                    disabled={!canWrite}
                    onChange={(value) => {
                      const next = cloneJson(transform)
                      next[component][index] = value
                      onCommand({
                        type: 'set-transform',
                        entityId: entity.id,
                        transform: next,
                      })
                    }}
                  />
                </label>
              ))}
            </div>
          </div>
        ))}
      </section>

      <section className="scene-section">
        <h3>Properties</h3>
        {properties.length === 0 ? (
          <p className="scene-empty-note">This definition has no fields.</p>
        ) : (
          <div className="scene-property-list">
            {properties.map((prop) => (
              <div className="scene-property" key={prop.name}>
                <div className="scene-property-heading">
                  <span className="scene-property-name">{prop.name}</span>
                  <span className="scene-property-type">{fieldTypeLabel(prop.field)}</span>
                  <span className={`scene-origin ${prop.promoted ? 'promoted' : ''}`}>
                    {prop.promoted ? 'promoted' : schemaLabel(prop.originDefinitionId)}
                  </span>
                  {prop.overridden && (
                    <button
                      type="button"
                      className="link-button"
                      disabled={!canWrite}
                      onClick={() =>
                        onCommand({
                          type: 'reset-prop',
                          entityId: entity.id,
                          name: prop.name,
                        })
                      }
                    >
                      Reset
                    </button>
                  )}
                </div>
                <FieldValueEditor
                  prop={prop}
                  scene={scene}
                  entityId={entity.id}
                  context={context}
                  assets={assets}
                  disabled={!canWrite}
                  onChange={(value) =>
                    onCommand({
                      type: 'set-prop',
                      entityId: entity.id,
                      name: prop.name,
                      value,
                    })
                  }
                />
                {!prop.hasDefault && !prop.overridden && prop.value === undefined && (
                  <span className="scene-required">required</span>
                )}
              </div>
            ))}
          </div>
        )}
        {entity.scene && (
          <p className="scene-hint">
            Scene instance properties override the referenced scene's root fields and promoted
            fields. Internal entities stay read-only.
          </p>
        )}
      </section>

      {events.length > 0 && (
        <section className="scene-section">
          <h3>Events</h3>
          <ul className="scene-event-list">
            {events.map((event) => (
              <li key={event.name}>
                <span>{event.name}</span>
                <small>
                  {event.promoted ? 'promoted · ' : ''}
                  {Object.keys(event.event.payload ?? {}).length === 0
                    ? 'no payload'
                    : Object.entries(event.event.payload ?? {})
                        .map(([name, field]) => `${name}: ${field.type}`)
                        .join(', ')}
                </small>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}

export interface InspectorPanelProps {
  doc: SceneDocument
  selection: string | null
  path: string
  context: SceneValidationContext
  workspace: LoadedWorkspace
  canWrite: boolean
  onSelect: (id: string | null) => void
  onCommand: (command: SceneCommand) => void
}

export function InspectorPanel({
  doc,
  selection,
  path,
  context,
  workspace,
  canWrite,
  onSelect,
  onCommand,
}: InspectorPanelProps) {
  const selectedEntity = selection ? entityById(doc, selection) : undefined
  const instanceScenes = useMemo(
    () => sceneOptions(workspace, path),
    [path, workspace],
  )
  const parentOptions = useMemo(() => {
    if (!selectedEntity) return []
    const removed = new Set(entitySubtree(doc, selectedEntity.id).map((entity) => entity.id))
    return doc.entities.filter((entity) => !removed.has(entity.id))
  }, [doc, selectedEntity])

  return (
    <div className="scene-panel-surface scene-inspector-panel">
      <div className="scene-panel-heading">
        <h2>{selectedEntity ? 'Inspector' : 'Scene settings'}</h2>
        {selectedEntity && (
          <button type="button" className="link-button" onClick={() => onSelect(null)}>
            Scene
          </button>
        )}
      </div>
      <div className="scene-inspector-scroll">
        {selectedEntity ? (
          <EntityInspector
            key={selectedEntity.id}
            scene={doc}
            entity={selectedEntity}
            context={context}
            assets={workspace.assets}
            canWrite={canWrite}
            parentOptions={parentOptions}
            sceneOptions={instanceScenes}
            onCommand={onCommand}
          />
        ) : (
          <SceneSettings
            scene={doc}
            context={context}
            canWrite={canWrite}
            onCommand={onCommand}
          />
        )}
      </div>
    </div>
  )
}
