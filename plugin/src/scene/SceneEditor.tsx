import type { EditorClient } from '@exo/plugin-sdk'
import { ExoProtocolError, type FileChangedPayload } from '@exo/plugin-sdk'
import { useEffect, useMemo, useRef, useState, type ComponentType } from 'react'
import {
  builtinBundle,
  cloneJson,
  type SchemaBundle,
  type ValidationIssue,
} from '../core/schema'
import { useHistory } from '../core/history'
import type { LoadedWorkspace } from '../core/workspace'
import {
  addEntity,
  addPromotion,
  addSceneInstance,
  addSlot,
  bundleForNamespace,
  deleteEntity,
  directChildren,
  displayScenePath,
  duplicateEntity,
  ensureSceneRequirement,
  entityById,
  entityEvents,
  entityIsSceneInstance,
  entityLabel,
  entityProperties,
  entitySubtree,
  enumForField,
  expandScene,
  normalizeScenePath,
  normalizeTransform,
  parseSceneText,
  removeEntityProp,
  removePromotion,
  removeSlot,
  sceneFileName,
  sceneSurface,
  sceneToText,
  setEntityName,
  setEntityParent,
  setEntityProp,
  setEntityTransform,
  setEntityType,
  setSceneInstancePath,
  slotNamesForInstance,
  validateScene,
  type EntityProperty,
  type EntityTransform,
  type SceneDocument,
  type SceneEntity,
  type SceneValidationContext,
} from '../core/scene'
import type { SceneViewportProps, TransformMode } from './Viewport'
import './scene.css'

type SidebarTab = 'palette' | 'assets'
type DrawerTab = 'validation' | 'public' | 'debug'

interface Toast {
  kind: 'notice' | 'error'
  message: string
}

export interface SceneEditorProps {
  client: EditorClient
  initialDoc: SceneDocument
  scenePath: string
  levelMode: boolean
  canWrite: boolean
  workspace: LoadedWorkspace
  Viewport?: ComponentType<SceneViewportProps>
}

function errorMessage(error: unknown): string {
  if (error instanceof ExoProtocolError) return `${error.code}: ${error.message}`
  if (error instanceof Error) return error.message
  return String(error)
}

function schemaLabel(originDefinitionId: string): string {
  const namespace = originDefinitionId.split(':')[0]
  return namespace || originDefinitionId
}

function fieldTypeLabel(field: { type: string; enum?: string }): string {
  if (field.type === 'enum' && field.enum) return field.enum
  return field.type
}

function schemaFromWorkspace(workspace: LoadedWorkspace): Record<string, SchemaBundle> {
  const schemas: Record<string, SchemaBundle> = {}
  for (const item of workspace.schemaPackages) {
    if (!item.bundle) continue
    if (item.bundle.namespace === 'basic3d') continue
    if (!schemas[item.bundle.namespace]) schemas[item.bundle.namespace] = item.bundle
  }
  return schemas
}

function sceneFromWorkspace(workspace: LoadedWorkspace): Record<string, SceneDocument> {
  const scenes: Record<string, SceneDocument> = {}
  for (const item of workspace.scenePackages) {
    if (!item.scene) continue
    scenes[normalizeScenePath(item.path)] = item.scene
  }
  return scenes
}

function concreteDefinitions(
  context: SceneValidationContext,
): Array<{ type: string; namespace: string; doc?: string }> {
  const definitions = new Map<string, { type: string; namespace: string; doc?: string }>()
  const bundles = [context.builtin, ...Object.values(context.schemas)]
  for (const bundle of bundles) {
    for (const [type, definition] of Object.entries(bundle.definitions)) {
      if (definition.abstract || definitions.has(type)) continue
      definitions.set(type, {
        type,
        namespace: bundle.namespace,
        doc: typeof definition.doc === 'string' ? definition.doc : undefined,
      })
    }
  }
  return [...definitions.values()].sort((a, b) => a.type.localeCompare(b.type))
}

function sceneOptions(
  workspace: LoadedWorkspace,
  currentPath: string,
): Array<{ path: string; label: string }> {
  return workspace.scenePackages
    .filter((item) => item.scene)
    .map((item) => normalizeScenePath(item.path))
    .filter((path) => path !== currentPath && !path.startsWith('/levels/'))
    .sort((a, b) => a.localeCompare(b))
    .map((path) => ({ path, label: displayScenePath(path) }))
}

