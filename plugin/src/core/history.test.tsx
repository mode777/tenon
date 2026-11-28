// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useDocumentHistory } from './history'

interface Doc {
  value: string
}

const clone = (doc: Doc): Doc => ({ ...doc })

function setup(initial = 'a', selection = 'root', limit = 100) {
  return renderHook(() =>
    useDocumentHistory<Doc, string>({ value: initial }, selection, clone, {
      limit,
      coalesceWindowMs: 1000,
    }),
  )
}

afterEach(() => {
  vi.useRealTimers()
})

describe('useDocumentHistory', () => {
  it('commits a document edit and undoes and redoes it', () => {
    const { result } = setup()

    act(() => {
      result.current.commit((draft) => {
        draft.value = 'b'
      })
    })
    expect(result.current.doc.value).toBe('b')
    expect(result.current.canUndo).toBe(true)
    expect(result.current.canRedo).toBe(false)

    act(() => result.current.undo())
    expect(result.current.doc.value).toBe('a')
    expect(result.current.canUndo).toBe(false)
    expect(result.current.canRedo).toBe(true)

    act(() => result.current.redo())
    expect(result.current.doc.value).toBe('b')
    expect(result.current.canRedo).toBe(false)
  })

  it('restores the selection stored with each snapshot', () => {
    const { result } = setup()

    act(() => {
      result.current.commit(
        (draft) => {
          draft.value = 'b'
        },
        { selection: 'b' },
      )
    })
    act(() => result.current.select('c'))
    act(() => {
      result.current.commit(
        (draft) => {
          draft.value = 'c'
        },
        { selection: 'd' },
      )
    })

    act(() => result.current.undo())
    expect(result.current.doc.value).toBe('b')
    expect(result.current.selection).toBe('c')

    act(() => result.current.undo())
    expect(result.current.doc.value).toBe('a')
    expect(result.current.selection).toBe('root')
  })

  it('does not add history for a selection-only change', () => {
    const { result } = setup()

    act(() => result.current.select('other'))

    expect(result.current.selection).toBe('other')
    expect(result.current.canUndo).toBe(false)
  })

  it('merges sequential partial selection updates', () => {
    const { result } = renderHook(() =>
      useDocumentHistory<Doc, { target: string; field: string | null }>(
        { value: 'a' },
        { target: 'root', field: null },
        clone,
      ),
    )

    act(() => {
      result.current.updateSelection((current) => ({ ...current, target: 'next' }))
      result.current.updateSelection((current) => ({ ...current, field: 'name' }))
    })

    expect(result.current.selection).toEqual({ target: 'next', field: 'name' })
    expect(result.current.canUndo).toBe(false)
  })

  it('coalesces consecutive commits with the same key into one step', () => {
    const { result } = setup()

    act(() => {
      result.current.commit(
        (draft) => {
          draft.value = 'b'
        },
        { coalesceKey: 'name' },
      )
    })
    act(() => {
      result.current.commit(
        (draft) => {
          draft.value = 'bc'
        },
        { coalesceKey: 'name' },
      )
    })
    expect(result.current.state.past).toHaveLength(1)

    act(() => result.current.undo())
    expect(result.current.doc.value).toBe('a')
  })

  it('keeps different coalescing keys as separate steps', () => {
    const { result } = setup()

    act(() => {
      result.current.commit(
        (draft) => {
          draft.value = 'b'
        },
        { coalesceKey: 'name' },
      )
    })
    act(() => {
      result.current.commit(
        (draft) => {
          draft.value = 'bc'
        },
        { coalesceKey: 'label' },
      )
    })

    act(() => result.current.undo())
    expect(result.current.doc.value).toBe('b')
  })

  it('splits coalescing when the boundary is broken', () => {
    const { result } = setup()

    act(() => {
      result.current.commit(
        (draft) => {
          draft.value = 'b'
        },
        { coalesceKey: 'name' },
      )
    })
    act(() => result.current.breakCoalescing())
    act(() => {
      result.current.commit(
        (draft) => {
          draft.value = 'bc'
        },
        { coalesceKey: 'name' },
      )
    })

    act(() => result.current.undo())
    expect(result.current.doc.value).toBe('b')
  })

  it('starts a new step after the coalescing window expires', () => {
    vi.useFakeTimers()
    vi.setSystemTime(1000)
    const { result } = setup()

    act(() => {
      result.current.commit(
        (draft) => {
          draft.value = 'b'
        },
        { coalesceKey: 'name' },
      )
    })
    vi.setSystemTime(2000)
    act(() => {
      result.current.commit(
        (draft) => {
          draft.value = 'bc'
        },
        { coalesceKey: 'name' },
      )
    })

    act(() => result.current.undo())
    expect(result.current.doc.value).toBe('b')
  })

  it('bounds history to the configured limit', () => {
    const { result } = setup('a', 'root', 2)

    act(() => {
      result.current.commit((draft) => {
        draft.value = 'b'
      })
    })
    act(() => {
      result.current.commit((draft) => {
        draft.value = 'c'
      })
    })
    act(() => {
      result.current.commit((draft) => {
        draft.value = 'd'
      })
    })
    expect(result.current.state.past).toHaveLength(2)

    act(() => result.current.undo())
    expect(result.current.doc.value).toBe('c')
    act(() => result.current.undo())
    expect(result.current.doc.value).toBe('b')
    act(() => result.current.undo())
    expect(result.current.doc.value).toBe('b')
  })

  it('resets history and selects the restored document', () => {
    const { result } = setup()

    act(() => {
      result.current.commit((draft) => {
        draft.value = 'b'
      })
    })
    act(() => result.current.reset({ value: 'z' }, 'z'))

    expect(result.current.doc.value).toBe('z')
    expect(result.current.selection).toBe('z')
    expect(result.current.canUndo).toBe(false)
    expect(result.current.canRedo).toBe(false)
  })

  it('keeps callbacks stable across renders', () => {
    const { result, rerender } = setup()
    const undo = result.current.undo
    const commit = result.current.commit

    rerender()

    expect(result.current.undo).toBe(undo)
    expect(result.current.commit).toBe(commit)
  })

  it('keeps the current selection when replace omits one', () => {
    const { result } = setup()

    act(() => {
      result.current.commit(
        (draft) => {
          draft.value = 'b'
        },
        { selection: 'b' },
      )
    })
    act(() => result.current.replace({ value: 'c' }))

    expect(result.current.selection).toBe('b')
  })

  it('clears the redo stack after a new commit', () => {
    const { result } = setup()

    act(() => {
      result.current.commit((draft) => {
        draft.value = 'b'
      })
    })
    act(() => result.current.undo())
    expect(result.current.canRedo).toBe(true)

    act(() => {
      result.current.commit((draft) => {
        draft.value = 'c'
      })
    })
    expect(result.current.canRedo).toBe(false)
  })
})
