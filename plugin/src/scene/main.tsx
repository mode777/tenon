import type { EditorClient } from '@exo/plugin-sdk'
import { connectBrowserPlugin } from '@exo/plugin-sdk/browser'
import { followTheme } from '@exo/plugin-sdk/theme'
import '@exo/plugin-sdk/theme.css'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { normalizeScenePath, parseSceneText, type SceneDocument } from '../core/scene'
import { loadWorkspace } from '../core/workspace'
import { SceneEditor } from './SceneEditor'
import { SceneViewport } from './Viewport'
import './scene.css'

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

function showBootError(root: HTMLElement, message: string, path?: string): void {
  root.innerHTML = `
    <main class="scene-boot-error">
      <div class="scene-boot-mark">T</div>
      <p class="scene-boot-eyebrow">Tenon scene editor</p>
      <h1>Could not open this scene</h1>
      <p class="scene-boot-message">${escapeHtml(message)}</p>
      ${path ? `<code class="scene-boot-path">${escapeHtml(path)}</code>` : ''}
      <p class="scene-boot-hint">Fix the file in a text editor, then reopen it. Tenon never silently rewrites an invalid scene.</p>
    </main>
  `
}

async function readScene(editor: EditorClient): Promise<SceneDocument> {
  const content = await editor.readFile(editor.file.path, 'utf8')
  return parseSceneText(content.text)
}

async function main(): Promise<void> {
  const rootElement = document.getElementById('root')
  if (!rootElement) throw new Error('Missing #root.')

  const connection = await connectBrowserPlugin()
  if (connection.mode !== 'editor') {
    throw new Error('The Tenon scene editor must be mounted in editor mode.')
  }

  const editor = connection.editor
  await followTheme(editor)

  editor.onError((error) => {
    console.error('TENON_SCENE_SHELL_ERROR', error)
  })

  let initialDoc: SceneDocument
  try {
    initialDoc = await readScene(editor)
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
  const scenePath = normalizeScenePath(editor.file.path)
  const levelMode = scenePath.startsWith('/levels/')

  const workspace = await loadWorkspace(editor)

  createRoot(rootElement).render(
    <StrictMode>
      <SceneEditor
        client={editor}
        initialDoc={initialDoc}
        scenePath={scenePath}
        levelMode={levelMode}
        canWrite={canWrite}
        workspace={workspace}
        Viewport={SceneViewport}
      />
    </StrictMode>,
  )
}

main().catch((error: unknown) => {
  const root = document.getElementById('root')
  if (root) {
    showBootError(root, error instanceof Error ? error.message : String(error))
  }
  console.error('TENON_SCENE_BOOT_ERROR', error)
})
