import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  contentHasImage,
  countImages,
  visibleText,
  errorText,
  friendlyVisionError,
  providerEnabled,
  normalizeConfig,
} from '../lib/utils.mjs'

const defaults = normalizeConfig({})

describe('contentHasImage', () => {
  it('returns false for plain text', () => {
    assert.equal(contentHasImage([{ type: 'text', text: 'hello' }]), false)
  })

  it('returns true for image block', () => {
    assert.equal(contentHasImage([{ type: 'image', attachment: {} }]), true)
  })

  it('returns true for nested image in tool-result', () => {
    assert.equal(
      contentHasImage([
        { type: 'tool-result', content: [{ type: 'image', attachment: {} }] },
      ]),
      true,
    )
  })
})

describe('countImages', () => {
  it('counts flat and nested images', () => {
    const blocks = [
      { type: 'image' },
      { type: 'tool-result', content: [{ type: 'image' }, { type: 'image' }] },
      { type: 'text', text: 'ok' },
    ]
    assert.equal(countImages(blocks), 3)
  })
})

describe('visibleText', () => {
  it('joins text blocks and ignores images', () => {
    const blocks = [
      { type: 'text', text: 'Hello ' },
      { type: 'image' },
      { type: 'text', text: 'world' },
    ]
    assert.equal(visibleText(blocks), 'Hello world')
  })
})

describe('errorText', () => {
  it('flattens newlines and truncates', () => {
    assert.equal(errorText(new Error('a\r\nb\nc')), 'a b c')
  })
})

describe('friendlyVisionError', () => {
  it('recognizes missing key', () => {
    const msg = friendlyVisionError(new Error('视觉 API 密钥缺失（SILICONFLOW_API_KEY 未配置）'), defaults)
    assert.match(msg, /API Key 未配置/)
  })

  it('recognizes HTTP 401', () => {
    const msg = friendlyVisionError(new Error('HTTP 401: unauthorized'), defaults)
    assert.match(msg, /无效或无权限/)
  })

  it('recognizes timeout', () => {
    const msg = friendlyVisionError(new Error('视觉识别超时'), defaults)
    assert.match(msg, /超时/)
  })
})

describe('providerEnabled', () => {
  it('allows all when list is empty', () => {
    assert.equal(providerEnabled('any', []), true)
  })

  it('allows only listed providers', () => {
    assert.equal(providerEnabled('a', ['a', 'b']), true)
    assert.equal(providerEnabled('c', ['a', 'b']), false)
  })
})

describe('normalizeConfig', () => {
  it('applies defaults', () => {
    const cfg = normalizeConfig({})
    assert.equal(cfg.enabled, true)
    assert.equal(cfg.strategy, 'cascade')
    assert.equal(cfg.failureMode, 'annotate')
    assert.equal(cfg.maxTokens, 4096)
    assert.equal(cfg.timeoutMs, 180000)
  })

  it('rejects invalid numbers', () => {
    const cfg = normalizeConfig({ maxTokens: NaN, timeoutMs: -1 })
    assert.equal(cfg.maxTokens, 4096)
    assert.equal(cfg.timeoutMs, 180000)
  })

  it('normalizes providers to array', () => {
    const cfg = normalizeConfig({ providers: undefined })
    assert.deepEqual(cfg.providers, [])
  })
})
