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

function makeTextMessage() {
  return { content: [{ type: 'text', text: 'hello' }] }
}

async function runPlugin(config = {}, visionModels = []) {
  const ctx = createMockContext({ visionModels })
  const dispose = await apply(ctx, config)
  return { ctx, dispose }
}

async function invokePreStep(ctx, agent, messages, signal) {
  const entry = ctx.handlers['agent/pre-step']?.[0]
  assert.ok(entry, 'pre-step handler not registered')
  return entry.handler(
    { agent, signal },
    async () => ({ kind: 'enter', messages }),
  )
}

describe('apply integration', () => {
  it('bridges image when model is blind', async () => {
    const { ctx } = await runPlugin({}, [])
    const decision = await invokePreStep(ctx, makeAgent('test', 'blind'), [makeImageMessage()])
    assert.equal(decision.kind, 'enter')
    const text = decision.messages[0].content[0].text
    assert.match(text, /\[图\]/)
  })

  it('skips bridge when model supports vision', async () => {
    const { ctx } = await runPlugin({}, ['test/vision'])
    const decision = await invokePreStep(ctx, makeAgent('test', 'gpt-4o'), [makeImageMessage()])
    assert.equal(decision.kind, 'enter')
    assert.equal(decision.messages[0].content[0].type, 'image')
  })

  it('skips when message has no image', async () => {
    const { ctx } = await runPlugin({}, [])
    const decision = await invokePreStep(ctx, makeAgent('test', 'blind'), [makeTextMessage()])
    assert.equal(decision.kind, 'enter')
    assert.equal(decision.messages[0].content[0].type, 'text')
  })

  it('skips when provider not in enabled list', async () => {
    const { ctx } = await runPlugin({ providers: ['other'] }, [])
    const decision = await invokePreStep(ctx, makeAgent('test', 'blind'), [makeImageMessage()])
    assert.equal(decision.kind, 'enter')
    assert.equal(decision.messages[0].content[0].type, 'image')
  })

  it('skips when disabled', async () => {
    const { ctx } = await runPlugin({ enabled: false }, [])
    const decision = await invokePreStep(ctx, makeAgent('test', 'blind'), [makeImageMessage()])
    assert.equal(decision.kind, 'enter')
    assert.equal(decision.messages[0].content[0].type, 'image')
  })
})


