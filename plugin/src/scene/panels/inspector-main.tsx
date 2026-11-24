import { mountTenonPanel } from './panel-boot'
import { InspectorPanelRoot } from './panel-roots'

void mountTenonPanel(InspectorPanelRoot).catch((error: unknown) => {
  console.error('TENON_INSPECTOR_BOOT_ERROR', error)
  const root = document.getElementById('root')
  if (root) {
    root.textContent = 'Could not start the Tenon inspector panel.'
  }
})
