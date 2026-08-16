/**
 * 明眸 VisionBridge —— 自研视觉桥（dsh-vision-bridge）
 *
 * 设计思路（借鉴社区 ds-vision-plugin / oil-oil/dsh-vision，但为自有实现）：
 * 1. 闸门放行：运行时包装 ctx.llm.resolveModelInfo，让选中的纯文本模型对外“支持图片”，
 *    使 Host API 不再在发送前拒绝图片（不动任何源码，卸载即还原）。
 * 2. pre-step 桥接：在 agent/pre-step 钩子里把请求中的图片块替换成“视觉证据”文字块，
 *    主模型（如 quchiai Flash）收到的永远是纯文本。
 * 3. 视觉策略：自适应级联（默认：快模型先上，空结果/失败自动升级大模型）或并发赛跑；
 *    任意 OpenAI 兼容视觉端点可配（默认 SiliconFlow Qwen3-VL）。
 * 4. 失败策略：annotate（把失败原因作为文字喂给主模型，绝不静默丢图）或 error（严格失败）。
 */

import { createRequire } from 'node:module'
import path from 'node:path'

export const name = 'dsh-vision-bridge'

export const inject = ['attachments', 'llm', 'credentials', 'settings']

/** 解析 DSH_HOME（与官方约定一致）。 */
function dshHome() {
  return process.env.DSH_HOME ?? path.join(process.env.USERPROFILE ?? process.env.HOME ?? '', '.dsh')
}

/** 从启动参数里找当前 profile（dsh web / headless）。 */
function argvProfile() {
  const argv = process.argv
  const flag = argv.indexOf('--profile')
  if (flag !== -1 && flag + 1 < argv.length && !argv[flag + 1].startsWith('-')) return argv[flag + 1]
  return 'web'
}

function localProfileDir() {
  return path.join(dshHome(), 'profiles', argvProfile())
}

let schemasteryCache
let schemasteryFailed = false

/** 从 profile 的 node_modules 加载 schemastery（插件是 link 安装，ESM 直接 import 解析不到）。 */
function loadSchemastery() {
  if (schemasteryCache !== undefined) return schemasteryCache
  if (schemasteryFailed) return null
  try {
    const requireFromProfile = createRequire(path.join(localProfileDir(), 'package.json'))
    const mod = requireFromProfile('@deepseek-ai/schemastery')
    schemasteryCache = mod?.default ?? mod
  } catch (error) {
    schemasteryFailed = true
    console.warn(`[vision-bridge] schemastery 加载失败，设置页配置不可用（退回环境变量配置）: ${error?.message ?? error}`)
    return null
  }
  return schemasteryCache
}

/** 加载 dsh-settings 的 settingsNamespace 品牌函数；失败时退化为恒等函数。 */
function loadSettingsApi() {
  try {
    const requireFromProfile = createRequire(path.join(localProfileDir(), 'package.json'))
    const mod = requireFromProfile('@deepseek-ai/dsh-settings')
    return { settingsNamespace: mod?.settingsNamespace ?? ((value) => value) }
  } catch {
    return { settingsNamespace: (value) => value }
  }
}

/** 设置页表单的 schema（字段与配置一一对应，带中文说明）。 */
function buildSettingsSchema(z) {
  return z.object({
    enabled: z.boolean().default(true).description('总开关'),
    providers: z.array(z.string()).default([]).description('生效的主模型 provider，留空 = 全部'),
    strategy: z.union(['cascade', 'race']).default('cascade').description('视觉策略：cascade 级联 / race 并发赛跑'),
    visionBaseURL: z.string().default('https://api.siliconflow.cn/v1').description('视觉 API 端点'),
    visionModel: z.string().default('Qwen/Qwen3-VL-8B-Instruct').description('首选识别模型'),
    visionModelUpgrade: z.string().default('Qwen/Qwen3-VL-32B-Instruct').description('升级/赛跑模型'),
    apiKeyEnv: z.string().default('SILICONFLOW_API_KEY').description('API Key 环境变量引用（key 本身留在凭据文件）'),
    failureMode: z.union(['annotate', 'error']).default('annotate').description('失败策略：annotate 标注 / error 严格报错'),
    maxTokens: z.number().default(4096).description('识别最大 token'),
    timeoutMs: z.number().default(180000).description('识别超时（毫秒）'),
    prompt: z.string().default('请识别并描述这张图片：完整转录所有文字、界面布局、数据与视觉关系。只输出识别结果本身，不要回答用户问题，不要输出思考过程。').description('识别提示词'),
  })
}

