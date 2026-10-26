import { host, PALETTE_AREA } from '@hermes/plugin-sdk'

const ID = 'hermes-dynamic-chat'
const ATTRIBUTE = 'data-dynamic-chat-width'
const STORAGE_KEY = 'composer-width'
const activeDocuments = new WeakSet()
const MODES = {
  compact: { label: '736 px', next: 'wide' },
  wide: { label: '883.2 px (+20%)', next: 'wider' },
  wider: { label: '1030.4 px (+40%)', next: 'hermes' },
  hermes: { label: 'Hermes (full width)', next: 'compact' }
}

const CSS = `
html[data-dynamic-chat-width='compact'] { --dynamic-chat-width: 736px; }
html[data-dynamic-chat-width='wide'] { --dynamic-chat-width: 883.2px; }
html[data-dynamic-chat-width='wider'] { --dynamic-chat-width: 1030.4px; }
html[data-dynamic-chat-width='hermes'] { --dynamic-chat-width: 100%; }

/* Keep the native thread and dock aligned without changing HUD geometry. */
html[data-dynamic-chat-width] [data-chat-surface]:not([data-hud-shell], [data-hud-shell] *) {
  --composer-width: var(--dynamic-chat-width) !important;
}

/* Preserve the native 5px grab margin on each side and popped-out sizing. */
html[data-dynamic-chat-width] [data-chat-surface]:not([data-hud-shell], [data-hud-shell] *) [data-slot='composer-dock']:not([data-popped-out], [data-hud-shell] *) {
  width: calc(min(var(--dynamic-chat-width), calc(100% - 2rem)) + 10px) !important;
  max-width: calc(100% - 22px) !important;
}

/* Full width must match the native dock, including in a narrow chat pane. */
html[data-dynamic-chat-width='hermes'] [data-chat-surface]:not([data-hud-shell], [data-hud-shell] *) [data-slot='composer-dock']:not([data-popped-out], [data-hud-shell] *) {
  max-width: 100% !important;
}
`

function normalizeMode(value) {
  return typeof value === 'string' && Object.hasOwn(MODES, value) ? value : 'compact'
}

export default {
  id: ID,
  name: 'Dynamic Chat',
  description: 'Theme-independent composer and chat width presets.',
  defaultEnabled: false,
  register(ctx) {
    const doc = globalThis.document
    const win = globalThis.window
    if (doc && (activeDocuments.has(doc) || doc.documentElement?.hasAttribute(ATTRIBUTE))) {
      throw new Error('Dynamic Chat is already active.')
    }
    if (doc) activeDocuments.add(doc)
    let disposed = false
    let style = null
    let root = null
    let current = 'compact'
    let listening = false

    // The SDK masks missing keys, malformed JSON and unavailable storage alike.
    // Read only our raw namespace so failures cannot become an editable default.
    const readRaw = () => {
      if (win) {
        const raw = win.localStorage.getItem(`hermes.plugin.${ID}.${STORAGE_KEY}`)
        return raw === null ? null : JSON.parse(raw)
      }
      return ctx.storage.get(STORAGE_KEY, null)
    }
    const read = () => normalizeMode(readRaw())
    const notify = () => host.notify({ kind: 'error', message: 'Dynamic Chat could not save the composer width. The previous layout is unchanged.' })
    const apply = mode => {
      current = mode
      if (root) root.setAttribute(ATTRIBUTE, mode)
    }
    const synchronize = () => {
      if (disposed) return
      try { apply(read()) } catch { /* Keep the last usable layout during a storage read failure. */ }
    }
    const onStorage = event => {
      if (event.key === null || event.key === `hermes.plugin.${ID}.${STORAGE_KEY}`) synchronize()
    }
    const cleanup = () => {
      if (disposed) return
      disposed = true
      doc?.removeEventListener('DOMContentLoaded', start)
      if (listening) win?.removeEventListener('storage', onStorage)
      style?.remove()
      if (root?.getAttribute(ATTRIBUTE) === current) root.removeAttribute(ATTRIBUTE)
      if (doc) activeDocuments.delete(doc)
      root = null
    }
    const start = () => {
      if (disposed || !doc?.head) return
      try {
        if (doc.documentElement.hasAttribute(ATTRIBUTE)) throw new Error('Dynamic Chat is already active.')
        root = doc.documentElement
        style = doc.createElement('style')
        style.setAttribute('data-dynamic-chat-owned', 'style')
        style.textContent = CSS
        doc.head.appendChild(style)
        apply(current)
        win?.addEventListener('storage', onStorage)
        listening = true
      } catch (error) {
        cleanup()
        throw error
      }
    }

    ctx.onDispose(cleanup)
    try {
      try { current = read() } catch { /* Initial read failures use the compact preset without writing. */ }
      ctx.register({
        id: 'composer-width',
        area: PALETTE_AREA,
        data: {
          id: `${ID}.composer-width`,
          label: 'Dynamic Chat: Composer width',
          detail: () => MODES[current].label,
          detailVariant: 'state',
          keepOpen: true,
          keywords: ['composer', 'chat', 'width', 'compact', 'wide', 'full', 'hermes'],
          run: () => {
            if (disposed) return false
            try {
              const next = MODES[read()].next
              ctx.storage.set(STORAGE_KEY, next)
              if (readRaw() !== next) throw new Error('Composer width persistence failed.')
              apply(next)
              return true
            } catch {
              notify()
              return false
            }
          }
        }
      })
      if (doc?.head) start()
      else doc?.addEventListener('DOMContentLoaded', start, { once: true })
    } catch (error) {
      cleanup()
      throw error
    }
  }
}
