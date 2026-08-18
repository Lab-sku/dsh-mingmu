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
        const isVision = options.nativeVisionModels?.includes(`${provider}/${model}`) ?? false
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
          visionModels: [],
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

describe('user model setup', () => {
  // DeepSeek 官方（deepseek-official）无论模型名如何，按 resolveModelInfo 结果判断
  it('bridges deepseek-official blind model', async () => {
    const ctx = createMockContext({ nativeVisionModels: [] })
    await apply(ctx, {})
    const decision = await invokePreStep(ctx, makeAgent('deepseek-official', 'deepseek-v4-flash'), [makeImageMessage()])
    assert.equal(decision.messages[0].content[0].type, 'text')
    assert.match(decision.messages[0].content[0].text, /系统视觉桥接/)
  })

  // QuchiAI 中的 DeepSeek-V4-Flash 也是瞎子模型
  it('bridges quchiai DeepSeek-V4-Flash', async () => {
    const ctx = createMockContext({ nativeVisionModels: [] })
    await apply(ctx, {})
    const decision = await invokePreStep(ctx, makeAgent('quchiai', 'deepseek-ai/DeepSeek-V4-Flash'), [makeImageMessage()])
    assert.equal(decision.messages[0].content[0].type, 'text')
    assert.match(decision.messages[0].content[0].text, /系统视觉桥接/)
  })

  // QuchiAI 中的 MiniMax-M3 被 dsh 错误标为 text-only，通过 visionModels 白名单强制视为视觉模型
  it('skips bridge for quchiai MiniMax-M3 via force-vision allowlist', async () => {
    const ctx = createMockContext({ nativeVisionModels: [] })
    await apply(ctx, { visionModels: ['quchiai/MiniMax/MiniMax-M3'] })
    const decision = await invokePreStep(ctx, makeAgent('quchiai', 'MiniMax/MiniMax-M3'), [makeImageMessage()])
    assert.equal(decision.messages[0].content[0].type, 'image')
  })

  // 白名单支持只写 model ID
  it('skips bridge for model ID in force-vision allowlist', async () => {
    const ctx = createMockContext({ nativeVisionModels: [] })
    await apply(ctx, { visionModels: ['MiniMax/MiniMax-M3'] })
    const decision = await invokePreStep(ctx, makeAgent('quchiai', 'MiniMax/MiniMax-M3'), [makeImageMessage()])
    assert.equal(decision.messages[0].content[0].type, 'image')
  })

  // QuchiAI 中的 Kimi-K2.7-Code 通过白名单强制视为视觉模型
  it('skips bridge for quchiai Kimi-K2.7-Code via force-vision allowlist', async () => {
    const ctx = createMockContext({ nativeVisionModels: [] })
    await apply(ctx, { visionModels: ['moonshotai/Kimi-K2.7-Code'] })
    const decision = await invokePreStep(ctx, makeAgent('quchiai', 'moonshotai/Kimi-K2.7-Code'), [makeImageMessage()])
    assert.equal(decision.messages[0].content[0].type, 'image')
  })

  // dsh 正确声明视觉模型时仍然原生通过
  it('skips bridge when dsh reports native vision', async () => {
    const ctx = createMockContext({ nativeVisionModels: ['quchiai/MiniMax/MiniMax-M3'] })
    await apply(ctx, {})
    const decision = await invokePreStep(ctx, makeAgent('quchiai', 'MiniMax/MiniMax-M3'), [makeImageMessage()])
    assert.equal(decision.messages[0].content[0].type, 'image')
  })

  // 默认内置白名单：无需用户配置，MiniMax / Kimi 自动视为视觉模型
  it('treats quchiai MiniMax-M3 as vision out of the box', async () => {
    const ctx = createMockContext({ nativeVisionModels: [] })
    await apply(ctx, {})
    const decision = await invokePreStep(ctx, makeAgent('quchiai', 'MiniMax/MiniMax-M3'), [makeImageMessage()])
    assert.equal(decision.messages[0].content[0].type, 'image')
  })

  it('treats quchiai Kimi-K2.7-Code as vision out of the box', async () => {
    const ctx = createMockContext({ nativeVisionModels: [] })
    await apply(ctx, {})
    const decision = await invokePreStep(ctx, makeAgent('quchiai', 'moonshotai/Kimi-K2.7-Code'), [makeImageMessage()])
    assert.equal(decision.messages[0].content[0].type, 'image')
  })
})

describe('admission bridge', () => {
  it('adds image modality to blind models', async () => {
    const ctx = createMockContext({ nativeVisionModels: [] })
    await apply(ctx, {})
    const info = await ctx.llm.resolveModelInfo('quchiai', 'deepseek-ai/DeepSeek-V4-Flash')
    assert.ok(info.inputModalities.includes('image'))
  })

  it('does not alter vision model modalities', async () => {
    const ctx = createMockContext({ nativeVisionModels: ['quchiai/MiniMax/MiniMax-M3'] })
    await apply(ctx, {})
    const info = await ctx.llm.resolveModelInfo('quchiai', 'MiniMax/MiniMax-M3')
    assert.ok(info.inputModalities.includes('image'))
    assert.ok(info.inputModalities.includes('text'))
  })

  it('does not add image when provider list is restricted', async () => {
    const ctx = createMockContext({ nativeVisionModels: [] })
    await apply(ctx, { providers: ['deepseek-official'] })
    const info = await ctx.llm.resolveModelInfo('quchiai', 'deepseek-ai/DeepSeek-V4-Flash')
    assert.ok(!info.inputModalities.includes('image'))
  })

  it('does not add image when disabled', async () => {
    const ctx = createMockContext({ nativeVisionModels: [] })
    await apply(ctx, { enabled: false })
    const info = await ctx.llm.resolveModelInfo('quchiai', 'deepseek-ai/DeepSeek-V4-Flash')
    assert.ok(!info.inputModalities.includes('image'))
  })
})
