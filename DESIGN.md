# 明眸 VisionBridge 非侵入式接入设计

> 目标：说清楚 dsh 是怎么加载插件的，以及明眸如何在不改 dsh 一行源码的前提下，让“瞎子模型”自动获得视觉能力。

---

## 1. dsh 的插件加载机制（cordis + bundle patch）

### 1.1 三层补丁栈

`dsh web` 启动时，`@deepseek-ai/dsh/lib/profile-boot-DG5t9aNs.js` 会按固定顺序把配置合并成一棵 cordis entry tree：

1. **bundle patches**：`~/.dsh/profiles/<profile>/package.json` 里 `dsh.profile.bundles` 列出的每个包，按顺序读其 `package.json` 的 `dsh.bundle.patch`，得到 patch 列表。
2. **profile patch**：`~/.dsh/profiles/<profile>/cordis.patch.yml`。
3. **home patch**：`~/.dsh/cordis.patch.yml`（全局偏好，覆盖 profile）。
4. **`--patch` overlays**：命令行临时覆盖。

`dsh-app-boot/lib/index.js:526` 里的 `loadProfile()` 负责把每个 bundle 的 `dsh.bundle.patch` 解析成 `patchPath` + `patches`。`composeProfile()` 再把这些 patches 通过 `composeEntries()` 合成最终的 cordis 配置。

### 1.2 从 patch 到插件实例

明眸的 `package.json` 声明：

```json
"dsh": {
  "bundle": {
    "patch": "./cordis.patch.yml"
  }
}
```

`cordis.patch.yml` 只干一件事：往 cordis entry tree 里插入一个 entry：

```yaml
- insert:
    - id: vision-bridge
      name: dsh-vision-bridge
      config:
        enabled: !!js process.env.DSH_VISION_ENABLED !== 'false'
        ...
```

`@deepseek-ai/cordis-plugin-loader` 拿到这个 entry 后：

1. `import('dsh-vision-bridge')` 加载模块（`lib/index.mjs`）。
2. 校验 `inject: ['attachments', 'llm', 'credentials', 'settings']`，确保这些服务先存在。
3. 调用 `ctx.registry.plugin(plugin, config)`，即执行插件导出的 `apply(ctx, pluginConfig)`。
4. `apply` 返回的 dispose 函数被 cordis 托管；插件被卸载/停用时自动还原所有副作用。

**这就是“非侵入式”的底层保证**：明眸只是一个被 cordis loader 动态挂载的 plugin fiber，不修改 dsh 源码，也不改核心配置，卸载即还原。

---

## 2. 明眸的三处运行时钩子

### 2.1 Admission Bridge：让 UI 允许瞎子模型“收图”

dsh 前端/Host 在发送含图消息前，会调用 `ctx.llm.resolveModelInfo(provider, model)` 检查 `inputModalities`。如果返回只有 `text`，UI 会拒绝上传。

明眸在 `apply()` 里保存原始的 `llm.resolveModelInfo`，然后替换成一个包装函数：

```js
originalResolveModelInfo = llm.resolveModelInfo.bind(llm)
llm.resolveModelInfo = async (provider, model, signal) => {
  const info = await originalResolveModelInfo(provider, model, signal)
  if (!info.inputModalities?.includes('image')) {
    return { ...info, inputModalities: [...info.inputModalities, 'image'] }
  }
  return info
}
```

这样前端就能正常粘贴图片。真实能力判断不依赖这个包装，而是靠下面两处。

### 2.2 Adapter Patch：绕过 `dsh-llm-pi-ai` 的硬性抛错

`dsh-llm-pi-ai/lib/index.js:827` 在 `stream()` 里直接检查 `model.input.includes('image')`：

```js
if (containsImage && !model.input.includes("image"))
  throw new LlmError(`pi-ai model "${model.id}" does not support image input`, "UNSUPPORTED_CONTENT");
```

这个 `model` 来自 `adapter.modelOf(snapshot, provider, model)`，而 `modelOf` 读取的是 pi-ai catalog 或 `settings.yaml` 里声明的 `input`。

明眸在 `installAdapterPatch()` 中监听 `llm/adapters-updated` 事件，并把每个 adapter 的 `modelOf` 包一层：

```js
adapter.modelOf = function (snapshot, provider, model) {
  const resolved = original(snapshot, provider, model)
  const full = `${provider}/${model}`
  if (visionModels.includes(full) && !resolved.input.includes('image')) {
    return { ...resolved, input: [...resolved.input, 'image'] }
  }
  return resolved
}
```

对 `quchiai/MiniMax/MiniMax-M3`、`quchiai/moonshotai/Kimi-K2.7-Code` 这类被 dsh 误标为 text-only 的视觉模型，运行时自动把 `image` 注入 `input`，`dsh-llm-pi-ai` 就不会再抛 `UNSUPPORTED_CONTENT`。

