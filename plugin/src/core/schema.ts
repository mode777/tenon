export type JsonRecord = Record<string, unknown>

export interface SchemaField {
  type: string
  default?: unknown
  enum?: string
  doc?: string
  scope?: string
  [key: string]: unknown
}

export interface SchemaEvent {
  payload?: Record<string, SchemaField>
  doc?: string
  [key: string]: unknown
}

export interface SchemaDefinition {
  abstract?: boolean
  compose?: string[]
  fields?: Record<string, SchemaField>
  events?: Record<string, SchemaEvent>
  doc?: string
  [key: string]: unknown
}

export interface SchemaEnum {
  values: string[]
  doc?: string
  [key: string]: unknown
}

export interface SchemaBundle {
  id: string
  version: string
  namespace: string
  enums?: Record<string, SchemaEnum>
  definitions: Record<string, SchemaDefinition>
  [key: string]: unknown
}

export type Severity = 'error' | 'warning'

export interface ValidationIssue {
  severity: Severity
  code: string
  message: string
  definitionId?: string
  fieldName?: string
  eventName?: string
  enumName?: string
  enumValue?: string
}

export interface EffectiveField {
  name: string
  field: SchemaField
  origin: string
  inherited: boolean
  override: boolean
  error?: string
}

export interface EffectiveEvent {
  name: string
  event: SchemaEvent
  origin: string
  inherited: boolean
  error?: string
}

export interface EffectiveDefinition {
  fields: EffectiveField[]
  events: EffectiveEvent[]
  issues: ValidationIssue[]
}

export interface ValidationResult {
  issues: ValidationIssue[]
  errors: number
  warnings: number
}

export const MVP_FIELD_TYPES = [
  'string',
  'int',
  'float',
  'bool',
  'enum',
  'color',
  'vec2',
  'vec3',
  'entityRef',
  'assetRef',
] as const

export const DEFERRED_FIELD_TYPES = ['array<T>', 'flags', 'nullable'] as const

const KNOWN_FIELD_TYPES = new Set<string>([...MVP_FIELD_TYPES, ...DEFERRED_FIELD_TYPES])

export const TYPE_LABELS: Record<string, string> = {
  string: 'String',
  int: 'Integer',
  float: 'Float',
  bool: 'Boolean',
  enum: 'Enum',
  color: 'Color',
  vec2: 'Vector 2',
  vec3: 'Vector 3',
  entityRef: 'Entity ref',
  assetRef: 'Asset ref',
  'array<T>': 'Array',
  flags: 'Flags',
  nullable: 'Nullable',
}

export const TYPE_DESCRIPTIONS: Record<string, string> = {
  string: 'Text value.',
  int: 'Whole number.',
  float: 'Decimal number.',
  bool: 'True or false.',
  enum: 'One value from a bundle enum.',
  color: 'RGB or RGBA color.',
  vec2: 'Two numbers.',
  vec3: 'Three numbers.',
  entityRef: 'Reference to an entity in a scene.',
  assetRef: 'Workspace asset path.',
  'array<T>': 'Ordered collection; authoring arrives after M1.',
  flags: 'Bit flags from an enum; authoring arrives after M1.',
  nullable: 'Optional value; authoring arrives after M1.',
}

export function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

export function createEmptySchema(namespace = 'game'): SchemaBundle {
  return {
    id: `com.example.${namespace}`,
    version: '1.0.0',
    namespace,
    enums: {},
    definitions: {},
  }
}

export function schemaTemplateText(): string {
  return `${JSON.stringify(createEmptySchema(), null, 2)}\n`
}

