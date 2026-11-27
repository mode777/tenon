import type { EditorClient } from '@exo/plugin-sdk'
import { ExoProtocolError, type FileChangedPayload } from '@exo/plugin-sdk'
import { useEffect, useMemo, useRef, useState, type ComponentType } from 'react'
import { useHistory } from '../core/history'
import { cloneJson } from '../core/schema'
import {
  entityById,
  normalizeScenePath,
  parseSceneText,
  sceneFileName,
  sceneToText,
  setEntityTransform,
  validateScene,
  type SceneDocument,
} from '../core/scene'
import type { LoadedWorkspace } from '../core/workspace'
import { loadWorkspace } from '../core/workspace'
import { applySceneCommand, type SceneCommand } from './scene-commands'
import { sceneValidationContext } from './scene-workspace'
import { useScenePanelBridge } from './useScenePanelBridge'
import type { SceneViewportProps, TransformMode } from './Viewport'
import './scene.css'

interface Toast {
  kind: 'notice' | 'error'
  message: string
}

export interface SceneEditorProps {
  client: EditorClient
  initialDoc: SceneDocument
  scenePath: string
  levelMode: boolean
  canWrite: boolean
  workspace: LoadedWorkspace
  Viewport?: ComponentType<SceneViewportProps>
}

function errorMessage(error: unknown): string {
  if (error instanceof ExoProtocolError) return `${error.code}: ${error.message}`
  if (error instanceof Error) return error.message
  return String(error)
}

