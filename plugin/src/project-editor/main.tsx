import type { EditorClient } from '@exo/plugin-sdk'
import { connectBrowserPlugin } from '@exo/plugin-sdk/browser'
import { followTheme } from '@exo/plugin-sdk/theme'
import '@exo/plugin-sdk/theme.css'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { parseProjectText, type ProjectManifest } from '../core/project'
import { loadWorkspace } from '../core/workspace'
import { ProjectEditor } from './ProjectEditor'
import './project-editor.css'

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

function showBootError(root: HTMLElement, message: string): void {
  root.innerHTML = `
    <main class="project-editor-boot">
      <div class="project-editor-boot-mark">T</div>
      <p class="project-editor-eyebrow">Tenon project editor</p>
      <h1>Could not open project.json</h1>
      <p class="project-editor-boot-message">${escapeHtml(message)}</p>
      <p class="project-editor-hint">Fix the manifest in a text editor, then reopen it.</p>
    </main>
  `
}

async function main(): Promise<void> {
  const rootElement = document.getElementById('root')
  if (!rootElement) throw new Error('Missing #root.')

  const connection = await connectBrowserPlugin()
  if (connection.mode !== 'editor') {
    throw new Error('The Tenon project editor must be mounted in editor mode.')
  }

  const editor = connection.editor
  await followTheme(editor)
  editor.onError((error) => {
    console.error('TENON_PROJECT_EDITOR_SHELL_ERROR', error)
  })

  let manifest: ProjectManifest
  let text: string
  try {
    const content = await editor.readFile(editor.file.path, 'utf8')
    text = content.text
    manifest = parseProjectText(text)
  } catch (error) {
    showBootError(rootElement, error instanceof Error ? error.message : String(error))
    return
  }

  const canWrite =
    editor.capabilities.write &&
    editor.initialization.permissions.includes('workspace:write')
  const workspace = await loadWorkspace(editor)

  createRoot(rootElement).render(
    <StrictMode>
      <ProjectEditor
        client={editor}
        initialManifest={manifest}
        canWrite={canWrite}
        workspace={workspace}
      />
    </StrictMode>,
  )
}

main().catch((error: unknown) => {
  const root = document.getElementById('root')
  if (root) showBootError(root, error instanceof Error ? error.message : String(error))
  console.error('TENON_PROJECT_EDITOR_BOOT_ERROR', error)
})