function issueTone(severity: ValidationIssue['severity']): string {
  return severity === 'error' ? 'error' : 'warning'
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
  return (
    <input
      type="number"
      step={step}
      value={Number.isFinite(value) ? value : 0}
      disabled={disabled}
      onChange={(event) => {
        const parsed = Number(event.target.value)
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
      <input
        type="text"
        value={typeof prop.value === 'string' ? prop.value : ''}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
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
    const normalized = current ? normalizeScenePath(current) : ''
    const missing = normalized && !assets.some((asset) => normalizeScenePath(asset) === normalized)
    if (assets.length === 0) {
      return (
        <input
          type="text"
          value={current}
          placeholder="assets/…"
          disabled={disabled}
          onChange={(event) => onChange(event.target.value || null)}
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
            value={typeof value[index] === 'number' ? value[index] : defaults[index] ?? 0}
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

function ValidationList({
  issues,
  onSelect,
}: {
  issues: ValidationIssue[]
  onSelect: (entityId: string) => void
}) {
  if (issues.length === 0) {
    return <p className="scene-empty-note">No validation issues in this document.</p>
  }
  return (
    <ul className="scene-issue-list">
      {issues.map((issue, index) => (
        <li key={`${issue.code}-${index}`} className={`scene-issue ${issueTone(issue.severity)}`}>
          <span className="scene-issue-dot" aria-hidden="true" />
          <div className="scene-issue-copy">
            <div>
              <span className="scene-issue-code">{issue.code}</span>
              <span className="scene-issue-message">{issue.message}</span>
            </div>
            <div className="scene-issue-meta">
              {issue.entityId && (
                <button
                  type="button"
                  className="link-button"
                  onClick={() => onSelect(issue.entityId!)}
                >
                  Select {issue.entityId}
                </button>
              )}
              {issue.scenePath && <span>{issue.scenePath}</span>}
              {issue.sourcePath && issue.sourcePath !== issue.scenePath && (
                <span>{issue.sourcePath}</span>
              )}
            </div>
          </div>
        </li>
      ))}
    </ul>
  )
}

function SceneSettings({
  scene,
  context,
  schemas,
  canWrite,
  onChange,
  onRequiresChange,
  onAddRequirement,
  onRemoveRequirement,
}: {
  scene: SceneDocument
  context: SceneValidationContext
  schemas: Record<string, SchemaBundle>
  canWrite: boolean
  onChange: (id: string) => void
  onRequiresChange: (index: number, value: string) => void
  onAddRequirement: () => void
  onRemoveRequirement: (index: number) => void
}) {
  const available = useMemo(() => {
    const options = [
      { namespace: context.builtin.namespace, version: context.builtin.version },
      ...Object.values(schemas).map((bundle) => ({
        namespace: bundle.namespace,
        version: bundle.version,
      })),
    ]
    return options.sort((a, b) => a.namespace.localeCompare(b.namespace))
  }, [context.builtin.namespace, context.builtin.version, schemas])
  const nextOption = available.find(
    (option) => !scene.requires.some((entry) => entry.startsWith(`${option.namespace}@`)),
  )
  return (
    <div className="scene-inspector-body">
      <section className="scene-section">
        <h3>Scene</h3>
        <label className="scene-field">
          <span>ID</span>
          <input
            type="text"
            aria-label="Scene ID"
            value={scene.id}
            disabled={!canWrite}
            onChange={(event) => onChange(event.target.value)}
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
            onClick={onAddRequirement}
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
                <input
                  type="text"
                  value={entry}
                  disabled={!canWrite}
                  onChange={(event) => onRequiresChange(index, event.target.value)}
                />
                <button
                  type="button"
                  className="button tiny ghost"
                  disabled={!canWrite}
                  onClick={() => onRemoveRequirement(index)}
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
          Select an entity to edit it. Promotions and slots are in the Public drawer below.
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
  onChangeName,
  onChangeType,
  onChangeScene,
  onChangeParent,
  onChangeSlot,
  onChangeTransform,
  onChangeProp,
  onResetProp,
  onDelete,
  onDuplicate,
}: {
  scene: SceneDocument
  entity: SceneEntity
  context: SceneValidationContext
  assets: string[]
  canWrite: boolean
  parentOptions: SceneEntity[]
  sceneOptions: Array<{ path: string; label: string }>
  onChangeName: (value: string) => void
  onChangeType: (value: string) => void
  onChangeScene: (value: string) => void
  onChangeParent: (value: string) => void
  onChangeSlot: (value: string) => void
  onChangeTransform: (transform: EntityTransform) => void
  onChangeProp: (name: string, value: unknown) => void
  onResetProp: (name: string) => void
  onDelete: () => void
  onDuplicate: () => void
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
  const definitionOptions = useMemo(
    () => concreteDefinitions(context),
    [context],
  )
  const sceneChoices = useMemo(() => {
    if (!entity.scene) return instanceOptions
    const current = normalizeScenePath(entity.scene)
    if (instanceOptions.some((option) => option.path === current)) return instanceOptions
    return [
      ...instanceOptions,
      { path: current, label: `${displayScenePath(current)} (missing)` },
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
              onClick={onDuplicate}
            >
              Duplicate
            </button>
            <button
              type="button"
              className="button tiny danger"
              disabled={!canWrite || isRoot}
              onClick={onDelete}
            >
              Delete
            </button>
          </div>
        </div>
        <label className="scene-field">
          <span>Name</span>
          <input
            type="text"
            aria-label="Entity name"
            value={entity.name ?? ''}
            placeholder={entityLabel(entity)}
            disabled={!canWrite}
            onChange={(event) => onChangeName(event.target.value)}
          />
        </label>
        {entity.scene ? (
          <label className="scene-field">
            <span>Scene</span>
            <select
              aria-label="Scene document"
              value={normalizeScenePath(entity.scene)}
              disabled={!canWrite}
              onChange={(event) => onChangeScene(event.target.value)}
            >
              {sceneChoices.map((option) => (
                <option key={option.path} value={option.path}>
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
              onChange={(event) => onChangeType(event.target.value)}
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
                onChange={(event) => onChangeParent(event.target.value)}
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
                  onChange={(event) => onChangeSlot(event.target.value)}
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
              onChangeTransform({
                position: [0, 0, 0],
                rotation: [0, 0, 0],
                scale: [1, 1, 1],
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
                    step={component === 'scale' ? 0.1 : 0.1}
                    disabled={!canWrite}
                    onChange={(value) => {
                      const next = cloneJson(transform)
                      next[component][index] = value
                      onChangeTransform(next)
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
                      onClick={() => onResetProp(prop.name)}
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
                  onChange={(value) => onChangeProp(prop.name, value)}
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

export function SceneEditor({
  client,
  initialDoc,
  scenePath,
  levelMode,
  canWrite,
  workspace,
  Viewport,
}: SceneEditorProps) {
  const builtin = useMemo(() => builtinBundle(), [])
  const workspaceScenes = useMemo(() => sceneFromWorkspace(workspace), [workspace])
  const schemas = useMemo(() => schemaFromWorkspace(workspace), [workspace])
  const history = useHistory(initialDoc, cloneJson)
  const doc = history.state.doc
  const [savedText, setSavedText] = useState(() => sceneToText(initialDoc))
  const [selection, setSelection] = useState<string | null>(initialDoc.root)
  const [sidebarTab, setSidebarTab] = useState<SidebarTab>('palette')
  const [drawerTab, setDrawerTab] = useState<DrawerTab>('validation')
  const [drawerOpen, setDrawerOpen] = useState(true)
  const [mode, setMode] = useState<TransformMode>('translate')
  const [snap, setSnap] = useState(false)
  const [search, setSearch] = useState('')
  const [assetSearch, setAssetSearch] = useState('')
  const [toast, setToast] = useState<Toast | null>(null)
  const [external, setExternal] = useState<FileChangedPayload | null>(null)
  const [promotionName, setPromotionName] = useState('')
  const [promotionEntity, setPromotionEntity] = useState('')
  const [promotionKind, setPromotionKind] = useState<'field' | 'event'>('field')
  const [promotionTarget, setPromotionTarget] = useState('')
  const [slotName, setSlotName] = useState('')
  const [slotAnchor, setSlotAnchor] = useState('')
  const [expanded, setExpanded] = useState(false)
  const pathRef = useRef(normalizeScenePath(scenePath))
  const pendingSaveRef = useRef<string | null>(null)
  const docRef = useRef(doc)
  const dirtyRef = useRef(false)

  const serialized = sceneToText(doc)
  const dirty = serialized !== savedText
  docRef.current = doc
  dirtyRef.current = dirty

  const context = useMemo<SceneValidationContext>(() => {
    const scenes = { ...workspaceScenes, [normalizeScenePath(scenePath)]: doc }
    return {
      builtin,
      schemas,
      scenes,
      ...(workspace.assetsKnown ? { assets: workspace.assets } : {}),
    }
  }, [builtin, schemas, workspaceScenes, workspace.assets, workspace.assetsKnown, scenePath, doc])

  const validation = useMemo(
    () => validateScene(doc, context, pathRef.current),
    [doc, context],
  )
  const surface = useMemo(() => sceneSurface(doc, context), [doc, context])
  const paletteDefinitions = useMemo(() => concreteDefinitions(context), [context])
  const instanceScenes = useMemo(
    () => sceneOptions(workspace, normalizeScenePath(scenePath)),
    [workspace, scenePath],
  )
  const selectedEntity = selection ? entityById(doc, selection) : undefined
  const workspaceIssues = workspace.issues
  const allIssues = useMemo(
    () => [...workspaceIssues, ...validation.issues],
    [workspaceIssues, validation.issues],
  )
  const errorCount =
    validation.errors + workspaceIssues.filter((issue) => issue.severity === 'error').length
  const warningCount =
    validation.warnings + workspaceIssues.filter((issue) => issue.severity === 'warning').length

  const filteredDefinitions = useMemo(() => {
    const query = search.trim().toLowerCase()
    if (!query) return paletteDefinitions
    return paletteDefinitions.filter(
      (definition) =>
        definition.type.toLowerCase().includes(query) ||
        (definition.doc ?? '').toLowerCase().includes(query),
    )
  }, [paletteDefinitions, search])
  const filteredScenes = useMemo(() => {
    const query = search.trim().toLowerCase()
    if (!query) return instanceScenes
    return instanceScenes.filter((scene) => scene.path.toLowerCase().includes(query))
  }, [instanceScenes, search])
  const filteredAssets = useMemo(() => {
    const query = assetSearch.trim().toLowerCase()
    const assets = workspace.assets
    if (!query) return assets
    return assets.filter((asset) => asset.toLowerCase().includes(query))
  }, [workspace.assets, assetSearch])

  const parentOptions = useMemo(() => {
    if (!selectedEntity) return []
    const removed = new Set(entitySubtree(doc, selectedEntity.id).map((entity) => entity.id))
    return doc.entities.filter((entity) => !removed.has(entity.id))
  }, [doc, selectedEntity])
  const creationParentId =
    selectedEntity && selectedEntity.id !== doc.root && !entityIsSceneInstance(selectedEntity)
      ? selectedEntity.id
      : doc.root

  const withTypeRequirement = (scene: SceneDocument, type: string): SceneDocument => {
    const namespace = type.split(':')[0]
    const bundle = namespace ? bundleForNamespace(namespace, context) : null
    return bundle ? ensureSceneRequirement(scene, namespace, bundle.version) : scene
  }

  const directChildOptions = useMemo(() => directChildren(doc, doc.root), [doc])
  const effectivePromotionEntity = promotionEntity || directChildOptions[0]?.id || ''
  const promotionTargetEntity = effectivePromotionEntity
    ? entityById(doc, effectivePromotionEntity)
    : undefined
  const promotionTargetOptions = useMemo(() => {
    if (!promotionTargetEntity) return []
    if (promotionKind === 'event') {
      return entityEvents(doc, promotionTargetEntity, context).map((event) => event.name)
    }
    return entityProperties(doc, promotionTargetEntity, context).map((prop) => prop.name)
  }, [doc, promotionTargetEntity, context, promotionKind])
  const effectivePromotionTarget = promotionTargetOptions.includes(promotionTarget)
    ? promotionTarget
    : promotionTargetOptions[0] ?? ''
  const effectiveSlotAnchor = slotAnchor || doc.entities[1]?.id || doc.root
  const expandedScene = useMemo(
    () => (expanded ? expandScene(doc, context, pathRef.current) : null),
    [expanded, doc, context],
  )

  const showError = (error: unknown) => {
    setToast({ kind: 'error', message: errorMessage(error) })
  }
  const showNotice = (message: string) => {
    setToast({ kind: 'notice', message })
  }

  const commit = (next: SceneDocument) => {
    history.replace(next)
  }
  const mutate = (recipe: (draft: SceneDocument) => void) => {
    history.update(recipe)
  }

  useEffect(() => {
    if (!selection) return
    if (!entityById(doc, selection)) setSelection(null)
  }, [doc, selection])

  useEffect(() => {
    client.setDirty(dirty)
  }, [client, dirty])

  useEffect(() => {
    if (!toast) return
    const timer = window.setTimeout(() => setToast(null), 5000)
    return () => window.clearTimeout(timer)
  }, [toast])

  const reloadFromDisk = async (force: boolean) => {
    if (!force && dirtyRef.current) {
      setExternal({ kind: 'changed', path: pathRef.current })
      return
    }
    try {
      const content = await client.readFile(pathRef.current, 'utf8')
      const next = parseSceneText(content.text)
      history.reset(next)
      setSavedText(sceneToText(next))
      setSelection(next.root)
      setExternal(null)
      showNotice('Reloaded from disk')
    } catch (error) {
      showError(error)
    }
  }

  useEffect(() => {
    const offSave = client.onSaveRequest(() => {
      const text = sceneToText(docRef.current)
      pendingSaveRef.current = text
      return { text }
    })
    const offResult = client.onSaveResult((result) => {
      if (result.ok) {
        setSavedText(pendingSaveRef.current ?? sceneToText(docRef.current))
        pendingSaveRef.current = null
        setToast({ kind: 'notice', message: 'Saved' })
      } else {
        setToast({
          kind: 'error',
          message: `${result.code}: ${result.message ?? 'The shell could not save the scene.'}`,
        })
      }
    })
    const offChanged = client.onFileChanged((change) => {
      if (change.kind === 'renamed') pathRef.current = normalizeScenePath(change.path)
      if (change.kind === 'deleted') {
        setExternal(change)
        return
      }
      if (dirtyRef.current) {
        setExternal(change)
        return
      }
      void reloadFromDisk(false)
    })
    const offError = client.onError((error) => {
      setToast({ kind: 'error', message: `${error.code}: ${error.message ?? 'Shell error'}` })
    })
    const offDispose = client.onDispose(() => {
      // The SDK acknowledges dispose; the frame is closing.
    })
    return () => {
      offSave()
      offResult()
      offChanged()
      offError()
      offDispose()
    }
    // The client is stable for the frame lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client])

  const addDefinitionEntity = (type: string) => {
    try {
      const added = addEntity(doc, type, creationParentId)
      commit(withTypeRequirement(added.scene, type))
      setSelection(added.id)
      showNotice(`Added ${type}`)
    } catch (error) {
      showError(error)
    }
  }

  const addInstance = (path: string) => {
    try {
      const added = addSceneInstance(doc, path, creationParentId)
      commit(added.scene)
      setSelection(added.id)
      showNotice(`Instanced ${path}`)
    } catch (error) {
      showError(error)
    }
  }

  const addAsset = (asset: string) => {
    try {
      const added = addEntity(doc, 'basic3d:mesh', creationParentId)
      const withAsset = setEntityProp(added.scene, added.id, 'mesh', displayScenePath(asset))
      commit(withAsset)
      setSelection(added.id)
      showNotice(`Placed ${displayScenePath(asset)}`)
    } catch (error) {
      showError(error)
    }
  }

  const duplicateSelected = () => {
    if (!selectedEntity) return
    try {
      const duplicated = duplicateEntity(doc, selectedEntity.id)
      commit(duplicated.scene)
      setSelection(duplicated.id)
    } catch (error) {
      showError(error)
    }
  }

  const deleteSelected = () => {
    if (!selectedEntity) return
    if (selectedEntity.id === doc.root) {
      setToast({ kind: 'error', message: 'The scene root cannot be deleted.' })
      return
    }
    try {
      const next = deleteEntity(doc, selectedEntity.id)
      commit(next)
      setSelection(null)
    } catch (error) {
      showError(error)
    }
  }

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      const editing =
        target?.tagName === 'INPUT' ||
        target?.tagName === 'TEXTAREA' ||
        target?.tagName === 'SELECT' ||
        target?.isContentEditable
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
        event.preventDefault()
        client.requestSave()
        return
      }
      if (!editing && (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault()
        if (event.shiftKey) history.redo()
        else history.undo()
        return
      }
      if (!editing && (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'y') {
        event.preventDefault()
        history.redo()
        return
      }
      if (editing || !canWrite) return
      if (event.metaKey || event.ctrlKey) {
        if (event.key.toLowerCase() === 'd') {
          event.preventDefault()
          duplicateSelected()
        }
        return
      }
      if (event.key.toLowerCase() === 'w') setMode('translate')
      if (event.key.toLowerCase() === 'e') setMode('rotate')
      if (event.key.toLowerCase() === 'r') setMode('scale')
      if (event.key === 'Delete' || event.key === 'Backspace') {
        if (selectedEntity && selectedEntity.id !== doc.root) {
          event.preventDefault()
          deleteSelected()
        }
      }
      if (event.key === 'Escape') {
        setSelection(null)
        setPromotionName('')
        setSlotName('')
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
    // The handlers intentionally track the current document and selection.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canWrite, selectedEntity, doc, client, history.canUndo, history.canRedo])

  const changeParent = (parentId: string) => {
    if (!selectedEntity) return
    try {
      const parent = entityById(doc, parentId)
      if (parent && entityIsSceneInstance(parent)) {
        const slots = slotNamesForInstance(doc, parent, context)
        if (slots.length === 0) {
          throw new Error('That scene instance exposes no slots.')
        }
        commit(setEntityParent(doc, selectedEntity.id, parentId, slots[0]))
      } else {
        commit(setEntityParent(doc, selectedEntity.id, parentId))
      }
    } catch (error) {
      showError(error)
    }
  }

  const changeSlot = (slot: string) => {
    if (!selectedEntity?.parent || !slot) return
    try {
      commit(setEntityParent(doc, selectedEntity.id, selectedEntity.parent, slot))
    } catch (error) {
      showError(error)
    }
  }

  const addPromotionFromForm = () => {
    const name = promotionName.trim()
    if (!name || !effectivePromotionEntity || !effectivePromotionTarget) {
      setToast({ kind: 'error', message: 'A promotion needs a name, a target entity, and a field or event.' })
      return
    }
    try {
      const next = addPromotion(doc, name, {
        entity: effectivePromotionEntity,
        ...(promotionKind === 'field'
          ? { field: effectivePromotionTarget }
          : { event: effectivePromotionTarget }),
      })
      commit(next)
      setPromotionName('')
      showNotice(`Promoted "${name}"`)
    } catch (error) {
      showError(error)
    }
  }

  const addSlotFromForm = () => {
    const name = slotName.trim()
    if (!name || !effectiveSlotAnchor) {
      setToast({ kind: 'error', message: 'A slot needs a name and an anchor entity.' })
      return
    }
    try {
      commit(addSlot(doc, name, effectiveSlotAnchor))
      setSlotName('')
      showNotice(`Declared slot "${name}"`)
    } catch (error) {
      showError(error)
    }
  }

  const deletePromotion = (name: string) => commit(removePromotion(doc, name))
  const deleteSlot = (name: string) => commit(removeSlot(doc, name))

  const updateRequires = (index: number, value: string) => {
    mutate((draft) => {
      draft.requires[index] = value
    })
  }

  const addRequirement = () => {
    const available = [
      { namespace: builtin.namespace, version: builtin.version },
      ...Object.values(schemas).map((bundle) => ({
        namespace: bundle.namespace,
        version: bundle.version,
      })),
    ]
    const nextOption = available.find(
      (option) => !doc.requires.some((entry) => entry.startsWith(`${option.namespace}@`)),
    )
    if (!nextOption) {
      setToast({ kind: 'error', message: 'Every available schema is already required.' })
      return
    }
    mutate((draft) => {
      draft.requires.push(`${nextOption.namespace}@${nextOption.version}`)
    })
  }

  const removeRequirement = (index: number) => {
    mutate((draft) => {
      draft.requires.splice(index, 1)
    })
  }

  const ViewportComponent = Viewport
  const fileName = sceneFileName(pathRef.current)
  const levelBadge = levelMode ? 'Level' : 'Scene'
  const allEntities = doc.entities

  return (
    <div className="scene-shell">
      <header className="scene-toolbar">
        <div className="scene-identity">
          <div className="scene-mark" aria-hidden="true">T</div>
          <div className="scene-identity-copy">
            <strong>{fileName}</strong>
            <span>
              {doc.id}
              <em className={`scene-kind-badge ${levelMode ? 'level' : ''}`}>{levelBadge}</em>
            </span>
          </div>
        </div>
        <div className="scene-toolbar-group">
          <button
            type="button"
            className={`button tiny ${mode === 'translate' ? 'active' : 'ghost'}`}
            title="Move (W)"
            onClick={() => setMode('translate')}
          >
            Move
          </button>
          <button
            type="button"
            className={`button tiny ${mode === 'rotate' ? 'active' : 'ghost'}`}
            title="Rotate (E)"
            onClick={() => setMode('rotate')}
          >
            Rotate
          </button>
          <button
            type="button"
            className={`button tiny ${mode === 'scale' ? 'active' : 'ghost'}`}
            title="Scale (R)"
            onClick={() => setMode('scale')}
          >
            Scale
          </button>
          <button
            type="button"
            className={`button tiny ${snap ? 'active' : 'ghost'}`}
            title="Snap transforms"
            onClick={() => setSnap((value) => !value)}
          >
            Snap
          </button>
        </div>
        <div className="scene-toolbar-group">
          <button
            type="button"
            className="button tiny ghost"
            disabled={!history.canUndo}
            onClick={history.undo}
            title="Undo (Ctrl/Cmd+Z)"
          >
            Undo
          </button>
          <button
            type="button"
            className="button tiny ghost"
            disabled={!history.canRedo}
            onClick={history.redo}
            title="Redo"
          >
            Redo
          </button>
          <button
            type="button"
            className="button tiny ghost"
            disabled={!canWrite || !selectedEntity || selectedEntity.id === doc.root}
            onClick={duplicateSelected}
            title="Duplicate (Ctrl/Cmd+D)"
          >
            Duplicate
          </button>
          <button
            type="button"
            className="button tiny danger"
            disabled={!canWrite || !selectedEntity || selectedEntity.id === doc.root}
            onClick={deleteSelected}
            title="Delete"
          >
            Delete
          </button>
        </div>
        <div className="scene-toolbar-group">
          <button
            type="button"
            className="button tiny ghost"
            onClick={() => {
              setDrawerTab('validation')
              setDrawerOpen(true)
            }}
          >
            Validation
            <span className={`scene-pill ${errorCount > 0 ? 'error' : warningCount > 0 ? 'warning' : ''}`}>
              {errorCount > 0 ? errorCount : warningCount}
            </span>
          </button>
        </div>
      </header>

      {external && (
        <div className="scene-banner warning" role="status">
          <span>
            {external.kind === 'deleted'
              ? 'The scene file was deleted outside this editor.'
              : 'The scene changed outside this editor.'}
            {dirty ? ' Your unsaved changes are kept.' : ''}
          </span>
          <button type="button" className="link-button" onClick={() => void reloadFromDisk(true)}>
            Reload from disk
          </button>
          <button type="button" className="link-button" onClick={() => setExternal(null)}>
            Dismiss
          </button>
        </div>
      )}
      {toast && (
        <div className={`scene-banner ${toast.kind === 'error' ? 'danger' : 'success'}`} role="status">
          <span>{toast.message}</span>
          <button type="button" className="link-button" onClick={() => setToast(null)}>
            Dismiss
          </button>
        </div>
      )}

      <div className="scene-body">
        <aside className="scene-left">
          <section className="scene-panel scene-hierarchy-panel">
            <div className="scene-panel-heading">
              <h2>Hierarchy</h2>
              <span>{allEntities.length}</span>
            </div>
            <div className="scene-tree" role="tree" aria-label="Scene hierarchy">
              <HierarchyTree
                scene={doc}
                entityId={doc.root}
                selection={selection}
                issues={validation.issues}
                onSelect={setSelection}
              />
              {!entityById(doc, doc.root) && (
                <p className="scene-empty-note">The root entity is missing.</p>
              )}
            </div>
          </section>

          <section className="scene-panel scene-library-panel">
            <div className="scene-panel-tabs">
              <button
                type="button"
                className={sidebarTab === 'palette' ? 'active' : ''}
                onClick={() => setSidebarTab('palette')}
              >
                Palette
              </button>
              <button
                type="button"
                className={sidebarTab === 'assets' ? 'active' : ''}
                onClick={() => setSidebarTab('assets')}
              >
                Assets
              </button>
            </div>
            {sidebarTab === 'palette' ? (
              <div className="scene-library-body">
                <input
                  type="search"
                  className="scene-search"
                  placeholder="Search definitions and scenes"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                />
                <div className="scene-palette-group">
                  <h3>Entities</h3>
                  {filteredDefinitions.length === 0 ? (
                    <p className="scene-empty-note">
                      No concrete definitions. Add one in a schema bundle required by this scene.
                    </p>
                  ) : (
                    <ul className="scene-palette-list">
                      {filteredDefinitions.map((definition) => (
                        <li key={definition.type}>
                          <button
                            type="button"
                            className="scene-palette-item"
                            disabled={!canWrite}
                            onClick={() => addDefinitionEntity(definition.type)}
                            title={definition.doc}
                          >
                            <span>{definition.type}</span>
                            <small>{definition.namespace}</small>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                <div className="scene-palette-group">
                  <h3>Scene instances</h3>
                  {filteredScenes.length === 0 ? (
                    <p className="scene-empty-note">No other scene documents.</p>
                  ) : (
                    <ul className="scene-palette-list">
                      {filteredScenes.map((scene) => (
                        <li key={scene.path}>
                          <button
                            type="button"
                            className="scene-palette-item"
                            disabled={!canWrite}
                            onClick={() => addInstance(scene.path)}
                          >
                            <span>{sceneFileName(scene.path)}</span>
                            <small>{scene.path}</small>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            ) : (
              <div className="scene-library-body">
                <input
                  type="search"
                  className="scene-search"
                  placeholder="Search assets"
                  value={assetSearch}
                  onChange={(event) => setAssetSearch(event.target.value)}
                />
                {!client.capabilities.directoryListing && (
                  <p className="scene-empty-note">
                    Directory listing is unavailable in this shell. Asset paths can still be typed.
                  </p>
                )}
                {filteredAssets.length === 0 ? (
                  <p className="scene-empty-note">
                    No assets under <code>/assets</code>.
                  </p>
                ) : (
                  <ul className="scene-asset-list">
                    {filteredAssets.map((asset) => (
                      <li key={asset}>
                        <span className="scene-asset-name">{displayScenePath(asset)}</span>
                        <button
                          type="button"
                          className="button tiny ghost"
                          disabled={!canWrite || !asset.toLowerCase().endsWith('.glb')}
                          onClick={() => addAsset(asset)}
                        >
                          Place
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </section>
        </aside>

        <main className="scene-viewport-wrap">
          {ViewportComponent ? (
            <ViewportComponent
              client={client}
              scene={doc}
              context={context}
              selection={selection}
              onSelect={setSelection}
              onTransform={(id, transform) => commit(setEntityTransform(doc, id, transform))}
              mode={mode}
              snap={snap}
            />
          ) : (
            <div className="scene-viewport-placeholder">
              <p>3D viewport unavailable.</p>
            </div>
          )}
          <div className="scene-viewport-hint">
            <span>W move · E rotate · R scale · Esc deselect</span>
            <span>{allEntities.length} entities</span>
          </div>
        </main>

        <aside className="scene-right">
          <div className="scene-panel-heading">
            <h2>{selection ? 'Inspector' : 'Scene settings'}</h2>
            {selection && (
              <button type="button" className="link-button" onClick={() => setSelection(null)}>
                Scene
              </button>
            )}
          </div>
          <div className="scene-inspector-scroll">
            {selectedEntity ? (
              <EntityInspector
                scene={doc}
                entity={selectedEntity}
                context={context}
                assets={workspace.assets}
                canWrite={canWrite}
                parentOptions={parentOptions}
                sceneOptions={instanceScenes}
                onChangeName={(value) => commit(setEntityName(doc, selectedEntity.id, value))}
                onChangeType={(value) => {
                  try {
                    commit(withTypeRequirement(setEntityType(doc, selectedEntity.id, value), value))
                  } catch (error) {
                    showError(error)
                  }
                }}
                onChangeScene={(value) => {
                  try {
                    commit(setSceneInstancePath(doc, selectedEntity.id, value))
                  } catch (error) {
                    showError(error)
                  }
                }}
                onChangeParent={changeParent}
                onChangeSlot={changeSlot}
                onChangeTransform={(transform) =>
                  commit(setEntityTransform(doc, selectedEntity.id, transform))
                }
                onChangeProp={(name, value) =>
                  commit(setEntityProp(doc, selectedEntity.id, name, value))
                }
                onResetProp={(name) => {
                  commit(removeEntityProp(doc, selectedEntity.id, name))
                }}
                onDelete={deleteSelected}
                onDuplicate={duplicateSelected}
              />
            ) : (
              <SceneSettings
                scene={doc}
                context={context}
                schemas={schemas}
                canWrite={canWrite}
                onChange={(id) =>
                  mutate((draft) => {
                    draft.id = id
                  })
                }
                onRequiresChange={updateRequires}
                onAddRequirement={addRequirement}
                onRemoveRequirement={removeRequirement}
              />
            )}
          </div>
        </aside>
      </div>

      <section className={`scene-drawer ${drawerOpen ? 'open' : ''}`}>
        <div className="scene-drawer-tabs">
          <button
            type="button"
            className={drawerTab === 'validation' ? 'active' : ''}
            onClick={() => {
              setDrawerTab('validation')
              setDrawerOpen(true)
            }}
          >
            Validation
            <span className={`scene-pill ${errorCount > 0 ? 'error' : warningCount > 0 ? 'warning' : ''}`}>
              {allIssues.length}
            </span>
          </button>
          <button
            type="button"
            className={drawerTab === 'public' ? 'active' : ''}
            onClick={() => {
              setDrawerTab('public')
              setDrawerOpen(true)
            }}
          >
            Public surface
            <span className="scene-pill">{surface.fields.length + surface.events.length}</span>
          </button>
          <button
            type="button"
            className={drawerTab === 'debug' ? 'active' : ''}
            onClick={() => {
              setDrawerTab('debug')
              setDrawerOpen(true)
              setExpanded(true)
            }}
          >
            Debug expansion
          </button>
          <button
            type="button"
            className="scene-drawer-toggle"
            onClick={() => setDrawerOpen((value) => !value)}
          >
            {drawerOpen ? 'Collapse' : 'Expand'}
          </button>
        </div>
        {drawerOpen && (
          <div className="scene-drawer-body">
            {drawerTab === 'validation' && (
              <ValidationList
                issues={allIssues}
                onSelect={(entityId) => setSelection(entityId)}
              />
            )}
            {drawerTab === 'public' && (
              <div className="scene-public-grid">
                <section className="scene-public-surface">
                  <h3>Effective public surface</h3>
                  {surface.fields.length === 0 && surface.events.length === 0 ? (
                    <p className="scene-empty-note">The scene has no public fields or events yet.</p>
                  ) : (
                    <ul className="scene-surface-list">
                      {surface.fields.map((field) => (
                        <li key={`field-${field.name}`}>
                          <span className="scene-surface-name">{field.name}</span>
                          <span className="scene-surface-type">{fieldTypeLabel(field.field)}</span>
                          <span className="scene-origin">{schemaLabel(field.originDefinitionId)}</span>
                          <span className={`scene-promoted ${field.promoted ? '' : 'root'}`}>
                            {field.promoted ? 'promoted' : 'root'}
                          </span>
                        </li>
                      ))}
                      {surface.events.map((event) => (
                        <li key={`event-${event.name}`}>
                          <span className="scene-surface-name">{event.name}</span>
                          <span className="scene-surface-type">event</span>
                          <span className="scene-origin">{schemaLabel(event.originDefinitionId)}</span>
                          <span className={`scene-promoted ${event.promoted ? '' : 'root'}`}>
                            {event.promoted ? 'promoted' : 'root'}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                  {surface.issues.length > 0 && (
                    <p className="scene-warning">{surface.issues.length} public-surface issue(s).</p>
                  )}
                </section>

                <section className="scene-promotions">
                  <h3>Promotions</h3>
                  {Object.keys(doc.promotes ?? {}).length === 0 ? (
                    <p className="scene-empty-note">No promotions.</p>
                  ) : (
                    <ul className="scene-public-list">
                      {Object.entries(doc.promotes ?? {}).map(([name, promotion]) => (
                        <li key={name}>
                          <span className="scene-public-name">{name}</span>
                          <span>
                            {promotion.entity}.{promotion.field ?? promotion.event}
                          </span>
                          <span className="scene-origin">
                            {promotion.event ? 'event' : 'field'}
                          </span>
                          <button
                            type="button"
                            className="link-button"
                            disabled={!canWrite}
                            onClick={() => deletePromotion(name)}
                          >
                            Remove
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                  <div className="scene-inline-form">
                    <input
                      type="text"
                      aria-label="Promotion name"
                      placeholder="public name"
                      value={promotionName}
                      disabled={!canWrite}
                      onChange={(event) => setPromotionName(event.target.value)}
                    />
                    <select
                      aria-label="Promotion target entity"
                      value={effectivePromotionEntity}
                      disabled={!canWrite}
                      onChange={(event) => {
                        setPromotionEntity(event.target.value)
                        setPromotionTarget('')
                      }}
                    >
                      {directChildOptions.map((entity) => (
                        <option key={entity.id} value={entity.id}>
                          {entity.id} · {entityLabel(entity)}
                        </option>
                      ))}
                    </select>
                    <select
                      aria-label="Promotion kind"
                      value={promotionKind}
                      disabled={!canWrite}
                      onChange={(event) => {
                        setPromotionKind(event.target.value as 'field' | 'event')
                        setPromotionTarget('')
                      }}
                    >
                      <option value="field">field</option>
                      <option value="event">event</option>
                    </select>
                    <select
                      aria-label="Promotion target"
                      value={effectivePromotionTarget}
                      disabled={!canWrite || promotionTargetOptions.length === 0}
                      onChange={(event) => setPromotionTarget(event.target.value)}
                    >
                      {promotionTargetOptions.length === 0 && <option value="">—</option>}
                      {promotionTargetOptions.map((name) => (
                        <option key={name} value={name}>
                          {name}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      className="button tiny primary"
                      disabled={!canWrite}
                      onClick={addPromotionFromForm}
                    >
                      Promote
                    </button>
                  </div>
                  {directChildOptions.length === 0 && (
                    <p className="scene-hint">
                      Promotions can target direct children of the root only.
                    </p>
                  )}
                </section>

                <section className="scene-slots">
                  <h3>Slots</h3>
                  {Object.keys(doc.slots ?? {}).length === 0 ? (
                    <p className="scene-empty-note">No slots.</p>
                  ) : (
                    <ul className="scene-public-list">
                      {Object.entries(doc.slots ?? {}).map(([name, slot]) => (
                        <li key={name}>
                          <span className="scene-public-name">{name}</span>
                          <span>{slot.entity}</span>
                          <span className="scene-origin">anchor</span>
                          <button
                            type="button"
                            className="link-button"
                            disabled={!canWrite}
                            onClick={() => deleteSlot(name)}
                          >
                            Remove
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                  <div className="scene-inline-form">
                    <input
                      type="text"
                      aria-label="Slot name"
                      placeholder="slot name"
                      value={slotName}
                      disabled={!canWrite}
                      onChange={(event) => setSlotName(event.target.value)}
                    />
                    <select
                      aria-label="Slot anchor"
                      value={effectiveSlotAnchor}
                      disabled={!canWrite}
                      onChange={(event) => setSlotAnchor(event.target.value)}
                    >
                      {doc.entities.map((entity) => (
                        <option key={entity.id} value={entity.id}>
                          {entity.id} · {entityLabel(entity)}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      className="button tiny primary"
                      disabled={!canWrite}
                      onClick={addSlotFromForm}
                    >
                      Add slot
                    </button>
                  </div>
                </section>
              </div>
            )}
            {drawerTab === 'debug' && (
              <div className="scene-debug">
                <div className="scene-debug-heading">
                  <span>
                    {expandedScene
                      ? `${expandedScene.entities.length} resolved entities · ${expandedScene.issues.length} expansion issues`
                      : 'Expansion has not run.'}
                  </span>
                  <button type="button" className="button tiny ghost" onClick={() => setExpanded(true)}>
                    Resolve scene instances
                  </button>
                </div>
                {expandedScene && expandedScene.issues.length > 0 && (
                  <ValidationList
                    issues={expandedScene.issues}
                    onSelect={(entityId) => setSelection(entityId)}
                  />
                )}
                {expandedScene && (
                  <pre className="scene-debug-json">
                    {JSON.stringify(expandedScene.entities, null, 2)}
                  </pre>
                )}
              </div>
            )}
          </div>
        )}
      </section>
    </div>
  )
}

function HierarchyTree({
  scene,
  entityId,
  selection,
  issues,
  onSelect,
  path = [],
}: {
  scene: SceneDocument
  entityId: string
  selection: string | null
  issues: ValidationIssue[]
  onSelect: (id: string) => void
  path?: string[]
}) {
  if (path.includes(entityId)) return null
  const entity = entityById(scene, entityId)
  if (!entity) return null
  const children = directChildren(scene, entity.id).filter((child) => child.id !== entity.id)
  const entityIssues = issues.filter((issue) => issue.entityId === entity.id)
  return (
    <div className="scene-tree-node" role="treeitem" aria-selected={selection === entity.id}>
      <button
        type="button"
        className={`scene-tree-row ${selection === entity.id ? 'selected' : ''}`}
        onClick={() => onSelect(entity.id)}
      >
        <span className={`scene-tree-icon ${entity.scene ? 'instance' : ''}`}>
          {entity.scene ? '◇' : entity.type?.split(':').at(-1) === 'node' ? '○' : '◆'}
        </span>
        <span className="scene-tree-label">{entityLabel(entity)}</span>
        <code>{entity.id}</code>
        {entityIssues.length > 0 && (
          <span
            className={`scene-tree-dot ${
              entityIssues.some((issue) => issue.severity === 'error') ? 'error' : 'warning'
            }`}
            title={entityIssues.map((issue) => issue.message).join('\n')}
          />
        )}
      </button>
      {children.length > 0 && (
        <div className="scene-tree-children">
          {children.map((child) => (
            <HierarchyTree
              key={child.id}
              scene={scene}
              entityId={child.id}
              selection={selection}
              issues={issues}
              onSelect={onSelect}
              path={[...path, entity.id]}
            />
          ))}
        </div>
      )}
    </div>
  )
}
