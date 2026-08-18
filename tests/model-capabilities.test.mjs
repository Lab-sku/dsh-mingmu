import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { guessVisionModel, isVisionModel } from '../lib/model-capabilities.mjs'

describe('guessVisionModel heuristic', () => {
  const visionCases = [
    // OpenAI
    ['openai/gpt-4o', true],
    ['openai/gpt-4-turbo', true],
    ['openai/gpt-4.1', true],
    ['openai/gpt-5', true],
    ['openai/gpt-4o-mini', true],
    // Anthropic
    ['anthropic/claude-3-5-sonnet', true],
    ['anthropic/claude-opus-4', true],
    ['anthropic/claude-haiku-4-5', true],
    // Google
    ['google/gemini-2.5-pro', true],
    // Meta
    ['meta/llama-3.2-11b-vision-instruct', true],
    // Qwen / SiliconFlow
    ['Qwen/Qwen3-VL-8B-Instruct', true],
    ['Qwen/Qwen2.5-VL-32B-Instruct', true],
    // MiniMax
    ['MiniMax/MiniMax-M3', true],
    ['together/MiniMaxAI/MiniMax-M3', true],
    ['quchiai/MiniMax/MiniMax-M3', true],
    // Kimi
    ['moonshotai/kimi-k2.7-code', true],
    ['quchiai/moonshotai/Kimi-K2.7-Code', true],
    ['openrouter/moonshotai/kimi-k2.7-code', true],
    // GLM vision
    ['zai/glm-5v-turbo', true],
    ['THUDM/glm-4v-9b', true],
    // DeepSeek vision
    ['deepseek-ai/DeepSeek-VL2', true],
    ['deepseek-ai/Janus-Pro-7B', true],
    // xAI
    ['xai/grok-4', true],
  ]

  const blindCases = [
    ['openai/gpt-4', false],
    ['openai/gpt-3.5-turbo', false],
    ['anthropic/claude-2', false],
    ['deepseek-ai/DeepSeek-V4-Flash', false],
    ['deepseek-ai/DeepSeek-V3', false],
    ['ZhipuAI/GLM-5.2', false],
    ['ZhipuAI/GLM-5.2-FP8', false],
    ['Qwen/Qwen3.6-27B', true],
    ['Qwen/Qwen-Turbo', false],
  ]

  for (const [modelId, expected] of [...visionCases, ...blindCases]) {
    it(`${expected ? 'detects' : 'rejects'} ${modelId}`, () => {
      assert.equal(guessVisionModel(modelId), expected, modelId)
    })
  }
})

describe('isVisionModel unified decision', () => {
  it('trusts native inputModalities', () => {
    const result = isVisionModel('any', 'any', ['text', 'image'], [])
    assert.equal(result.vision, true)
    assert.equal(result.reason, 'native')
  })

  it('trusts user allowlist over heuristic', () => {
    const result = isVisionModel('custom', 'my-model', ['text'], ['custom/my-model'])
    assert.equal(result.vision, true)
    assert.equal(result.reason, 'allowlist')
  })

  it('falls back to heuristic when dsh is wrong', () => {
    const result = isVisionModel('quchiai', 'MiniMax/MiniMax-M3', ['text'], [])
    assert.equal(result.vision, true)
    assert.equal(result.reason, 'heuristic')
  })

  it('marks unknown models as blind', () => {
    const result = isVisionModel('quchiai', 'deepseek-ai/DeepSeek-V4-Flash', ['text'], [])
    assert.equal(result.vision, false)
    assert.equal(result.reason, 'blind')
  })
})