### 2.3 agent/pre-step：真正决定“桥接还是原生”

`dsh-agent-loop/lib/index.js:501` 在每次 step 触发 waterfall：

```js
const decision = await this.dispatch.waterfall("agent/pre-step", {
  messages: claimed,
  ...position,
  signal
}, () => Promise.resolve({ kind: "enter", messages: ... }));
```

明眸用 `ctx.on('agent/pre-step', handler, { prepend: true })` 把自己挂在最前面。分流逻辑在 `lib/model-capabilities.mjs` 的 `isVisionModel()` 里，优先级：

1. dsh 真实能力：用 **未包装的** `originalResolveModelInfo(provider, model)` 查 `inputModalities`，含 `image` 就原生。
2. 用户白名单：`visionModels` 精确匹配，原生。
3. 启发式识别：按模型名匹配全球主流视觉模型家族（OpenAI、Anthropic、Google、Qwen、MiniMax、Kimi、GLM、DeepSeek-VL 等），原生。
4. 都不是 → 调用 `rewriteMessages()` 走视觉桥接。

**关键点**：判断基于每次请求的 `agent.options`，不是全局状态，所以多会话、多 Agent、多 turn 并发不会串态。`tests/multi-agent.test.mjs` 就是验证这一点。

**关键点**：判断基于每次请求的 `agent.options`，不是全局状态，所以多会话、多 Agent、多 turn 并发不会串态。`tests/multi-agent.test.mjs` 就是验证这一点。

---

## 3. 配置与凭据的整合

### 3.1 配置的优先级

明眸读取配置时按以下顺序合并（`readConfig()`）：

1. `cordis.patch.yml` 里的 entry config / 环境变量默认值。
2. dsh settings 命名空间 `vision-bridge` 中用户显式改过的字段（通过 `ctx.settings.describe().find(...).user` 识别）。
3. `effectiveVisionModels()` 把内置默认白名单和用户自定义列表合并去重。

因此用户什么都不配时，`MiniMax/MiniMax-M3`、`moonshotai/Kimi-K2.7-Code` 已经自动放行。

### 3.2 API Key 不落盘配置

视觉 API Key 通过 `ctx.credentials.resolve(config.apiKeyEnv)` 读取，回退到环境变量。Key 存在 dsh 凭据库 `~/.dsh/.credentials.yaml`，不会出现在 `settings.yaml` 或插件代码里。

---

## 4. 并发与状态安全

- `originalResolveModelInfo` 在插件加载时保存一次，之后不会被覆盖。
- `installAdmissionBridge` 和 `installAdapterPatch` 返回的 dispose 函数在插件卸载时还原 `llm.resolveModelInfo` 和 adapter 的 `modelOf`。
- `agent/pre-step` 每次从 `agent.options` 重新读取 provider/model，不存在跨请求的共享可变状态。
- `tests/multi-agent.test.mjs` 和 `tests/user-models.test.mjs` 覆盖：瞎子模型对话与视觉模型对话交替进行时不会互相污染。

---

## 5. 已知边界与风险

| 风险点 | 说明 | 当前处理 |
|---|---|---|
| dsh API 仍为 rc | `0.1.0-rc.6` 的 `llm` 服务、`agent/pre-step` 签名、settings API 都可能变化 | 插件版本跟随 rc，并在 CHANGELOG 记录适配 |
| adapter patch 只覆盖 `modelOf` | 如果未来 dsh 换了一种不经过 adapter.modelOf 的方式校验图片能力，patch 会失效 | 保留 `visionModels` 白名单作为兜底；失效时前端的 admission bridge 仍允许上传，pre-step 仍会尝试桥接 |
| 图片会离开本机 | 默认发送到 SiliconFlow | 可配置任意 OpenAI 兼容端点；Key 走凭据库 |
| 瞎子模型首次含图请求多一次视觉 API 调用 | 这是桥接的固有成本 | 失败时自动降级/标注，不会静默丢图 |

---

## 6. 总结

明眸的非侵入式实现建立在 dsh/cordis 的 bundle patch + plugin loader 之上：

- **安装**：`dsh plugin add` 只是往 profile 里加依赖，并在 `dsh.profile.bundles` 追加一行；dsh 启动时自动加载 `dsh.bundle.patch`。
- **激活**：`cordis.patch.yml` 插入 entry；loader 调用 `apply(ctx, config)`。
- **运行**：
  - Admission bridge 让 UI 对瞎子模型放行图片；
  - Adapter patch 让 `dsh-llm-pi-ai` 对 MiniMax/Kimi 等模型放行图片；
  - `agent/pre-step` 按真实能力决定是原生看图还是调用视觉桥。
- **卸载**：返回的 dispose 函数还原所有包装，dsh 恢复原状。

这就是“外挂式”加载明眸、瞎子模型自动使用的完整底层路径。
