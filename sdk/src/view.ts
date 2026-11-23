import type { MessageGate } from './gate'
import { FrameClient } from './client'
import {
  ExoProtocolError,
  type EditorLimits,
  type ViewCapabilities,
  type ViewInit,
  type ViewInitData,
} from './protocol'

/**
 * One panel or content-view frame. It shares reads, listings, the file picker,
 * events, navigation intents and disposal with the editor client, and exposes
 * no save or dirty methods.
 */
export class ViewClient extends FrameClient {
  private readonly viewInit: ViewInit

  constructor(gate: MessageGate, init: ViewInit) {
    if ((init as { mode?: string }).mode !== 'view') {
      throw new ExoProtocolError('identity', 'A view client requires a view-mode initialization.')
    }
    super(gate, init)
    this.viewInit = init
  }

  get initialization(): ViewInit {
    return this.viewInit
  }

  get view(): ViewInitData {
    return { ...this.viewInit.view }
  }

  get capabilities(): ViewCapabilities {
    return this.viewInit.capabilities
  }

  get limits(): EditorLimits {
    return this.viewInit.limits
  }
}
