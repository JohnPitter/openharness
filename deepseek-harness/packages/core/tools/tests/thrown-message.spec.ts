import { describe, expect, it } from 'vitest'
import { formatThrownMessage } from '../src/thrown-message.ts'

describe('formatThrownMessage', () => {
  it('prefers Error.message, string values, and string message fields', () => {
    expect(formatThrownMessage(new Error('exploded'))).toBe('exploded')
    expect(formatThrownMessage('plain')).toBe('plain')
    expect(formatThrownMessage({ message: 'denied' })).toBe('denied')
  })

  it('renders an agent cancel cause instead of [object Object]', () => {
    expect(formatThrownMessage({ kind: 'user' })).toBe('user')
    expect(formatThrownMessage({ kind: 'hook', reason: 'policy' })).toBe('hook: policy')
    expect(formatThrownMessage({ kind: 'hook', reason: '' })).toBe('hook')
  })

  it('JSON-stringifies other objects and maps a blank object to aborted', () => {
    expect(formatThrownMessage({ code: 7 })).toBe('{"code":7}')
    expect(formatThrownMessage({ message: 1 })).toBe('{"message":1}')
    expect(formatThrownMessage({ toJSON: () => null })).toBe('aborted')
    expect(formatThrownMessage({})).toBe('aborted')
    expect(formatThrownMessage(42)).toBe('42')
    expect(formatThrownMessage(null)).toBe('null')
  })

  it('falls back when inspection and coercion both throw', () => {
    expect(formatThrownMessage(new Proxy({}, {
      getPrototypeOf: () => { throw new Error('prototype trap') },
      has: () => { throw new Error('has trap') },
      get: () => { throw new Error('get trap') },
    }))).toBe('<unprintable thrown value>')
  })
})
