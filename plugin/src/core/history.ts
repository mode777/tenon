import { useState } from 'react'

export interface HistoryState<T> {
  doc: T
  past: T[]
  future: T[]
}

export interface History<T> {
  state: HistoryState<T>
  update: (recipe: (draft: T) => void) => void
  replace: (doc: T) => void
  reset: (doc: T) => void
  undo: () => void
  redo: () => void
  canUndo: boolean
  canRedo: boolean
}

export function useHistory<T>(initial: T, clone: (value: T) => T, limit = 100): History<T> {
  const [state, setState] = useState<HistoryState<T>>({ doc: initial, past: [], future: [] })

  const update = (recipe: (draft: T) => void) => {
    setState((previous) => {
      const next = clone(previous.doc)
      recipe(next)
      return {
        doc: next,
        past: [...previous.past, previous.doc].slice(-limit),
        future: [],
      }
    })
  }

  const replace = (doc: T) => {
    setState((previous) => ({
      doc,
      past: [...previous.past, previous.doc].slice(-limit),
      future: [],
    }))
  }

  const reset = (doc: T) => {
    setState({ doc, past: [], future: [] })
  }

  const undo = () => {
    setState((previous) => {
      const previousDoc = previous.past.at(-1)
      if (!previousDoc) return previous
      return {
        doc: previousDoc,
        past: previous.past.slice(0, -1),
        future: [previous.doc, ...previous.future].slice(0, limit),
      }
    })
  }

  const redo = () => {
    setState((previous) => {
      const nextDoc = previous.future[0]
      if (!nextDoc) return previous
      return {
        doc: nextDoc,
        past: [...previous.past, previous.doc].slice(-limit),
        future: previous.future.slice(1),
      }
    })
  }

  return {
    state,
    update,
    replace,
    reset,
    undo,
    redo,
    canUndo: state.past.length > 0,
    canRedo: state.future.length > 0,
  }
}
