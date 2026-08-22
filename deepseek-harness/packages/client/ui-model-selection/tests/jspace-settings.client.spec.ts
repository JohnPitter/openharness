import { describe, expect, it } from 'vitest'
import { JSPACE_PROTOCOL, jspaceProtocolText } from '../src/jspace-settings.ts'

describe('jspaceProtocolText', () => {
  it('returns the construction protocol while enabled and omits it while off', () => {
    expect(jspaceProtocolText(true)).toBe(JSPACE_PROTOCOL)
    expect(jspaceProtocolText(false)).toBe('')
  })
})
