import { useCallback, useRef, useState } from 'react'

export interface DocumentSnapshot<TDoc, TSelection> {
  doc: TDoc
  selection: TSelection
}

export interface DocumentHistoryState<TDoc, TSelection>
  extends DocumentSnapshot<TDoc, TSelection> {
  past: DocumentSnapshot<TDoc, TSelection>[]
  future: DocumentSnapshot<TDoc, TSelection>[]
}

export interface DocumentHistoryOptions<TSelection> {
  /** Selection to store with the snapshot. Defaults to the current selection. */
  selection?: TSelection
  /**
   * Merge consecutive commits with the same key inside the coalescing window into one
   * history entry. Use this for controls that must update live; text fields commit on
   * blur/Enter instead.
   */
  coalesceKey?: string
}

export interface DocumentHistory<TDoc, TSelection> {
  state: DocumentHistoryState<TDoc, TSelection>
  doc: TDoc
  selection: TSelection
  commit: (
    recipe: (draft: TDoc) => void,
    options?: DocumentHistoryOptions<TSelection>,
  ) => void
  replace: (doc: TDoc, options?: DocumentHistoryOptions<TSelection>) => void
  select: (selection: TSelection) => void
  updateSelection: (recipe: (selection: TSelection) => TSelection) => void
  reset: (doc: TDoc, selection: TSelection) => void
  undo: () => void
  redo: () => void
  breakCoalescing: () => void
  canUndo: boolean
  canRedo: boolean
}

const DEFAULT_LIMIT = 100
const DEFAULT_COALESCE_MS = 750

interface CoalesceMarker {
  key: string
  at: number
}

/**
 * Frame-local document history. Every undoable edit records a bounded snapshot of the
 * document plus the editor selection behind it. Selection-only changes update the present
 * snapshot without creating an entry.
 */
export function useDocumentHistory<TDoc, TSelection>(
  initialDoc: TDoc,
  initialSelection: TSelection,
  clone: (value: TDoc) => TDoc,
  options: { limit?: number; coalesceWindowMs?: number } = {},
): DocumentHistory<TDoc, TSelection> {
  const [state, setState] = useState<DocumentHistoryState<TDoc, TSelection>>({
    doc: initialDoc,
    selection: initialSelection,
    past: [],
    future: [],
  })
  const stateRef = useRef(state)
  stateRef.current = state
  const cloneRef = useRef(clone)
  cloneRef.current = clone
  const limitRef = useRef(options.limit ?? DEFAULT_LIMIT)
  limitRef.current = options.limit ?? DEFAULT_LIMIT
  const coalesceWindowRef = useRef(options.coalesceWindowMs ?? DEFAULT_COALESCE_MS)
  coalesceWindowRef.current = options.coalesceWindowMs ?? DEFAULT_COALESCE_MS
  const coalesceRef = useRef<CoalesceMarker | null>(null)

  const publish = useCallback((next: DocumentHistoryState<TDoc, TSelection>) => {
    stateRef.current = next
    setState(next)
  }, [])

  const record = useCallback(
    (nextDoc: TDoc, nextSelection: TSelection, coalesceKey?: string) => {
      const previous = stateRef.current
      const now = Date.now()
      const marker = coalesceRef.current
      const coalesced = Boolean(
        coalesceKey &&
          marker &&
          marker.key === coalesceKey &&
          now - marker.at < coalesceWindowRef.current,
      )

      coalesceRef.current = coalesceKey ? { key: coalesceKey, at: now } : null
      if (coalesced) {
        publish({ ...previous, doc: nextDoc, selection: nextSelection, future: [] })
        return
      }

      publish({
        doc: nextDoc,
        selection: nextSelection,
        past: [...previous.past, { doc: previous.doc, selection: previous.selection }].slice(
          -limitRef.current,
        ),
        future: [],
      })
    },
    [publish],
  )

  const commit = useCallback(
    (recipe: (draft: TDoc) => void, commitOptions?: DocumentHistoryOptions<TSelection>) => {
      const previous = stateRef.current
      const next = cloneRef.current(previous.doc)
      recipe(next)
      record(
        next,
        commitOptions?.selection === undefined
          ? previous.selection
          : commitOptions.selection,
        commitOptions?.coalesceKey,
      )
    },
    [record],
  )

  const replace = useCallback(
    (doc: TDoc, replaceOptions?: DocumentHistoryOptions<TSelection>) => {
      const previous = stateRef.current
      record(
        doc,
        replaceOptions?.selection === undefined
          ? previous.selection
          : replaceOptions.selection,
        replaceOptions?.coalesceKey,
      )
    },
    [record],
  )

  const select = useCallback(
    (selection: TSelection) => {
      coalesceRef.current = null
      const previous = stateRef.current
      if (Object.is(previous.selection, selection)) return
      publish({ ...previous, selection })
    },
    [publish],
  )

  const updateSelection = useCallback(
    (recipe: (selection: TSelection) => TSelection) => {
      coalesceRef.current = null
      const previous = stateRef.current
      const selection = recipe(previous.selection)
      if (Object.is(selection, previous.selection)) return
      publish({ ...previous, selection })
    },
    [publish],
  )

  const reset = useCallback(
    (doc: TDoc, selection: TSelection) => {
      coalesceRef.current = null
      publish({ doc, selection, past: [], future: [] })
    },
    [publish],
  )

  const breakCoalescing = useCallback(() => {
    coalesceRef.current = null
  }, [])

  const undo = useCallback(() => {
    coalesceRef.current = null
    const previous = stateRef.current
    const restored = previous.past.at(-1)
    if (!restored) return
    publish({
      doc: restored.doc,
      selection: restored.selection,
      past: previous.past.slice(0, -1),
      future: [
        { doc: previous.doc, selection: previous.selection },
        ...previous.future,
      ].slice(0, limitRef.current),
    })
  }, [publish])

  const redo = useCallback(() => {
    coalesceRef.current = null
    const previous = stateRef.current
    const restored = previous.future[0]
    if (!restored) return
    publish({
      doc: restored.doc,
      selection: restored.selection,
      past: [
        ...previous.past,
        { doc: previous.doc, selection: previous.selection },
      ].slice(-limitRef.current),
      future: previous.future.slice(1),
    })
  }, [publish])

  return {
    state,
    doc: state.doc,
    selection: state.selection,
    commit,
    replace,
    select,
    updateSelection,
    reset,
    undo,
    redo,
    breakCoalescing,
    canUndo: state.past.length > 0,
    canRedo: state.future.length > 0,
  }
}
