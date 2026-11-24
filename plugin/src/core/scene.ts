import {
  builtinBundle,
  cloneJson,
  definitionLocalName,
  definitionNamespace,
  effectiveDefinition,
  fieldHasDefault,
  isRecord,
  lookupDefinition,
  lookupFieldEnum,
  type EffectiveEvent,
  type EffectiveField,
  type JsonRecord,
  type SchemaBundle,
  type SchemaEvent,
  type SchemaField,
  type ValidationIssue,
  type ValidationResult,
} from './schema'

export type Vec3 = [number, number, number]

export interface EntityTransform {
  position?: Vec3
  rotation?: Vec3
  scale?: Vec3
  [key: string]: unknown
}

export interface SceneEntity {
  id: string
  name?: string
  type?: string
  scene?: string
  parent?: string
  slot?: string
  transform?: EntityTransform
  props?: Record<string, unknown>
  [key: string]: unknown
}

export interface ScenePromotion {
  entity: string
  field?: string
  event?: string
  [key: string]: unknown
}

export interface SceneSlot {
  entity: string
  [key: string]: unknown
}

export interface SceneDocument {
  id: string
  requires: string[]
  root: string
  entities: SceneEntity[]
  promotes?: Record<string, ScenePromotion>
  slots?: Record<string, SceneSlot>
  [key: string]: unknown
}

export interface SceneValidationContext {
  builtin: SchemaBundle
  /** Resolved schema bundles keyed by namespace. */
  schemas: Record<string, SchemaBundle>
  /** Scene documents keyed by normalized `/`-rooted path. */
  scenes: Record<string, SceneDocument>
  /** Workspace asset paths, when the editor can list them. */
  assets?: string[]
}

export interface SceneSurfaceField {
  name: string
  field: SchemaField
  originDefinitionId: string
  namespace: string
  promoted: boolean
  /** Entity in this document that owns the concrete property. */
  targetEntityId?: string
  /** Property name on the target entity (or public name on a nested scene). */
  targetFieldName?: string
}

export interface SceneSurfaceEvent {
  name: string
  event: SchemaEvent
  originDefinitionId: string
  namespace: string
  promoted: boolean
  targetEntityId?: string
  targetEventName?: string
}

export interface SceneSurface {
  fields: SceneSurfaceField[]
  events: SceneSurfaceEvent[]
  issues: ValidationIssue[]
}

export interface EntitySurface {
  fields: EffectiveField[]
  events: EffectiveEvent[]
  issues: ValidationIssue[]
}

export interface EntityProperty {
  name: string
  field: SchemaField
  originDefinitionId: string
  namespace: string
  value: unknown
  hasDefault: boolean
  overridden: boolean
  promoted: boolean
}

export interface ExpandedEntity {
  id: string
  type: string
  parent?: string
  transform: Required<Pick<EntityTransform, 'position' | 'rotation' | 'scale'>>
  props: Record<string, unknown>
  /** Authoring path for debug display: scene path followed by entity IDs. */
  path: string[]
}

export interface ExpandedScene {
  root: string
  entities: ExpandedEntity[]
  issues: ValidationIssue[]
}

export const IDENTITY_POSITION: Vec3 = [0, 0, 0]
export const IDENTITY_ROTATION: Vec3 = [0, 0, 0]
export const IDENTITY_SCALE: Vec3 = [1, 1, 1]

export function normalizeScenePath(path: string): string {
  const clean = path.trim().replaceAll('\\', '/')
  if (!clean) return ''
  return clean.startsWith('/') ? clean : `/${clean}`
}

export function displayScenePath(path: string): string {
  return normalizeScenePath(path).replace(/^\/+/, '')
}

export function sceneFileName(path: string): string {
  return normalizeScenePath(path).split('/').at(-1) ?? path
}

