// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SceneCommand } from '../scene-commands'
import { InspectionPanel } from './InspectionPanel'
import { contextFor, levelScene, workspace } from './panel-test-fixtures'

afterEach(cleanup)

function renderInspection(doc = levelScene(), canWrite = true) {
  const loaded = workspace()
  const onSelect = vi.fn()
  const onCommand = vi.fn<(command: SceneCommand) => void>()
  const onFocusTabHandled = vi.fn()
  render(
    <InspectionPanel
      doc={doc}
      path="/levels/level01.scene.json"
      context={contextFor(doc, loaded)}
      workspace={loaded}
      canWrite={canWrite}
      focusTab={null}
      onFocusTabHandled={onFocusTabHandled}
      onSelect={onSelect}
      onCommand={onCommand}
    />,
  )
  return { onSelect, onCommand, onFocusTabHandled }
}

describe('InspectionPanel', () => {
  it('lists validation issues and selects the entity', async () => {
    const user = userEvent.setup()
    const doc = levelScene()
    doc.entities[1].scene = 'scenes/missing.scene.json'
    const { onSelect } = renderInspection(doc)

    expect(await screen.findByText(/missing-scene/)).toBeTruthy()
    await user.click(screen.getAllByRole('button', { name: 'Select train_1' })[0])
    expect(onSelect).toHaveBeenCalledWith('train_1')
  })

  it('adds promotions and slots from the public surface', async () => {
    const user = userEvent.setup()
    const { onCommand } = renderInspection()

    await user.click(screen.getByRole('button', { name: /Public surface/ }))
    await user.type(screen.getByLabelText('Promotion name'), 'powerPublic')
    await user.selectOptions(screen.getByLabelText('Promotion target'), 'power')
    await user.click(screen.getByRole('button', { name: 'Promote' }))
    expect(onCommand).toHaveBeenLastCalledWith({
      type: 'add-promotion',
      name: 'powerPublic',
      target: { entity: 'train_1', field: 'power' },
    })

    await user.type(screen.getByLabelText('Slot name'), 'mount_0')
    await user.selectOptions(screen.getByLabelText('Slot anchor'), 'button_1')
    await user.click(screen.getByRole('button', { name: 'Add slot' }))
    expect(onCommand).toHaveBeenLastCalledWith({
      type: 'add-slot',
      name: 'mount_0',
      entity: 'button_1',
    })
  })

  it('expands scene instances into concrete entities', async () => {
    const user = userEvent.setup()
    renderInspection()
    await user.click(screen.getByRole('button', { name: /Debug expansion/ }))
    expect(await screen.findByText(/resolved entities/)).toBeTruthy()
    await waitFor(() => expect(screen.getByText(/train_1::engine/)).toBeTruthy())
    expect(screen.getByText(/train_1::button_anchor/)).toBeTruthy()
  })

  it('disables the public-surface forms in a read-only workspace', async () => {
    const user = userEvent.setup()
    renderInspection(levelScene(), false)
    await user.click(screen.getByRole('button', { name: /Public surface/ }))
    expect((screen.getByLabelText('Promotion name') as HTMLInputElement).disabled).toBe(true)
    expect((screen.getByLabelText('Slot name') as HTMLInputElement).disabled).toBe(true)
  })
})
