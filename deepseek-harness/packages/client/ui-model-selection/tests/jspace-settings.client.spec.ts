import { describe, expect, it } from 'vitest'
import { JSPACE_PROTOCOL, jspaceProtocolForAssembly, jspaceProtocolText } from '../src/jspace-settings.ts'

describe('jspaceProtocolText', () => {
  it('returns the construction protocol while enabled and omits it while off', () => {
    expect(jspaceProtocolText(true)).toBe(JSPACE_PROTOCOL)
    expect(jspaceProtocolText(false)).toBe('')
  })
})

describe('jspaceProtocolForAssembly', () => {
  it('omits the protocol only for a Workflow planner', () => {
    expect(jspaceProtocolForAssembly(true, 'workflow', 0)).toBe('')
    expect(jspaceProtocolForAssembly(true, 'workflow', 1)).toBe(JSPACE_PROTOCOL)
    expect(jspaceProtocolForAssembly(true, 'standard', 0)).toBe(JSPACE_PROTOCOL)
    expect(jspaceProtocolForAssembly(false, 'workflow', 1)).toBe('')
  })
})