export function parseSceneText(text: string): SceneDocument {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch (error) {
    throw new Error(
      `The scene is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
  if (!isRecord(value)) throw new Error('The scene document must be a JSON object.')
  if (typeof value.id !== 'string' || value.id.length === 0) {
    throw new Error('The scene needs a non-empty string "id".')
  }
  if (!Array.isArray(value.requires) || value.requires.some((item) => typeof item !== 'string')) {
    throw new Error('The scene needs a "requires" array of schema versions.')
  }
  if (typeof value.root !== 'string' || value.root.length === 0) {
    throw new Error('The scene needs a string "root" entity ID.')
  }
  if (!Array.isArray(value.entities)) {
    throw new Error('The scene needs an "entities" array.')
  }
  for (const [index, entity] of value.entities.entries()) {
    if (!isRecord(entity)) throw new Error(`Entity ${index + 1} must be an object.`)
    if (typeof entity.id !== 'string' || entity.id.length === 0) {
      throw new Error(`Entity ${index + 1} needs a non-empty string "id".`)
    }
  }
  if (value.promotes !== undefined) {
    if (!isRecord(value.promotes)) throw new Error('Scene "promotes" must be an object when present.')
    for (const [name, promotion] of Object.entries(value.promotes)) {
      if (!isRecord(promotion)) throw new Error(`Promotion "${name}" must be an object.`)
      if (typeof promotion.entity !== 'string') {
        throw new Error(`Promotion "${name}" needs an entity ID.`)
      }
    }
  }
  if (value.slots !== undefined) {
    if (!isRecord(value.slots)) throw new Error('Scene "slots" must be an object when present.')
    for (const [name, slot] of Object.entries(value.slots)) {
      if (!isRecord(slot)) throw new Error(`Slot "${name}" must be an object.`)
      if (typeof slot.entity !== 'string') throw new Error(`Slot "${name}" needs an entity ID.`)
    }
  }
  return value as unknown as SceneDocument
}

export function sceneToText(scene: SceneDocument): string {
  return `${JSON.stringify(scene, null, 2)}\n`
}

export function createEmptyScene(
  id = 'scene_new',
  builtinVersion = builtinBundle().version,
): SceneDocument {
  return {
    id,
    requires: [`basic3d@${builtinVersion}`],
    root: 'root',
    entities: [{ id: 'root', type: 'basic3d:node' }],
    promotes: {},
    slots: {},
  }
}

export function sceneTemplateText(id = 'scene_new'): string {
  return sceneToText(createEmptyScene(id))
}

export function entityById(scene: SceneDocument, id: string): SceneEntity | undefined {
  return scene.entities.find((entity) => entity.id === id)
}

export function directChildren(scene: SceneDocument, parentId: string): SceneEntity[] {
  return scene.entities.filter((entity) => entity.parent === parentId)
}

export function entityIsSceneInstance(entity: SceneEntity): boolean {
  return typeof entity.scene === 'string'
}

export function entityLabel(entity: SceneEntity): string {
  const explicit = typeof entity.name === 'string' ? entity.name.trim() : ''
  if (explicit) return explicit
  if (entity.type) return definitionLocalName(entity.type)
  if (entity.scene) return sceneFileName(entity.scene).replace(/\.scene\.json$/, '')
  return entity.id
}

export function normalizeTransform(transform?: EntityTransform): {
  position: Vec3
  rotation: Vec3
  scale: Vec3
} {
  const component = (key: 'position' | 'rotation' | 'scale', fallback: Vec3): Vec3 => {
    const value = transform?.[key]
    if (
      Array.isArray(value) &&
      value.length === 3 &&
      value.every((item) => typeof item === 'number' && Number.isFinite(item))
    ) {
      return [value[0], value[1], value[2]]
    }
    return [...fallback] as Vec3
  }
  return {
    position: component('position', IDENTITY_POSITION),
    rotation: component('rotation', IDENTITY_ROTATION),
    scale: component('scale', IDENTITY_SCALE),
  }
}

export function normalizeRequires(scene: SceneDocument): {
  requirements: Record<string, string>
  issues: ValidationIssue[]
} {  const requirements: Record<string, string> = {}
  const issues: ValidationIssue[] = []
  const seen = new Set<string>()
  for (const entry of scene.requires) {
    const match = /^([A-Za-z0-9._-]+)@(\d+\.\d+\.\d+(?:[-+].+)?)$/.exec(entry)
    if (!match) {
      issues.push({
        severity: 'error',
        code: 'scene-requirement',
        message: `Scene requirement "${entry}" must use "namespace@version", for example gameA@1.0.0.`,
      })
      continue
    }
    const [, namespace, version] = match
    if (seen.has(namespace)) {
      issues.push({
        severity: 'error',
        code: 'scene-requirement-duplicate',
        message: `Scene requires schema "${namespace}" more than once.`,
      })
      continue
    }
    seen.add(namespace)
    requirements[namespace] = version
  }
  return { requirements, issues }
}

export function bundleForNamespace(
  namespace: string,
  context: SceneValidationContext,
): SchemaBundle | null {
  if (namespace === context.builtin.namespace) return context.builtin
  return context.schemas[namespace] ?? null
}

export function ensureSceneRequirement(
  scene: SceneDocument,
  namespace: string,
  version: string,
): SceneDocument {
  if (scene.requires.some((entry) => entry.startsWith(`${namespace}@`))) return scene
  const next = cloneJson(scene)
  next.requires = [...next.requires, `${namespace}@${version}`]
  return next
}

export function importsForBundle(
  bundle: SchemaBundle,
  context: SceneValidationContext,
): Record<string, SchemaBundle> {
  const imports: Record<string, SchemaBundle> = {}
  for (const namespace of Object.keys(bundle.imports ?? {})) {
    const imported = bundleForNamespace(namespace, context)
    if (imported) imports[namespace] = imported
  }
  return imports
}

export interface TypeLookup {
  bundle: SchemaBundle
  definition: ReturnType<typeof lookupDefinition>
}

export function lookupType(
  type: string,
  context: SceneValidationContext,
): TypeLookup | null {
  const namespace = definitionNamespace(type)
  if (!namespace) return null
  const bundle = bundleForNamespace(namespace, context)
  if (!bundle) return null
  const definition = lookupDefinition(type, bundle, context.builtin, importsForBundle(bundle, context))
  return definition ? { bundle, definition } : null
}

export function effectiveForType(
  type: string,
  context: SceneValidationContext,
): EntitySurface {
  const found = lookupType(type, context)
  if (!found) {
    return {
      fields: [],
      events: [],
      issues: [
        {
          severity: 'error',
          code: 'missing-definition',
          message: `Type "${type}" is not available in the project schemas.`,
        },
      ],
    }
  }
  const effective = effectiveDefinition(
    type,
    found.bundle,
    context.builtin,
    importsForBundle(found.bundle, context),
  )
  return {
    fields: effective.fields,
    events: effective.events,
    issues: effective.issues,
  }
}

export function enumForField(
  field: SchemaField,
  originDefinitionId: string,
  context: SceneValidationContext,
) {
  const namespace = definitionNamespace(originDefinitionId)
  const bundle = namespace ? bundleForNamespace(namespace, context) : null
  if (!bundle) return null
  return lookupFieldEnum(
    field,
    originDefinitionId,
    bundle,
    context.builtin,
    importsForBundle(bundle, context),
  )
}

function addSceneIssue(
  issues: ValidationIssue[],
  issue: ValidationIssue,
  seen: Set<string>,
): void {
  const key = `${issue.severity}|${issue.code}|${issue.entityId ?? ''}|${issue.fieldName ?? ''}|${issue.promotionName ?? ''}|${issue.slotName ?? ''}|${issue.message}`
  if (seen.has(key)) return
  seen.add(key)
  issues.push(issue)
}

function sceneIssue(
  code: string,
  message: string,
  extra: Partial<ValidationIssue> = {},
): ValidationIssue {
  return { severity: 'error', code, message, ...extra }
}

function publicNameIssue(name: string): string | null {
  if (!name.trim()) return 'Public names cannot be empty.'
  if (!/^[A-Za-z0-9._-]+$/.test(name)) {
    return `Public name "${name}" must contain letters, numbers, dots, dashes, or underscores.`
  }
  return null
}

function entitySurface(
  scene: SceneDocument,
  entity: SceneEntity,
  context: SceneValidationContext,
  stack: SceneDocument[],
): EntitySurface {
  if (entity.type) {
    const effective = effectiveForType(entity.type, context)
    return { fields: effective.fields, events: effective.events, issues: effective.issues }
  }
  if (entity.scene) {
    const target = context.scenes[normalizeScenePath(entity.scene)]
    if (!target) {
      return {
        fields: [],
        events: [],
        issues: [
          sceneIssue(
            'missing-scene',
            `Scene instance "${entity.id}" references missing "${entity.scene}".`,
            { entityId: entity.id },
          ),
        ],
      }
    }
    const surface = sceneSurface(target, context, stack)
    return {
      fields: surface.fields.map((field) => ({
        name: field.name,
        field: field.field,
        origin: field.originDefinitionId,
        inherited: field.promoted,
        override: false,
      })),
      events: surface.events.map((event) => ({
        name: event.name,
        event: event.event,
        origin: event.originDefinitionId,
        inherited: event.promoted,
      })),
      issues: surface.issues,
    }
  }
  void scene
  return { fields: [], events: [], issues: [] }
}

export function sceneSurface(
  scene: SceneDocument,
  context: SceneValidationContext,
  stack: SceneDocument[] = [],
): SceneSurface {
  const issues: ValidationIssue[] = []
  const seen = new Set<string>()
  if (stack.includes(scene)) {
    const issue = sceneIssue(
      'scene-cycle',
      `Scene reference cycle includes "${scene.id}".`,
    )
    return { fields: [], events: [], issues: [issue] }
  }
  const nextStack = [...stack, scene]
  const root = entityById(scene, scene.root)
  if (!root) {
    return {
      fields: [],
      events: [],
      issues: [
        sceneIssue('scene-root', `Scene root "${scene.root}" does not exist.`),
      ],
    }
  }
  if (entityIsSceneInstance(root)) {
    return {
      fields: [],
      events: [],
      issues: [
        sceneIssue('scene-root-instance', 'A scene root must be an entity, not a scene instance.', {
          entityId: root.id,
        }),
      ],
    }
  }
  if (!root.type) {
    return {
      fields: [],
      events: [],
      issues: [
        sceneIssue('scene-root-type', 'The scene root needs a concrete definition.', {
          entityId: root.id,
        }),
      ],
    }
  }
  const rootSurface = entitySurface(scene, root, context, nextStack)
  for (const issue of rootSurface.issues) addSceneIssue(issues, issue, seen)

  const fields = new Map<string, SceneSurfaceField>()
  const events = new Map<string, SceneSurfaceEvent>()
  for (const field of rootSurface.fields) {
    fields.set(field.name, {
      name: field.name,
      field: field.field,
      originDefinitionId: field.origin,
      namespace: definitionNamespace(field.origin) ?? sceneNamespace(root.type) ?? '',
      promoted: false,
      targetEntityId: root.id,
      targetFieldName: field.name,
    })
  }
  for (const event of rootSurface.events) {
    if (fields.has(event.name)) {
      addSceneIssue(
        issues,
        sceneIssue(
          'public-name-collision',
          `Public name "${event.name}" is used by both a field and an event.`,
          { entityId: root.id, eventName: event.name },
        ),
        seen,
      )
    }
    events.set(event.name, {
      name: event.name,
      event: event.event,
      originDefinitionId: event.origin,
      namespace: definitionNamespace(event.origin) ?? sceneNamespace(root.type) ?? '',
      promoted: false,
      targetEntityId: root.id,
      targetEventName: event.name,
    })
  }

  for (const [name, promotion] of Object.entries(scene.promotes ?? {})) {
    if (!isRecord(promotion)) {
      addSceneIssue(
        issues,
        sceneIssue('promotion-shape', `Promotion "${name}" must be an object.`, {
          promotionName: name,
        }),
        seen,
      )
      continue
    }
    const sourceId = typeof promotion.entity === 'string' ? promotion.entity : ''
    const source = sourceId ? entityById(scene, sourceId) : undefined
    if (!source) {
      addSceneIssue(
        issues,
        sceneIssue(
          'promotion-target',
          `Promotion "${name}" references missing entity "${sourceId}".`,
          { promotionName: name, entityId: sourceId || undefined },
        ),
        seen,
      )
      continue
    }
    if (source.parent !== scene.root) {
      addSceneIssue(
        issues,
        sceneIssue(
          'promotion-direct-child',
          `Promotion "${name}" targets "${source.id}", which is not a direct child of the root.`,
          { promotionName: name, entityId: source.id },
        ),
        seen,
      )
      continue
    }
    const sourceSurface = entitySurface(scene, source, context, nextStack)
    for (const issue of sourceSurface.issues) addSceneIssue(issues, issue, seen)

    const wantsField = typeof promotion.field === 'string' && promotion.field.length > 0
    const wantsEvent = typeof promotion.event === 'string' && promotion.event.length > 0
    if (wantsField === wantsEvent) {
      addSceneIssue(
        issues,
        sceneIssue(
          'promotion-kind',
          `Promotion "${name}" must name exactly one field or event.`,
          { promotionName: name, entityId: source.id },
        ),
        seen,
      )
      continue
    }
    if (fields.has(name) || events.has(name)) {
      addSceneIssue(
        issues,
        sceneIssue(
          'promotion-collision',
          `Promotion "${name}" collides with another public field, event, or promotion.`,
          { promotionName: name, entityId: source.id },
        ),
        seen,
      )
      continue
    }
    if (wantsField) {
      const target = sourceSurface.fields.find((field) => field.name === promotion.field)
      if (!target) {
        addSceneIssue(
          issues,
          sceneIssue(
            'promotion-field',
            `Promotion "${name}" references missing field "${promotion.field}" on "${source.id}".`,
            { promotionName: name, entityId: source.id, fieldName: promotion.field },
          ),
          seen,
        )
        continue
      }
      if (target.field.type === 'entityRef' && target.field.scope !== 'host') {
        addSceneIssue(
          issues,
          sceneIssue(
            'promotion-entity-ref',
            `Promotion "${name}" exposes entityRef "${promotion.field}" without scope "host".`,
            { promotionName: name, entityId: source.id, fieldName: promotion.field },
          ),
          seen,
        )
      }
      fields.set(name, {
        name,
        field: target.field,
        originDefinitionId: target.origin,
        namespace: definitionNamespace(target.origin) ?? '',
        promoted: true,
        targetEntityId: source.id,
        targetFieldName: target.name,
      })
    } else {
      const target = sourceSurface.events.find((event) => event.name === promotion.event)
      if (!target) {
        addSceneIssue(
          issues,
          sceneIssue(
            'promotion-event',
            `Promotion "${name}" references missing event "${promotion.event}" on "${source.id}".`,
            { promotionName: name, entityId: source.id, eventName: promotion.event },
          ),
          seen,
        )
        continue
      }
      events.set(name, {
        name,
        event: target.event,
        originDefinitionId: target.origin,
        namespace: definitionNamespace(target.origin) ?? '',
        promoted: true,
        targetEntityId: source.id,
        targetEventName: target.name,
      })
    }
  }

  return { fields: [...fields.values()], events: [...events.values()], issues }
}

export function scenePublicField(
  scene: SceneDocument,
  name: string,
  context: SceneValidationContext,
): SceneSurfaceField | undefined {
  return sceneSurface(scene, context).fields.find((field) => field.name === name)
}

/** Current value of a public field before a host overrides it. */
export function scenePublicValue(
  scene: SceneDocument,
  name: string,
  context: SceneValidationContext,
  stack: SceneDocument[] = [],
): unknown {
  if (stack.includes(scene)) return undefined
  const field = scenePublicField(scene, name, context)
  if (!field || !field.targetEntityId) return undefined
  const target = entityById(scene, field.targetEntityId)
  if (!target) return undefined
  if (target.type) {
    const key = field.targetFieldName ?? name
    return Object.prototype.hasOwnProperty.call(target.props ?? {}, key)
      ? target.props?.[key]
      : field.field.default
  }
  if (target.scene) {
    const referenced = context.scenes[normalizeScenePath(target.scene)]
    if (!referenced) return undefined
    return scenePublicValue(referenced, field.targetFieldName ?? name, context, [...stack, scene])
  }
  return undefined
}

function sceneNamespace(type: string | undefined): string | null {
  return type ? definitionNamespace(type) : null
}

function validateTransform(
  transform: unknown,
  entityId: string,
  issues: ValidationIssue[],
  seen: Set<string>,
): void {
  if (transform === undefined) return
  if (!isRecord(transform)) {
    addSceneIssue(
      issues,
      sceneIssue('transform-shape', `Transform on "${entityId}" must be an object.`, {
        entityId,
      }),
      seen,
    )
    return
  }
  for (const key of Object.keys(transform)) {
    if (key !== 'position' && key !== 'rotation' && key !== 'scale') {
      addSceneIssue(
        issues,
        {
          severity: 'warning',
          code: 'transform-component',
          message: `Transform on "${entityId}" has unknown component "${key}".`,
          entityId,
        },
        seen,
      )
    }
  }
  for (const key of ['position', 'rotation', 'scale'] as const) {
    const value = transform[key]
    if (value === undefined) continue
    if (
      !Array.isArray(value) ||
      value.length !== 3 ||
      value.some((item) => typeof item !== 'number' || !Number.isFinite(item))
    ) {
      addSceneIssue(
        issues,
        sceneIssue(
          'transform-component',
          `Transform "${key}" on "${entityId}" must be three finite numbers.`,
          { entityId },
        ),
        seen,
      )
    }
  }
}

function valueIssue(
  value: unknown,
  field: SchemaField,
  originDefinitionId: string,
  context: SceneValidationContext,
): string | null {
  const type = field.type
  if (type === 'enum') {
    const lookup = enumForField(field, originDefinitionId, context)
    if (!lookup) return 'references an enum that is not available'
    if (typeof value !== 'string' || !lookup.enumDef.values.includes(value)) {
      return `must be one of ${lookup.enumDef.values.map((item) => `"${item}"`).join(', ')}`
    }
    return null
  }
  if (type === 'string') return typeof value === 'string' ? null : 'must be a string'
  if (type === 'int') {
    return typeof value === 'number' && Number.isInteger(value) ? null : 'must be an integer'
  }
  if (type === 'float') {
    return typeof value === 'number' && Number.isFinite(value) ? null : 'must be a finite number'
  }
  if (type === 'bool') return typeof value === 'boolean' ? null : 'must be a boolean'
  if (type === 'color') {
    if (
      Array.isArray(value) &&
      (value.length === 3 || value.length === 4) &&
      value.every((item) => typeof item === 'number' && Number.isFinite(item))
    ) {
      return null
    }
    return 'must be an RGB or RGBA number array'
  }
  if (type === 'vec2') {
    if (
      Array.isArray(value) &&
      value.length === 2 &&
      value.every((item) => typeof item === 'number' && Number.isFinite(item))
    ) {
      return null
    }
    return 'must be a two-number array'
  }
  if (type === 'vec3') {
    if (
      Array.isArray(value) &&
      value.length === 3 &&
      value.every((item) => typeof item === 'number' && Number.isFinite(item))
    ) {
      return null
    }
    return 'must be a three-number array'
  }
  if (type === 'entityRef' || type === 'assetRef') {
    return value === null || typeof value === 'string' ? null : 'must be a string or null'
  }
  if (/^array<.+>$/.test(type)) return Array.isArray(value) ? null : 'must be an array'
  if (type === 'flags') {
    return typeof value === 'number' || Array.isArray(value) || typeof value === 'string'
      ? null
      : 'must be a number, string, or array'
  }
  if (type === 'nullable') return null
  return null
}

function validateAsset(
  entity: SceneEntity,
  fieldName: string,
  value: unknown,
  context: SceneValidationContext,
  issues: ValidationIssue[],
  seen: Set<string>,
): void {
  if (typeof value !== 'string' || value.length === 0 || !context.assets) return
  const normalized = normalizeScenePath(value)
  if (!context.assets.some((asset) => normalizeScenePath(asset) === normalized)) {
    addSceneIssue(
      issues,
      sceneIssue(
        'asset-ref',
        `Entity "${entity.id}" field "${fieldName}" references missing asset "${value}".`,
        { entityId: entity.id, fieldName },
      ),
      seen,
    )
  }
}

function checkEntityRef(
  entity: SceneEntity,
  fieldName: string,
  value: unknown,
  scene: SceneDocument,
  issues: ValidationIssue[],
  seen: Set<string>,
): void {
  if (typeof value !== 'string' || value.length === 0) return
  if (!entityById(scene, value)) {
    addSceneIssue(
      issues,
      sceneIssue(
        'entity-ref',
        `Entity "${entity.id}" field "${fieldName}" references missing entity "${value}".`,
        { entityId: entity.id, fieldName },
      ),
      seen,
    )
  }
}

function validateOwnProps(
  scene: SceneDocument,
  entity: SceneEntity,
  fieldSurface: EntitySurface,
  context: SceneValidationContext,
  issues: ValidationIssue[],
  seen: Set<string>,
): void {
  const props = entity.props ?? {}
  const fields = new Map(fieldSurface.fields.map((field) => [field.name, field]))
  for (const [name, value] of Object.entries(props)) {
    const field = fields.get(name)
    if (!field) {
      addSceneIssue(
        issues,
        sceneIssue(
          'unknown-prop',
          `Entity "${entity.id}" sets unknown property "${name}".`,
          { entityId: entity.id, fieldName: name },
        ),
        seen,
      )
      continue
    }
    const message = valueIssue(value, field.field, field.origin, context)
    if (message) {
      addSceneIssue(
        issues,
        sceneIssue(
          'prop-value',
          `Property "${name}" on "${entity.id}" ${message}.`,
          { entityId: entity.id, fieldName: name },
        ),
        seen,
      )
      continue
    }
    if (field.field.type === 'entityRef') {
      checkEntityRef(entity, name, value, scene, issues, seen)
    }
    if (field.field.type === 'assetRef') {
      validateAsset(entity, name, value, context, issues, seen)
    }
  }
  for (const field of fieldSurface.fields) {
    if (!fieldHasDefault(field.field) && !(field.name in props)) {
      addSceneIssue(
        issues,
        sceneIssue(
          'required-prop',
          `Entity "${entity.id}" needs a value for required field "${field.name}".`,
          { entityId: entity.id, fieldName: field.name },
        ),
        seen,
      )
    }
  }
}

function validateSceneInstanceProps(
  scene: SceneDocument,
  entity: SceneEntity,
  surface: SceneSurface,
  context: SceneValidationContext,
  issues: ValidationIssue[],
  seen: Set<string>,
): void {
  const props = entity.props ?? {}
  const fields = new Map(surface.fields.map((field) => [field.name, field]))
  for (const [name, value] of Object.entries(props)) {
    const field = fields.get(name)
    if (!field) {
      addSceneIssue(
        issues,
        sceneIssue(
          'scene-instance-prop',
          `Scene instance "${entity.id}" overrides "${name}", which is not on the scene's public surface.`,
          { entityId: entity.id, fieldName: name },
        ),
        seen,
      )
      continue
    }
    const message = valueIssue(value, field.field, field.originDefinitionId, context)
    if (message) {
      addSceneIssue(
        issues,
        sceneIssue(
          'prop-value',
          `Property "${name}" on scene instance "${entity.id}" ${message}.`,
          { entityId: entity.id, fieldName: name },
        ),
        seen,
      )
      continue
    }
    if (field.field.type === 'entityRef') {
      checkEntityRef(entity, name, value, scene, issues, seen)
    }
    if (field.field.type === 'assetRef') {
      validateAsset(entity, name, value, context, issues, seen)
    }
  }
}

