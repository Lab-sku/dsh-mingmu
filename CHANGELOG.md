## [0.1.4] - 2026-08-19

### Fixed
- 修复客户端 bundle 注册 ID 仍为 `dsh-vision-bridge` 的问题，统一改为 `dsh-mingmu`，解决 `Failed to load plugins` 错误。
- 修复服务端插件名 `name` 仍为 `dsh-vision-bridge` 的问题，统一改为 `dsh-mingmu`。
## [0.1.3] - 2026-08-19

### Fixed
- 修复 `cordis.patch.yml` 中 bundle 入口仍指向旧包名 `dsh-vision-bridge` 的问题，改名为 `dsh-mingmu`，避免卸载旧包后 `dsh web` 启动报 `ERR_MODULE_NOT_FOUND`。
## [0.1.2] - 2026-08-19

### Changed
- 桥接输出默认从生硬的 `[系统视觉桥接] ... <visual-content>` 改为更自然的 `[图] 内容` 形式，真正接近“无感桥接”。
- 新增 `resultPrefix` 配置项：可自定义前缀（如 `图片`、`Pic`），留空则完全无感。

### Fixed
- 修复默认包装出现双重方括号 `[[图]]` 的问题。
## [0.1.1] - 2026-08-19

### Fixed
- 修复底层 adapter (dsh-llm-pi-ai) 仍对瞎子模型报 `UNSUPPORTED_CONTENT` 的问题：现在统一为所有模型追加 `image` input，真正的视觉/瞎子分流仍由 pre-step 根据真实 `inputModalities` 决定。
- 修复 adapter 懒加载导致 patch 未生效的问题：启动后 30 秒内每 5 秒重新扫描一次 adapter。
- 修复 Kimi-K3 等模型被误判为瞎子模型的问题，新增 `kimi.*vision`、`kimi.*vl` 兜底规则。
- 修复 Qwen3.x 非 VL 模型被误判为视觉模型的问题（移除 `qwen3.[5-9]` 过于宽泛的规则）。
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




