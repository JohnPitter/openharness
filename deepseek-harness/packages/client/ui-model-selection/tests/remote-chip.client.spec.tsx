// @vitest-environment jsdom
/** Sidebar Remote chip: desktop postMessage, QR panel, copy/stop. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { RemoteChipProps } from '../src/client/RemoteChip.tsx'
import { RemoteChip } from '../src/client/RemoteChip.tsx'
import { en } from '../src/client/locales.ts'

afterEach(() => {
  cleanup()
  Object.defineProperty(window, 'parent', { configurable: true, value: window })
  vi.unstubAllGlobals()
})

beforeEach(() => {
  class FakeResizeObserver {
    observe(): void { /* jsdom has no layout */ }
    disconnect(): void { /* jsdom has no layout */ }
    unobserve(): void { /* jsdom has no layout */ }
  }
  vi.stubGlobal('ResizeObserver', FakeResizeObserver)
})

function interpolate(key: keyof typeof en, vars?: Record<string, string>): string {
  let text = en[key]
  if (vars === undefined) return text
  for (const [name, value] of Object.entries(vars)) text = text.replaceAll(`{${name}}`, value)
  return text
}

function mount(wide = true) {
  const unused = (() => { throw new Error('unused') }) as never
  const props: RemoteChipProps = {
    wide,
    t: interpolate as RemoteChipProps['t'],
    useSessions: unused,
    useWorkspaces: unused,
  }
  return render(<RemoteChip {...props} />)
}

function desktopParent(): { postMessage: ReturnType<typeof vi.fn> } {
  const postMessage = vi.fn()
  Object.defineProperty(window, 'parent', { configurable: true, value: { postMessage } })
  return { postMessage }
}

function triggerAria(state: string): string {
  return interpolate('remote.triggerAria', { state })
}

const READY = {
  type: 'openharness:remote-ready',
  url: 'http://192.168.1.20:7788/?token=abc',
  qrDataUrl: 'data:image/png;base64,qq',
} as const

