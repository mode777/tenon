import type { ViewClient } from '@exo/plugin-sdk'
import { connectBrowserPlugin } from '@exo/plugin-sdk/browser'
import { followTheme } from '@exo/plugin-sdk/theme'
import '@exo/plugin-sdk/theme.css'
import { StrictMode, type ComponentType } from 'react'
import { createRoot } from 'react-dom/client'
import { loadWorkspace, type LoadedWorkspace } from '../../core/workspace'
import '../scene.css'

export interface TenonPanelProps {
  view: ViewClient
  workspace: LoadedWorkspace
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

function showBootError(root: HTMLElement, message: string): void {
  root.innerHTML = `
    <main class="scene-boot-error">
      <div class="scene-boot-mark">T</div>
      <p class="scene-boot-eyebrow">Tenon scene panel</p>
      <h1>Could not start this panel</h1>
      <p class="scene-boot-message">${escapeHtml(message)}</p>
      <p class="scene-boot-hint">Reload the panel from the Exo shell. Tenon does not write workspace files from a panel.</p>
    </main>
  `
}

function PanelBootLoading() {
  return (
    <div className="scene-panel-frame">
      <div className="scene-panel-empty" role="status">
        <div className="scene-panel-empty-mark" aria-hidden="true">
          T
        </div>
        <h2>Loading the Tenon workspace</h2>
        <p>Reading the project, schemas, scenes, and assets.</p>
      </div>
    </div>
  )
}

export async function mountTenonPanel(
  Component: ComponentType<TenonPanelProps>,
): Promise<void> {
  const rootElement = document.getElementById('root')
  if (!rootElement) throw new Error('Missing #root.')

  const connection = await connectBrowserPlugin()
  if (connection.mode !== 'view') {
    throw new Error('A Tenon scene panel must be mounted in view mode.')
  }

  const view = connection.view
  const root = createRoot(rootElement)
  root.render(
    <StrictMode>
      <PanelBootLoading />
    </StrictMode>,
  )

  await followTheme(view)
  view.onError((error) => {
    console.error('TENON_PANEL_SHELL_ERROR', error)
  })

  let workspace: LoadedWorkspace
  try {
    workspace = await loadWorkspace(view)
  } catch (error) {
    showBootError(
      rootElement,
      error instanceof Error ? error.message : String(error),
    )
    return
  }

  root.render(
    <StrictMode>
      <Component view={view} workspace={workspace} />
    </StrictMode>,
  )
}
