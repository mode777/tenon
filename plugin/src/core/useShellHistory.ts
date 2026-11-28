import type { EditorClient } from '@exo/plugin-sdk'
import { useEffect, useRef } from 'react'

export interface ShellHistoryActions {
  canWrite: boolean
  undo: () => void
  redo: () => void
}

/**
 * Apply Exo's id-less undo/redo intents to a frame's own history. The shell keeps no
 * history and only sends these intents to an active writable editor.
 */
export function useShellHistory(client: EditorClient, actions: ShellHistoryActions): void {
  const actionsRef = useRef(actions)
  actionsRef.current = actions

  useEffect(() => {
    const apply = (action: 'undo' | 'redo') => {
      const current = actionsRef.current
      if (!current.canWrite) return
      current[action]()
    }
    const offUndo = client.onUndoRequest(() => apply('undo'))
    const offRedo = client.onRedoRequest(() => apply('redo'))
    return () => {
      offUndo()
      offRedo()
    }
  }, [client])
}