export function validateScene(
  scene: SceneDocument,
  context: SceneValidationContext,
  path?: string,
): ValidationResult {
  const issues: ValidationIssue[] = []
  const seen = new Set<string>()
  const add = (issue: ValidationIssue) => addSceneIssue(issues, issue, seen)
  const scenePath = path ? normalizeScenePath(path) : undefined

  if (!scene.id || !scene.id.trim()) {
    add(sceneIssue('scene-id', 'The scene needs a non-empty "id".', { scenePath }))
  }
  if (!Array.isArray(scene.requires)) {
    add(sceneIssue('scene-requires', 'The scene "requires" must be an array.', { scenePath }))
  }
  const requirementInfo = normalizeRequires(scene)
  for (const issue of requirementInfo.issues) add({ ...issue, scenePath })
  const requirements = requirementInfo.requirements
  for (const [namespace, version] of Object.entries(requirements)) {
    const bundle = bundleForNamespace(namespace, context)
    if (!bundle) {
      add(
        sceneIssue(
          'scene-requirement-missing',
          `Scene requires "${namespace}@${version}", but that schema is not available.`,
          { scenePath },
        ),
      )
      continue
    }
    if (namespace === context.builtin.namespace && version !== context.builtin.version) {
      add(
        sceneIssue(
          'scene-requirement-version',
          `Scene requires builtin "${namespace}@${version}", but the plugin ships ${context.builtin.version}.`,
          { scenePath },
        ),
      )
      continue
    }
    if (bundle.version !== version) {
      add(
        sceneIssue(
          'scene-requirement-version',
          `Scene requires "${namespace}@${version}", but the project resolves "${namespace}@${bundle.version}".`,
          { scenePath },
        ),
      )
    }
  }

  const ids = new Map<string, SceneEntity>()
  for (const entity of scene.entities) {
    if (!entity.id || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(entity.id)) {
      add(
        sceneIssue(
          'entity-id',
          `Entity ID "${entity.id}" must start with a letter or number and contain only letters, numbers, dots, dashes, or underscores.`,
          { entityId: entity.id, scenePath },
        ),
      )
    }
    if (ids.has(entity.id)) {
      add(
        sceneIssue('duplicate-entity-id', `Entity ID "${entity.id}" is duplicated.`, {
          entityId: entity.id,
          scenePath,
        }),
      )
      continue
    }
    ids.set(entity.id, entity)
    if (entity.name !== undefined && typeof entity.name !== 'string') {
      add(
        sceneIssue('entity-name', `Entity "${entity.id}" has a non-string name.`, {
          entityId: entity.id,
          scenePath,
        }),
      )
    }
    if (entity.parent !== undefined && typeof entity.parent !== 'string') {
      add(
        sceneIssue('entity-parent', `Entity "${entity.id}" has a non-string parent.`, {
          entityId: entity.id,
          scenePath,
        }),
      )
    }
    if (entity.slot !== undefined && typeof entity.slot !== 'string') {
      add(
        sceneIssue('entity-slot', `Entity "${entity.id}" has a non-string slot.`, {
          entityId: entity.id,
          scenePath,
        }),
      )
    }
    if (entity.props !== undefined && !isRecord(entity.props)) {
      add(
        sceneIssue('entity-props', `Entity "${entity.id}" props must be an object.`, {
          entityId: entity.id,
          scenePath,
        }),
      )
    }
    validateTransform(entity.transform, entity.id, issues, seen)
  }

  const root = entityById(scene, scene.root)
  if (!root) {
    add(
      sceneIssue('scene-root', `Scene root "${scene.root}" does not exist.`, {
        scenePath,
      }),
    )
  } else {
    if (root.parent !== undefined) {
      add(
        sceneIssue('root-parent', `Scene root "${root.id}" must not have a parent.`, {
          entityId: root.id,
          scenePath,
        }),
      )
    }
    if (entityIsSceneInstance(root)) {
      add(
        sceneIssue('scene-root-instance', 'A scene root must be an entity, not a scene instance.', {
          entityId: root.id,
          scenePath,
        }),
      )
    } else if (!root.type) {
      add(
        sceneIssue('scene-root-type', 'The scene root needs a concrete definition.', {
          entityId: root.id,
          scenePath,
        }),
      )
    }
  }

  for (const entity of scene.entities) {
    if (entity === root) continue
    if (entity.parent === undefined) {
      add(
        sceneIssue('missing-parent', `Entity "${entity.id}" needs a parent.`, {
          entityId: entity.id,
          scenePath,
        }),
      )
      continue
    }
    if (entity.parent === entity.id) {
      add(
        sceneIssue('hierarchy-cycle', `Entity "${entity.id}" cannot be its own parent.`, {
          entityId: entity.id,
          scenePath,
        }),
      )
      continue
    }
    const parent = ids.get(entity.parent)
    if (!parent) {
      add(
        sceneIssue(
          'missing-parent',
          `Entity "${entity.id}" references missing parent "${entity.parent}".`,
          { entityId: entity.id, scenePath },
        ),
      )
    }
  }

  const visiting = new Set<string>()
  const visited = new Set<string>()
  const visit = (entity: SceneEntity, trail: string[]): void => {
    if (visiting.has(entity.id)) {
      add(
        sceneIssue(
          'hierarchy-cycle',
          `Hierarchy cycle: ${[...trail, entity.id].join(' → ')}.`,
          { entityId: entity.id, scenePath },
        ),
      )
      return
    }
    if (visited.has(entity.id)) return
    visiting.add(entity.id)
    if (entity.parent && ids.has(entity.parent)) {
      visit(ids.get(entity.parent)!, [...trail, entity.id])
    }
    visiting.delete(entity.id)
    visited.add(entity.id)
  }
  for (const entity of scene.entities) visit(entity, [])

  const reachable = new Set<string>()
  const reach = (id: string) => {
    if (reachable.has(id)) return
    reachable.add(id)
    for (const child of directChildren(scene, id)) reach(child.id)
  }
  if (root) reach(root.id)
  for (const entity of scene.entities) {
    if (!reachable.has(entity.id)) {
      add(
        sceneIssue('orphan-entity', `Entity "${entity.id}" is not reachable from the root.`, {
          entityId: entity.id,
          scenePath,
        }),
      )
    }
  }

  const typeNamespaces = new Set<string>()
  for (const entity of scene.entities) {
    if (entity.type !== undefined && typeof entity.type !== 'string') {
      add(
        sceneIssue('entity-type', `Entity "${entity.id}" has a non-string type.`, {
          entityId: entity.id,
          scenePath,
        }),
      )
    }
    if (entity.scene !== undefined && typeof entity.scene !== 'string') {
      add(
        sceneIssue('entity-scene', `Entity "${entity.id}" has a non-string scene path.`, {
          entityId: entity.id,
          scenePath,
        }),
      )
    }
    const hasType = typeof entity.type === 'string' && entity.type.length > 0
    const hasScene = typeof entity.scene === 'string' && entity.scene.length > 0
    if (hasType === hasScene) {
      add(
        sceneIssue(
          'entity-kind',
          `Entity "${entity.id}" must have exactly one of "type" or "scene".`,
          { entityId: entity.id, scenePath },
        ),
      )
      continue
    }
    if (hasType) {
      const type = entity.type!
      const namespace = definitionNamespace(type)
      if (!namespace) {
        add(
          sceneIssue('entity-type', `Entity "${entity.id}" type "${type}" must be namespace-qualified.`, {
            entityId: entity.id,
            scenePath,
          }),
        )
        continue
      }
      typeNamespaces.add(namespace)
      if (!(namespace in requirements)) {
        add(
          sceneIssue(
            'scene-requires',
            `Entity "${entity.id}" uses "${type}" but the scene does not require "${namespace}".`,
            { entityId: entity.id, scenePath },
          ),
        )
      }
      const found = lookupType(type, context)
      if (!found || !found.definition) {
        add(
          sceneIssue('missing-definition', `Entity "${entity.id}" uses missing type "${type}".`, {
            entityId: entity.id,
            scenePath,
          }),
        )
        continue
      }
      if (found.definition.definition.abstract) {
        add(
          sceneIssue(
            'abstract-instance',
            `Entity "${entity.id}" uses abstract definition "${type}".`,
            { entityId: entity.id, scenePath },
          ),
        )
        continue
      }
      const effective = effectiveForType(type, context)
      for (const issue of effective.issues) add({ ...issue, entityId: entity.id, scenePath })
      if (isRecord(entity.props ?? {})) {
        validateOwnProps(scene, entity, effective, context, issues, seen)
      }
      continue
    }

    const sceneRef = normalizeScenePath(entity.scene!)
    if (/^[a-z][a-z0-9+.-]*:/i.test(entity.scene!) || entity.scene!.startsWith('//')) {
      add(
        sceneIssue(
          'entity-scene',
          `Scene instance "${entity.id}" must reference a project-relative scene path.`,
          { entityId: entity.id, scenePath },
        ),
      )
      continue
    }
    if (!sceneRef) {
      add(
        sceneIssue('entity-scene', `Scene instance "${entity.id}" needs a scene path.`, {
          entityId: entity.id,
          scenePath,
        }),
      )
      continue
    }
    if (sceneRef.includes('..')) {
      add(
        sceneIssue('entity-scene', `Scene instance "${entity.id}" must not traverse outside the workspace.`, {
          entityId: entity.id,
          scenePath,
        }),
      )
      continue
    }
    if (scenePath && sceneRef === scenePath) {
      add(
        sceneIssue('scene-self-reference', `Scene instance "${entity.id}" references its own scene.`, {
          entityId: entity.id,
          scenePath,
        }),
      )
      continue
    }
    const target = context.scenes[sceneRef]
    if (!target) {
      add(
        sceneIssue(
          'missing-scene',
          `Scene instance "${entity.id}" references missing scene "${entity.scene}".`,
          { entityId: entity.id, scenePath },
        ),
      )
      continue
    }
    const targetRequirements = normalizeRequires(target).requirements
    for (const [namespace, version] of Object.entries(targetRequirements)) {
      const bundle = bundleForNamespace(namespace, context)
      if (!bundle || bundle.version !== version) {
        add(
          sceneIssue(
            'scene-instance-requires',
            `Scene instance "${entity.id}" needs "${namespace}@${version}", which the project does not resolve.`,
            { entityId: entity.id, scenePath },
          ),
        )
      }
    }
    const surface = sceneSurface(target, context, [scene])
    for (const issue of surface.issues) add({ ...issue, scenePath })
    if (isRecord(entity.props ?? {})) {
      validateSceneInstanceProps(scene, entity, surface, context, issues, seen)
    }
  }

  const currentSurface = sceneSurface(scene, context)
  for (const issue of currentSurface.issues) add({ ...issue, scenePath })
  const publicNames = new Set<string>()
  for (const field of currentSurface.fields) publicNames.add(field.name)
  for (const event of currentSurface.events) publicNames.add(event.name)

  for (const name of Object.keys(scene.promotes ?? {})) {
    const nameIssue = publicNameIssue(name)
    if (nameIssue) {
      add(sceneIssue('promotion-name', `Promotion name "${name}": ${nameIssue}`, {
        promotionName: name,
        scenePath,
      }))
    }
  }

  for (const [name, slot] of Object.entries(scene.slots ?? {})) {
    const nameIssue = publicNameIssue(name)
    if (nameIssue) {
      add(sceneIssue('slot-name', `Slot name "${name}": ${nameIssue}`, {
        slotName: name,
        scenePath,
      }))
    }
    if (!isRecord(slot)) {
      add(sceneIssue('slot-shape', `Slot "${name}" must be an object.`, {
        slotName: name,
        scenePath,
      }))
      continue
    }
    if (publicNames.has(name)) {
      add(
        sceneIssue(
          'public-name-collision',
          `Slot name "${name}" collides with a public field or event.`,
          { slotName: name, scenePath },
        ),
      )
    }
    publicNames.add(name)
    const anchorId = typeof slot.entity === 'string' ? slot.entity : ''
    if (!anchorId || !entityById(scene, anchorId)) {
      add(
        sceneIssue('slot-anchor', `Slot "${name}" references missing entity "${anchorId}".`, {
          slotName: name,
          entityId: anchorId || undefined,
          scenePath,
        }),
      )
    }
  }

  for (const entity of scene.entities) {
    const parent = entity.parent ? entityById(scene, entity.parent) : undefined
    if (entity.slot !== undefined) {
      if (typeof entity.slot !== 'string' || !entity.slot) {
        add(
          sceneIssue('attachment-slot', `Entity "${entity.id}" has an invalid slot name.`, {
            entityId: entity.id,
            scenePath,
          }),
        )
        continue
      }
      if (!parent) {
        add(
          sceneIssue('attachment-parent', `Entity "${entity.id}" has a slot but no parent scene instance.`, {
            entityId: entity.id,
            scenePath,
          }),
        )
        continue
      }
      if (!entityIsSceneInstance(parent)) {
        add(
          sceneIssue(
            'attachment-parent',
            `Entity "${entity.id}" can attach through a slot only to a scene instance.`,
            { entityId: entity.id, scenePath },
          ),
        )
        continue
      }
      const target = context.scenes[normalizeScenePath(parent.scene!)]
      if (!target) continue
      if (!target.slots?.[entity.slot]) {
        add(
          sceneIssue(
            'attachment-slot',
            `Entity "${entity.id}" attaches to missing slot "${entity.slot}" on "${parent.scene}".`,
            { entityId: entity.id, slotName: entity.slot, scenePath },
          ),
        )
      }
    } else if (parent && entityIsSceneInstance(parent)) {
      add(
        sceneIssue(
          'attachment-slot',
          `Entity "${entity.id}" is parented to scene instance "${parent.id}" without a slot.`,
          { entityId: entity.id, scenePath },
        ),
      )
    }
  }

  const startKey = scenePath ?? normalizeScenePath(scene.id)
  const walkScenes = (current: SceneDocument, trail: string[]): void => {
    for (const entity of current.entities) {
      if (!entity.scene) continue
      const nextKey = normalizeScenePath(entity.scene)
      if (trail.includes(nextKey)) {
        add(
          sceneIssue('scene-cycle', `Scene reference cycle: ${[...trail, nextKey].join(' → ')}.`, {
            entityId: entity.id,
            scenePath,
          }),
        )
        continue
      }
      const target = context.scenes[nextKey]
      if (target) walkScenes(target, [...trail, nextKey])
    }
  }
  walkScenes(scene, [startKey])

  for (const namespace of Object.keys(requirements)) {
    if (!typeNamespaces.has(namespace) && namespace !== context.builtin.namespace) {
      add({
        severity: 'warning',
        code: 'unused-requirement',
        message: `Scene requires "${namespace}", but no entity uses a type from it.`,
        scenePath,
      })
    }
  }

  const errors = issues.filter((issue) => issue.severity === 'error').length
  const warnings = issues.length - errors
  return { issues, errors, warnings }
}

