import { connectBrowserPlugin } from '@exo/plugin-sdk/browser'

const boot = document.getElementById('boot')

function show(message: string): void {
  if (boot) boot.textContent = message
}

async function main(): Promise<void> {
  show('connecting to Exo…')
  const connection = await connectBrowserPlugin()
  if (connection.mode !== 'register') {
    throw new Error('The Tenon controller must be mounted in register mode.')
  }

  connection.registration.register({
    glob: 'schemas/*.schema.json',
    entry: 'editor.html',
    label: 'Tenon Schema',
  })
  connection.registration.registerPanel('tenon.project')
  connection.registration.registerNewFile('tenon.schema')

  const ack = await connection.registration.complete()
  show(`Tenon registered: ${ack.accepted.join(', ') || 'no editors'}`)
  console.log('TENON_REGISTER', ack.accepted, ack.acceptedPanels, ack.acceptedCommands, ack.rejected)
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error)
  show(`Tenon failed to register: ${message}`)
  console.error('TENON_REGISTER_ERROR', error)
})
