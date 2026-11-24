import {
  isRecord,
  normalizeSchemaPath,
  parseSchemaText,
  resolveSchemaImports,
  validateSchema,
  type SchemaBundle,
  type SchemaPackageFile,
  type ValidationIssue,
  type ValidationResult,
} from './schema'
import {
  normalizeScenePath,
  normalizeRequires,
  parseSceneText,
  validateScene,
  type SceneDocument,
  type SceneValidationContext,
} from './scene'

export interface ProjectManifest {
  imports?: Record<string, string>
  [key: string]: unknown
}

export interface ProjectSchemaPackage {
  path: string
  source: 'local' | 'remote'
  text: string
  hash?: string
  bundle?: SchemaBundle
  error?: string
}

export interface ProjectScenePackage {
  path: string
  text: string
  hash?: string
  scene?: SceneDocument
  error?: string
}

export interface ProjectSchemaRow {
  namespace: string
  version: string
  location: string
  path?: string
  source: 'builtin' | 'local' | 'remote'
  hash?: string
  status: 'ok' | 'missing' | 'invalid' | 'unmapped'
  bundle?: SchemaBundle
}

export interface ProjectAnalysis {
  manifest: ProjectManifest
  schemas: ProjectSchemaRow[]
  schemasByNamespace: Record<string, SchemaBundle>
  scenesByPath: Record<string, SceneDocument>
  issues: ValidationIssue[]
  errors: number
  warnings: number
  ready: boolean
}

export type ImportLocation =
  | { kind: 'builtin'; namespace: string; version: string }
  | { kind: 'remote'; url: string }
  | { kind: 'local'; path: string }
  | { kind: 'invalid'; message: string }

