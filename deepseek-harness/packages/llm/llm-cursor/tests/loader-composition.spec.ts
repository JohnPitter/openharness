import { describe, expect, it } from 'vitest'
import * as plugin from '../src/index.ts'

describe('llm-cursor composition contract', () => {
  it('exports the Loader function-plugin protocol', () => {
    expect(plugin.name).toBe('llm-cursor')
    expect(plugin.inject).toEqual(['llm'])
    expect(plugin.apply).toBeTypeOf('function')
    expect(plugin.Config).toBeDefined()
  })
})
