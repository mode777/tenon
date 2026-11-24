import type { EditorClient } from '@exo/plugin-sdk'
import { connectBrowserPlugin } from '@exo/plugin-sdk/browser'
import { followTheme } from '@exo/plugin-sdk/theme'
import '@exo/plugin-sdk/theme.css'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import {
  normalizeSchemaPath,
  parseSchemaText,
  type SchemaPackageFile,
  type SchemaPackageIssue,
} from '../core/schema'
import { SchemaEditor } from './SchemaEditor'
import './schema.css'

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

function showBootError(root: HTMLElement, message: string, path?: string): void {
  root.innerHTML = `
    <main class="boot-error">
      <div class="boot-mark">T</div>
      <p class="eyebrow">Tenon schema editor</p>
      <h1>Could not open this schema</h1>
      <p class="boot-message">${escapeHtml(message)}</p>
      ${path ? `<code class="boot-path">${escapeHtml(path)}</code>` : ''}
      <p class="muted-copy">Fix the file in a text editor, then reopen it. Tenon never silently rewrites an invalid schema.</p>
    </main>
  `
}

function parseProjectImports(text: string): Record<string, string> {
  try {
    const value = JSON.parse(text) as unknown
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return {}
    const imports = (value as { imports?: unknown }).imports
    if (typeof imports !== 'object' || imports === null || Array.isArray(imports)) return {}
    return Object.fromEntries(
      Object.entries(imports).filter(
        (entry): entry is [string, string] => typeof entry[1] === 'string',
      ),
    )
  } catch {
    return {}
  }
}

async function readPackageText(editor: EditorClient, path: string): Promise<string> {
  if (/^https?:\/\//.test(path)) {
    const response = await fetch(path)
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    return response.text()
  }
  const content = await editor.readFile(path, 'utf8')
  return content.text
}

async function loadSchemas(editor: EditorClient, currentNamespace: string): Promise<{
  packages: SchemaPackageFile[]
  issues: SchemaPackageIssue[]
  projectImports: Record<string, string>
}> {
  let projectImports: Record<string, string> = {}
  try {
    const project = await editor.readFile('/project.json', 'utf8')
    projectImports = parseProjectImports(project.text)
  } catch {
    // A project without project.json still opens; imports resolve by workspace scan.
  }

  const paths = new Set<string>()
  const expectedPaths = new Set<string>()
  for (const location of Object.values(projectImports)) {
    if (location.startsWith('builtin:')) continue
    const path = /^https?:\/\//.test(location) ? location : normalizeSchemaPath(location)
    paths.add(path)
    expectedPaths.add(path)
  }
  if (editor.capabilities.directoryListing) {
    try {
      let cursor: string | undefined
      do {
        const page = await editor.listDirectory('/schemas', cursor ? { cursor } : {})
        for (const entry of page.entries) {
          if (entry.kind === 'file' && entry.path.endsWith('.schema.json')) {
            paths.add(entry.path)
          }
        }
        cursor = page.nextCursor
      } while (cursor)
    } catch {
      // The project import map still supplies explicit packages.
    }
  }

  const currentPath = normalizeSchemaPath(editor.file.path)
  const packages: SchemaPackageFile[] = []
  const issues: SchemaPackageIssue[] = []
  const seen = new Set<string>()
  for (const path of [...paths].sort((a, b) => a.localeCompare(b))) {
    const key = /^https?:\/\//.test(path) ? path : normalizeSchemaPath(path)
    if (key === currentPath || seen.has(key)) continue
    seen.add(key)
    try {
      const bundle = parseSchemaText(await readPackageText(editor, path))
      if (bundle.namespace === currentNamespace) continue
      packages.push({ path, bundle })
    } catch (error) {
      if (expectedPaths.has(key)) {
        issues.push({
          path,
          message: error instanceof Error ? error.message : String(error),
        })
      }
    }
  }
  return { packages, issues, projectImports }
}

async function main(): Promise<void> {
  const rootElement = document.getElementById('root')
  if (!rootElement) throw new Error('Missing #root.')

  const connection = await connectBrowserPlugin()
  if (connection.mode !== 'editor') {
    throw new Error('The Tenon schema editor must be mounted in editor mode.')
  }

  const editor = connection.editor
  await followTheme(editor)

  editor.onError((error) => {
    console.error('TENON_SCHEMA_SHELL_ERROR', error)
  })

  let text: string
  try {
    const content = await editor.readFile(editor.file.path, 'utf8')
    text = content.text
  } catch (error) {
    showBootError(
      rootElement,
      error instanceof Error ? error.message : String(error),
      editor.file.path,
    )
    return
  }

  let initialDoc
  try {
    initialDoc = parseSchemaText(text)
  } catch (error) {
    showBootError(
      rootElement,
      error instanceof Error ? error.message : String(error),
      editor.file.path,
    )
    return
  }

  const canWrite =
    editor.capabilities.write &&
    editor.initialization.permissions.includes('workspace:write')

  const workspace = await loadSchemas(editor, initialDoc.namespace)

  createRoot(rootElement).render(
    <StrictMode>
      <SchemaEditor
        client={editor}
        initialDoc={initialDoc}
        canWrite={canWrite}
        packages={workspace.packages}
        packageIssues={workspace.issues}
        projectImports={workspace.projectImports}
      />
    </StrictMode>,
  )
}

main().catch((error: unknown) => {
  const root = document.getElementById('root')
  if (root) {
    showBootError(root, error instanceof Error ? error.message : String(error))
  }
  console.error('TENON_SCHEMA_BOOT_ERROR', error)
})
