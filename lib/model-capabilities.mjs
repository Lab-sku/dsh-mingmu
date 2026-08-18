/**
 * 视觉模型启发式识别。
 *
 * dsh 只认 `model.input` 里有没有 `"image"`。对于自定义 provider（quchiai、SiliconFlow、
 * OpenRouter 等），dsh 往往拿不到正确元数据，只能默认 `input: ["text"]`。
 *
 * 这里维护一份按模型 ID / 名字匹配的启发式规则，覆盖全球主流视觉模型家族。
 * 规则按“宁可漏掉也不乱放行”设计，但随着 pi-ai catalog 演进会持续补充。
 */

/**
 * 已知视觉模型家族的正则（大小写不敏感）。
 * 顺序无关，均为独立规则。
 */
export const VISION_MODEL_PATTERNS = [
  // OpenAI
  /(?:^|[^a-z0-9])gpt-4o/i,
  /(?:^|[^a-z0-9])gpt-4[-.]?turbo/i,
  /(?:^|[^a-z0-9])gpt-4\.1/i,
  /(?:^|[^a-z0-9])gpt-5/i,
  /(?:^|[^a-z0-9])gpt-realtime/i,
  /(?:^|[^a-z0-9])gpt-(?:chat|mini|nano)?-?latest/i,
  /(?:^|[^a-z0-9])o[1-9]/i,

  // Anthropic
  /(?:^|[^a-z0-9])claude-3/i,
  /(?:^|[^a-z0-9])claude-4/i,
  /(?:^|[^a-z0-9])claude-fable/i,
  /(?:^|[^a-z0-9])claude-haiku/i,
  /(?:^|[^a-z0-9])claude-sonnet/i,
  /(?:^|[^a-z0-9])claude-opus/i,

  // Google
  /(?:^|[^a-z0-9])gemini-/i,
  /(?:^|[^a-z0-9])gemma-[3-9]/i,

  // Meta
  /(?:^|[^a-z0-9])llama.*vision/i,
  /(?:^|[^a-z0-9])llama-?4/i,

  // Alibaba / Qwen
  /(?:^|[^a-z0-9])qwen.*vl/i,
  /(?:^|[^a-z0-9])qwen2\.5-vl/i,
  /(?:^|[^a-z0-9])qwen3-vl/i,
  /(?:^|[^a-z0-9])qwen3\.?[5-9]/i,
  /(?:^|[^a-z0-9])qwen3p[5-9]/i,

  // MiniMax
  /(?:^|[^a-z0-9])minimax-m3/i,

  // Moonshot / Kimi
  /(?:^|[^a-z0-9])kimi-k2\.[5-9]/i,
  /(?:^|[^a-z0-9])kimi-k2p[5-9]/i,
  /(?:^|[^a-z0-9])kimi-k3/i,
  /(?:^|[^a-z0-9])kimi-coding/i,
  /(?:^|[^a-z0-9])kimi-for-coding/i,
  /(?:^|[^a-z0-9])kimi-latest/i,

  // Zhipu / GLM
  /(?:^|[^a-z0-9])glm-?\d+v/i,
  /(?:^|[^a-z0-9])glm-?\d+\.?\d*v/i,

  // DeepSeek
  /(?:^|[^a-z0-9])deepseek.*vl/i,
  /(?:^|[^a-z0-9])deepseek.*janus/i,

  // Mistral / Pixtral
  /(?:^|[^a-z0-9])pixtral/i,
  /(?:^|[^a-z0-9])mistral[\\/-](?:large|small|medium|ministral|magistral|devstral).*-2[5-9]/i,
  /(?:^|[^a-z0-9])mistral-(?:large|small|medium)-latest/i,
  /(?:^|[^a-z0-9])mistral-(?:large|small|medium)-3(?:[-\.]|$)/i,
  /(?:^|[^a-z0-9])magistral/i,
  /(?:^|[^a-z0-9])devstral/i,
  /(?:^|[^a-z0-9])ministral/i,

  // xAI
  /(?:^|[^a-z0-9])grok/i,

  // Amazon Nova
  /(?:^|[^a-z0-9])nova-(?:lite|pro|premier|2)/i,

  // Stepfun
  /(?:^|[^a-z0-9])step-3\./i,

  // 01.AI / Yi
  /(?:^|[^a-z0-9])yi-.*vl/i,

  // OpenGVLab
  /(?:^|[^a-z0-9])internvl/i,

  // LLaVA
  /(?:^|[^a-z0-9])llava/i,

  // THUDM CogVLM
  /(?:^|[^a-z0-9])cogvlm/i,

  // 通用 -vl 后缀兜底
  /(?:^|[^a-z0-9])[a-z0-9_.-]+-vl(?:[-\\/:]|$)/i,

  // ByteDance Seed
  /(?:^|[^a-z0-9])seed-(?:1\.|2\.)/i,

  // Xiaomi Mimo
  /(?:^|[^a-z0-9])mimo/i,

  // 其他小众但确定支持视觉的模型
  /(?:^|[^a-z0-9])inkling/i,
  /(?:^|[^a-z0-9])fugu/i,
  /(?:^|[^a-z0-9])muse-spark/i,
  /(?:^|[^a-z0-9])reka/i,
  /(?:^|[^a-z0-9])nemotron/i,
]

/**
 * 明确排除的模型（名字看起来像视觉模型但实际上不支持图像输入）。
 */
export const VISION_MODEL_DENYLIST = [
  /claude-2/i,
  /claude-instant-1/i,
  /gpt-4$/,
  /gpt-3/i,
  /text-davinci/i,
  /glm-4-?air/i,
]

function normalizeModelId(modelId) {
  return String(modelId ?? '').toLowerCase().replace(/_/g, '-')
}

export function guessVisionModel(modelId) {
  const normalized = normalizeModelId(modelId)
  if (VISION_MODEL_DENYLIST.some((re) => re.test(normalized))) {
    return false
  }
  return VISION_MODEL_PATTERNS.some((re) => re.test(normalized))
}

export function isVisionModel(provider, modelId, realInputModalities, userVisionModels = []) {
  if (Array.isArray(realInputModalities) && realInputModalities.includes('image')) {
    return { vision: true, reason: 'native' }
  }

  const full = `${provider}/${modelId}`
  const userMatch = userVisionModels.some((entry) => {
    const trimmed = String(entry).trim()
    return trimmed === full || trimmed === modelId
  })
  if (userMatch) {
    return { vision: true, reason: 'allowlist' }
  }

  if (guessVisionModel(modelId)) {
    return { vision: true, reason: 'heuristic' }
  }

  return { vision: false, reason: 'blind' }
}
