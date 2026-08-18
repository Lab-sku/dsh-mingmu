# 明眸视觉模型识别规则

> 本文件维护明眸用于“自动分流”的视觉模型启发式规则。
>
> 判断优先级：
> 1. dsh 自身声明的真实能力（`inputModalities` 含 `image`）
> 2. 用户在 `visionModels` 里写的精确白名单
> 3. 本文档的启发式模型名规则
> 4. 以上都不是 → 当瞎子模型走视觉桥接
>
> 覆盖率：对 pi-ai 官方 catalog 中 691 个视觉模型，当前启发式规则命中 679 个（约 98.3%）。
> 漏掉的主要是 `auto`、`free`、`latest` 这类网关路由器别名，以及个别小众模型。

## 已识别的视觉模型家族

| 厂商 | 规则 / 关键字 | 典型模型 ID |
|---|---|---|
| **OpenAI** | `gpt-4o`、`gpt-4-turbo`、`gpt-4.1`、`gpt-5`、`gpt-realtime`、`o[1-9]`、`gpt-*-latest` | `gpt-4o`、`gpt-4-turbo`、`gpt-4.1`、`o3`、`o4-mini`、`gpt-latest` |
| **Anthropic** | `claude-3`、`claude-4`、全系列后缀 | `claude-3-5-sonnet`、`claude-opus-4` |
| **Google** | `gemini-` 全系列、`gemma-[3-9]` | `gemini-2.5-pro`、`gemma-4-9b-it` |
| **Meta** | `llama.*vision`、`llama-4` | `llama-3.2-11b-vision-instruct`、`llama-4-scout` |
| **Alibaba / Qwen** | `qwen.*vl`、`qwen2.5-vl`、`qwen3-vl`、`qwen3.[5-9]`、`qwen3p[5-9]` | `Qwen/Qwen3-VL-8B-Instruct`、`Qwen/Qwen3.6-27B` |
| **MiniMax** | `minimax-m3` | `MiniMax/MiniMax-M3` |
| **Moonshot / Kimi** | `kimi-k2.5~k2.9`、`kimi-k3`、`kimi-coding`、`kimi-for-coding`、`kimi-latest` | `moonshotai/kimi-k2.7-code`、`k3` |
| **Zhipu / GLM** | `glm-{数字}v`、`glm-{数字}.{数字}v` | `glm-4v-9b`、`glm-5v-turbo`、`glm-4.5v` |
| **DeepSeek** | `deepseek.*vl`、`deepseek.*janus` | `DeepSeek-VL2`、`Janus-Pro-7B` |
| **Mistral** | `pixtral`、`magistral`、`devstral`、`ministral`、`mistral-(large/small/medium)-3`、25/26 年版本 | `pixtral-12b`、`mistral-large-2512`、`mistral-small-3.2-24b` |
| **xAI** | `grok` 全系列 | `grok-4.5` |
| **Amazon** | `nova-(lite/pro/premier/2)` | `amazon.nova-pro-v1:0` |
| **Stepfun** | `step-3.*` | `step-3.7-flash` |
| **01.AI / Yi** | `yi-.*vl` | `yi-vl-plus` |
| **OpenGVLab** | `internvl` | `internvl2.5-26b` |
| **LLaVA** | `llava` | `llava-v1.5-7b` |
| **THUDM** | `cogvlm` | `cogvlm-chat` |
| **通用兜底** | 任意模型名以 `-vl` 结尾 | `some-vl` |
| **ByteDance** | `seed-1.`、`seed-2.` | `seed-1.6-flash` |
| **Xiaomi** | `mimo` | `mimo-v2.5` |
| **其他小众** | `inkling`、`fugu`、`muse-spark`、`reka`、`nemotron` | `thinkingmachines/inkling`、`reka-edge` |

## 明确不识别为视觉的模型（会走桥接）

| 厂商 | 典型模型 ID | 原因 |
|---|---|---|
| **OpenAI** | `gpt-4`、`gpt-3.5-turbo` | 无视觉能力 |
| **Anthropic** | `claude-2`、`claude-instant-1` | 无视觉能力 |
| **DeepSeek** | `DeepSeek-V4-Flash`、`DeepSeek-V3` | 当前主系列为文本模型 |
| **Zhipu** | `GLM-5.2`、`GLM-5.2-FP8` | 无视觉后缀 |
| **Qwen** | `Qwen-Turbo`（无 VL/3.5+ 后缀） | 普通文本版 |

## 中转 / 网关 / 自定义 provider 如何生效

规则只匹配**模型名**，不依赖 provider。因此以下 ID 都能被识别：

```text
quchiai/MiniMax/MiniMax-M3
openrouter/moonshotai/kimi-k2.7-code
together/MiniMaxAI/MiniMax-M3
siliconflow/Qwen/Qwen3-VL-8B-Instruct
fireworks/accounts/fireworks/models/kimi-k2p7-code
```

只要模型名里包含上表的关键字，就会被自动视为视觉模型。

## 如何补充新模型

如果某个模型实际支持视觉但明眸没识别到，可以在不修改代码的情况下临时解决：

```yaml
# ~/.dsh/settings.yaml
vision-bridge:
  visionModels:
    - your-provider/your-model-id
```

或环境变量：

```bash
DSH_VISION_VISION_MODELS="your-provider/your-model-id"
```

也欢迎给 `lib/model-capabilities.mjs` 的 `VISION_MODEL_PATTERNS` 提 PR 补充规则。
