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
import {
  contentHasImage,
  countImages,
  visibleText,
  errorText,
  friendlyVisionError,
  providerEnabled,
  normalizeConfig,
} from './utils.mjs'
import { isVisionModel } from './model-capabilities.mjs'

export const name = 'dsh-vision-bridge'

/** 用户可扩展的视觉模型白名单（精确兜底）。 */
const DEFAULT_VISION_MODELS = []

/** 合并用户自定义白名单与内置默认。 */
function effectiveVisionModels(userList) {
  const user = Array.isArray(userList) ? userList.map((s) => String(s).trim()).filter(Boolean) : []
  return Array.from(new Set([...DEFAULT_VISION_MODELS, ...user]))
}

/** 保存未包装的 resolveModelInfo，用于 pre-step 中真实判断模型是否支持视觉。 */
let originalResolveModelInfo = null

/** AbortSignal.any 兼容辅助（Node 18 fallback）。 */
function anySignal(signals) {
  if (typeof AbortSignal.any === 'function') return AbortSignal.any(signals)
  const ctrl = new AbortController()
  const cleanup = []
  for (const signal of signals) {
    if (!signal) continue
    if (signal.aborted) {
      ctrl.abort(signal.reason)
      break
    }
    const handler = () => ctrl.abort(signal.reason)
    signal.addEventListener('abort', handler, { once: true })
    cleanup.push(() => signal.removeEventListener('abort', handler))
  }
  if (!ctrl.signal.aborted) {
    ctrl.signal.addEventListener('abort', () => cleanup.forEach((fn) => fn()), { once: true })
  }
  return ctrl.signal
}

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

/** 加载 schemastery：优先 ESM 动态 import（npm 安装场景），失败后回退到 profile 的 createRequire（本地 link 场景）。 */
async function loadSchemastery() {
  if (schemasteryCache !== undefined) return schemasteryCache
  if (schemasteryFailed) return null
  try {
    const mod = await import('@deepseek-ai/schemastery')
    schemasteryCache = mod?.default ?? mod
    return schemasteryCache
  } catch {
    // fallback：本地 link 时 ESM 解析可能失败，从 profile 的 node_modules 取
  }
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
    visionModels: z.array(z.string()).default([]).description('强制视为视觉模型的 provider/model 或 model 列表；解决 dsh 未正确声明某些模型视觉能力的问题'),
    resultPrefix: z.string().default('图').description('桥接结果前缀，留空则完全无感'),
  })
}



/** 运行时包装 resolveModelInfo：为配置的 provider 追加 image 模态（卸载即还原）。
 * 注意：不再用共享可变状态记录“当前模型”，而是把真实能力判断放到 pre-step
 * 里用 agent.options + 未包装的 originalResolveModelInfo 进行，避免多 agent/多
 * turn 并发时状态错乱。 */
function installAdmissionBridge(ctx, getConfig) {
  const llm = ctx.llm
  originalResolveModelInfo = llm.resolveModelInfo.bind(llm)
  const wrapped = async (provider, model, signal) => {
    const info = await originalResolveModelInfo(provider, model, signal)
    const modalities = info.inputModalities
    const cfg = getConfig()
    // 插件关闭或 provider 不在生效列表时，不做任何放行（图片回到官方闸门逻辑）。
    if (!cfg.enabled || !providerEnabled(provider, cfg.providers)) {
      return info
    }
    if (Array.isArray(modalities) && modalities.includes('image')) {
      return info
    }
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
        value: originalResolveModelInfo,
      })
    }
    originalResolveModelInfo = null
  }
}

/**
 * 运行时补丁 llm-pi-ai 等 adapter 的 modelOf：把 visionModels 白名单里的模型
 * 的 input 追加 image，让 dsh 底层不再报 "does not support image input"。
 * 这样用户无需在 settings.yaml 里手动写 llm-pi-ai.providers.<p>.models[].input。
 */
function patchAdapterModelOf(adapter) {
  if (!adapter || typeof adapter.modelOf !== 'function' || adapter.__visionBridgePatched) return
  const debug = process.env.DSH_VISION_DEBUG === '1'
  const original = adapter.modelOf.bind(adapter)
  adapter.modelOf = function (snapshot, provider, model) {
    const resolved = original(snapshot, provider, model)
    const full = `${provider}/${model}`
    // 关键：对底层 adapter 统一追加 image input，使 dsh-llm-pi-ai 在 stream 阶段
    // 不再因为"模型不支持图片"而直接抛 UNSUPPORTED_CONTENT。
    // 真正的视觉/瞎子分流由 pre-step 用真实 inputModalities 判断。
    if (Array.isArray(resolved?.input) && !resolved.input.includes('image')) {
      if (debug) console.log(`[vision-bridge][debug] 为 ${full} 追加 image input`)
      return { ...resolved, input: [...resolved.input, 'image'] }
    }
    if (!Array.isArray(resolved?.input)) {
      if (debug) console.log(`[vision-bridge][debug] 为 ${full} 设置默认 input`)
      return { ...resolved, input: ['text', 'image'] }
    }
    return resolved
  }
  adapter.__visionBridgePatched = true
  if (debug) console.log(`[vision-bridge][debug] patched adapter modelOf: ${adapter?.constructor?.name ?? 'unknown'}`)
}

