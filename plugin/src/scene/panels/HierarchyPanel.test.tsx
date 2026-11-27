// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SceneCommand } from '../scene-commands'
import type { SceneEditorIntent } from '../scene-panel-protocol'
import { HierarchyPanel } from './HierarchyPanel'
import { contextFor, levelScene, workspace } from './panel-test-fixtures'

afterEach(cleanup)

function renderPanel(
  options: {
    selection?: string | null
    canWrite?: boolean
    onCommand?: (command: SceneCommand) => void
    onIntent?: (intent: SceneEditorIntent) => void
    onRefresh?: () => void
  } = {},
) {
  const doc = levelScene()
  const onCommand = options.onCommand ?? vi.fn()
  const onIntent = options.onIntent ?? vi.fn()
  const onRefresh = options.onRefresh ?? vi.fn()
  render(
    <HierarchyPanel
      doc={doc}
      path="/levels/level01.scene.json"
      selection={options.selection ?? 'train_1'}
      context={contextFor(doc)}
      workspace={workspace()}
      canWrite={options.canWrite ?? true}
      refreshing={false}
      onRefresh={onRefresh}
      onCommand={onCommand}
      onIntent={onIntent}
    />,
  )
  return { onCommand, onIntent, onRefresh }
}

describe('HierarchyPanel', () => {
  it('renders the host hierarchy and library', () => {
    renderPanel()
    expect(screen.getByRole('tree')).toBeTruthy()
    expect(screen.getByRole('button', { name: /train_1/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /button_1/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /game:engine/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Entities' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Scenes' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Assets' })).toBeTruthy()
    expect(screen.queryByText('engine')).toBeNull()
  })

  it('sends selection and placement commands to the editor', async () => {
    const user = userEvent.setup()
    const { onCommand } = renderPanel({ selection: 'button_1' })

    await user.click(screen.getByRole('button', { name: /button_1/ }))
    expect(onCommand).toHaveBeenCalledWith({ type: 'select', entityId: 'button_1' })

    await user.click(screen.getByRole('button', { name: /game:engine/ }))
    expect(onCommand).toHaveBeenCalledWith({
      type: 'add-entity',
      definition: 'game:engine',
      parentId: 'button_1',
    })

    await user.click(screen.getByRole('button', { name: 'Scenes' }))
    await user.click(screen.getByRole('button', { name: /train.scene.json/ }))
    expect(onCommand).toHaveBeenCalledWith({
      type: 'add-scene-instance',
      scenePath: '/scenes/train.scene.json',
      parentId: 'button_1',
    })

    await user.click(screen.getByRole('button', { name: 'Assets' }))
    await user.click(screen.getByRole('button', { name: 'Place' }))
    expect(onCommand).toHaveBeenCalledWith({
      type: 'add-asset',
      asset: '/assets/cube.glb',
      parentId: 'button_1',
    })
  })

  it('uses the root as the creation parent for a scene instance selection', async () => {
    const user = userEvent.setup()
    const { onCommand } = renderPanel({ selection: 'train_1' })
    await user.click(screen.getByRole('button', { name: /game:engine/ }))
    expect(onCommand).toHaveBeenCalledWith({
      type: 'add-entity',
      definition: 'game:engine',
      parentId: 'root',
    })
  })

  it('disables placement in a read-only workspace', async () => {
    const user = userEvent.setup()
    renderPanel({ canWrite: false })
    expect((screen.getByRole('button', { name: /game:engine/ }) as HTMLButtonElement).disabled).toBe(
      true,
    )
    await user.click(screen.getByRole('button', { name: 'Assets' }))
    expect((screen.getByRole('button', { name: 'Place' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('forwards editing shortcuts to the active editor', async () => {
    const user = userEvent.setup()
    const { onCommand, onIntent } = renderPanel({ selection: 'button_1' })

    await user.keyboard('{Delete}')
    expect(onCommand).toHaveBeenCalledWith({ type: 'delete-entity', entityId: 'button_1' })

    await user.keyboard('{Control>}d{/Control}')
    expect(onCommand).toHaveBeenCalledWith({ type: 'duplicate-entity', entityId: 'button_1' })

    await user.keyboard('{Escape}')
    expect(onCommand).toHaveBeenCalledWith({ type: 'select', entityId: null })

    await user.keyboard('{Control>}z{/Control}')
    expect(onIntent).toHaveBeenCalledWith({ type: 'undo' })

    await user.keyboard('{Control>}{Shift>}z{/Shift}{/Control}')
    expect(onIntent).toHaveBeenCalledWith({ type: 'redo' })

    await user.keyboard('{Control>}y{/Control}')
    expect(onIntent).toHaveBeenCalledWith({ type: 'redo' })

    await user.keyboard('{Control>}s{/Control}')
    expect(onIntent).toHaveBeenCalledWith({ type: 'save' })

    await user.keyboard('w')
    await user.keyboard('e')
    await user.keyboard('r')
    expect(onIntent).toHaveBeenCalledWith({ type: 'set-mode', mode: 'translate' })
    expect(onIntent).toHaveBeenCalledWith({ type: 'set-mode', mode: 'rotate' })
    expect(onIntent).toHaveBeenCalledWith({ type: 'set-mode', mode: 'scale' })
  })

  it('does not fire editing shortcuts while typing in search', async () => {
    const user = userEvent.setup()
    const { onCommand, onIntent } = renderPanel({ selection: 'button_1' })
    const search = screen.getByPlaceholderText('Search definitions')
    await user.click(search)
    await user.keyboard('{Delete}')
    await user.keyboard('{Control>}d{/Control}')
    await user.keyboard('{Control>}z{/Control}')
    expect(onCommand).not.toHaveBeenCalled()
    expect(onIntent).not.toHaveBeenCalledWith({ type: 'undo' })
    await user.keyboard('{Control>}s{/Control}')
    expect(onIntent).toHaveBeenCalledWith({ type: 'save' })
  })

  it('filters definitions and refreshes the workspace', async () => {
    const user = userEvent.setup()
    const { onRefresh } = renderPanel()
    await user.type(screen.getByPlaceholderText('Search definitions'), 'button')
    expect(screen.getByRole('button', { name: /game:button/ })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /game:engine/ })).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Refresh schemas and entities' }))
    expect(onRefresh).toHaveBeenCalled()
  })
})
