import { builtinBundle, type SchemaBundle } from '../core/schema'
import {
  bundleForNamespace,
  displayScenePath,
  ensureSceneRequirement,
  normalizeScenePath,
  type SceneDocument,
  type SceneValidationContext,
} from '../core/scene'
import type { LoadedWorkspace } from '../core/workspace'

export function schemaFromWorkspace(workspace: LoadedWorkspace): Record<string, SchemaBundle> {
  const schemas: Record<string, SchemaBundle> = {}
  for (const item of workspace.schemaPackages) {
    if (!item.bundle) continue
    if (item.bundle.namespace === 'basic3d') continue
    if (!schemas[item.bundle.namespace]) schemas[item.bundle.namespace] = item.bundle
  }
  return schemas
}

export function sceneFromWorkspace(workspace: LoadedWorkspace): Record<string, SceneDocument> {
  const scenes: Record<string, SceneDocument> = {}
  for (const item of workspace.scenePackages) {
    if (!item.scene) continue
    scenes[normalizeScenePath(item.path)] = item.scene
  }
  return scenes
}

export function sceneValidationContext(
  workspace: LoadedWorkspace,
  currentDoc: SceneDocument,
  currentPath: string,
): SceneValidationContext {
  return {
    builtin: builtinBundle(),
    schemas: schemaFromWorkspace(workspace),
    scenes: {
      ...sceneFromWorkspace(workspace),
      [normalizeScenePath(currentPath)]: currentDoc,
    },
    ...(workspace.assetsKnown ? { assets: workspace.assets } : {}),
  }
}

export function concreteDefinitions(
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

export function sceneOptions(
  workspace: LoadedWorkspace,
  currentPath: string,
): Array<{ path: string; label: string }> {
  return workspace.scenePackages
    .filter((item) => item.scene)
    .map((item) => normalizeScenePath(item.path))
    .filter((path) => path !== normalizeScenePath(currentPath) && !path.startsWith('/levels/'))
    .sort((a, b) => a.localeCompare(b))
    .map((path) => ({ path, label: displayScenePath(path) }))
}

export function withTypeRequirement(
  scene: SceneDocument,
  type: string,
  context: SceneValidationContext,
): SceneDocument {
  const namespace = type.split(':')[0]
  const bundle = namespace ? bundleForNamespace(namespace, context) : null
  return bundle ? ensureSceneRequirement(scene, namespace, bundle.version) : scene
}

export function isSceneEditorPath(path: string): boolean {
  const normalized = normalizeScenePath(path)
  return (
    (normalized.startsWith('/scenes/') || normalized.startsWith('/levels/')) &&
    normalized.endsWith('.scene.json')
  )
}