export function parseSchemaText(text: string): SchemaBundle {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch (error) {
    throw new Error(
      `The file is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
  if (!isRecord(value)) throw new Error('The schema bundle must be a JSON object.')
  if (typeof value.id !== 'string' || value.id.length === 0) {
    throw new Error('The schema bundle needs a string "id".')
  }
  if (typeof value.version !== 'string' || value.version.length === 0) {
    throw new Error('The schema bundle needs a string "version".')
  }
  if (typeof value.namespace !== 'string' || value.namespace.length === 0) {
    throw new Error('The schema bundle needs a string "namespace".')
  }
  if (!isRecord(value.definitions)) {
    throw new Error('The schema bundle needs a "definitions" object.')
  }
  if (value.enums !== undefined && !isRecord(value.enums)) {
    throw new Error('The schema bundle "enums" must be an object when present.')
  }
  return value as unknown as SchemaBundle
}

export function schemaToText(bundle: SchemaBundle): string {
  return `${JSON.stringify(bundle, null, 2)}\n`
}

export function builtinBundle(): SchemaBundle {
  return cloneJson(builtinRaw as unknown as SchemaBundle)
}

import builtinRaw from './basic3d.schema.json'

export interface DefinitionLookup {
  definition: SchemaDefinition
  builtin: boolean
}

export function lookupDefinition(
  id: string,
  bundle: SchemaBundle,
  builtin?: SchemaBundle | null,
): DefinitionLookup | null {
  const own = bundle.definitions[id]
  if (own) return { definition: own, builtin: false }
  const built = builtin?.definitions[id]
  if (built) return { definition: built, builtin: true }
  return null
}

export function allDefinitionIds(bundle: SchemaBundle, builtin?: SchemaBundle | null): string[] {
  return [
    ...Object.keys(bundle.definitions).sort((a, b) => a.localeCompare(b)),
    ...Object.keys(builtin?.definitions ?? {})
      .filter((id) => !(id in bundle.definitions))
      .sort((a, b) => a.localeCompare(b)),
  ]
}

export function isBuiltinDefinition(
  id: string,
  bundle: SchemaBundle,
  builtin?: SchemaBundle | null,
): boolean {
  return !(id in bundle.definitions) && Boolean(builtin?.definitions[id])
}

export function definitionLocalName(id: string): string {
  const index = id.indexOf(':')
  return index >= 0 ? id.slice(index + 1) : id
}

export function definitionNamespace(id: string): string | null {
  const index = id.indexOf(':')
  return index > 0 ? id.slice(0, index) : null
}

export function qualify(namespace: string, localName: string): string {
  return `${namespace}:${localName}`
}

export function fieldHasDefault(field: SchemaField): boolean {
  return Object.prototype.hasOwnProperty.call(field, 'default')
}

function defaultsEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

interface Collected {
  fields: Map<string, EffectiveField>
  events: Map<string, EffectiveEvent>
  issues: ValidationIssue[]
}

function issueFor(
  code: string,
  message: string,
  definitionId?: string,
  extra: Partial<ValidationIssue> = {},
): ValidationIssue {
  return { severity: 'error', code, message, definitionId, ...extra }
}

function collectDefinition(
  id: string,
  bundle: SchemaBundle,
  builtin: SchemaBundle | null,
  stack: string[],
  cache: Map<string, Collected>,
): Collected {
  const cached = cache.get(id)
  if (cached) return cached

  const found = lookupDefinition(id, bundle, builtin)
  if (!found) {
    return {
      fields: new Map(),
      events: new Map(),
      issues: [issueFor('missing-definition', `Composition target "${id}" does not exist.`, id)],
    }
  }

  if (stack.includes(id)) {
    return {
      fields: new Map(),
      events: new Map(),
      issues: [
        issueFor(
          'composition-cycle',
          `Composition cycle: ${[...stack, id].join(' → ')}.`,
          id,
        ),
      ],
    }
  }

  const definition = found.definition
  const fields = new Map<string, EffectiveField>()
  const events = new Map<string, EffectiveEvent>()
  const issues: ValidationIssue[] = []
  const nextStack = [...stack, id]

  for (const target of normalizeCompose(definition.compose)) {
    const collected = collectDefinition(target, bundle, builtin, nextStack, cache)
    issues.push(...collected.issues)
    for (const field of collected.fields.values()) {
      const existing = fields.get(field.name)
      if (!existing) {
        fields.set(field.name, { ...field, inherited: true })
        continue
      }
      if (existing.origin === field.origin) {
        if (
          fieldHasDefault(existing.field) &&
          fieldHasDefault(field.field) &&
          !defaultsEqual(existing.field.default, field.field.default)
        ) {
          issues.push(
            issueFor(
              'default-conflict',
              `Field "${field.name}" reaches "${id}" twice from "${field.origin}" with different defaults.`,
              id,
              { fieldName: field.name },
            ),
          )
          existing.error = 'Conflicting defaults'
        }
        continue
      }
      issues.push(
        issueFor(
          'field-collision',
          `Field "${field.name}" is contributed by both "${existing.origin}" and "${field.origin}".`,
          id,
          { fieldName: field.name },
        ),
      )
      existing.error = 'Field collision'
    }

    for (const event of collected.events.values()) {
      const existing = events.get(event.name)
      if (existing) {
        issues.push(
          issueFor(
            'event-collision',
            `Event "${event.name}" is contributed by both "${existing.origin}" and "${event.origin}".`,
            id,
            { eventName: event.name },
          ),
        )
        existing.error = 'Event collision'
        continue
      }
      events.set(event.name, { ...event, inherited: true })
    }
  }

  for (const [name, field] of Object.entries(definition.fields ?? {})) {
    const existing = fields.get(name)
    if (!existing) {
      fields.set(name, {
        name,
        field,
        origin: id,
        inherited: false,
        override: false,
      })
      continue
    }
    if (existing.field.type !== field.type) {
      issues.push(
        issueFor(
          'override-type',
          `Field "${name}" overrides "${existing.origin}" with type "${field.type}" instead of "${existing.field.type}".`,
          id,
          { fieldName: name },
        ),
      )
      existing.error = 'Override type mismatch'
      continue
    }
    fields.set(name, {
      ...existing,
      field: { ...existing.field, ...field },
      override: true,
    })
  }

  for (const [name, event] of Object.entries(definition.events ?? {})) {
    const existing = events.get(name)
    if (existing) {
      issues.push(
        issueFor(
          'event-redefinition',
          `Event "${name}" is inherited from "${existing.origin}" and cannot be redefined.`,
          id,
          { eventName: name },
        ),
      )
      existing.error = 'Event redefinition'
      continue
    }
    events.set(name, {
      name,
      event,
      origin: id,
      inherited: false,
    })
  }

  const collected: Collected = { fields, events, issues }
  cache.set(id, collected)
  return collected
}

function normalizeCompose(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string')
}

export function effectiveDefinition(
  id: string,
  bundle: SchemaBundle,
  builtin?: SchemaBundle | null,
): EffectiveDefinition {
  const cache = new Map<string, Collected>()
  const collected = collectDefinition(id, bundle, builtin ?? null, [], cache)
  return {
    fields: [...collected.fields.values()],
    events: [...collected.events.values()],
    issues: collected.issues,
  }
}

function validateFieldType(
  field: SchemaField,
  bundle: SchemaBundle,
  context: string,
  definitionId: string,
  fieldName: string,
  payload = false,
): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  const type = field.type
  if (typeof type !== 'string' || type.length === 0) {
    issues.push(
      issueFor('field-type', `Field "${fieldName}" needs a type.`, definitionId, { fieldName }),
    )
    return issues
  }
  if (!KNOWN_FIELD_TYPES.has(type) && !/^array<.+>$/.test(type)) {
    issues.push({
      severity: 'warning',
      code: 'unknown-field-type',
      message: `Field "${fieldName}" uses type "${type}", which M1 preserves but does not edit.`,
      definitionId,
      fieldName,
    })
    return issues
  }

  if (payload && type === 'entityRef' && field.scope !== 'host') {
    issues.push({
      severity: 'warning',
      code: 'payload-entity-ref',
      message: `Payload field "${fieldName}" is an entityRef without scope "host"; payloads should not expose internal entities.`,
      definitionId,
      fieldName,
    })
  }

  if (type === 'enum') {
    if (typeof field.enum !== 'string' || field.enum.length === 0) {
      issues.push(
        issueFor(
          'enum-reference',
          `Field "${fieldName}" is an enum but does not name an enum.`,
          definitionId,
          { fieldName },
        ),
      )
      return issues
    }
    const enumDef = bundle.enums?.[field.enum]
    if (!enumDef) {
      issues.push(
        issueFor(
          'missing-enum',
          `Field "${fieldName}" references missing enum "${field.enum}".`,
          definitionId,
          { fieldName },
        ),
      )
      return issues
    }
    if (!fieldHasDefault(field)) return issues
    if (typeof field.default !== 'string' || !enumDef.values.includes(field.default)) {
      issues.push(
        issueFor(
          'enum-default',
          `Default for "${fieldName}" must be one of ${enumDef.values.map((value) => `"${value}"`).join(', ')}.`,
          definitionId,
          { fieldName },
        ),
      )
    }
    return issues
  }

  if (!fieldHasDefault(field)) return issues
  const value = field.default
  const fail = (expected: string) => {
    issues.push(
      issueFor(
        'default-type',
        `Default for "${fieldName}" must be ${expected} (${context}).`,
        definitionId,
        { fieldName },
      ),
    )
  }
  switch (type) {
    case 'string':
      if (typeof value !== 'string') fail('a string')
      break
    case 'int':
      if (typeof value !== 'number' || !Number.isInteger(value)) fail('an integer')
      break
    case 'float':
      if (typeof value !== 'number' || !Number.isFinite(value)) fail('a finite number')
      break
    case 'bool':
      if (typeof value !== 'boolean') fail('a boolean')
      break
    case 'color':
      if (
        !Array.isArray(value) ||
        (value.length !== 3 && value.length !== 4) ||
        value.some((item) => typeof item !== 'number' || !Number.isFinite(item))
      ) {
        fail('an RGB or RGBA number array')
      }
      break
    case 'vec2':
      if (
        !Array.isArray(value) ||
        value.length !== 2 ||
        value.some((item) => typeof item !== 'number' || !Number.isFinite(item))
      ) {
        fail('a two-number array')
      }
      break
    case 'vec3':
      if (
        !Array.isArray(value) ||
        value.length !== 3 ||
        value.some((item) => typeof item !== 'number' || !Number.isFinite(item))
      ) {
        fail('a three-number array')
      }
      break
    case 'entityRef':
    case 'assetRef':
      if (value !== null && typeof value !== 'string') fail('a string or null')
      break
    default:
      break
  }
  return issues
}

export function validateSchema(
  bundle: SchemaBundle,
  builtin?: SchemaBundle | null,
): ValidationResult {
  const issues: ValidationIssue[] = []
  const add = (issue: ValidationIssue) => issues.push(issue)
  const seen = new Set<string>()
  const addUnique = (issue: ValidationIssue) => {
    const key = `${issue.severity}|${issue.code}|${issue.definitionId ?? ''}|${issue.fieldName ?? ''}|${issue.eventName ?? ''}|${issue.message}`
    if (seen.has(key)) return
    seen.add(key)
    add(issue)
  }

  if (!bundle.id) add(issueFor('bundle-id', 'The schema bundle needs an "id".'))
  if (!/^[A-Za-z0-9._-]+$/.test(bundle.namespace ?? '')) {
    add(issueFor('bundle-namespace', 'Namespace must contain letters, numbers, dots, dashes, or underscores.'))
  }
  if (!/^\d+\.\d+\.\d+(?:[-+].+)?$/.test(bundle.version ?? '')) {
    add(issueFor('bundle-version', 'Version must use semantic version form, for example 1.0.0.'))
  }

  const enums = bundle.enums ?? {}
  for (const [name, enumDef] of Object.entries(enums)) {
    if (!isRecord(enumDef)) {
      add(issueFor('enum-shape', `Enum "${name}" must be an object.`, undefined, { enumName: name }))
      continue
    }
    if (!Array.isArray(enumDef.values)) {
      add(issueFor('enum-values', `Enum "${name}" needs a "values" array.`, undefined, { enumName: name }))
      continue
    }
    const seenValues = new Set<string>()
    for (const value of enumDef.values) {
      if (typeof value !== 'string' || value.length === 0) {
        add(issueFor('enum-value', `Enum "${name}" values must be non-empty strings.`, undefined, { enumName: name }))
        continue
      }
      if (seenValues.has(value)) {
        add(issueFor('enum-duplicate', `Enum "${name}" has duplicate value "${value}".`, undefined, { enumName: name, enumValue: value }))
      }
      seenValues.add(value)
    }
  }

  const usedEnums = new Set<string>()
  const registryIds = new Set([...Object.keys(bundle.definitions), ...Object.keys(builtin?.definitions ?? {})])

  for (const [definitionId, definition] of Object.entries(bundle.definitions)) {
    if (!isRecord(definition)) {
      add(issueFor('definition-shape', `Definition "${definitionId}" must be an object.`, definitionId))
      continue
    }
    const namespace = definitionNamespace(definitionId)
    if (namespace !== bundle.namespace) {
      add(
        issueFor(
          'definition-namespace',
          `Definition "${definitionId}" must use the bundle namespace "${bundle.namespace}".`,
          definitionId,
        ),
      )
    }
    const local = definitionLocalName(definitionId)
    if (!local || /\s/.test(local)) {
      add(issueFor('definition-id', `Definition "${definitionId}" needs a non-empty local ID without spaces.`, definitionId))
    }
    if (definition.abstract !== undefined && typeof definition.abstract !== 'boolean') {
      add(issueFor('definition-abstract', `Definition "${definitionId}" has a non-boolean "abstract" flag.`, definitionId))
    }
    if (definition.compose !== undefined && !Array.isArray(definition.compose)) {
      add(issueFor('definition-compose', `Definition "${definitionId}" has a non-array "compose".`, definitionId))
    }
    const compose = normalizeCompose(definition.compose)
    const seenCompose = new Set<string>()
    for (const target of compose) {
      if (seenCompose.has(target)) {
        add(issueFor('compose-duplicate', `Definition "${definitionId}" composes "${target}" twice.`, definitionId))
      }
      seenCompose.add(target)
      if (target === definitionId) {
        add(issueFor('compose-self', `Definition "${definitionId}" cannot compose itself.`, definitionId))
      } else if (!registryIds.has(target)) {
        add(issueFor('compose-missing', `Definition "${definitionId}" composes missing "${target}".`, definitionId))
      }
    }

    for (const [fieldName, field] of Object.entries(definition.fields ?? {})) {
      if (!isRecord(field)) {
        add(issueFor('field-shape', `Field "${fieldName}" must be an object.`, definitionId, { fieldName }))
        continue
      }
      for (const issue of validateFieldType(field, bundle, 'definition field', definitionId, fieldName)) {
        addUnique(issue)
      }
      if (field.type === 'enum' && typeof field.enum === 'string') usedEnums.add(field.enum)
      if (field.doc !== undefined && typeof field.doc !== 'string') {
        add(issueFor('field-doc', `Field "${fieldName}" documentation must be a string.`, definitionId, { fieldName }))
      }
    }

    for (const [eventName, event] of Object.entries(definition.events ?? {})) {
      if (!isRecord(event)) {
        add(issueFor('event-shape', `Event "${eventName}" must be an object.`, definitionId, { eventName }))
        continue
      }
      if (event.payload !== undefined && !isRecord(event.payload)) {
        add(issueFor('event-payload', `Event "${eventName}" payload must be an object.`, definitionId, { eventName }))
        continue
      }
      for (const [fieldName, field] of Object.entries(event.payload ?? {})) {
        if (!isRecord(field)) {
          add(issueFor('payload-field-shape', `Event payload field "${fieldName}" must be an object.`, definitionId, { eventName, fieldName }))
          continue
        }
        for (const issue of validateFieldType(field, bundle, 'event payload', definitionId, fieldName, true)) {
          addUnique(issue)
        }
        if (field.type === 'enum' && typeof field.enum === 'string') usedEnums.add(field.enum)
      }
    }
  }

  const effectiveCache = new Map<string, Collected>()
  for (const definitionId of Object.keys(bundle.definitions)) {
    const effective = collectDefinition(definitionId, bundle, builtin ?? null, [], effectiveCache)
    for (const issue of effective.issues) addUnique(issue)
    const definition = bundle.definitions[definitionId]
    if (
      Object.keys(definition.fields ?? {}).length === 0 &&
      Object.keys(definition.events ?? {}).length === 0 &&
      normalizeCompose(definition.compose).length === 0
    ) {
      addUnique({
        severity: 'warning',
        code: 'empty-definition',
        message: `Definition "${definitionId}" has no fields, events, or composition.`,
        definitionId,
      })
    }
  }

  for (const enumName of Object.keys(enums)) {
    if (!usedEnums.has(enumName)) {
      addUnique({
        severity: 'warning',
        code: 'unused-enum',
        message: `Enum "${enumName}" is not used by any field in this bundle.`,
        enumName,
      })
    }
  }

  const errors = issues.filter((issue) => issue.severity === 'error').length
  const warnings = issues.length - errors
  return { issues, errors, warnings }
}

export function renameDefinitionInBundle(
  bundle: SchemaBundle,
  oldId: string,
  newId: string,
): SchemaBundle {
  const next = cloneJson(bundle)
  if (oldId === newId) return next
  if (next.definitions[newId]) throw new Error(`Definition "${newId}" already exists.`)
  const definition = next.definitions[oldId]
  if (!definition) throw new Error(`Definition "${oldId}" does not exist.`)
  next.definitions[newId] = definition
  delete next.definitions[oldId]
  for (const item of Object.values(next.definitions)) {
    if (!Array.isArray(item.compose)) continue
    item.compose = item.compose.map((target) => (target === oldId ? newId : target))
  }
  return next
}

export function deleteDefinitionInBundle(bundle: SchemaBundle, id: string): SchemaBundle {
  const next = cloneJson(bundle)
  delete next.definitions[id]
  for (const item of Object.values(next.definitions)) {
    if (Array.isArray(item.compose)) {
      item.compose = item.compose.filter((target) => target !== id)
      if (item.compose.length === 0) delete item.compose
    }
  }
  return next
}

export function usageCount(bundle: SchemaBundle, id: string): number {
  return Object.values(bundle.definitions).filter((definition) =>
    normalizeCompose(definition.compose).includes(id),
  ).length
}

export function wouldCreateCycle(
  bundle: SchemaBundle,
  sourceId: string,
  targetId: string,
  builtin?: SchemaBundle | null,
): boolean {
  if (sourceId === targetId) return true
  const seen = new Set<string>()
  const visit = (id: string): boolean => {
    if (id === sourceId) return true
    if (seen.has(id)) return false
    seen.add(id)
    const found = lookupDefinition(id, bundle, builtin)
    if (!found) return false
    return normalizeCompose(found.definition.compose).some(visit)
  }
  return visit(targetId)
}

function forEachField(
  bundle: SchemaBundle,
  visit: (field: SchemaField, definitionId: string, fieldName: string, payload: boolean) => void,
): void {
  for (const [definitionId, definition] of Object.entries(bundle.definitions)) {
    for (const [fieldName, field] of Object.entries(definition.fields ?? {})) {
      visit(field, definitionId, fieldName, false)
    }
    for (const event of Object.values(definition.events ?? {})) {
      for (const [fieldName, field] of Object.entries(event.payload ?? {})) {
        visit(field, definitionId, fieldName, true)
      }
    }
  }
}

export function enumUsageCount(bundle: SchemaBundle, enumName: string): number {
  let count = 0
  forEachField(bundle, (field) => {
    if (field.type === 'enum' && field.enum === enumName) count += 1
  })
  return count
}

export function renameEnumInBundle(
  bundle: SchemaBundle,
  oldName: string,
  newName: string,
): SchemaBundle {
  const next = cloneJson(bundle)
  if (oldName === newName) return next
  const source = next.enums?.[oldName]
  if (!source) throw new Error(`Enum "${oldName}" does not exist.`)
  if (next.enums?.[newName]) throw new Error(`Enum "${newName}" already exists.`)
  next.enums = next.enums ?? {}
  next.enums[newName] = source
  delete next.enums[oldName]
  forEachField(next, (field) => {
    if (field.type === 'enum' && field.enum === oldName) field.enum = newName
  })
  return next
}

export function renameEnumValueInBundle(
  bundle: SchemaBundle,
  enumName: string,
  oldValue: string,
  newValue: string,
): SchemaBundle {
  const next = cloneJson(bundle)
  if (oldValue === newValue) return next
  const enumDef = next.enums?.[enumName]
  if (!enumDef) throw new Error(`Enum "${enumName}" does not exist.`)
  const index = enumDef.values.indexOf(oldValue)
  if (index < 0) throw new Error(`Enum value "${oldValue}" does not exist.`)
  if (enumDef.values.includes(newValue)) throw new Error(`Enum value "${newValue}" already exists.`)
  enumDef.values[index] = newValue
  forEachField(next, (field) => {
    if (field.type === 'enum' && field.enum === enumName && field.default === oldValue) {
      field.default = newValue
    }
  })
  return next
}

export function deleteEnumInBundle(bundle: SchemaBundle, enumName: string): SchemaBundle {
  const next = cloneJson(bundle)
  if (!next.enums?.[enumName]) throw new Error(`Enum "${enumName}" does not exist.`)
  if (enumUsageCount(next, enumName) > 0) {
    throw new Error(`Enum "${enumName}" is still used by a field.`)
  }
  delete next.enums[enumName]
  return next
}

export function defaultPreview(field: SchemaField): string {
  if (!fieldHasDefault(field)) return 'required'
  const value = field.default
  if (field.type === 'bool') return value ? 'true' : 'false'
  if (typeof value === 'string') return JSON.stringify(value)
  if (typeof value === 'number') return String(value)
  if (Array.isArray(value)) return `[${value.join(', ')}]`
  if (value === null) return 'null'
  return JSON.stringify(value)
}

export function fieldOriginLabel(field: EffectiveField): string {
  return field.origin
}


export function addDefinition(
  bundle: SchemaBundle,
  localName: string,
  abstract: boolean,
): { bundle: SchemaBundle; id: string } {
  const clean = localName.trim().replace(/^.*:/, '')
  if (!clean || /\s/.test(clean)) throw new Error('Definition name must not be empty or contain spaces.')
  const id = qualify(bundle.namespace, clean)
  if (bundle.definitions[id]) throw new Error(`Definition "${id}" already exists.`)
  const next = cloneJson(bundle)
  next.definitions[id] = {
    ...(abstract ? { abstract: true } : {}),
    fields: {},
    events: {},
  }
  return { bundle: next, id }
}

export function uniqueLocalName(bundle: SchemaBundle, base = 'newDefinition'): string {
  let candidate = base
  let index = 2
  while (bundle.definitions[qualify(bundle.namespace, candidate)]) {
    candidate = `${base}${index}`
    index += 1
  }
  return candidate
}
