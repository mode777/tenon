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
  imports?: Record<string, string>
  enums?: Record<string, SchemaEnum>
  definitions: Record<string, SchemaDefinition>
  [key: string]: unknown
}

export interface SchemaPackageFile {
  path: string
  bundle: SchemaBundle
}

export interface SchemaPackageIssue {
  path: string
  message: string
}

export interface ResolvedSchemaPackages {
  /** Every directly or transitively resolved package, keyed by namespace. */
  bundles: Record<string, SchemaBundle>
  /** Workspace locations for resolved packages, keyed by namespace. */
  paths: Record<string, string>
  /** Non-fatal resolution notes that the editor surfaces with validation. */
  issues: ValidationIssue[]
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
  /** Scene-document context. */
  entityId?: string
  promotionName?: string
  slotName?: string
  scenePath?: string
  /** Authoring file that produced the issue, when it is not the open document. */
  sourcePath?: string
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
  if (value.imports !== undefined) {
    if (!isRecord(value.imports)) {
      throw new Error('The schema bundle "imports" must be an object when present.')
    }
    for (const [namespace, version] of Object.entries(value.imports)) {
      if (typeof version !== 'string' || version.length === 0) {
        throw new Error(`The schema import "${namespace}" needs a version string.`)
      }
    }
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

export type DefinitionSource = 'own' | 'builtin' | 'import'

export interface DefinitionLookup {
  definition: SchemaDefinition
  builtin: boolean
  imported: boolean
  source: DefinitionSource
  namespace: string | null
}

export interface EnumLookup {
  enumDef: SchemaEnum
  builtin: boolean
  imported: boolean
  namespace: string
  /** Qualified for imported enums; unqualified for the open bundle. */
  key: string
}

export function lookupDefinition(
  id: string,
  bundle: SchemaBundle,
  builtin?: SchemaBundle | null,
  imports?: Record<string, SchemaBundle> | null,
): DefinitionLookup | null {
  const own = bundle.definitions[id]
  if (own) {
    return {
      definition: own,
      builtin: false,
      imported: false,
      source: 'own',
      namespace: bundle.namespace,
    }
  }
  const namespace = definitionNamespace(id)
  if (namespace && builtin?.namespace === namespace) {
    const built = builtin.definitions[id]
    if (built) {
      return { definition: built, builtin: true, imported: false, source: 'builtin', namespace }
    }
  }
  if (namespace && imports?.[namespace]) {
    const imported = imports[namespace].definitions[id]
    if (imported) {
      return { definition: imported, builtin: false, imported: true, source: 'import', namespace }
    }
  }
  // Keep exact-ID lookup for callers that pass a bundle without its namespace.
  const built = builtin?.definitions[id]
  if (built) {
    return {
      definition: built,
      builtin: true,
      imported: false,
      source: 'builtin',
      namespace: definitionNamespace(id),
    }
  }
  return null
}

export function allDefinitionIds(
  bundle: SchemaBundle,
  builtin?: SchemaBundle | null,
  imports?: Record<string, SchemaBundle> | null,
): string[] {
  const seen = new Set(Object.keys(bundle.definitions))
  for (const id of Object.keys(builtin?.definitions ?? {})) seen.add(id)
  for (const imported of Object.values(imports ?? {})) {
    for (const id of Object.keys(imported.definitions)) seen.add(id)
  }
  return [...seen].sort((a, b) => a.localeCompare(b))
}

export function isBuiltinDefinition(
  id: string,
  bundle: SchemaBundle,
  builtin?: SchemaBundle | null,
): boolean {
  return !(id in bundle.definitions) && Boolean(builtin?.definitions[id])
}

export function isImportedDefinition(
  id: string,
  bundle: SchemaBundle,
  builtin?: SchemaBundle | null,
  imports?: Record<string, SchemaBundle> | null,
): boolean {
  if (id in bundle.definitions || isBuiltinDefinition(id, bundle, builtin)) return false
  const namespace = definitionNamespace(id)
  return Boolean(namespace && imports?.[namespace]?.definitions[id])
}

export function definitionLocalName(id: string): string {
  const index = id.indexOf(':')
  return index >= 0 ? id.slice(index + 1) : id
}

export function definitionNamespace(id: string): string | null {
  const index = id.indexOf(':')
  return index > 0 ? id.slice(0, index) : null
}

export function packageVersion(namespace: string, bundle: SchemaBundle): string {
  return `${namespace}@${bundle.version}`
}

export function normalizeSchemaPath(path: string): string {
  const normalized = path.replaceAll('\\', '/')
  return normalized.startsWith('/') ? normalized : `/${normalized}`
}

function importLocation(path: string): string | null {
  if (/^https?:\/\//.test(path)) return null
  if (path.startsWith('builtin:')) return null
  return normalizeSchemaPath(path)
}

function schemaImportEntries(bundle: SchemaBundle): Array<[string, string]> {
  if (!isRecord(bundle.imports)) return []
  return Object.entries(bundle.imports).filter(
    (entry): entry is [string, string] => typeof entry[1] === 'string',
  )
}

export function resolveSchemaImports(
  bundle: SchemaBundle,
  packages: SchemaPackageFile[],
  projectImports: Record<string, string> = {},
): ResolvedSchemaPackages {
  const resolved: ResolvedSchemaPackages = { bundles: {}, paths: {}, issues: [] }
  const byPath = new Map<string, SchemaPackageFile>()
  for (const item of packages) {
    const path = importLocation(item.path)
    if (!path) continue
    if (!byPath.has(path)) byPath.set(path, item)
  }
  const candidates = packages.filter((item) => item.bundle.namespace !== bundle.namespace)

  const resolveOne = (
    namespace: string,
    version: string,
  ): { bundle: SchemaBundle; path: string } | null => {
    const mapped = projectImports[namespace]
    if (mapped) {
      const path = importLocation(mapped)
      const item = path
        ? byPath.get(path)
        : candidates.find((candidate) => candidate.path === mapped)
      if (item) return { bundle: item.bundle, path: item.path }
    }
    const exact = candidates.find(
      (item) => item.bundle.namespace === namespace && item.bundle.version === version,
    )
    if (exact) return { bundle: exact.bundle, path: exact.path }
    const known = candidates.find((item) => item.bundle.namespace === namespace)
    return known ? { bundle: known.bundle, path: known.path } : null
  }

  const addPackage = (namespace: string, version: string, found: { bundle: SchemaBundle; path: string }) => {
    resolved.bundles[namespace] = found.bundle
    resolved.paths[namespace] = found.path
    if (found.bundle.namespace !== namespace) {
      resolved.issues.push(
        issueFor(
          'import-namespace',
          `Schema import "${namespace}@${version}" resolved to a bundle with namespace "${found.bundle.namespace}".`,
        ),
      )
    }
    return found.bundle
  }

  for (const [namespace, version] of schemaImportEntries(bundle)) {
    if (namespace === bundle.namespace) continue
    const found = resolveOne(namespace, version)
    if (found) addPackage(namespace, version, found)
  }

  const queue = Object.entries(resolved.bundles).map(([namespace, item]) => ({ namespace, bundle: item }))
  const visited = new Set(queue.map((item) => item.namespace))
  while (queue.length > 0) {
    const current = queue.shift()!
    for (const [namespace, version] of schemaImportEntries(current.bundle)) {
      if (namespace === current.bundle.namespace || namespace === bundle.namespace) continue
      const existing = resolved.bundles[namespace]
      if (existing) {
        if (existing.version !== version) {
          resolved.issues.push(
            issueFor(
              'import-conflict',
              `Schema "${current.bundle.namespace}@${current.bundle.version}" requires "${namespace}@${version}", but the project resolves "${namespace}@${existing.version}".`,
            ),
          )
        }
        continue
      }
      const found = resolveOne(namespace, version)
      if (!found) {
        resolved.issues.push(
          issueFor(
            'missing-import',
            `Schema "${current.bundle.namespace}@${current.bundle.version}" requires "${namespace}@${version}", which is not available.`,
          ),
        )
        continue
      }
      if (found.bundle.version !== version) {
        resolved.issues.push(
          issueFor(
            'import-version',
            `Schema "${current.bundle.namespace}@${current.bundle.version}" requires "${namespace}@${version}", but the project resolves "${namespace}@${found.bundle.version}".`,
          ),
        )
      }
      const added = addPackage(namespace, version, found)
      if (!visited.has(namespace)) {
        visited.add(namespace)
        queue.push({ namespace, bundle: added })
      }
    }
  }

  return resolved
}

export function lookupEnum(
  name: string,
  bundle: SchemaBundle,
  builtin?: SchemaBundle | null,
  imports?: Record<string, SchemaBundle> | null,
): EnumLookup | null {
  const namespace = definitionNamespace(name)
  if (namespace) {
    const local = definitionLocalName(name)
    if (namespace === bundle.namespace) {
      const enumDef = bundle.enums?.[local]
      return enumDef
        ? { enumDef, builtin: false, imported: false, namespace, key: name }
        : null
    }
    if (builtin?.namespace === namespace) {
      const enumDef = builtin.enums?.[local]
      return enumDef
        ? { enumDef, builtin: true, imported: false, namespace, key: name }
        : null
    }
    const imported = imports?.[namespace]?.enums?.[local]
    return imported
      ? { enumDef: imported, builtin: false, imported: true, namespace, key: name }
      : null
  }
  const enumDef = bundle.enums?.[name]
  return enumDef
    ? { enumDef, builtin: false, imported: false, namespace: bundle.namespace, key: name }
    : null
}

/** Resolve a field enum reference in the bundle that owns the field's origin. */
export function lookupFieldEnum(
  field: SchemaField,
  originDefinitionId: string,
  bundle: SchemaBundle,
  builtin?: SchemaBundle | null,
  imports?: Record<string, SchemaBundle> | null,
): EnumLookup | null {
  if (typeof field.enum !== 'string' || field.enum.length === 0) return null
  if (definitionNamespace(field.enum)) {
    return lookupEnum(field.enum, bundle, builtin, imports)
  }
  const originNamespace = definitionNamespace(originDefinitionId)
  if (!originNamespace || originNamespace === bundle.namespace) {
    return lookupEnum(field.enum, bundle, builtin, imports)
  }
  if (originNamespace === builtin?.namespace) {
    const enumDef = builtin?.enums?.[field.enum]
    return enumDef
      ? {
          enumDef,
          builtin: true,
          imported: false,
          namespace: originNamespace,
          key: qualify(originNamespace, field.enum),
        }
      : null
  }
  const enumDef = imports?.[originNamespace]?.enums?.[field.enum]
  return enumDef
    ? {
        enumDef,
        builtin: false,
        imported: true,
        namespace: originNamespace,
        key: qualify(originNamespace, field.enum),
      }
    : null
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
  imports: Record<string, SchemaBundle> | null,
  stack: string[],
  cache: Map<string, Collected>,
): Collected {
  const cached = cache.get(id)
  if (cached) return cached

  const found = lookupDefinition(id, bundle, builtin, imports)
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
    const collected = collectDefinition(target, bundle, builtin, imports, nextStack, cache)
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
  imports?: Record<string, SchemaBundle> | null,
): EffectiveDefinition {
  const cache = new Map<string, Collected>()
  const collected = collectDefinition(id, bundle, builtin ?? null, imports ?? null, [], cache)
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
  builtin?: SchemaBundle | null,
  imports?: Record<string, SchemaBundle> | null,
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
    const enumNamespace = definitionNamespace(field.enum)
    if (
      enumNamespace &&
      enumNamespace !== bundle.namespace &&
      enumNamespace !== builtin?.namespace &&
      !(enumNamespace in (bundle.imports ?? {}))
    ) {
      issues.push(
        issueFor(
          'undeclared-import',
          `Field "${fieldName}" references enum "${field.enum}" but schema "${enumNamespace}" is not imported.`,
          definitionId,
          { fieldName },
        ),
      )
    }
    const enumLookup = lookupFieldEnum(field, definitionId, bundle, builtin, imports)
    if (!enumLookup) {
      const hint = enumNamespace && enumNamespace !== bundle.namespace && !imports?.[enumNamespace]
        ? ` The namespace "${enumNamespace}" is not imported.`
        : ''
      issues.push(
        issueFor(
          'missing-enum',
          `Field "${fieldName}" references missing enum "${field.enum}".${hint}`,
          definitionId,
          { fieldName },
        ),
      )
      return issues
    }
    if (!fieldHasDefault(field)) return issues
    if (typeof field.default !== 'string' || !enumLookup.enumDef.values.includes(field.default)) {
      issues.push(
        issueFor(
          'enum-default',
          `Default for "${fieldName}" must be one of ${enumLookup.enumDef.values.map((value) => `"${value}"`).join(', ')}.`,
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
  imports?: Record<string, SchemaBundle> | null,
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
  } else if (bundle.namespace === builtin?.namespace) {
    add(issueFor('bundle-namespace', `Namespace "${bundle.namespace}" is reserved for the builtin schema.`))
  }
  if (!/^\d+\.\d+\.\d+(?:[-+].+)?$/.test(bundle.version ?? '')) {
    add(issueFor('bundle-version', 'Version must use semantic version form, for example 1.0.0.'))
  }

  const declaredImports: Record<string, string> = isRecord(bundle.imports)
    ? Object.fromEntries(
        Object.entries(bundle.imports).filter(
          (entry): entry is [string, string] => typeof entry[1] === 'string',
        ),
      )
    : {}
  if (bundle.imports !== undefined && !isRecord(bundle.imports)) {
    add(issueFor('bundle-imports', 'Schema imports must be an object from namespace to version.'))
  }
  for (const [namespace, version] of Object.entries(declaredImports)) {
    if (!/^[A-Za-z0-9._-]+$/.test(namespace)) {
      add(
        issueFor(
          'import-namespace',
          `Schema import namespace "${namespace}" must contain letters, numbers, dots, dashes, or underscores.`,
        ),
      )
    }
    if (namespace === bundle.namespace) {
      add(issueFor('import-self', `Schema import "${namespace}" points at this bundle's own namespace.`))
    }
    if (!/^\d+\.\d+\.\d+(?:[-+].+)?$/.test(version)) {
      add(
        issueFor(
          'import-version',
          `Schema import "${namespace}" must pin a semantic version, for example 1.0.0.`,
        ),
      )
      continue
    }
    if (namespace === builtin?.namespace) {
      add(
        issueFor(
          'import-builtin',
          `Schema import "${namespace}@${version}" is builtin and is available without an import entry.`,
        ),
      )
      continue
    }
    const provided = imports?.[namespace]
    if (!provided) {
      add(
        issueFor(
          'missing-import',
          `Schema import "${namespace}@${version}" is not available in this project.`,
        ),
      )
      continue
    }
    if (provided.namespace !== namespace) {
      add(
        issueFor(
          'import-namespace',
          `Schema import "${namespace}@${version}" resolved to a bundle with namespace "${provided.namespace}".`,
        ),
      )
    }
    if (provided.version !== version) {
      add(
        issueFor(
          'import-version',
          `Schema import "${namespace}@${version}" resolved to version ${provided.version}.`,
        ),
      )
    }
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
  const registryIds = new Set([
    ...Object.keys(bundle.definitions),
    ...Object.keys(builtin?.definitions ?? {}),
    ...Object.values(imports ?? {}).flatMap((item) => Object.keys(item.definitions)),
  ])
  const builtinNamespace = builtin?.namespace ?? null

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
      const targetNamespace = definitionNamespace(target)
      const undeclared = Boolean(
        targetNamespace &&
        targetNamespace !== bundle.namespace &&
        targetNamespace !== builtinNamespace &&
        !(targetNamespace in declaredImports),
      )
      if (target === definitionId) {
        add(issueFor('compose-self', `Definition "${definitionId}" cannot compose itself.`, definitionId))
      } else if (undeclared && targetNamespace) {
        add(
          issueFor(
            'undeclared-import',
            `Definition "${definitionId}" composes "${target}" but schema "${targetNamespace}" is not imported.`,
            definitionId,
          ),
        )
      } else if (!registryIds.has(target)) {
        add(issueFor('compose-missing', `Definition "${definitionId}" composes missing "${target}".`, definitionId))
      }
    }

    for (const [fieldName, field] of Object.entries(definition.fields ?? {})) {
      if (!isRecord(field)) {
        add(issueFor('field-shape', `Field "${fieldName}" must be an object.`, definitionId, { fieldName }))
        continue
      }
      for (const issue of validateFieldType(
        field,
        bundle,
        'definition field',
        definitionId,
        fieldName,
        false,
        builtin,
        imports,
      )) {
        addUnique(issue)
      }
      if (field.type === 'enum' && typeof field.enum === 'string') {
        const enumNamespace = definitionNamespace(field.enum)
        if (!enumNamespace || enumNamespace === bundle.namespace) {
          usedEnums.add(definitionLocalName(field.enum))
        }
      }
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
        for (const issue of validateFieldType(
          field,
          bundle,
          'event payload',
          definitionId,
          fieldName,
          true,
          builtin,
          imports,
        )) {
          addUnique(issue)
        }
        if (field.type === 'enum' && typeof field.enum === 'string') {
          const enumNamespace = definitionNamespace(field.enum)
          if (!enumNamespace || enumNamespace === bundle.namespace) {
            usedEnums.add(definitionLocalName(field.enum))
          }
        }
      }
    }
  }

  const effectiveCache = new Map<string, Collected>()
  for (const definitionId of Object.keys(bundle.definitions)) {
    const effective = collectDefinition(
      definitionId,
      bundle,
      builtin ?? null,
      imports ?? null,
      [],
      effectiveCache,
    )
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

export function renameNamespaceInBundle(
  bundle: SchemaBundle,
  namespace: string,
): SchemaBundle {
  const clean = namespace.trim()
  if (!/^[A-Za-z0-9._-]+$/.test(clean)) {
    throw new Error('Namespace must contain letters, numbers, dots, dashes, or underscores.')
  }
  const next = cloneJson(bundle)
  const oldNamespace = next.namespace
  if (oldNamespace === clean) return next
  if (clean in (next.imports ?? {})) {
    throw new Error(`The bundle already imports the namespace "${clean}".`)
  }
  const definitions: Record<string, SchemaDefinition> = {}
  for (const [id, definition] of Object.entries(next.definitions)) {
    definitions[qualify(clean, definitionLocalName(id))] = definition
  }
  next.definitions = definitions
  for (const definition of Object.values(next.definitions)) {
    if (Array.isArray(definition.compose)) {
      definition.compose = definition.compose.map((target) => {
        if (definitionNamespace(target) !== oldNamespace) return target
        return qualify(clean, definitionLocalName(target))
      })
    }
  }
  forEachField(next, (field) => {
    if (typeof field.enum === 'string' && definitionNamespace(field.enum) === oldNamespace) {
      field.enum = qualify(clean, definitionLocalName(field.enum))
    }
  })
  next.namespace = clean
  return next
}

export function addImportToBundle(
  bundle: SchemaBundle,
  namespace: string,
  version: string,
): SchemaBundle {
  const cleanNamespace = namespace.trim()
  const cleanVersion = version.trim()
  if (!/^[A-Za-z0-9._-]+$/.test(cleanNamespace)) {
    throw new Error('Import namespace must contain letters, numbers, dots, dashes, or underscores.')
  }
  if (cleanNamespace === bundle.namespace) {
    throw new Error('A schema cannot import its own namespace.')
  }
  if (!/^\d+\.\d+\.\d+(?:[-+].+)?$/.test(cleanVersion)) {
    throw new Error(`Import "${cleanNamespace}" must pin a semantic version.`)
  }
  const next = cloneJson(bundle)
  next.imports = { ...(next.imports ?? {}), [cleanNamespace]: cleanVersion }
  return next
}

export function removeImportFromBundle(bundle: SchemaBundle, namespace: string): SchemaBundle {
  const next = cloneJson(bundle)
  if (!next.imports?.[namespace]) return next
  delete next.imports[namespace]
  if (Object.keys(next.imports).length === 0) delete next.imports
  return next
}

export function importUsageCount(bundle: SchemaBundle, namespace: string): number {
  let count = 0
  for (const definition of Object.values(bundle.definitions)) {
    for (const target of normalizeCompose(definition.compose)) {
      if (definitionNamespace(target) === namespace) count += 1
    }
  }
  forEachField(bundle, (field) => {
    if (typeof field.enum === 'string' && definitionNamespace(field.enum) === namespace) {
      count += 1
    }
  })
  return count
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
  imports?: Record<string, SchemaBundle> | null,
): boolean {
  if (sourceId === targetId) return true
  const seen = new Set<string>()
  const visit = (id: string): boolean => {
    if (id === sourceId) return true
    if (seen.has(id)) return false
    seen.add(id)
    const found = lookupDefinition(id, bundle, builtin, imports)
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

function isEnumRef(ref: unknown, enumName: string, namespace: string): boolean {
  return ref === enumName || ref === qualify(namespace, enumName)
}

export function enumUsageCount(bundle: SchemaBundle, enumName: string): number {
  let count = 0
  forEachField(bundle, (field) => {
    if (field.type === 'enum' && isEnumRef(field.enum, enumName, bundle.namespace)) count += 1
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
  const qualifiedOld = qualify(next.namespace, oldName)
  forEachField(next, (field) => {
    if (field.type !== 'enum') return
    if (field.enum === oldName) field.enum = newName
    else if (field.enum === qualifiedOld) field.enum = qualify(next.namespace, newName)
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
  const qualifiedName = qualify(next.namespace, enumName)
  forEachField(next, (field) => {
    if (
      field.type === 'enum' &&
      (field.enum === enumName || field.enum === qualifiedName) &&
      field.default === oldValue
    ) {
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
