// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import type { EditorClient } from '@exo/plugin-sdk'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useShellHistory } from './useShellHistory'

function mockClient() {
  const undoListeners = new Set<() => void>()
  const redoListeners = new Set<() => void>()
  const client = {
    onUndoRequest: (listener: () => void) => {
      undoListeners.add(listener)
      return () => {
        undoListeners.delete(listener)
      }
    },
    onRedoRequest: (listener: () => void) => {
      redoListeners.add(listener)
      return () => {
        redoListeners.delete(listener)
      }
    },
  } as unknown as EditorClient
  return {
    client,
    emitUndo: () => {
      for (const listener of [...undoListeners]) listener()
    },
    emitRedo: () => {
      for (const listener of [...redoListeners]) listener()
    },
    undoListeners,
    redoListeners,
  }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('useShellHistory', () => {
  it('applies shell undo and redo in a writable editor', () => {
    const { client, emitUndo, emitRedo } = mockClient()
    const undo = vi.fn()
    const redo = vi.fn()
    renderHook(() => useShellHistory(client, { canWrite: true, undo, redo }))

    act(() => emitUndo())
    act(() => emitRedo())

    expect(undo).toHaveBeenCalledTimes(1)
    expect(redo).toHaveBeenCalledTimes(1)
  })

  it('ignores intents when the document is read-only', () => {
    const { client, emitUndo, emitRedo } = mockClient()
    const undo = vi.fn()
    const redo = vi.fn()
    const { rerender } = renderHook(
      ({ canWrite }) => useShellHistory(client, { canWrite, undo, redo }),
      { initialProps: { canWrite: true } },
    )

    rerender({ canWrite: false })
    act(() => emitUndo())
    act(() => emitRedo())

    expect(undo).not.toHaveBeenCalled()
    expect(redo).not.toHaveBeenCalled()
  })

  it('uses the latest callbacks without resubscribing', () => {
    const { client, emitUndo, undoListeners } = mockClient()
    const first = vi.fn()
    const second = vi.fn()
    const { rerender } = renderHook(
      ({ undo }) => useShellHistory(client, { canWrite: true, undo, redo: vi.fn() }),
      { initialProps: { undo: first } },
    )

    rerender({ undo: second })
    act(() => emitUndo())

    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledTimes(1)
    expect(undoListeners.size).toBe(1)
  })

  it('unsubscribes on unmount', () => {
    const { client, emitUndo, emitRedo, undoListeners, redoListeners } = mockClient()
    const undo = vi.fn()
    const redo = vi.fn()
    const { unmount } = renderHook(() => useShellHistory(client, { canWrite: true, undo, redo }))

    expect(undoListeners.size).toBe(1)
    expect(redoListeners.size).toBe(1)

    unmount()
    act(() => emitUndo())
    act(() => emitRedo())

    expect(undoListeners.size).toBe(0)
    expect(redoListeners.size).toBe(0)
    expect(undo).not.toHaveBeenCalled()
    expect(redo).not.toHaveBeenCalled()
  })
})