/** 消息内容里是否含图片（含 tool-result 嵌套）。 */
function contentHasImage(blocks) {
  if (!Array.isArray(blocks)) return false
  return blocks.some((block) => {
    if (block?.type === 'image') return true
    if (block?.type === 'tool-result' && Array.isArray(block.content)) return contentHasImage(block.content)
    return false
  })
}

function countImages(blocks) {
  if (!Array.isArray(blocks)) return 0
  return blocks.reduce((n, block) => {
    if (block?.type === 'image') return n + 1
    if (block?.type === 'tool-result' && Array.isArray(block.content)) return n + countImages(block.content)
    return n
  }, 0)
}

function visibleText(blocks) {
  if (!Array.isArray(blocks)) return ''
  return blocks
    .flatMap((block) => {
      if (block?.type === 'text') return [block.text]
      if (block?.type === 'tool-result') return [visibleText(block.content)]
      return []
    })
    .join('')
    .trim()
}

function errorText(error) {
  const value = error instanceof Error ? error.message : String(error)
  return value.replace(/[\r\n]+/g, ' ').slice(0, 400)
}

/** 把底层错误翻译成用户能看懂的中文提示（用于 annotate 与 error 模式）。 */
function friendlyVisionError(error, config) {
  const raw = errorText(error)
  if (/密钥缺失|API Key 未配置/.test(raw)) {
    return `视觉 API Key 未配置（${config.apiKeyEnv}）。请到 设置 → 插件 → 明眸 粘贴 Key 并保存，或写入 ~/.dsh/.credentials.yaml。`
  }
  const http = raw.match(/HTTP (\d{3})/)
  if (http !== null) {
    const code = Number(http[1])
    if (code === 401 || code === 403) return `视觉 API Key 无效或无权限（HTTP ${code}）。请检查 Key 是否正确、账户是否欠费。`
    if (code === 429) return `视觉服务请求过于频繁（HTTP 429）。请稍后重试或降低使用频率。`
    if (code >= 500) return `视觉供应商服务异常（HTTP ${code}）。请稍后重试，或确认 ${config.visionBaseURL} 可用。`
    return `视觉服务拒绝请求（HTTP ${code}）：${raw.slice(0, 120)}`
  }
  if (/超时/.test(raw)) return `视觉识别超时（${Math.round(config.timeoutMs / 1000)}s）。图片可能过大或服务繁忙，请重试。`
  if (/返回空结果/.test(raw)) return `视觉模型未返回识别内容（已尝试首选模型${config.visionModelUpgrade ? '与备选模型' : ''}）。请换一张更清晰的图片重试。`
  return `视觉识别失败：${raw}`
}

function providerEnabled(provider, providers) {
  return providers.length === 0 || providers.includes(provider)
}

/** 运行时包装 resolveModelInfo：为配置的 provider 追加 image 模态（卸载即还原）。
 * 关键：记录“本次图片提示词放行时使用的模型” —— 闸门在 prompt 时用会话当前模型调用
 * resolveModelInfo；若该模型是瞎子模型（被追加 image），记入 state.admitted，
 * pre-step 据此决定桥接，完全绕开不可靠的 agent.options。 */