export function entityProperties(
  scene: SceneDocument,
  entity: SceneEntity,
  context: SceneValidationContext,
): EntityProperty[] {
  if (entity.type) {
    const effective = effectiveForType(entity.type, context)
    return effective.fields.map((field) => {
      const overridden = Object.prototype.hasOwnProperty.call(entity.props ?? {}, field.name)
      return {
        name: field.name,
        field: field.field,
        originDefinitionId: field.origin,
        namespace: definitionNamespace(field.origin) ?? '',
        value: overridden ? entity.props?.[field.name] : field.field.default,
        hasDefault: fieldHasDefault(field.field),
        overridden,
        promoted: false,
      }
    })
  }
  if (entity.scene) {
    const target = context.scenes[normalizeScenePath(entity.scene)]
    if (!target) return []
    const surface = sceneSurface(target, context)
    return surface.fields.map((field) => {
      const overridden = Object.prototype.hasOwnProperty.call(entity.props ?? {}, field.name)
      return {
        name: field.name,
        field: field.field,
        originDefinitionId: field.originDefinitionId,
        namespace: field.namespace,
        value: overridden
          ? entity.props?.[field.name]
          : scenePublicValue(target, field.name, context),
        hasDefault: fieldHasDefault(field.field),
        overridden,
        promoted: field.promoted,
      }
    })
  }
  return []
}

