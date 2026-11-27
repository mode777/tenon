import type { ActiveEditor, ViewClient } from '@exo/plugin-sdk'
import { useCallback, useEffect, useRef, useState } from 'react'
import { normalizeScenePath } from '../../core/scene'
import type { SceneCommand } from '../scene-commands'
import {
  SCENE_PANEL_TOPIC,
  isScenePanelMessage,
  type InspectionTab,
  type SceneEditorIntent,
  type ScenePanelSnapshot,
} from '../scene-panel-protocol'
import { isSceneEditorPath } from '../scene-workspace'

export interface ScenePanelState {
  activeEditor: ActiveEditor | null
  snapshot: ScenePanelSnapshot | null
  loading: boolean
  error: string | null
  focusTab: InspectionTab | null
  sendCommand: (command: SceneCommand) => void
  sendIntent: (intent: SceneEditorIntent) => void
  clearError: () => void
  clearFocusTab: () => void
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}

/**
 * Panel side of the shell-panel bridge. It follows the active scene/level
 * editor, requests a snapshot when that editor changes, and sends commands back
 * to the active editor instance. It never reads or writes the document itself.
 */
export function useScenePanel(
  view: ViewClient,
  options: { onFocusTab?: (tab: InspectionTab) => void } = {},
): ScenePanelState {
  const [activeEditor, setActiveEditor] = useState<ActiveEditor | null>(() => view.activeEditor)
  const [snapshot, setSnapshot] = useState<ScenePanelSnapshot | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [focusTab, setFocusTab] = useState<InspectionTab | null>(null)
  const activeRef = useRef<ActiveEditor | null>(activeEditor)
  activeRef.current = activeEditor
  const snapshotRef = useRef<ScenePanelSnapshot | null>(snapshot)
  snapshotRef.current = snapshot
  const requestIdRef = useRef(0)
  const timeoutRef = useRef<number | null>(null)
  const activeEventSeenRef = useRef(false)
  const onFocusTabRef = useRef(options.onFocusTab)
  onFocusTabRef.current = options.onFocusTab

  const clearTimer = useCallback(() => {
    if (timeoutRef.current !== null) {
      window.clearTimeout(timeoutRef.current)
      timeoutRef.current = null
    }
  }, [])

  const requestSnapshot = useCallback(
    (editor: ActiveEditor) => {
      if (!isSceneEditorPath(editor.path)) {
        setLoading(false)
        return
      }
      clearTimer()
      setLoading(true)
      setError(null)
      const requestId = `snapshot-${++requestIdRef.current}`
      void view
        .publishLocal(SCENE_PANEL_TOPIC, {
          kind: 'snapshot-request',
          target: editor.instanceId,
          requestId,
        })
        .catch((cause: unknown) => {
          setLoading(false)
          setError(`Could not request the scene state: ${errorMessage(cause)}`)
        })
      timeoutRef.current = window.setTimeout(() => {
        setLoading(false)
        setError('The scene editor did not respond. Reopen the scene or retry the panel.')
      }, 1500)
    },
    [clearTimer, view],
  )

  const activate = useCallback(
    (editor: ActiveEditor | null) => {
      activeRef.current = editor
      setActiveEditor(editor)
      snapshotRef.current = null
      setSnapshot(null)
      setFocusTab(null)
      clearTimer()
      if (editor && isSceneEditorPath(editor.path)) {
        requestSnapshot(editor)
      } else {
        setLoading(false)
        setError(null)
      }
    },
    [clearTimer, requestSnapshot],
  )

  useEffect(() => {
    let cancelled = false
    activeEventSeenRef.current = false
    const offLocal = view.onLocalEvent(SCENE_PANEL_TOPIC, (event) => {
      if (!isScenePanelMessage(event.payload)) return
      const message = event.payload
      if (message.kind === 'editor-online') {
        activeEventSeenRef.current = true
        if (!message.active) {
          if (activeRef.current?.instanceId === message.instanceId) activate(null)
          return
        }
        if (!isSceneEditorPath(message.path)) return
        const current = activeRef.current
        if (current && current.instanceId !== message.instanceId) return
        if (!current) {
          activate({
            pluginId: view.initialization.plugin.id,
            path: message.path,
            instanceId: message.instanceId,
          })
        } else if (normalizeScenePath(current.path) !== normalizeScenePath(message.path)) {
          activate({ ...current, path: message.path })
        } else if (!snapshotRef.current) {
          requestSnapshot(current)
        }
        return
      }
      const editor = activeRef.current
      if (!editor || event.from !== editor.instanceId) return
      if (message.kind === 'snapshot') {
        if (normalizeScenePath(message.snapshot.path) !== normalizeScenePath(editor.path)) return
        const previous = snapshotRef.current
        if (previous && message.snapshot.revision < previous.revision) return
        clearTimer()
        snapshotRef.current = message.snapshot
        setSnapshot(message.snapshot)
        setLoading(false)
        setError(null)
        return
      }
      if (message.kind === 'command-result') {
        if (!message.ok) setError(message.message ?? 'The scene editor rejected the edit.')
        return
      }
      if (
        message.kind === 'focus-tab' &&
        normalizeScenePath(message.path) === normalizeScenePath(editor.path)
      ) {
        setFocusTab(message.tab)
        onFocusTabRef.current?.(message.tab)
      }
    })
    const offActive = view.onEvent('editor/active', (event) => {
      activeEventSeenRef.current = true
      if (!event.payload.active) {
        activate(null)
        return
      }
      const next: ActiveEditor = {
        pluginId: event.payload.pluginId,
        path: event.payload.path,
        instanceId: event.payload.instanceId,
      }
      activate(next)
    })

    const start = async () => {
      try {
        if (!view.capabilities.localEvents) {
          throw new Error('This shell does not support plugin-local events.')
        }
        if (!view.capabilities.editorContext) {
          throw new Error('This shell does not provide active-editor context.')
        }
        try {
          await view.subscribe('editor/active')
        } catch {
          // The initial active-editor context still works without live updates.
        }
        await view.subscribeLocal(SCENE_PANEL_TOPIC)
        if (cancelled) return
        activate(activeEventSeenRef.current ? activeRef.current : view.activeEditor)
        void view
          .publishLocal(SCENE_PANEL_TOPIC, {
            kind: 'discover',
            requestId: `discover-${++requestIdRef.current}`,
          })
          .catch((cause: unknown) => {
            setError(`Could not discover the scene editor: ${errorMessage(cause)}`)
          })
      } catch (cause) {
        if (!cancelled) setError(errorMessage(cause))
      }
    }
    void start()

    return () => {
      cancelled = true
      offLocal()
      offActive()
      clearTimer()
      view.unsubscribe(SCENE_PANEL_TOPIC)
      view.unsubscribe('editor/active')
    }
  }, [activate, clearTimer, requestSnapshot, view])

  const sendCommand = useCallback(
    (command: SceneCommand) => {
      const editor = activeRef.current
      if (!editor || !isSceneEditorPath(editor.path)) {
        setError('Open a scene or level before editing it.')
        return
      }
      const requestId = `command-${++requestIdRef.current}`
      void view
        .publishLocal(SCENE_PANEL_TOPIC, {
          kind: 'command',
          target: editor.instanceId,
          requestId,
          command,
        })
        .catch((cause: unknown) => {
          setError(`Could not reach the scene editor: ${errorMessage(cause)}`)
        })
    },
    [view],
  )

  const sendIntent = useCallback(
    (intent: SceneEditorIntent) => {
      const editor = activeRef.current
      if (!editor || !isSceneEditorPath(editor.path)) {
        setError('Open a scene or level before using the scene editor controls.')
        return
      }
      const requestId = `intent-${++requestIdRef.current}`
      void view
        .publishLocal(SCENE_PANEL_TOPIC, {
          kind: 'intent',
          target: editor.instanceId,
          requestId,
          intent,
        })
        .catch((cause: unknown) => {
          setError(`Could not reach the scene editor: ${errorMessage(cause)}`)
        })
    },
    [view],
  )

  const clearError = useCallback(() => setError(null), [])
  const clearFocusTab = useCallback(() => setFocusTab(null), [])

  return {
    activeEditor,
    snapshot,
    loading,
    error,
    focusTab,
    sendCommand,
    sendIntent,
    clearError,
    clearFocusTab,
  }
}
