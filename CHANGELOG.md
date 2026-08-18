# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/lang/zh-CN/spec/v2.0.0.html).

## [0.1.0] - 2026-08-18

### Changed
- 包名与仓库名从 `dsh-vision-bridge` 重命名为 `dsh-mingmu`，建立独立品牌「明眸」。
- 版本号重置为 `0.1.0`（新包名新起点）。
- README、package.json、文档链接全部同步更新。

### Added
- 真实界面截图与 Mermaid 分流流程图。
- GitHub topics 与 awesome-dsh-plugin 收录说明。

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