export function entityEvents(
  scene: SceneDocument,
  entity: SceneEntity,
  context: SceneValidationContext,
): Array<{ name: string; event: SchemaEvent; originDefinitionId: string; promoted: boolean }> {
  if (entity.type) {
    return effectiveForType(entity.type, context).events.map((event) => ({
      name: event.name,
      event: event.event,
      originDefinitionId: event.origin,
      promoted: false,
    }))
  }
  if (entity.scene) {
    const target = context.scenes[normalizeScenePath(entity.scene)]
    if (!target) return []
    return sceneSurface(target, context).events.map((event) => ({
      name: event.name,
      event: event.event,
      originDefinitionId: event.originDefinitionId,
      promoted: event.promoted,
    }))
  }
  return []
}

// --- Editing operations -----------------------------------------------------

export function uniqueEntityId(scene: SceneDocument, base: string): string {
  const clean =
    base
      .trim()
      .replace(/^.*:/, '')
      .replace(/[^A-Za-z0-9_-]+/g, '_')
      .replace(/^_+|_+$/g, '') || 'entity'
  let index = 1
  let candidate = `${clean}_${index}`
  while (scene.entities.some((entity) => entity.id === candidate)) {
    index += 1
    candidate = `${clean}_${index}`
  }
  return candidate
}

