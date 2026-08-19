/** 消息内容里是否含图片（含 tool-result 嵌套）。 */
export function contentHasImage(blocks) {
  if (!Array.isArray(blocks)) return false
  return blocks.some((block) => {
    if (block?.type === 'image') return true
    if (block?.type === 'tool-result' && Array.isArray(block.content)) return contentHasImage(block.content)
    return false
  })
}

export function countImages(blocks) {
  if (!Array.isArray(blocks)) return 0
  return blocks.reduce((n, block) => {
    if (block?.type === 'image') return n + 1
    if (block?.type === 'tool-result' && Array.isArray(block.content)) return n + countImages(block.content)
    return n
  }, 0)
}

export function visibleText(blocks) {
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

export function errorText(error) {
  const value = error instanceof Error ? error.message : String(error)
  return value.replace(/[\r\n]+/g, ' ').slice(0, 400)
}

/** 把底层错误翻译成用户能看懂的中文提示（用于 annotate 与 error 模式）。 */
export function friendlyVisionError(error, config) {
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

export function providerEnabled(provider, providers) {
  return providers.length === 0 || providers.includes(provider)
}

/** 归一化一份配置（entry 配置 = 环境变量插值后的默认值）。 */
export function normalizeConfig(source) {
  return {
    enabled: source.enabled !== false,
    providers: Array.isArray(source.providers) ? source.providers : [],
    strategy: source.strategy === 'race' ? 'race' : 'cascade',
    visionBaseURL: source.visionBaseURL ?? 'https://api.siliconflow.cn/v1',
    visionModel: source.visionModel ?? 'Qwen/Qwen3-VL-8B-Instruct',
    visionModelUpgrade: source.visionModelUpgrade ?? 'Qwen/Qwen3-VL-32B-Instruct',
    apiKeyEnv: source.apiKeyEnv ?? 'SILICONFLOW_API_KEY',
    failureMode: source.failureMode === 'error' ? 'error' : 'annotate',
    maxTokens: (() => {
      const n = Number(source.maxTokens ?? 4096)
      return Number.isFinite(n) && n > 0 ? Math.floor(n) : 4096
    })(),
    timeoutMs: (() => {
      const n = Number(source.timeoutMs ?? 180000)
      return Number.isFinite(n) && n > 0 ? Math.floor(n) : 180000
    })(),
    prompt:
      source.prompt ??
      '请识别并描述这张图片：完整转录所有文字、界面布局、数据与视觉关系。只输出识别结果本身，不要回答用户问题，不要输出思考过程。',
    visionModels: Array.isArray(source.visionModels) ? source.visionModels.map((s) => String(s).trim()).filter(Boolean) : [],
    resultPrefix: source.resultPrefix ?? '图',
  }
}

