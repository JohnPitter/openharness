/**
 * The settings-nav service: bind, replace, and unbind the shell handler.
 */
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { SettingsNavigation } from '../src/client/settings-nav.ts'

describe('SettingsNavigation', () => {
  it('forwards openSection only while the matching handler is bound', () => {
    const ctx = new Context()
    const nav = new SettingsNavigation(ctx)
    const first = vi.fn()
    const second = vi.fn()
    const unbindFirst = nav.bind(first)
    nav.openSection('models')
    expect(first).toHaveBeenCalledOnce()
    expect(first).toHaveBeenCalledWith('models')

    const unbindSecond = nav.bind(second)
    nav.openSection('general')
    expect(second).toHaveBeenCalledWith('general')
    expect(first).toHaveBeenCalledOnce()

    unbindFirst()
    nav.openSection('plugins')
    expect(second).toHaveBeenCalledTimes(2)

    unbindSecond()
    nav.openSection('models')
    expect(second).toHaveBeenCalledTimes(2)
  })
})
