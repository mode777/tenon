// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SceneCommand } from '../scene-commands'
import { InspectorPanel } from './InspectorPanel'
import { contextFor, levelScene, workspace } from './panel-test-fixtures'

afterEach(cleanup)

function renderInspector(
  selection: string | null,
  canWrite = true,
  doc = levelScene(),
) {
  const loaded = workspace()
  const onSelect = vi.fn()
  const onCommand = vi.fn<(command: SceneCommand) => void>()
  render(
    <InspectorPanel
      doc={doc}
      selection={selection}
      path="/levels/level01.scene.json"
      context={contextFor(doc, loaded)}
      workspace={loaded}
      canWrite={canWrite}
      onSelect={onSelect}
      onCommand={onCommand}
    />,
  )
  return { onSelect, onCommand }
}

describe('InspectorPanel', () => {
  it('edits an entity name, transform, and property through commands', async () => {
    const user = userEvent.setup()
    const { onCommand } = renderInspector('button_1')

    expect(screen.getByRole('heading', { name: 'Inspector' })).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Entity name'), { target: { value: 'Button' } })
    expect(onCommand).toHaveBeenLastCalledWith({
      type: 'set-entity-name',
      entityId: 'button_1',
      value: 'Button',
    })

    fireEvent.change(screen.getByDisplayValue('Press'), { target: { value: 'Go' } })
    expect(onCommand).toHaveBeenLastCalledWith({
      type: 'set-prop',
      entityId: 'button_1',
      name: 'label',
      value: 'Go',
    })

    const position = screen.getAllByRole('spinbutton')[0]
    fireEvent.change(position, { target: { value: '4' } })
    expect(onCommand).toHaveBeenLastCalledWith({
      type: 'set-transform',
      entityId: 'button_1',
      transform: {
        position: [4, 0, 0],
        rotation: [0, 0, 0],
        scale: [1, 1, 1],
      },
    })

    await user.click(screen.getByRole('button', { name: 'Duplicate' }))
    expect(onCommand).toHaveBeenLastCalledWith({
      type: 'duplicate-entity',
      entityId: 'button_1',
    })
  })

  it('shows slot selection for an attachment to a scene instance', async () => {
    const user = userEvent.setup()
    const { onCommand } = renderInspector('button_1')
    expect(screen.getByLabelText('Slot')).toBeTruthy()
    await user.selectOptions(screen.getByLabelText('Slot'), 'button_0')
    expect(onCommand).toHaveBeenLastCalledWith({
      type: 'set-entity-slot',
      entityId: 'button_1',
      slot: 'button_0',
    })
  })

  it('edits scene settings when nothing is selected', async () => {
    const user = userEvent.setup()
    const doc = levelScene()
    doc.requires = ['basic3d@1.0.0']
    const { onCommand } = renderInspector(null, true, doc)

    expect(screen.getByRole('heading', { name: 'Scene settings' })).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Scene ID'), { target: { value: 'level_02' } })
    expect(onCommand).toHaveBeenLastCalledWith({ type: 'set-scene-id', id: 'level_02' })

    await user.click(screen.getByRole('button', { name: 'Add requirement' }))
    expect(onCommand).toHaveBeenLastCalledWith({ type: 'add-requirement' })

    await user.click(screen.getAllByRole('button', { name: 'Remove' })[0])
    expect(onCommand).toHaveBeenLastCalledWith({ type: 'remove-requirement', index: 0 })
  })

  it('disables edits in a read-only workspace', () => {
    renderInspector('button_1', false)
    expect((screen.getByLabelText('Entity name') as HTMLInputElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: 'Delete' }) as HTMLButtonElement).disabled).toBe(true)
  })
})
