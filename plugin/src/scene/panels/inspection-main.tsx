import { mountTenonPanel } from './panel-boot'
import { InspectionPanelRoot } from './panel-roots'

void mountTenonPanel(InspectionPanelRoot).catch((error: unknown) => {
  console.error('TENON_INSPECTION_BOOT_ERROR', error)
  const root = document.getElementById('root')
  if (root) {
    root.textContent = 'Could not start the Tenon inspection panel.'
  }
})