function installAdapterPatch(ctx) {
  const llm = ctx.llm
  if (!llm || typeof llm.adapters !== 'object') return () => {}
  const debug = process.env.DSH_VISION_DEBUG === '1'
  const patched = new WeakSet()
  const patchAll = () => {
    try {
      const regs = [...llm.adapters.values()]
      if (debug) console.log(`[vision-bridge][debug] adapter patch scan: ${regs.length} registration(s)`)
      for (const registration of regs) {
        const adapter = registration?.adapter
        if (adapter && !patched.has(adapter)) {
          patchAdapterModelOf(adapter)
          patched.add(adapter)
        }
      }
    } catch (error) {
      if (debug) console.warn(`[vision-bridge][debug] adapter patch error: ${error?.message ?? error}`)
    }
  }
  patchAll()
  const dispose = ctx.on('llm/adapters-updated', patchAll)
  // 懒加载保护：dsh 的 adapter 可能晚于插件初始化注册，启动后多扫描几次
  let scanCount = 0
  const maxScans = 6
  const interval = setInterval(() => {
    patchAll()
    scanCount++
    if (scanCount >= maxScans) clearInterval(interval)
  }, 5000)
  return () => {
    clearInterval(interval)
    dispose?.()
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
      signal: signal ? anySignal([signal, ctrl.signal]) : ctrl.signal,
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
        const prefix = config.resultPrefix ?? '[图]'
        const label = total > 1 ? `${prefix}${index}/${total}` : prefix
        const displayName = name && name !== `图片${index}` ? `(${name}) ` : ''
        const header = label ? `[${label}] ` : ''
        return {
          type: 'text',
          text: `${header}${displayName}${text}`,
        }
      } catch (error) {
        if (signal?.aborted) throw signal.reason
        if (config.failureMode === 'error') {
          throw new Error(`视觉桥接失败（图片 ${index}/${total}）：${errorText(error)}`, { cause: error })
        }
        const failPrefix = config.resultPrefix ?? '[图]'
        const failLabel = total > 1 ? `${failPrefix}${index}/${total}` : failPrefix
        const failHeader = failLabel ? `[${failLabel}] ` : ''
        return {
          type: 'text',
          text: `${failHeader}图片识别失败：${friendlyVisionError(error, config)}`,
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

export async function apply(ctx, pluginConfig) {
  const debug = process.env.DSH_VISION_DEBUG === '1'
  if (debug) {
    console.log('[vision-bridge][debug] env ENABLED =', JSON.stringify(process.env.DSH_VISION_ENABLED))
    console.log('[vision-bridge][debug] pluginConfig.enabled =', JSON.stringify(pluginConfig.enabled), 'type =', typeof pluginConfig.enabled)
  }


  // —— 设置页注册（settings 命名空间 + schemastery schema），失败时安静退回环境变量配置 ——
  const z = await loadSchemastery()
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
    try {
      if (settingsScope) {
        const resolved = settingsScope.get()
        const user = settingsUserFields()
        if (debug) console.log('[vision-bridge][debug] readConfig user=', JSON.stringify(user), 'resolved.enabled=', JSON.stringify(resolved.enabled))
        for (const key of Object.keys(user)) {
          if (resolved[key] !== undefined) base[key] = resolved[key]
        }
      }
    } catch (error) {
      if (debug) console.warn(`[vision-bridge][debug] 读取设置失败: ${error?.message ?? error}`)
    }
    base.visionModels = effectiveVisionModels(base.visionModels)
    return base
  }

  const disposeAdmission = ctx.effect(
    () => installAdmissionBridge(ctx, () => readConfig()),
    'dsh-vision-bridge.admission',
  )

  const disposeAdapterPatch = ctx.effect(
    () => installAdapterPatch(ctx),
    'dsh-vision-bridge.adapter-patch',
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

      // 核心判定：直接用 agent.options 里的 provider/model，调用未包装的 resolveModelInfo
      // 判断真实能力；支持图片就原生看图，否则桥接。避免全局可变状态。
      const provider = agent?.options?.provider
      const model = agent?.options?.model
      if (debug) console.log(`[vision-bridge][debug] agent options provider=${provider} model=${model}`)
      if (!provider || !model || !providerEnabled(provider, config.providers)) return decision
      if (typeof originalResolveModelInfo !== 'function') {
        console.warn('[vision-bridge] resolveModelInfo 原始引用未就绪，跳过桥接')
        return decision
      }
      try {
        const info = await originalResolveModelInfo(provider, model, signal)
        const { vision, reason } = isVisionModel(provider, model, info?.inputModalities, config.visionModels)
        if (debug) console.log(`[vision-bridge][debug] real inputModalities=${JSON.stringify(info?.inputModalities)} vision=${vision} reason=${reason}`)
        if (vision) return decision
      } catch (error) {
        if (debug) console.warn(`[vision-bridge][debug] 真实能力检测失败: ${error?.message ?? error}`)
        return decision
      }

      const messages = await rewriteMessages(ctx, config, decision.messages, signal)
      return { kind: 'enter', messages }
    },
    { prepend: true },
  )

  return () => {
    disposeAdmission?.()
    disposeAdapterPatch?.()
  }
}

