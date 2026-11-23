import { connectBrowserPlugin } from '@exo/plugin-sdk/browser'
import { followTheme } from '@exo/plugin-sdk/theme'
import '@exo/plugin-sdk/theme.css'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { parseSchemaText } from '../core/schema'
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

  createRoot(rootElement).render(
    <StrictMode>
      <SchemaEditor client={editor} initialDoc={initialDoc} canWrite={canWrite} />
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