export function parseProjectText(text: string): ProjectManifest {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch (error) {
    throw new Error(
      `The project manifest is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
  if (!isRecord(value)) throw new Error('The project manifest must be a JSON object.')
  if (value.imports !== undefined) {
    if (!isRecord(value.imports)) {
      throw new Error('The project "imports" map must be an object when present.')
    }
    for (const [namespace, location] of Object.entries(value.imports)) {
      if (typeof location !== 'string' || location.length === 0) {
        throw new Error(`Project import "${namespace}" needs a non-empty location string.`)
      }
    }
  }
  return value as unknown as ProjectManifest
}

export function projectToText(manifest: ProjectManifest): string {
  return `${JSON.stringify(manifest, null, 2)}\n`
}

export function createEmptyProject(): ProjectManifest {
  return { imports: {} }
}

export function projectTemplateText(): string {
  return projectToText(createEmptyProject())
}

export function hashText(text: string): string {
  let hash = 0x811c9dc5
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

export function parseImportLocation(location: string): ImportLocation {
  const value = location.trim()
  if (!value) return { kind: 'invalid', message: 'The location is empty.' }
  if (value.startsWith('builtin:')) {
    const reference = value.slice('builtin:'.length)
    const match = /^([A-Za-z0-9._-]+)@(\d+\.\d+\.\d+(?:[-+].+)?)$/.exec(reference)
    if (!match) {
      return {
        kind: 'invalid',
        message: `Builtin location "${value}" must use "builtin:namespace@version".`,
      }
    }
    return { kind: 'builtin', namespace: match[1], version: match[2] }
  }
  if (/^https:\/\//.test(value)) {
    try {
      void new URL(value)
    } catch {
      return { kind: 'invalid', message: `Remote location "${value}" is not a valid HTTPS URL.` }
    }
    return { kind: 'remote', url: value }
  }
  if (/^[a-z][a-z0-9+.-]*:/i.test(value)) {
    return {
      kind: 'invalid',
      message: `Unsupported location scheme in "${value}". Use builtin:, a project-relative path, or HTTPS.`,
    }
  }
  if (value.startsWith('/') || value.includes('..')) {
    return {
      kind: 'invalid',
      message: `Project-relative location "${value}" must stay inside the workspace.`,
    }
  }
  return { kind: 'local', path: normalizeSchemaPath(value) }
}

function addIssue(
  issues: ValidationIssue[],
  seen: Set<string>,
  issue: ValidationIssue,
): void {
  const key = `${issue.severity}|${issue.code}|${issue.sourcePath ?? ''}|${issue.scenePath ?? ''}|${issue.entityId ?? ''}|${issue.fieldName ?? ''}|${issue.message}`
  if (seen.has(key)) return
  seen.add(key)
  issues.push(issue)
}

function analyzeSchemaPackages(
  manifest: ProjectManifest,
  packages: ProjectSchemaPackage[],
  builtin: SchemaBundle,
  issues: ValidationIssue[],
  seen: Set<string>,
): {
  schemas: ProjectSchemaRow[]
  schemasByNamespace: Record<string, SchemaBundle>
  packagesByPath: Map<string, ProjectSchemaPackage>
} {
  const rows: ProjectSchemaRow[] = []
  const schemasByNamespace: Record<string, SchemaBundle> = {}
  const packagesByPath = new Map<string, ProjectSchemaPackage>()
  for (const item of packages) {
    const key = item.source === 'remote' ? item.path : normalizeSchemaPath(item.path)
    if (!packagesByPath.has(key)) packagesByPath.set(key, item)
  }

  const schemaFiles: SchemaPackageFile[] = packages
    .filter((item) => item.bundle)
    .map((item) => ({ path: item.path, bundle: item.bundle! }))
  const projectLocations: Record<string, string> = {}
  const declared = isRecord(manifest.imports) ? manifest.imports : {}
  for (const [namespace, location] of Object.entries(declared)) {
    if (typeof location !== 'string') continue
    projectLocations[namespace] = location
  }

  rows.push({
    namespace: builtin.namespace,
    version: builtin.version,
    location: `builtin:${builtin.namespace}@${builtin.version}`,
    source: 'builtin',
    status: 'ok',
    hash: hashText(JSON.stringify(builtin)),
    bundle: builtin,
  })
  schemasByNamespace[builtin.namespace] = builtin

  const usedPaths = new Set<string>()
  const namespaces = new Set<string>()
  for (const [namespace, location] of Object.entries(declared)) {
    if (typeof location !== 'string') continue
    if (!/^[A-Za-z0-9._-]+$/.test(namespace)) {
      addIssue(issues, seen, {
        severity: 'error',
        code: 'project-import-namespace',
        message: `Project import namespace "${namespace}" must contain letters, numbers, dots, dashes, or underscores.`,
        sourcePath: '/project.json',
      })
    }
    if (namespaces.has(namespace)) {
      addIssue(issues, seen, {
        severity: 'error',
        code: 'project-import-duplicate',
        message: `Project import namespace "${namespace}" is declared more than once.`,
        sourcePath: '/project.json',
      })
      continue
    }
    namespaces.add(namespace)
    const parsed = parseImportLocation(location)
    if (parsed.kind === 'invalid') {
      rows.push({
        namespace,
        version: '',
        location,
        source: 'local',
        status: 'invalid',
      })
      addIssue(issues, seen, {
        severity: 'error',
        code: 'project-import-location',
        message: `Project import "${namespace}": ${parsed.message}`,
        sourcePath: '/project.json',
      })
      continue
    }
    if (parsed.kind === 'builtin') {
      if (parsed.namespace !== namespace) {
        addIssue(issues, seen, {
          severity: 'error',
          code: 'project-import-namespace',
          message: `Project import "${namespace}" points at builtin namespace "${parsed.namespace}".`,
          sourcePath: '/project.json',
        })
      }
      if (parsed.namespace !== builtin.namespace) {
        addIssue(issues, seen, {
          severity: 'error',
          code: 'project-builtin',
          message: `Builtin schema "${parsed.namespace}" is not supported by this Tenon build.`,
          sourcePath: '/project.json',
        })
      } else if (parsed.version !== builtin.version) {
        addIssue(issues, seen, {
          severity: 'error',
          code: 'project-builtin-version',
          message: `Project selects builtin "${parsed.namespace}@${parsed.version}", but the plugin ships ${builtin.version}.`,
          sourcePath: '/project.json',
        })
      }
      if (namespace === builtin.namespace) {
        rows[0] = {
          namespace,
          version: parsed.version,
          location,
          source: 'builtin',
          status: parsed.version === builtin.version ? 'ok' : 'invalid',
          hash: rows[0].hash,
          bundle: builtin,
        }
      }
      continue
    }
    const path = parsed.kind === 'remote' ? parsed.url : parsed.path
    const item = packagesByPath.get(path)
    usedPaths.add(path)
    if (!item) {
      rows.push({
        namespace,
        version: '',
        location,
        path,
        source: parsed.kind,
        status: 'missing',
      })
      addIssue(issues, seen, {
        severity: 'error',
        code: 'project-import-missing',
        message: `Project import "${namespace}" points at "${location}", which is not available.`,
        sourcePath: '/project.json',
      })
      continue
    }
    if (item.error || !item.bundle) {
      rows.push({
        namespace,
        version: '',
        location,
        path: item.path,
        source: item.source,
        hash: item.hash ?? hashText(item.text),
        status: 'invalid',
      })
      addIssue(issues, seen, {
        severity: 'error',
        code: 'schema-load',
        message: `${item.path}: ${item.error ?? 'The schema could not be parsed.'}`,
        sourcePath: item.path,
      })
      continue
    }
    if (item.bundle.namespace !== namespace) {
      addIssue(issues, seen, {
        severity: 'error',
        code: 'project-import-bundle',
        message: `Project import "${namespace}" resolved to "${item.bundle.namespace}" in ${item.path}.`,
        sourcePath: item.path,
      })
    }
    if (schemasByNamespace[item.bundle.namespace]) {
      addIssue(issues, seen, {
        severity: 'error',
        code: 'duplicate-schema-namespace',
        message: `Schema namespace "${item.bundle.namespace}" is provided by more than one bundle.`,
        sourcePath: item.path,
      })
    } else {
      schemasByNamespace[item.bundle.namespace] = item.bundle
    }
    rows.push({
      namespace,
      version: item.bundle.version,
      location,
      path: item.path,
      source: item.source,
      hash: item.hash ?? hashText(item.text),
      status: item.bundle.namespace === namespace ? 'ok' : 'invalid',
      bundle: item.bundle,
    })
  }

  for (const item of packages) {
    const key = item.source === 'remote' ? item.path : normalizeSchemaPath(item.path)
    if (usedPaths.has(key) || !item.bundle) continue
    if (item.bundle.namespace === builtin.namespace) {
      addIssue(issues, seen, {
        severity: 'error',
        code: 'project-builtin-override',
        message: `${item.path} uses the reserved builtin namespace "${builtin.namespace}".`,
        sourcePath: item.path,
      })
      continue
    }
    if (schemasByNamespace[item.bundle.namespace]) {
      addIssue(issues, seen, {
        severity: 'warning',
        code: 'unmapped-schema',
        message: `${item.bundle.namespace}@${item.bundle.version} in ${item.path} is not in the project import map.`,
        sourcePath: item.path,
      })
      continue
    }
    schemasByNamespace[item.bundle.namespace] = item.bundle
    rows.push({
      namespace: item.bundle.namespace,
      version: item.bundle.version,
      location: item.path,
      path: item.path,
      source: item.source,
      hash: item.hash ?? hashText(item.text),
      status: 'unmapped',
      bundle: item.bundle,
    })
    addIssue(issues, seen, {
      severity: 'warning',
      code: 'unmapped-schema',
      message: `${item.bundle.namespace}@${item.bundle.version} in ${item.path} is not in the project import map.`,
      sourcePath: item.path,
    })
  }

  for (const item of packages) {
    if (!item.bundle) continue
    for (const namespace of Object.keys(item.bundle.imports ?? {})) {
      if (namespace === builtin.namespace) continue
      if (!declared[namespace]) {
        addIssue(issues, seen, {
          severity: 'error',
          code: 'unmapped-import',
          message: `${item.bundle.namespace}@${item.bundle.version} imports "${namespace}", but the project import map does not provide it.`,
          sourcePath: item.path,
        })
      }
    }
    const resolved = resolveSchemaImports(item.bundle, schemaFiles, projectLocations)
    for (const issue of resolved.issues) {
      addIssue(issues, seen, { ...issue, sourcePath: item.path })
    }
    const validation = validateSchema(item.bundle, builtin, resolved.bundles)
    for (const issue of validation.issues) {
      addIssue(issues, seen, { ...issue, sourcePath: item.path })
    }
  }

  return { schemas: rows, schemasByNamespace, packagesByPath }
}

export function analyzeProject(
  manifest: ProjectManifest,
  packages: ProjectSchemaPackage[],
  scenePackages: ProjectScenePackage[],
  builtin: SchemaBundle,
  assets?: string[],
): ProjectAnalysis {
  const issues: ValidationIssue[] = []
  const seen = new Set<string>()
  const schemaAnalysis = analyzeSchemaPackages(manifest, packages, builtin, issues, seen)
  const manifestImports = isRecord(manifest.imports) ? manifest.imports : {}
  const scenesByPath: Record<string, SceneDocument> = {}

  const context: SceneValidationContext = {
    builtin,
    schemas: { ...schemaAnalysis.schemasByNamespace },
    scenes: {},
    ...(assets === undefined ? {} : { assets }),
  }
  delete context.schemas[builtin.namespace]

  for (const scenePackage of scenePackages) {
    const key = normalizeScenePath(scenePackage.path)
    if (scenePackage.error || !scenePackage.scene) {
      addIssue(issues, seen, {
        severity: 'error',
        code: 'scene-load',
        message: `${scenePackage.path}: ${scenePackage.error ?? 'The scene could not be parsed.'}`,
        sourcePath: scenePackage.path,
        scenePath: key,
      })
      continue
    }
    scenesByPath[key] = scenePackage.scene
    context.scenes[key] = scenePackage.scene
  }

  for (const scenePackage of scenePackages) {
    if (!scenePackage.scene) continue
    const key = normalizeScenePath(scenePackage.path)
    const requirements = normalizeRequires(scenePackage.scene).requirements
    for (const [namespace, version] of Object.entries(requirements)) {
      if (namespace === builtin.namespace) continue
      if (!manifestImports[namespace]) {
        addIssue(issues, seen, {
          severity: 'error',
          code: 'project-scene-import',
          message: `${scenePackage.path} requires "${namespace}@${version}", but project.json does not map "${namespace}".`,
          sourcePath: '/project.json',
          scenePath: key,
        })
      }
    }
    const validation = validateScene(scenePackage.scene, context, key)
    for (const issue of validation.issues) {
      addIssue(issues, seen, {
        ...issue,
        sourcePath: scenePackage.path,
        scenePath: key,
      })
    }
  }

  const errors = issues.filter((issue) => issue.severity === 'error').length
  const warnings = issues.length - errors
  return {
    manifest,
    schemas: schemaAnalysis.schemas,
    schemasByNamespace: schemaAnalysis.schemasByNamespace,
    scenesByPath,
    issues,
    errors,
    warnings,
    ready: errors === 0,
  }
}

export function projectValidationResult(analysis: ProjectAnalysis): ValidationResult {
  return {
    issues: analysis.issues,
    errors: analysis.errors,
    warnings: analysis.warnings,
  }
}

export function projectBuildCommand(levelPath: string): string {
  return `tenon build ${normalizeScenePath(levelPath).replace(/^\/+/, '')}`
}

export function sceneDocumentPath(sceneId: string): string {
  return `/scenes/${sceneId}.scene.json`
}
