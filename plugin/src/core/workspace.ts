import { ExoProtocolError } from '@exo/plugin-sdk'
import { hashText, parseImportLocation, parseProjectText, type ProjectManifest, type ProjectScenePackage, type ProjectSchemaPackage } from './project'
import { parseSchemaText, normalizeSchemaPath, type ValidationIssue } from './schema'
import { normalizeScenePath, parseSceneText } from './scene'

export interface WorkspaceDirectoryEntry {
  path: string
  kind: 'file' | 'directory'
  size?: number
}

export interface WorkspaceDirectoryPage {
  entries: WorkspaceDirectoryEntry[]
  nextCursor?: string
}

export interface WorkspaceClient {
  capabilities: { directoryListing: boolean }
  readFile(path: string, encoding?: 'utf8'): Promise<{ text: string }>
  listDirectory(path: string, options?: { cursor?: string }): Promise<WorkspaceDirectoryPage>
}

export interface LoadedWorkspace {
  manifest: ProjectManifest | null
  manifestText: string | null
  manifestError: string | null
  schemaPackages: ProjectSchemaPackage[]
  scenePackages: ProjectScenePackage[]
  assets: string[]
  assetsKnown: boolean
  issues: ValidationIssue[]
}

function messageOf(error: unknown): string {
  if (error instanceof ExoProtocolError) return `${error.code}: ${error.message}`
  return error instanceof Error ? error.message : String(error)
}

function isNotFound(error: unknown): boolean {
  return error instanceof ExoProtocolError && error.code === 'not-found'
}

async function readText(client: WorkspaceClient, path: string): Promise<string> {
  const content = await client.readFile(path, 'utf8')
  return content.text
}

async function listTree(
  client: WorkspaceClient,
  root: string,
  issues: ValidationIssue[],
): Promise<WorkspaceDirectoryEntry[]> {
  if (!client.capabilities.directoryListing) return []
  const files: WorkspaceDirectoryEntry[] = []
  const queue = [root]
  const seen = new Set<string>()
  while (queue.length > 0) {
    const directory = queue.shift()!
    if (seen.has(directory)) continue
    seen.add(directory)
    try {
      let cursor: string | undefined
      do {
        const page = await client.listDirectory(directory, cursor ? { cursor } : {})
        for (const entry of page.entries) {
          if (entry.kind === 'directory') {
            queue.push(entry.path)
          } else {
            files.push(entry)
          }
        }
        cursor = page.nextCursor
      } while (cursor)
    } catch (error) {
      if (!isNotFound(error)) {
        issues.push({
          severity: 'warning',
          code: 'workspace-list',
          message: `Could not list ${directory}: ${messageOf(error)}`,
          sourcePath: directory,
        })
      }
    }
  }
  return files
}

async function remoteText(url: string): Promise<string> {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`)
  return response.text()
}

async function loadRemotePackage(url: string): Promise<ProjectSchemaPackage> {
  try {
    const text = await remoteText(url)
    const hash = hashText(text)
    try {
      const bundle = parseSchemaText(text)
      return { path: url, source: 'remote', text, hash, bundle }
    } catch (error) {
      return { path: url, source: 'remote', text, hash, error: messageOf(error) }
    }
  } catch (error) {
    return { path: url, source: 'remote', text: '', error: messageOf(error) }
  }
}

export async function loadWorkspace(client: WorkspaceClient): Promise<LoadedWorkspace> {
  const issues: ValidationIssue[] = []
  let manifest: ProjectManifest | null = null
  let manifestText: string | null = null
  let manifestError: string | null = null

  try {
    manifestText = await readText(client, '/project.json')
    try {
      manifest = parseProjectText(manifestText)
    } catch (error) {
      manifestError = messageOf(error)
    }
  } catch (error) {
    if (!isNotFound(error)) {
      manifestError = messageOf(error)
    }
  }

  const schemaPaths = new Set<string>()
  for (const entry of await listTree(client, '/schemas', issues)) {
    if (entry.path.endsWith('.schema.json')) schemaPaths.add(normalizeSchemaPath(entry.path))
  }
  const remoteLocations = new Set<string>()
  for (const location of Object.values(manifest?.imports ?? {})) {
    if (typeof location !== 'string') continue
    const parsed = parseImportLocation(location)
    if (parsed.kind === 'local') schemaPaths.add(parsed.path)
    if (parsed.kind === 'remote') remoteLocations.add(parsed.url)
  }

  const schemaPackages: ProjectSchemaPackage[] = []
  const loadedPaths = new Set<string>()
  for (const path of [...schemaPaths].sort((a, b) => a.localeCompare(b))) {
    if (loadedPaths.has(path)) continue
    loadedPaths.add(path)
    try {
      const text = await readText(client, path)
      const hash = hashText(text)
      try {
        schemaPackages.push({
          path,
          source: 'local',
          text,
          hash,
          bundle: parseSchemaText(text),
        })
      } catch (error) {
        schemaPackages.push({ path, source: 'local', text, hash, error: messageOf(error) })
      }
    } catch (error) {
      schemaPackages.push({
        path,
        source: 'local',
        text: '',
        error: messageOf(error),
      })
    }
  }
  for (const url of [...remoteLocations].sort((a, b) => a.localeCompare(b))) {
    if (loadedPaths.has(url)) continue
    loadedPaths.add(url)
    schemaPackages.push(await loadRemotePackage(url))
  }

  const scenePackages: ProjectScenePackage[] = []
  const scenePaths: string[] = []
  for (const root of ['/scenes', '/levels']) {
    for (const entry of await listTree(client, root, issues)) {
      if (entry.path.endsWith('.scene.json')) scenePaths.push(entry.path)
    }
  }
  for (const path of [...new Set(scenePaths)].sort((a, b) => a.localeCompare(b))) {
    try {
      const text = await readText(client, path)
      const hash = hashText(text)
      try {
        scenePackages.push({
          path: normalizeScenePath(path),
          text,
          hash,
          scene: parseSceneText(text),
        })
      } catch (error) {
        scenePackages.push({
          path: normalizeScenePath(path),
          text,
          hash,
          error: messageOf(error),
        })
      }
    } catch (error) {
      scenePackages.push({
        path: normalizeScenePath(path),
        text: '',
        error: messageOf(error),
      })
    }
  }

  const assets = (await listTree(client, '/assets', issues))
    .map((entry) => normalizeScenePath(entry.path))
    .sort((a, b) => a.localeCompare(b))

  return {
    manifest,
    manifestText,
    manifestError,
    schemaPackages,
    scenePackages,
    assets,
    assetsKnown: client.capabilities.directoryListing,
    issues,
  }
}

export function workspaceSchemaPaths(workspace: LoadedWorkspace): string[] {
  return workspace.schemaPackages.map((item) => item.path)
}

export function workspaceScenePaths(workspace: LoadedWorkspace): string[] {
  return workspace.scenePackages.map((item) => item.path)
}