export function addEntity(
  scene: SceneDocument,
  type: string,
  parentId = scene.root,
  name?: string,
): { scene: SceneDocument; id: string } {
  const next = cloneJson(scene)
  const id = uniqueEntityId(next, definitionLocalName(type))
  next.entities.push({
    id,
    type,
    parent: parentId,
    ...(name ? { name } : {}),
  })
  return { scene: next, id }
}

export function addSceneInstance(
  scene: SceneDocument,
  scenePath: string,
  parentId = scene.root,
  slot?: string,
): { scene: SceneDocument; id: string } {
  const next = cloneJson(scene)
  const base = sceneFileName(scenePath).replace(/\.scene\.json$/, '') || 'scene'
  const id = uniqueEntityId(next, base)
  next.entities.push({
    id,
    scene: displayScenePath(scenePath),
    parent: parentId,
    ...(slot ? { slot } : {}),
  })
  return { scene: next, id }
}

export function entitySubtree(scene: SceneDocument, id: string): SceneEntity[] {
  const found: SceneEntity[] = []
  const visit = (entityId: string) => {
    const entity = entityById(scene, entityId)
    if (!entity) return
    found.push(entity)
    for (const child of directChildren(scene, entity.id)) visit(child.id)
  }
  visit(id)
  return found
}

export function deleteEntity(scene: SceneDocument, id: string): SceneDocument {
  if (id === scene.root) throw new Error('The scene root cannot be deleted.')
  const next = cloneJson(scene)
  const removed = new Set(entitySubtree(next, id).map((entity) => entity.id))
  next.entities = next.entities.filter((entity) => !removed.has(entity.id))
  for (const [name, promotion] of Object.entries(next.promotes ?? {})) {
    if (removed.has(promotion.entity)) delete next.promotes![name]
  }
  for (const [name, slot] of Object.entries(next.slots ?? {})) {
    if (removed.has(slot.entity)) delete next.slots![name]
  }
  return next
}

export function duplicateEntity(
  scene: SceneDocument,
  id: string,
): { scene: SceneDocument; id: string } {
  const source = entityById(scene, id)
  if (!source) throw new Error(`Entity "${id}" does not exist.`)
  if (id === scene.root) throw new Error('The scene root cannot be duplicated.')
  const subtree = entitySubtree(scene, id)
  const next = cloneJson(scene)
  const idMap = new Map<string, string>()
  for (const entity of subtree) {
    const base = definitionLocalName(entity.type ?? entity.id.split('_')[0] ?? 'entity')
    idMap.set(entity.id, uniqueEntityId(next, base))
    next.entities.push({ ...cloneJson(entity), id: idMap.get(entity.id)! })
  }
  for (const entity of subtree) {
    const copy = entityById(next, idMap.get(entity.id)!)!
    if (entity.id === id) {
      copy.parent = source.parent
      if (source.slot) copy.slot = source.slot
      else delete copy.slot
    } else if (entity.parent && idMap.has(entity.parent)) {
      copy.parent = idMap.get(entity.parent)!
    }
    if (copy.props) {
      for (const [key, value] of Object.entries(copy.props)) {
        if (typeof value === 'string' && idMap.has(value)) copy.props[key] = idMap.get(value)
      }
    }
  }
  return { scene: next, id: idMap.get(id)! }
}

export function setEntityParent(
  scene: SceneDocument,
  id: string,
  parentId: string,
  slot?: string,
): SceneDocument {
  if (id === scene.root) throw new Error('The scene root cannot be reparented.')
  if (id === parentId) throw new Error('An entity cannot be its own parent.')
  if (entitySubtree(scene, id).some((entity) => entity.id === parentId)) {
    throw new Error('The parent would be inside the entity subtree.')
  }
  if (!entityById(scene, parentId)) throw new Error(`Parent "${parentId}" does not exist.`)
  const next = cloneJson(scene)
  const entity = entityById(next, id)!
  entity.parent = parentId
  if (slot) entity.slot = slot
  else delete entity.slot
  return next
}

export function setEntityTransform(
  scene: SceneDocument,
  id: string,
  transform: EntityTransform,
): SceneDocument {
  const next = cloneJson(scene)
  const entity = entityById(next, id)
  if (!entity) throw new Error(`Entity "${id}" does not exist.`)
  const compact: EntityTransform = {}
  const position = transform.position
  if (position && position.some((value) => value !== 0)) compact.position = [...position]
  const rotation = transform.rotation
  if (rotation && rotation.some((value) => value !== 0)) compact.rotation = [...rotation]
  const scale = transform.scale
  if (scale && scale.some((value) => value !== 1)) compact.scale = [...scale]
  if (Object.keys(compact).length === 0) delete entity.transform
  else entity.transform = compact
  return next
}