function installAdmissionBridge(ctx, getProviders, state) {
  const llm = ctx.llm
  const original = llm.resolveModelInfo.bind(llm)
  const wrapped = async (provider, model, signal) => {
    const info = await original(provider, model, signal)
    const modalities = info.inputModalities
    if (!providerEnabled(provider, getProviders())) {
      state.admitted = undefined
      return info
    }
    if (Array.isArray(modalities) && modalities.includes('image')) {
      state.admitted = undefined
      return info
    }
    state.admitted = { provider, model }
    return { ...info, inputModalities: [...(modalities ?? []), 'image'] }
  }
  Object.defineProperty(llm, 'resolveModelInfo', {
    configurable: true,
    enumerable: false,
    writable: true,
    value: wrapped,
  })
  return () => {
    if (llm.resolveModelInfo === wrapped) {
      Object.defineProperty(llm, 'resolveModelInfo', {
        configurable: true,
        enumerable: false,
        writable: true,
        value: original,
      })
    }
  }
}

/** 解析视觉 API key：优先凭据服务，其次环境变量。 */
async function resolveApiKey(ctx, envName) {
  try {
    const resolved = await ctx.credentials?.resolve(envName)
    if (resolved?.value) return resolved.value
  } catch {}
  return process.env[envName] ?? undefined
}

