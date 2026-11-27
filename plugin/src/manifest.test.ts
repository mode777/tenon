import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

interface ManifestPanel {
  id: string
  title: string
  location: string
  entry: string
}

interface ManifestEditor {
  glob: string
  companionPanels?: string[]
}

interface Manifest {
  version: string
  engines: { exo: string }
  contributes: {
    panels: ManifestPanel[]
    fileEditors: ManifestEditor[]
  }
}

function manifest(): Manifest {
  return JSON.parse(
    readFileSync(new URL('../public/exo-manifest.json', import.meta.url), 'utf8'),
  ) as Manifest
}

describe('Tenon manifest', () => {
  it('declares the hierarchy primary panel and binds it to scene/level editors', () => {
    const value = manifest()
    expect(value.version).toBe('0.5.0')
    expect(value.engines.exo).toBe('>=0.11.0')

    const hierarchy = value.contributes.panels.find(
      (panel) => panel.id === 'tenon.scene.hierarchy',
    )
    expect(hierarchy).toMatchObject({
      title: 'Hierarchy & Assets',
      location: 'primary',
      entry: 'views/hierarchy.html',
    })

    for (const glob of ['scenes/*.scene.json', 'levels/*.scene.json']) {
      const editor = value.contributes.fileEditors.find((entry) => entry.glob === glob)
      expect(editor?.companionPanels).toEqual([
        'tenon.scene.hierarchy',
        'tenon.scene.inspector',
        'tenon.scene.inspection',
      ])
    }
    expect(value.contributes.panels).toHaveLength(4)
  })
})