export function setEntityProp(
  scene: SceneDocument,
  id: string,
  name: string,
  value: unknown,
): SceneDocument {
  const next = cloneJson(scene)
  const entity = entityById(next, id)
  if (!entity) throw new Error(`Entity "${id}" does not exist.`)
  entity.props = { ...(entity.props ?? {}), [name]: value }
  return next
}

export function removeEntityProp(scene: SceneDocument, id: string, name: string): SceneDocument {
  const next = cloneJson(scene)
  const entity = entityById(next, id)
  if (!entity) throw new Error(`Entity "${id}" does not exist.`)
  if (!entity.props) return next
  delete entity.props[name]
  if (Object.keys(entity.props).length === 0) delete entity.props
  return next
}

export function setEntityName(scene: SceneDocument, id: string, name: string): SceneDocument {
  const next = cloneJson(scene)
  const entity = entityById(next, id)
  if (!entity) throw new Error(`Entity "${id}" does not exist.`)
  const clean = name.trim()
  if (clean) entity.name = clean
  else delete entity.name
  return next
}

export function setEntityType(scene: SceneDocument, id: string, type: string): SceneDocument {
  const next = cloneJson(scene)
  const entity = entityById(next, id)
  if (!entity) throw new Error(`Entity "${id}" does not exist.`)
  entity.type = type
  delete entity.scene
  delete entity.props
  return next
}

export function setSceneInstancePath(
  scene: SceneDocument,
  id: string,
  scenePath: string,
): SceneDocument {
  const next = cloneJson(scene)
  const entity = entityById(next, id)
  if (!entity) throw new Error(`Entity "${id}" does not exist.`)
  entity.scene = displayScenePath(scenePath)
  delete entity.type
  delete entity.props
  return next
}

export function addPromotion(
  scene: SceneDocument,
  name: string,
  target: { entity: string; field?: string; event?: string },
): SceneDocument {
  const clean = name.trim()
  if (!clean) throw new Error('A promotion needs a name.')
  const next = cloneJson(scene)
  next.promotes = next.promotes ?? {}
  next.promotes[clean] = cloneJson(target)
  return next
}

export function removePromotion(scene: SceneDocument, name: string): SceneDocument {
  const next = cloneJson(scene)
  if (!next.promotes?.[name]) return next
  delete next.promotes[name]
  return next
}

export function addSlot(scene: SceneDocument, name: string, entityId: string): SceneDocument {
  const clean = name.trim()
  if (!clean) throw new Error('A slot needs a name.')
  if (!entityById(scene, entityId)) throw new Error(`Entity "${entityId}" does not exist.`)
  const next = cloneJson(scene)
  next.slots = next.slots ?? {}
  next.slots[clean] = { entity: entityId }
  return next
}

export function removeSlot(scene: SceneDocument, name: string): SceneDocument {
  const next = cloneJson(scene)
  if (!next.slots?.[name]) return next
  delete next.slots[name]
  return next
}

export function slotAnchor(scene: SceneDocument, slotName: string): SceneEntity | undefined {
  const anchor = scene.slots?.[slotName]?.entity
  return anchor ? entityById(scene, anchor) : undefined
}

export function slotNamesForInstance(
  scene: SceneDocument,
  instance: SceneEntity,
  context: SceneValidationContext,
): string[] {
  if (!instance.scene) return []
  const target = context.scenes[normalizeScenePath(instance.scene)]
  return target ? Object.keys(target.slots ?? {}).sort((a, b) => a.localeCompare(b)) : []
}

// --- Runtime expansion ------------------------------------------------------

type Trs = { position: Vec3; rotation: Vec3; scale: Vec3 }

function degToRad(value: number): number {
  return (value * Math.PI) / 180
}

function radToDeg(value: number): number {
  return (value * 180) / Math.PI
}

function eulerToQuaternion(rotation: Vec3): [number, number, number, number] {
  const x = degToRad(rotation[0])
  const y = degToRad(rotation[1])
  const z = degToRad(rotation[2])
  const c1 = Math.cos(x / 2)
  const c2 = Math.cos(y / 2)
  const c3 = Math.cos(z / 2)
  const s1 = Math.sin(x / 2)
  const s2 = Math.sin(y / 2)
  const s3 = Math.sin(z / 2)
  return [
    s1 * c2 * c3 + c1 * s2 * s3,
    c1 * s2 * c3 - s1 * c2 * s3,
    c1 * c2 * s3 + s1 * s2 * c3,
    c1 * c2 * c3 - s1 * s2 * s3,
  ]
}

function quaternionToEuler(x: number, y: number, z: number, w: number): Vec3 {
  const t0 = 2 * (w * x + y * z)
  const t1 = 1 - 2 * (x * x + y * y)
  const rotationX = Math.atan2(t0, t1)
  let t2 = 2 * (w * y - z * x)
  t2 = Math.max(-1, Math.min(1, t2))
  const rotationY = Math.asin(t2)
  const t3 = 2 * (w * z + x * y)
  const t4 = 1 - 2 * (y * y + z * z)
  const rotationZ = Math.atan2(t3, t4)
  return [radToDeg(rotationX), radToDeg(rotationY), radToDeg(rotationZ)]
}

function trsMatrix(transform: Trs): number[] {
  const [x, y, z, w] = eulerToQuaternion(transform.rotation)
  const x2 = x + x
  const y2 = y + y
  const z2 = z + z
  const xx = x * x2
  const xy = x * y2
  const xz = x * z2
  const yy = y * y2
  const yz = y * z2
  const zz = z * z2
  const wx = w * x2
  const wy = w * y2
  const wz = w * z2
  const [sx, sy, sz] = transform.scale
  return [
    (1 - (yy + zz)) * sx,
    (xy + wz) * sx,
    (xz - wy) * sx,
    0,
    (xy - wz) * sy,
    (1 - (xx + zz)) * sy,
    (yz + wx) * sy,
    0,
    (xz + wy) * sz,
    (yz - wx) * sz,
    (1 - (xx + yy)) * sz,
    0,
    transform.position[0],
    transform.position[1],
    transform.position[2],
    1,
  ]
}

function multiplyMatrices(a: number[], b: number[]): number[] {
  const out = new Array<number>(16).fill(0)
  for (let column = 0; column < 4; column += 1) {
    for (let row = 0; row < 4; row += 1) {
      out[column * 4 + row] =
        a[row] * b[column * 4] +
        a[4 + row] * b[column * 4 + 1] +
        a[8 + row] * b[column * 4 + 2] +
        a[12 + row] * b[column * 4 + 3]
    }
  }
  return out
}

function matrixDeterminant(m: number[]): number {
  return (
    m[0] * (m[5] * m[10] - m[6] * m[9]) -
    m[4] * (m[1] * m[10] - m[2] * m[9]) +
    m[8] * (m[1] * m[6] - m[2] * m[5])
  )
}

function length3(x: number, y: number, z: number): number {
  return Math.hypot(x, y, z)
}

function decomposeMatrix(m: number[]): Trs {
  const position: Vec3 = [m[12], m[13], m[14]]
  let sx = length3(m[0], m[1], m[2])
  const sy = length3(m[4], m[5], m[6])
  const sz = length3(m[8], m[9], m[10])
  if (matrixDeterminant(m) < 0) sx = -sx
  const invSx = sx === 0 ? 0 : 1 / sx
  const invSy = sy === 0 ? 0 : 1 / sy
  const invSz = sz === 0 ? 0 : 1 / sz
  const m11 = m[0] * invSx
  const m12 = m[4] * invSy
  const m13 = m[8] * invSz
  const m21 = m[1] * invSx
  const m22 = m[5] * invSy
  const m23 = m[9] * invSz
  const m31 = m[2] * invSx
  const m32 = m[6] * invSy
  const m33 = m[10] * invSz
  const trace = m11 + m22 + m33
  let x = 0
  let y = 0
  let z = 0
  let w = 1
  if (trace > 0) {
    const s = 0.5 / Math.sqrt(trace + 1)
    w = 0.25 / s
    x = (m32 - m23) * s
    y = (m13 - m31) * s
    z = (m21 - m12) * s
  } else if (m11 > m22 && m11 > m33) {
    const s = 2 * Math.sqrt(1 + m11 - m22 - m33)
    w = (m32 - m23) / s
    x = 0.25 * s
    y = (m12 + m21) / s
    z = (m13 + m31) / s
  } else if (m22 > m33) {
    const s = 2 * Math.sqrt(1 + m22 - m11 - m33)
    w = (m13 - m31) / s
    x = (m12 + m21) / s
    y = 0.25 * s
    z = (m23 + m32) / s
  } else {
    const s = 2 * Math.sqrt(1 + m33 - m11 - m22)
    w = (m21 - m12) / s
    x = (m13 + m31) / s
    y = (m23 + m32) / s
    z = 0.25 * s
  }
  return {
    position,
    rotation: quaternionToEuler(x, y, z, w),
    scale: [sx, sy, sz],
  }
}

