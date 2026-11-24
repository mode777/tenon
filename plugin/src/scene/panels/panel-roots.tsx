import type { ViewClient } from '@exo/plugin-sdk'
import type { LoadedWorkspace } from '../../core/workspace'
import { sceneValidationContext, isSceneEditorPath } from '../scene-workspace'
import { InspectionPanel } from './InspectionPanel'
import { InspectorPanel } from './InspectorPanel'
import { useScenePanel } from './useScenePanel'

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

export function InspectorPanelRoot({
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
        <InspectorPanel
          key={panel.snapshot.path}
          doc={panel.snapshot.doc}
          selection={panel.snapshot.selection}
          path={panel.snapshot.path}
          context={context}
          workspace={workspace}
          canWrite={panel.snapshot.canWrite}
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