export function SceneEditor({
  client,
  initialDoc,
  scenePath,
  levelMode,
  canWrite,
  workspace: initialWorkspace,
  Viewport,
}: SceneEditorProps) {
  const history = useHistory(initialDoc, cloneJson)
  const doc = history.state.doc
  const [savedText, setSavedText] = useState(() => sceneToText(initialDoc))
  const [selection, setSelection] = useState<string | null>(initialDoc.root)
  const [mode, setMode] = useState<TransformMode>('translate')
  const [snap, setSnap] = useState(false)
  const [workspace, setWorkspace] = useState(initialWorkspace)
  const refreshingRef = useRef(false)
  const [toast, setToast] = useState<Toast | null>(null)
  const [external, setExternal] = useState<FileChangedPayload | null>(null)
  const [pathVersion, setPathVersion] = useState(0)
  const pathRef = useRef(normalizeScenePath(scenePath))
  const pendingSaveRef = useRef<string | null>(null)
  const docRef = useRef(doc)
  const dirtyRef = useRef(false)

  const serialized = sceneToText(doc)
  const dirty = serialized !== savedText
  docRef.current = doc
  dirtyRef.current = dirty

  const context = useMemo(
    () => sceneValidationContext(workspace, doc, pathRef.current),
    [doc, pathVersion, workspace],
  )
  const validation = useMemo(
    () => validateScene(doc, context, pathRef.current),
    [context, doc, pathVersion],
  )
  const selectedEntity = selection ? entityById(doc, selection) : undefined
  const workspaceIssues = workspace.issues
  const errorCount =
    validation.errors + workspaceIssues.filter((issue) => issue.severity === 'error').length
  const warningCount =
    validation.warnings + workspaceIssues.filter((issue) => issue.severity === 'warning').length

  const showError = (error: unknown) => {
    setToast({ kind: 'error', message: errorMessage(error) })
  }
  const showNotice = (message: string) => {
    setToast({ kind: 'notice', message })
  }

  const refreshWorkspace = async () => {
    if (refreshingRef.current) return
    refreshingRef.current = true
    try {
      setWorkspace(await loadWorkspace(client))
      showNotice('Refreshed workspace resources')
    } catch (error) {
      showError(error)
    } finally {
      refreshingRef.current = false
    }
  }

  const commit = (next: SceneDocument) => {
    history.replace(next)
  }

  useEffect(() => {
    if (!selection) return
    if (!entityById(doc, selection)) setSelection(null)
  }, [doc, selection])

  useEffect(() => {
    client.setDirty(dirty)
  }, [client, dirty])

  useEffect(() => {
    if (!toast) return
    const timer = window.setTimeout(() => setToast(null), 5000)
    return () => window.clearTimeout(timer)
  }, [toast])

  const reloadFromDisk = async (force: boolean) => {
    if (!force && dirtyRef.current) {
      setExternal({ kind: 'changed', path: pathRef.current })
      return
    }
    try {
      const content = await client.readFile(pathRef.current, 'utf8')
      const next = parseSceneText(content.text)
      history.reset(next)
      setSavedText(sceneToText(next))
      setSelection(next.root)
      setExternal(null)
      showNotice('Reloaded from disk')
    } catch (error) {
      showError(error)
    }
  }

  useEffect(() => {
    const offSave = client.onSaveRequest(() => {
      const text = sceneToText(docRef.current)
      pendingSaveRef.current = text
      return { text }
    })
    const offResult = client.onSaveResult((result) => {
      if (result.ok) {
        setSavedText(pendingSaveRef.current ?? sceneToText(docRef.current))
        pendingSaveRef.current = null
        setToast({ kind: 'notice', message: 'Saved' })
      } else {
        setToast({
          kind: 'error',
          message: `${result.code}: ${result.message ?? 'The shell could not save the scene.'}`,
        })
      }
    })
    const offChanged = client.onFileChanged((change) => {
      if (change.kind === 'renamed') {
        pathRef.current = normalizeScenePath(change.path)
        setPathVersion((value) => value + 1)
      }
      if (change.kind === 'deleted') {
        setExternal(change)
        return
      }
      if (dirtyRef.current) {
        setExternal(change)
        return
      }
      void reloadFromDisk(false)
    })
    const offError = client.onError((error) => {
      setToast({ kind: 'error', message: `${error.code}: ${error.message ?? 'Shell error'}` })
    })
    const offDispose = client.onDispose(() => {
      // The SDK acknowledges dispose; the frame is closing.
    })
    return () => {
      offSave()
      offResult()
      offChanged()
      offError()
      offDispose()
    }
    // The client is stable for the frame lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client])

  const panelBridge = useScenePanelBridge({
    client,
    doc,
    selection,
    canWrite,
    levelMode,
    scenePath: pathRef.current,
    context,
    commit,
    setSelection,
    onUndo: history.undo,
    onRedo: history.redo,
    onSave: () => client.requestSave(),
    onSetMode: setMode,
    onRefreshWorkspace: refreshWorkspace,
    onError: (message) => setToast({ kind: 'error', message }),
  })

  const applyEditorCommand = (command: SceneCommand) => {
    try {
      const result = applySceneCommand(doc, command, context)
      if (result.doc !== doc) commit(result.doc)
      if (result.selection !== undefined) setSelection(result.selection)
    } catch (error) {
      showError(error)
    }
  }

  const duplicateSelected = () => {
    if (!selectedEntity) return
    applyEditorCommand({ type: 'duplicate-entity', entityId: selectedEntity.id })
  }

  const deleteSelected = () => {
    if (!selectedEntity) return
    if (selectedEntity.id === doc.root) {
      setToast({ kind: 'error', message: 'The scene root cannot be deleted.' })
      return
    }
    applyEditorCommand({ type: 'delete-entity', entityId: selectedEntity.id })
  }

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      const editing =
        target?.tagName === 'INPUT' ||
        target?.tagName === 'TEXTAREA' ||
        target?.tagName === 'SELECT' ||
        target?.isContentEditable
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
        event.preventDefault()
        client.requestSave()
        return
      }
      if (!editing && (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault()
        if (event.shiftKey) history.redo()
        else history.undo()
        return
      }
      if (!editing && (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'y') {
        event.preventDefault()
        history.redo()
        return
      }
      if (editing || !canWrite) return
      if (event.metaKey || event.ctrlKey) {
        if (event.key.toLowerCase() === 'd') {
          event.preventDefault()
          duplicateSelected()
        }
        return
      }
      if (event.key.toLowerCase() === 'w') setMode('translate')
      if (event.key.toLowerCase() === 'e') setMode('rotate')
      if (event.key.toLowerCase() === 'r') setMode('scale')
      if (event.key === 'Delete' || event.key === 'Backspace') {
        if (selectedEntity && selectedEntity.id !== doc.root) {
          event.preventDefault()
          deleteSelected()
        }
      }
      if (event.key === 'Escape') {
        setSelection(null)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
    // The handlers intentionally track the current document and selection.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canWrite, selectedEntity, doc, client, history.canUndo, history.canRedo])

  const ViewportComponent = Viewport
  const fileName = sceneFileName(pathRef.current)
  const levelBadge = levelMode ? 'Level' : 'Scene'
  const allEntities = doc.entities

  return (
    <div className="scene-shell">
      <header className="scene-toolbar">
        <div className="scene-identity">
          <div className="scene-mark" aria-hidden="true">T</div>
          <div className="scene-identity-copy">
            <strong>{fileName}</strong>
            <span>
              {doc.id}
              <em className={`scene-kind-badge ${levelMode ? 'level' : ''}`}>{levelBadge}</em>
            </span>
          </div>
        </div>
        <div className="scene-toolbar-group">
          <button
            type="button"
            className={`button tiny ${mode === 'translate' ? 'active' : 'ghost'}`}
            title="Move (W)"
            onClick={() => setMode('translate')}
          >
            Move
          </button>
          <button
            type="button"
            className={`button tiny ${mode === 'rotate' ? 'active' : 'ghost'}`}
            title="Rotate (E)"
            onClick={() => setMode('rotate')}
          >
            Rotate
          </button>
          <button
            type="button"
            className={`button tiny ${mode === 'scale' ? 'active' : 'ghost'}`}
            title="Scale (R)"
            onClick={() => setMode('scale')}
          >
            Scale
          </button>
          <button
            type="button"
            className={`button tiny ${snap ? 'active' : 'ghost'}`}
            title="Snap transforms"
            onClick={() => setSnap((value) => !value)}
          >
            Snap
          </button>
        </div>
        <div className="scene-toolbar-group">
          <button
            type="button"
            className="button tiny ghost"
            disabled={!history.canUndo}
            onClick={history.undo}
            title="Undo (Ctrl/Cmd+Z)"
          >
            Undo
          </button>
          <button
            type="button"
            className="button tiny ghost"
            disabled={!history.canRedo}
            onClick={history.redo}
            title="Redo"
          >
            Redo
          </button>
          <button
            type="button"
            className="button tiny ghost"
            disabled={!canWrite || !selectedEntity || selectedEntity.id === doc.root}
            onClick={duplicateSelected}
            title="Duplicate (Ctrl/Cmd+D)"
          >
            Duplicate
          </button>
          <button
            type="button"
            className="button tiny danger"
            disabled={!canWrite || !selectedEntity || selectedEntity.id === doc.root}
            onClick={deleteSelected}
            title="Delete"
          >
            Delete
          </button>
        </div>
        <div className="scene-toolbar-group">
          <button
            type="button"
            className="button tiny ghost"
            onClick={panelBridge.revealHierarchy}
            title="Show the hierarchy and assets panel"
          >
            Hierarchy
          </button>
          <button
            type="button"
            className="button tiny ghost"
            onClick={panelBridge.revealInspector}
            title="Show the inspector panel"
          >
            Inspector
          </button>
          <button
            type="button"
            className="button tiny ghost"
            onClick={() => panelBridge.revealInspection('validation')}
            title="Show the inspection panel"
          >
            Inspection
            <span className={`scene-pill ${errorCount > 0 ? 'error' : warningCount > 0 ? 'warning' : ''}`}>
              {errorCount > 0 ? errorCount : warningCount}
            </span>
          </button>
        </div>
      </header>

      {external && (
        <div className="scene-banner warning" role="status">
          <span>
            {external.kind === 'deleted'
              ? 'The scene file was deleted outside this editor.'
              : 'The scene changed outside this editor.'}
            {dirty ? ' Your unsaved changes are kept.' : ''}
          </span>
          <button type="button" className="link-button" onClick={() => void reloadFromDisk(true)}>
            Reload from disk
          </button>
          <button type="button" className="link-button" onClick={() => setExternal(null)}>
            Dismiss
          </button>
        </div>
      )}
      {toast && (
        <div className={`scene-banner ${toast.kind === 'error' ? 'danger' : 'success'}`} role="status">
          <span>{toast.message}</span>
          <button type="button" className="link-button" onClick={() => setToast(null)}>
            Dismiss
          </button>
        </div>
      )}

      <div className="scene-body">
        <main className="scene-viewport-wrap">
          {ViewportComponent ? (
            <ViewportComponent
              client={client}
              scene={doc}
              context={context}
              selection={selection}
              onSelect={setSelection}
              onTransform={(id, transform) => commit(setEntityTransform(doc, id, transform))}
              mode={mode}
              snap={snap}
            />
          ) : (
            <div className="scene-viewport-placeholder">
              <p>3D viewport unavailable.</p>
            </div>
          )}
          <div className="scene-viewport-hint">
            <span>W move · E rotate · R scale · Esc deselect</span>
            <span>{allEntities.length} entities</span>
          </div>
        </main>
      </div>
    </div>
  )
}