export function composeTransforms(parent: Trs, child: Trs): Trs {
  return decomposeMatrix(multiplyMatrices(trsMatrix(parent), trsMatrix(child)))
}

interface PublicOverrides {
  root: Record<string, unknown>
  entities: Record<string, Record<string, unknown>>
  instances: Record<string, Record<string, unknown>>
  issues: ValidationIssue[]
}

function computePublicOverrides(
  scene: SceneDocument,
  props: Record<string, unknown>,
  context: SceneValidationContext,
): PublicOverrides {
  const overrides: PublicOverrides = { root: {}, entities: {}, instances: {}, issues: [] }
  if (Object.keys(props).length === 0) return overrides
  const surface = sceneSurface(scene, context)
  const fields = new Map(surface.fields.map((field) => [field.name, field]))
  for (const [name, value] of Object.entries(props)) {
    const field = fields.get(name)
    if (!field || !field.targetEntityId) {
      overrides.issues.push(
        sceneIssue(
          'scene-instance-prop',
          `Scene instance override "${name}" is not on the public surface of "${scene.id}".`,
        ),
      )
      continue
    }
    if (field.targetEntityId === scene.root) {
      overrides.root[field.targetFieldName ?? name] = value
      continue
    }
    const target = entityById(scene, field.targetEntityId)
    if (!target) continue
    if (target.type) {
      overrides.entities[target.id] = {
        ...(overrides.entities[target.id] ?? {}),
        [field.targetFieldName ?? name]: value,
      }
    } else if (target.scene) {
      overrides.instances[target.id] = {
        ...(overrides.instances[target.id] ?? {}),
        [field.targetFieldName ?? name]: value,
      }
    }
  }
  return overrides
}

function scopedId(scope: string, id: string): string {
  return scope ? `${scope}::${id}` : id
}

function resolvedEntityId(
  scene: SceneDocument,
  id: string,
  scope: string,
  context: SceneValidationContext,
): string | null {
  const entity = entityById(scene, id)
  if (!entity) return null
  const base = scopedId(scope, entity.id)
  if (entity.scene) {
    const target = context.scenes[normalizeScenePath(entity.scene)]
    if (target) return scopedId(base, target.root)
  }
  return base
}

function resolvedParentId(
  scene: SceneDocument,
  entity: SceneEntity,
  scope: string,
  fallbackParent: string | undefined,
  context: SceneValidationContext,
): string | undefined {
  if (entity.id === scene.root || !entity.parent) return fallbackParent
  const parent = entityById(scene, entity.parent)
  if (!parent) return fallbackParent
  if (parent.type) return scopedId(scope, parent.id)
  if (parent.scene) {
    if (!entity.slot) return fallbackParent
    const target = context.scenes[normalizeScenePath(parent.scene)]
    const anchor = target?.slots?.[entity.slot]?.entity
    if (!target || !anchor) return fallbackParent
    return resolvedEntityId(target, anchor, scopedId(scope, parent.id), context) ?? fallbackParent
  }
  return fallbackParent
}

function effectivePropsFor(
  scene: SceneDocument,
  entity: SceneEntity,
  scope: string,
  explicit: Record<string, unknown>,
  context: SceneValidationContext,
  issues: ValidationIssue[],
): Record<string, unknown> {
  if (!entity.type) return { ...explicit }
  const effective = effectiveForType(entity.type, context)
  const props: Record<string, unknown> = {}
  for (const field of effective.fields) {
    const hasExplicit = Object.prototype.hasOwnProperty.call(explicit, field.name)
    const value = hasExplicit
      ? explicit[field.name]
      : fieldHasDefault(field.field)
        ? field.field.default
        : undefined
    if (value === undefined) continue
    if (field.field.type === 'entityRef' && field.field.scope !== 'host' && typeof value === 'string') {
      const mapped = resolvedEntityId(scene, value, scope, context)
      props[field.name] = mapped ?? value
    } else {
      props[field.name] = cloneJson(value)
    }
  }
  for (const issue of effective.issues) issues.push(issue)
  return props
}

export function expandScene(
  scene: SceneDocument,
  context: SceneValidationContext,
  scenePath = `/${scene.id}`,
): ExpandedScene {
  const issues: ValidationIssue[] = []
  const entities: ExpandedEntity[] = []
  const stack: string[] = []

  const expand = (
    document: SceneDocument,
    documentKey: string,
    scope: string,
    fallbackParent: string | undefined,
    instanceTransform: Trs | undefined,
    incomingProps: Record<string, unknown>,
    path: string[],
  ): string | null => {
    const key = normalizeScenePath(documentKey)
    if (stack.includes(key)) {
      issues.push(
        sceneIssue('scene-cycle', `Scene reference cycle includes "${document.id}".`, {
          scenePath,
        }),
      )
      return null
    }
    const root = entityById(document, document.root)
    if (!root || !root.type) {
      issues.push(
        sceneIssue('scene-root', `Scene "${document.id}" needs an entity root with a type.`, {
          scenePath,
        }),
      )
      return null
    }
    stack.push(key)
    const overrides = computePublicOverrides(document, incomingProps, context)
    issues.push(...overrides.issues)
    const rootScope = scopedId(scope, root.id)
    const rootTransform = instanceTransform
      ? composeTransforms(instanceTransform, normalizeTransform(root.transform))
      : normalizeTransform(root.transform)
    const rootExplicit = { ...(root.props ?? {}), ...overrides.root }
    entities.push({
      id: rootScope,
      type: root.type,
      ...(fallbackParent ? { parent: fallbackParent } : {}),
      transform: rootTransform,
      props: effectivePropsFor(document, root, scope, rootExplicit, context, issues),
      path: [...path, root.id],
    })
    const instanceIds = new Set(
      document.entities.filter((entity) => entity.scene).map((entity) => entity.id),
    )
    for (const entity of document.entities) {
      if (entity === root) continue
      if (entity.scene) {
        const target = context.scenes[normalizeScenePath(entity.scene)]
        if (!target) {
          issues.push(
            sceneIssue('missing-scene', `Scene instance "${entity.id}" references a missing scene.`, {
              entityId: entity.id,
              scenePath,
            }),
          )
          continue
        }
        const parent = resolvedParentId(document, entity, scope, fallbackParent, context)
        const inherited = overrides.instances[entity.id] ?? {}
        expand(
          target,
          entity.scene!,
          scopedId(scope, entity.id),
          parent,
          normalizeTransform(entity.transform),
          { ...(entity.props ?? {}), ...inherited },
          [...path, entity.id],
        )
        continue
      }
      if (entity.parent && instanceIds.has(entity.parent)) {
        // Attachments are emitted after the scene instance expansion above.
        continue
      }
      if (!entity.type) continue
      const parent = resolvedParentId(document, entity, scope, fallbackParent, context)
      const explicit = { ...(entity.props ?? {}), ...(overrides.entities[entity.id] ?? {}) }
      entities.push({
        id: scopedId(scope, entity.id),
        type: entity.type,
        ...(parent ? { parent } : {}),
        transform: normalizeTransform(entity.transform),
        props: effectivePropsFor(document, entity, scope, explicit, context, issues),
        path: [...path, entity.id],
      })
    }
    for (const entity of document.entities) {
      if (entity === root || !entity.type) continue
      if (entity.parent && instanceIds.has(entity.parent)) {
        const parent = resolvedParentId(document, entity, scope, fallbackParent, context)
        const explicit = { ...(entity.props ?? {}), ...(overrides.entities[entity.id] ?? {}) }
        entities.push({
          id: scopedId(scope, entity.id),
          type: entity.type,
          ...(parent ? { parent } : {}),
          transform: normalizeTransform(entity.transform),
          props: effectivePropsFor(document, entity, scope, explicit, context, issues),
          path: [...path, entity.id],
        })
      }
    }
    stack.pop()
    return rootScope
  }

  const rootId = expand(scene, scenePath, '', undefined, undefined, {}, [scenePath])
  return { root: rootId ?? scene.root, entities, issues }
}
