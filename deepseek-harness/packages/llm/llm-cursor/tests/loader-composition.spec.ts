import { describe, expect, it } from 'vitest'
import * as plugin from '../src/index.ts'

describe('llm-cursor composition contract', () => {
  it('exports the Loader function-plugin protocol', () => {
    expect(plugin.name).toBe('llm-cursor')
    expect(plugin.inject).toEqual(['llm'])
    expect(plugin.apply).toBeTypeOf('function')
    expect(plugin.Config).toBeDefined()
    expect(plugin.Config()).toMatchObject({
      apiKeyEnv: 'CURSOR_ACCESS_TOKEN',
      transportMode: 'native',
      defaultModel: 'composer-2.5',
      clientVersion: '3.17.21',
      models: [{ id: 'composer-2.5', name: 'Composer 2.5', contextWindow: 200_000, maxTokens: 32_768 }],
    })
  })
})
