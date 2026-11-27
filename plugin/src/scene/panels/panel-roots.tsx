import type { ViewClient } from '@exo/plugin-sdk'
import { useCallback, useRef, useState } from 'react'
import { loadWorkspace, type LoadedWorkspace } from '../../core/workspace'
import { sceneValidationContext, isSceneEditorPath } from '../scene-workspace'
import { HierarchyPanel } from './HierarchyPanel'
import { InspectionPanel } from './InspectionPanel'
import { InspectorPanel } from './InspectorPanel'
import { useScenePanel } from './useScenePanel'

function useRefreshableWorkspace(view: ViewClient, initial: LoadedWorkspace) {
  const [workspace, setWorkspace] = useState(initial)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const busy = useRef(false)
  const refresh = useCallback(() => {
    if (busy.current) return
    busy.current = true
    setRefreshing(true)
    setError(null)
    void loadWorkspace(view)
      .then((next) => setWorkspace(next))
      .catch((cause: unknown) =>
        setError(cause instanceof Error ? cause.message : String(cause)),
      )
      .finally(() => {
        busy.current = false
        setRefreshing(false)
      })
  }, [view])
  return { workspace, refresh, refreshing, error, clearError: () => setError(null) }
}

function PanelError({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  return (
    <div className="scene-banner danger scene-panel-error" role="alert">
      <span>{message}</span>
      <button type="button" className="link-button" onClick={onDismiss}>
        Dismiss
      </button>
    </div>
  )
}

function PanelEmpty({ activePath }: { activePath?: string }) {
  return (
    <div className="scene-panel-empty">
      <div className="scene-panel-empty-mark" aria-hidden="true">
        T
      </div>
      <h2>No scene selected</h2>
      <p>
        {activePath
          ? 'The active editor is not a scene or level. Open a scene or level to inspect it.'
          : 'Open a scene or level to inspect it. This panel follows the active Tenon scene editor.'}
      </p>
    </div>
  )
}

function PanelLoading() {
  return (
    <div className="scene-panel-empty" role="status">
      <div className="scene-panel-empty-mark" aria-hidden="true">
        T
      </div>
      <h2>Waiting for the scene editor</h2>
      <p>The panel is requesting the active scene state.</p>
    </div>
  )
}

export function HierarchyPanelRoot({
  view,
  workspace: initialWorkspace,
}: {
  view: ViewClient
  workspace: LoadedWorkspace
}) {
  const { workspace, refresh, refreshing, error, clearError } = useRefreshableWorkspace(
    view,
    initialWorkspace,
  )
  const panel = useScenePanel(view)
  const editor = panel.activeEditor
  const isScene = editor ? isSceneEditorPath(editor.path) : false
  const context =
    panel.snapshot && isScene
      ? sceneValidationContext(workspace, panel.snapshot.doc, panel.snapshot.path)
      : null
  const refreshAll = useCallback(() => {
    refresh()
    panel.sendIntent({ type: 'refresh-workspace' })
  }, [panel, refresh])

  return (
    <div className="scene-panel-frame">
      {panel.error && <PanelError message={panel.error} onDismiss={panel.clearError} />}
      {error && <PanelError message={error} onDismiss={clearError} />}
      {!isScene ? (
        <PanelEmpty activePath={editor?.path} />
      ) : panel.snapshot && context ? (
        <HierarchyPanel
          key={panel.snapshot.path}
          doc={panel.snapshot.doc}
          path={panel.snapshot.path}
          selection={panel.snapshot.selection}
          context={context}
          workspace={workspace}
          canWrite={panel.snapshot.canWrite}
          refreshing={refreshing}
          onRefresh={refreshAll}
          onCommand={panel.sendCommand}
          onIntent={panel.sendIntent}
        />
      ) : (
        <PanelLoading />
      )}
    </div>
  )
}

export function InspectorPanelRoot({
  view,
  workspace: initialWorkspace,
}: {
  view: ViewClient
  workspace: LoadedWorkspace
}) {
  const { workspace, refresh, refreshing, error, clearError } = useRefreshableWorkspace(
    view,
    initialWorkspace,
  )
  const panel = useScenePanel(view)
  const editor = panel.activeEditor
  const isScene = editor ? isSceneEditorPath(editor.path) : false
  const context =
    panel.snapshot && isScene
      ? sceneValidationContext(workspace, panel.snapshot.doc, panel.snapshot.path)
      : null

  return (
    <div className="scene-panel-frame">
      {panel.error && <PanelError message={panel.error} onDismiss={panel.clearError} />}
      {error && <PanelError message={error} onDismiss={clearError} />}
      {!isScene ? (
        <PanelEmpty activePath={editor?.path} />
      ) : panel.snapshot && context ? (
        <InspectorPanel
          key={panel.snapshot.path}
          doc={panel.snapshot.doc}
          selection={panel.snapshot.selection}
          path={panel.snapshot.path}
          context={context}
          workspace={workspace}
          canWrite={panel.snapshot.canWrite}
          refreshing={refreshing}
          onRefresh={refresh}
          onSelect={(entityId) => panel.sendCommand({ type: 'select', entityId })}
          onCommand={panel.sendCommand}
        />
      ) : (
        <PanelLoading />
      )}
    </div>
  )
}

export function InspectionPanelRoot({
  view,
  workspace,
}: {
  view: ViewClient
  workspace: LoadedWorkspace
}) {
  const panel = useScenePanel(view)
  const editor = panel.activeEditor
  const isScene = editor ? isSceneEditorPath(editor.path) : false
  const context =
    panel.snapshot && isScene
      ? sceneValidationContext(workspace, panel.snapshot.doc, panel.snapshot.path)
      : null

  return (
    <div className="scene-panel-frame">
      {panel.error && <PanelError message={panel.error} onDismiss={panel.clearError} />}
      {!isScene ? (
        <PanelEmpty activePath={editor?.path} />
      ) : panel.snapshot && context ? (
        <InspectionPanel
          key={panel.snapshot.path}
          doc={panel.snapshot.doc}
          path={panel.snapshot.path}
          context={context}
          workspace={workspace}
          canWrite={panel.snapshot.canWrite}
          focusTab={panel.focusTab}
          onFocusTabHandled={panel.clearFocusTab}
          onSelect={(entityId) => panel.sendCommand({ type: 'select', entityId })}
          onCommand={panel.sendCommand}
        />
      ) : (
        <PanelLoading />
      )}
    </div>
  )
}
