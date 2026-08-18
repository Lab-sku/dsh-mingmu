# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/lang/zh-CN/spec/v2.0.0.html).


## [0.1.2] - 2026-08-18

### Added
- README 增加 GitHub badges（版本、License、仓库大小），提升可发现性。
- 为 GitHub 仓库添加 topics：deepseek-harness、dsh-plugin、ision-model、lm、multimodal、i-plugin 等。

### Changed
- 无功能变更。

## [0.1.1] - 2026-08-17

### Added
- 新增全球视觉模型启发式识别模块（`lib/model-capabilities.mjs`），覆盖 OpenAI、Anthropic、Google、Meta、Qwen、MiniMax、Kimi、GLM、DeepSeek-VL、Pixtral、Grok、InternVL、LLaVA 等主流家族。
- adapter patch 与 pre-step 统一使用 `isVisionModel()`：真实能力 → 用户白名单 → 启发式识别，三层分流。
- 新增 `VISION_MODELS.md` 维护已识别/未识别的模型列表。
- 新增 `tests/model-capabilities.test.mjs`，覆盖全球模型 ID 的识别与拒绝用例。

### Changed
- 默认硬编码白名单 `DEFAULT_VISION_MODELS` 置空，分流逻辑主要依赖启发式识别；`visionModels` 配置仅作为精确兜底。
- 启发式规则对 pi-ai 官方 catalog 中约 98% 的视觉模型生效。

### Added
- 运行时自动补丁 `dsh-llm-pi-ai` 等 adapter 的 `modelOf`：为内置视觉模型白名单自动注入 `image` input，用户无需再手动声明 `llm-pi-ai.providers.<p>.models[].input`。
- 新增 `effectiveVisionModels` 合并逻辑：内置默认白名单（`MiniMax/MiniMax-M3`、`moonshotai/Kimi-K2.7-Code`）与用户自定义列表自动去重合并。
- 为 adapter patch 增加调试日志（`DSH_VISION_DEBUG=1` 时输出每次 `modelOf` 扫描与命中情况）。
- 新增开箱即用默认白名单的集成测试。

### Fixed
- 修复内置默认白名单常量 `DEFAULT_VISION_MODELS` 未实际生效，导致 MiniMax / Kimi 仍被桥接的问题。
- 修复 adapter patch 在部分 dsh 启动时未正确应用（事件监听 + 启动时全量扫描）。

### Changed
- README 删除“必须手动写 llm-pi-ai.models[].input”的旧说明，改为“内置白名单自动放行，可选扩展”。

## [0.1.0] - 2026-08-17

### Added
- 新增 `visionModels`（强制视觉模型白名单）配置，解决 dsh 未正确声明某些模型视觉能力的问题。
- 明眸 VisionBridge 初版：为 dsh 纯文本模型提供自动视觉识别桥接。
- 支持 cascade（自动升级备选模型）和 race（并发赛跑）两种视觉策略。
- 支持 Web 设置页可视化配置与 API Key 安全写入 dsh 凭据库。
- 支持环境变量兜底配置。
- 失败不静默：annotate / error 两种失败策略。
- 新增针对用户实际模型配置的集成测试（deepseek-official / quchiai DeepSeek / quchiai MiniMax / quchiai Kimi）。
- 新增 admission bridge 单元测试，验证 resolveModelInfo 包装行为。

### Fixed
- 修复 dsh `llm-pi-ai` 因模型未声明 `input: [text, image]` 而拒绝发送图片的问题，并补充 README 配置说明。
- 修复 `providers` 设置项在 UI 中为字符串、schema 要求数组导致保存失败的问题。
- 修复 `bridgeState.admitted` 共享可变状态可能引发的多 agent/多 turn 并发误判。
- 修复 `AbortSignal.any` 在 Node 18 下的兼容性。
- 修复设置页 `useSyncExternalStore` pending snapshot 不稳定导致的无限重渲染。
- 统一 `package.json` 与 `README.md` 的 Node.js 版本声明为 `>=22.19.0`（跟随 dsh 最低版本）。
