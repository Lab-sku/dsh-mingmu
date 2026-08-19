import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { apply } from '../lib/index.mjs'

function createMockContext(options = {}) {
  const handlers = {}
  const effects = []

  const ctx = {
    handlers,
    effects,
    llm: {
      resolveModelInfo: async (provider, model) => {
        const isVision = options.visionModels?.includes(`${provider}/${model}`) ?? false
        return {
          provider,
          id: model,
          name: model,
          inputModalities: isVision ? ['text', 'image'] : ['text'],
        }
      },
      registerConfigurableProviders: () => {},
      listConfigurableProviders: () => [],
    },
    attachments: {
      readImage: async () => ({
        data: Buffer.from('fake-image'),
        ref: { mediaType: 'image/png' },
      }),
    },
    credentials: {
      resolve: async (envName) => ({ value: 'fake-api-key' }),
    },
    settings: {
      register: (ns, schema) => ({
        get: () => ({
          enabled: true,
          providers: [],
          strategy: 'cascade',
          visionBaseURL: 'https://example.com/v1',
          visionModel: 'vision-model',
          visionModelUpgrade: '',
          apiKeyEnv: 'TEST_API_KEY',
          failureMode: 'annotate',
          maxTokens: 100,
          timeoutMs: 5000,
          prompt: 'describe image',
        }),
      }),
      describe: () => [],
    },
    effect: (fn, label) => {
      const dispose = fn()
      effects.push({ label, dispose })
      return dispose
    },
    on: (event, handler, options) => {
      handlers[event] = handlers[event] || []
      handlers[event].push({ handler, options })
      return () => {
        handlers[event] = handlers[event].filter((h) => h.handler !== handler)
      }
    },
    get: (key) => {
      if (key === 'llm') return ctx.llm
      return undefined
    },
  }

  return ctx
}

function makeAgent(provider, model) {
  return { options: { provider, model } }
}

function makeImageMessage() {
  return {
    content: [{ type: 'image', attachment: { name: 'test.png' } }],
  }
}

async function invokePreStep(ctx, agent, messages) {
  const entry = ctx.handlers['agent/pre-step']?.[0]
  assert.ok(entry, 'pre-step handler not registered')
  return entry.handler(
    { agent },
    async () => ({ kind: 'enter', messages }),
  )
}

describe('multi-agent concurrency', () => {
  it('does not confuse state between a blind agent and a vision agent', async () => {
    const ctx = createMockContext({ visionModels: ['test/gpt-4o'] })
    await apply(ctx, {})

    // Agent A: vision model -> should NOT bridge
    const decisionA = await invokePreStep(ctx, makeAgent('test', 'gpt-4o'), [makeImageMessage()])
    assert.equal(decisionA.messages[0].content[0].type, 'image')

    // Agent B: blind model -> should bridge
    const decisionB = await invokePreStep(ctx, makeAgent('test', 'blind'), [makeImageMessage()])
    assert.equal(decisionB.messages[0].content[0].type, 'text')
    assert.match(decisionB.messages[0].content[0].text, /[图]/)

    // Agent C: vision model again -> should still NOT bridge
    const decisionC = await invokePreStep(ctx, makeAgent('test', 'gpt-4o'), [makeImageMessage()])
    assert.equal(decisionC.messages[0].content[0].type, 'image')
  })
})



