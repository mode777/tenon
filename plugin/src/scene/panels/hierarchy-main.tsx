import { mountTenonPanel } from './panel-boot'
import { HierarchyPanelRoot } from './panel-roots'

void mountTenonPanel(HierarchyPanelRoot).catch((error: unknown) => {
  console.error('TENON_HIERARCHY_BOOT_ERROR', error)
  const root = document.getElementById('root')
  if (root) {
    root.textContent = 'Could not start the Tenon hierarchy panel.'
  }
})