/** 调用一个 OpenAI 兼容视觉端点，返回识别文本（失败返回 null）。 */
async function runVision({ ctx, config, data, mediaType, prompt, signal }) {
  const key = await resolveApiKey(ctx, config.apiKeyEnv)
  if (!key) throw new Error(`视觉 API 密钥缺失（${config.apiKeyEnv} 未配置）`)

  const base64 = Buffer.from(data).toString('base64')
  const payload = {
    model: config.visionModel,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          { type: 'image_url', image_url: { url: `data:${mediaType};base64,${base64}` } },
        ],
      },
    ],
    max_tokens: config.maxTokens,
  }
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(new Error('视觉识别超时')), config.timeoutMs)
  try {
    const resp = await fetch(`${config.visionBaseURL.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: signal ? AbortSignal.any([signal, ctrl.signal]) : ctrl.signal,
    })
    if (!resp.ok) {
      const text = await resp.text().catch(() => '')
      throw new Error(`HTTP ${resp.status}: ${text.slice(0, 200)}`)
    }
    const json = await resp.json()
    const content = json?.choices?.[0]?.message?.content
    return typeof content === 'string' && content.trim() ? content.trim() : null
  } finally {
    clearTimeout(timer)
  }
}

/** 视觉策略：cascade 自适应级联 / race 并发赛跑（首个非空胜出）。 */
async function runVisionStrategy({ ctx, config, data, mediaType, prompt, signal }) {
  const models = [config.visionModel]
  if (config.visionModelUpgrade && config.visionModelUpgrade !== config.visionModel) {
    models.push(config.visionModelUpgrade)
  }

  if (config.strategy === 'race') {
    const results = await Promise.all(
      models.map(async (model) => {
        try {
          return { model, text: await runVision({ ctx, config: { ...config, visionModel: model }, data, mediaType, prompt, signal }) }
        } catch (error) {
          return { model, text: null, error }
        }
      }),
    )
    const winner = results.find((r) => r.text)
    if (winner) return { text: winner.text, model: winner.model, errors: results.filter((r) => !r.text).map((r) => errorText(r.error)) }
    throw new Error(results.map((r) => `${r.model}: ${errorText(r.error)}`).join(' | ') || '视觉识别返回空结果')
  }

  // cascade：逐级尝试，空结果/失败自动升级
  const errors = []
  for (const model of models) {
    try {
      const text = await runVision({ ctx, config: { ...config, visionModel: model }, data, mediaType, prompt, signal })
      if (text) return { text, model, errors }
      errors.push(`${model}: 返回空结果`)
    } catch (error) {
      errors.push(`${model}: ${errorText(error)}`)
    }
  }
  throw new Error(errors.join(' | '))
}

/** 把一条消息里的图片块替换为视觉证据文字块。 */
async function rewriteContent(ctx, config, blocks, accompanyingText, counter, total, signal) {
  return Promise.all(
    blocks.map(async (block) => {
      if (block?.type === 'tool-result') {
        return { ...block, content: await rewriteContent(ctx, config, block.content, accompanyingText, counter, total, signal) }
      }
      if (block?.type !== 'image') return block

      const index = ++counter.value
      const name = block.attachment?.name?.trim() || `图片${index}`
      try {
        signal?.throwIfAborted()
        const stored = await ctx.attachments.readImage(block.attachment, signal)
        signal?.throwIfAborted()
        const promptParts = [
          config.prompt,
          `这是第 ${index}/${total} 张图片（${name}）。`,
          accompanyingText ? `用户同时附带的文字说明：\n${accompanyingText}` : '',
        ].filter(Boolean)
        const { text, model } = await runVisionStrategy({
          ctx,
          config,
          data: stored.data,
          mediaType: stored.ref.mediaType,
          prompt: promptParts.join('\n\n'),
          signal,
        })
        return {
          type: 'text',
          text: `[系统视觉桥接] 图片 ${index}/${total}（${name}）已由 ${model} 识别。以下为视觉识别结果，请直接当作图片内容使用：\n<visual-content>\n${text}\n</visual-content>`,
        }
      } catch (error) {
        if (signal?.aborted) throw signal.reason
        if (config.failureMode === 'error') {
          throw new Error(`视觉桥接失败（图片 ${index}/${total}）：${errorText(error)}`, { cause: error })
        }
        return {
          type: 'text',
          text: `[系统视觉桥接] 图片 ${index}/${total}（${name}）识别失败：${friendlyVisionError(error, config)} 请告知用户检查视觉桥配置后重试。`,
        }
      }
    }),
  )
}

async function rewriteMessages(ctx, config, messages, signal) {
  const total = messages.reduce((n, m) => n + countImages(m.content), 0)
  if (total === 0) return messages
  const counter = { value: 0 }
  return Promise.all(
    messages.map(async (message) => {
      if (countImages(message.content) === 0) return message
      const content = await rewriteContent(ctx, config, message.content, visibleText(message.content), counter, total, signal)
      return { ...message, content }
    }),
  )
}

export function apply(ctx, pluginConfig) {
  const debug = process.env.DSH_VISION_DEBUG === '1'

  /** 归一化一份配置（entry 配置 = 环境变量插值后的默认值）。 */
  function normalizeConfig(source) {
    return {
      enabled: source.enabled !== false,
      providers: Array.isArray(source.providers) ? source.providers : [],
      strategy: source.strategy === 'race' ? 'race' : 'cascade',
      visionBaseURL: source.visionBaseURL ?? 'https://api.siliconflow.cn/v1',
      visionModel: source.visionModel ?? 'Qwen/Qwen3-VL-8B-Instruct',
      visionModelUpgrade: source.visionModelUpgrade ?? 'Qwen/Qwen3-VL-32B-Instruct',
      apiKeyEnv: source.apiKeyEnv ?? 'SILICONFLOW_API_KEY',
      failureMode: source.failureMode === 'error' ? 'error' : 'annotate',
      maxTokens: Number(source.maxTokens ?? 4096),
      timeoutMs: Number(source.timeoutMs ?? 180000),
      prompt:
        source.prompt ??
        '请识别并描述这张图片：完整转录所有文字、界面布局、数据与视觉关系。只输出识别结果本身，不要回答用户问题，不要输出思考过程。',
    }
  }

  // —— 设置页注册（settings 命名空间 + schemastery schema），失败时安静退回环境变量配置 ——
  const z = loadSchemastery()
  const { settingsNamespace } = loadSettingsApi()
  let settingsScope = null
  let settingsUserFields = () => ({})
  if (z && ctx.settings?.register) {
    try {
      const ns = settingsNamespace('vision-bridge')
      settingsScope = ctx.settings.register(ns, buildSettingsSchema(z))
      settingsUserFields = () => {
        try {
          const desc = ctx.settings.describe()?.find((d) => d.ns === ns)
          return (desc?.user && typeof desc.user === 'object' ? desc.user : {}) || {}
        } catch {
          return {}
        }
      }
      if (debug) console.log('[vision-bridge][debug] settings 命名空间已注册（设置 → 插件配置 → vision-bridge）')
      if (debug) {
        try {
          const all = ctx.settings.describe().map((d) => String(d.ns))
          console.log(`[vision-bridge][debug] 服务内命名空间: ${JSON.stringify(all)}`)
        } catch (e) {
          console.log(`[vision-bridge][debug] describe 失败: ${e?.message ?? e}`)
        }
      }
      // 关键一步：把自己注册为“可配置提供方”，使 api-proxy 的暴露白名单
      // （listConfigurableProviders().settingsNs）包含 vision-bridge，
      // 设置页（设置 → 插件配置）才能看到并编辑这个命名空间。
      try {
        const llm = ctx.get('llm')
        if (llm && typeof llm.registerConfigurableProviders === 'function' && typeof llm.listConfigurableProviders === 'function') {
          const exists = llm.listConfigurableProviders().some((entry) => entry.provider === 'vision-bridge')
          if (!exists) {
            llm.registerConfigurableProviders([{
              provider: 'vision-bridge',
              displayName: '明眸 VisionBridge（视觉桥）',
              settingsNs: 'vision-bridge',
              settingsPath: [],
            }])
            if (debug) console.log('[vision-bridge][debug] 已注册可配置提供方，设置命名空间已暴露')
          }
        }
      } catch (error) {
        console.warn(`[vision-bridge] 暴露设置失败（设置页可能看不到）：${error?.message ?? error}`)
      }
    } catch (error) {
      console.warn(`[vision-bridge] 设置页注册失败，退回环境变量配置: ${error?.message ?? error}`)
    }
  }

  /**
   * 每次读取生效配置：entry/环境变量为基底，设置页里用户显式改过的字段覆盖之。
   * 只有出现在 describe().user 里的字段才算用户改过，避免 schema 默认值误覆盖环境变量。
   */
  function readConfig() {
    const base = normalizeConfig(pluginConfig)
    if (!settingsScope) return base
    try {
      const resolved = settingsScope.get()
      const user = settingsUserFields()
      for (const key of Object.keys(user)) {
        if (resolved[key] !== undefined) base[key] = resolved[key]
      }
    } catch (error) {
      if (debug) console.warn(`[vision-bridge][debug] 读取设置失败: ${error?.message ?? error}`)
    }
    return base
  }

  const bridgeState = { admitted: undefined }
  const disposeAdmission = ctx.effect(
    () => installAdmissionBridge(ctx, () => readConfig().providers, bridgeState),
    'dsh-vision-bridge.admission',
  )

  ctx.on(
    'agent/pre-step',
    async ({ agent, signal }, next) => {
      if (debug) console.log('[vision-bridge][debug] hook entered')
      const decision = await next()
      const config = readConfig()
      if (debug) console.log(`[vision-bridge][debug] next() kind=${decision?.kind} enabled=${config.enabled} aborted=${signal?.aborted ?? false}`)
      if (decision?.kind === 'reject' || !config.enabled || signal?.aborted) return decision
      const hasImage = decision.messages.some((m) => contentHasImage(m.content))
      if (debug) console.log(`[vision-bridge][debug] messages=${decision.messages.length} hasImage=${hasImage}`)
      if (!hasImage) return decision
      // 核心判定：本次图片提示词刚被闸门放行时用的模型是瞎子模型（admitted 有值）→ 桥接；
      // 真视觉模型或未启用 provider → admitted 为空 → 原生看图。
      if (debug) console.log(`[vision-bridge][debug] admitted=${JSON.stringify(bridgeState.admitted)} bridge=${bridgeState.admitted ? 'yes' : 'skip-native'}`)
      if (!bridgeState.admitted) return decision
      const messages = await rewriteMessages(ctx, config, decision.messages, signal)
      return { kind: 'enter', messages }
    },
    { prepend: true },
  )

  return () => {
    disposeAdmission?.()
  }
}