describe('RemoteChip', () => {
  it('shows idle copy on the wide chip', () => {
    mount()
    const trigger = screen.getByRole('button', { name: triggerAria(en['remote.idle']) })
    expect(trigger.textContent).toContain(en['menu.remote'])
    expect(trigger.textContent).toContain(en['remote.idle'])
  })

  it('explains desktop-only when the iframe parent is missing', () => {
    mount()
    fireEvent.click(screen.getByRole('button', { expanded: false }))
    expect(screen.getByRole('dialog', { name: en['remote.panelAria'] })).toBeTruthy()
    expect(screen.getByText(en['remote.desktopOnly'])).toBeTruthy()
  })

  it('asks the desktop shell to enable and renders the QR when ready', async () => {
    const { postMessage } = desktopParent()
    mount()
    fireEvent.click(screen.getByRole('button', { expanded: false }))
    expect(postMessage).toHaveBeenCalledWith({ type: 'openharness:remote-enable' }, '*')
    expect(screen.getByText(en['remote.loading'])).toBeTruthy()
    window.dispatchEvent(new MessageEvent('message', { data: { type: 'noise' } }))
    window.dispatchEvent(new MessageEvent('message', { data: READY }))
    expect((await screen.findByAltText(en['remote.qrAlt'])).getAttribute('src')).toBe(READY.qrDataUrl)
    fireEvent.scroll(window)
    fireEvent.resize(window)
    expect(screen.getByText(READY.url)).toBeTruthy()
    expect(screen.getByText(en['remote.warning'])).toBeTruthy()
    expect(screen.getByRole('button', { name: triggerAria(en['remote.active']) })).toBeTruthy()
  })

  it('shows a shell error that is not the desktop-only copy', async () => {
    desktopParent()
    mount()
    fireEvent.click(screen.getByRole('button', { expanded: false }))
    window.dispatchEvent(new MessageEvent('message', {
      data: { type: 'openharness:remote-ready', error: 'port in use' },
    }))
    expect(await screen.findByText(interpolate('remote.error', { message: 'port in use' }))).toBeTruthy()
  })

  it('copies the link, swallows clipboard denial, and resets the copied label', async () => {
    desktopParent()
    const writeText = vi.fn()
      .mockRejectedValueOnce(new Error('denied'))
      .mockResolvedValueOnce(undefined)
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    })
    mount()
    fireEvent.click(screen.getByRole('button', { expanded: false }))
    window.dispatchEvent(new MessageEvent('message', { data: READY }))
    const copy = await screen.findByRole('button', { name: en['remote.copy'] })
    fireEvent.click(copy)
    await waitFor(() => {
      expect(writeText).toHaveBeenCalledTimes(1)
    })
    expect(screen.getByRole('button', { name: en['remote.copy'] })).toBeTruthy()
    fireEvent.click(copy)
    expect(await screen.findByRole('button', { name: en['remote.copied'] })).toBeTruthy()
    await waitFor(() => {
      expect(screen.getByRole('button', { name: en['remote.copy'] })).toBeTruthy()
    }, { timeout: 2000 })
  }, 10_000)

  it('stops remote through the parent and closes the panel', async () => {
    const { postMessage } = desktopParent()
    mount()
    fireEvent.click(screen.getByRole('button', { expanded: false }))
    window.dispatchEvent(new MessageEvent('message', { data: READY }))
    fireEvent.click(await screen.findByRole('button', { name: en['remote.stop'] }))
    expect(postMessage).toHaveBeenCalledWith({ type: 'openharness:remote-disable' }, '*')
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getByRole('button', { name: triggerAria(en['remote.idle']) })).toBeTruthy()
  })

  it('closes on Escape and outside pointerdown', () => {
    mount()
    fireEvent.click(screen.getByRole('button', { expanded: false }))
    expect(screen.getByRole('dialog')).toBeTruthy()
    fireEvent.keyDown(document, { key: 'Tab' })
    expect(screen.getByRole('dialog')).toBeTruthy()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
    fireEvent.click(screen.getByRole('button', { expanded: false }))
    fireEvent.pointerDown(document.body)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('keeps the panel open when the pointer stays inside', () => {
    mount()
    fireEvent.click(screen.getByRole('button', { expanded: false }))
    fireEvent.pointerDown(screen.getByRole('dialog'))
    expect(screen.getByRole('dialog')).toBeTruthy()
  })

  it('toggles the panel from the chip', () => {
    mount()
    const trigger = screen.getByRole('button', { expanded: false })
    fireEvent.click(trigger)
    expect(screen.getByRole('dialog')).toBeTruthy()
    fireEvent.click(trigger)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('renders the rail trigger without the wide label', () => {
    mount(false)
    const trigger = screen.getByRole('button', { expanded: false })
    expect(trigger.textContent).toBe('')
  })

  it('fixes the rail panel to the viewport so the sidebar clip cannot hide it', () => {
    mount(false)
    fireEvent.click(screen.getByRole('button', { expanded: false }))
    const dialog = screen.getByRole('dialog', { name: en['remote.panelAria'] })
    expect(dialog.style.width).toBe('240px')
  })

  it('places the panel without ResizeObserver', () => {
    vi.unstubAllGlobals()
    vi.stubGlobal('ResizeObserver', undefined)
    mount()
    fireEvent.click(screen.getByRole('button', { expanded: false }))
    expect(screen.getByRole('dialog').style.width).toBe('240px')
  })

  it('ignores a second enable while connecting', async () => {
    const { postMessage } = desktopParent()
    mount()
    fireEvent.click(screen.getByRole('button', { expanded: false }))
    await waitFor(() => {
      expect(postMessage).toHaveBeenCalledTimes(1)
    })
    expect(screen.getByText(en['remote.connecting'])).toBeTruthy()
  })

  it('stops locally when there is no desktop parent', async () => {
    mount()
    fireEvent.click(screen.getByRole('button', { expanded: false }))
    window.dispatchEvent(new MessageEvent('message', { data: READY }))
    fireEvent.click(await screen.findByRole('button', { name: en['remote.stop'] }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getByRole('button', { name: triggerAria(en['remote.idle']) })).toBeTruthy()
  })
})
