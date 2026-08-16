# 明眸 VisionBridge（dsh-vision-bridge）

给 DeepSeek Harness（dsh）的纯文本模型装上「外挂眼睛」：上传图片时，若当前模型不支持视觉（瞎子模型），自动调用视觉模型识别，把识别文字喂回主模型继续处理——全程无感；真视觉模型则保持原生看图，不拦截。

> 纯 ESM 插件，零 node_modules 改动，升级 dsh 不丢，卸载即还原。已在 dsh `0.1.0-rc.6` 实测。

## 特性

- **按模型能力触发**：只有真实不支持图片的模型才走桥接；真视觉模型（如 SiliconFlow Qwen3-VL）原生直连看图。
- **双策略**：`cascade` 自适应级联（快模型先上，空结果/失败自动升级大模型）/ `race` 并发赛跑（首个非空胜出）。
- **设置页可视化配置**：注册 `vision-bridge` 设置命名空间，在 dsh Web 的「设置 → 插件-插件配置」直接改提供商、模型、策略，即时生效。
- **失败不静默**：`annotate`（失败原因作为文字喂给主模型）/ `error`（严格报错）。
- **凭据安全**：API Key 走 dsh 官方凭据服务，不落盘到配置。
- **环境变量兜底**：不写设置页也能用环境变量配置。

## 安装

```bash
dsh plugin --profile web add link:C:/路径/到/dsh-vision-bridge
dsh plugin --profile headless add link:C:/路径/到/dsh-vision-bridge   # 可选
```

重启 `dsh web` 生效。

## 配置

### 方式一：Web 设置页（推荐）

打开 **设置 → 插件-插件配置 → vision-bridge（明眸 VisionBridge）**，改完即时生效。

### 方式二：环境变量

| 变量 | 默认 | 说明 |
|---|---|---|
| `DSH_VISION_ENABLED` | `true` | 总开关 |
| `DSH_VISION_PROVIDERS` | 空（全部） | 生效的主模型 provider 列表，逗号分隔 |
| `DSH_VISION_STRATEGY` | `cascade` | `cascade` / `race` |
| `DSH_VISION_BASE_URL` | `https://api.siliconflow.cn/v1` | 视觉 API 端点 |
| `DSH_VISION_MODEL` | `Qwen/Qwen3-VL-8B-Instruct` | 首选识别模型 |
| `DSH_VISION_MODEL_UPGRADE` | `Qwen/Qwen3-VL-32B-Instruct` | 升级/赛跑模型 |
| `DSH_VISION_API_KEY_ENV` | `SILICONFLOW_API_KEY` | API Key 环境变量引用 |
| `DSH_VISION_FAILURE_MODE` | `annotate` | `annotate` / `error` |
| `DSH_VISION_MAX_TOKENS` | `4096` | 识别最大 token |
| `DSH_VISION_TIMEOUT_MS` | `180000` | 识别超时（毫秒） |
| `DSH_VISION_PROMPT` | 见源码 | 识别提示词 |
| `DSH_VISION_DEBUG` | 关 | `1` 开启调试日志 |

API Key 写入 `~/.dsh/.credentials.yaml`：

```yaml
SILICONFLOW_API_KEY: sk-xxx
```

## 工作原理

1. **闸门放行**：运行时包装 `ctx.llm.resolveModelInfo`。瞎子模型被追加 `image` 模态放行并记录；真视觉模型原样返回、不记录。
2. **pre-step 桥接**：`agent/pre-step` 钩子发现消息含图且「放行记录」命中 → 读取附件 → 视觉模型识别 → 图片块替换为视觉证据文字块。
3. **主模型作答**：替换后的纯文本请求发给主模型（如 quchiai Flash），它基于识别结果回答。

详细设计见源码注释。

## 验证

2026-08-16 实测（同一实例双会话）：

- quchiai Flash（瞎子模型）+ 截图 → 自动桥接，完整读出页面内容；
- SiliconFlow Qwen3-VL-8B（真视觉模型）→ 原生看图，不桥接；
- 设置页修改识别模型为 32B → 桥接文本实时变为 32B 识别；
- web / headless 均正常。

## 许可

MIT。DeepSeek Harness 为 rc 阶段，插件接口可能随上游变化。
