# AI 模型价格与费用账本

Updated: 2026-08-22

本文定义 AI 模型价格的维护来源、缓存 Token 计价和费用账本边界。模型价格是管理员核验后的估算元数据，实际结算始终以服务商账单为准。

## 1. 模型价格字段

`sys_ai_model` 按每 100 万 Token 保存：

| 字段                | 含义                       | 未配置时的估算规则                            |
| ------------------- | -------------------------- | --------------------------------------------- |
| `inputPrice`        | 非缓存输入价格             | 按 `0` 估算                                   |
| `cachedInputPrice`  | Prompt Cache 读取价格      | 回退使用 `inputPrice`，不把缓存命中误算为免费 |
| `cacheWritePrice`   | Prompt Cache 创建/写入价格 | 回退使用 `inputPrice`                         |
| `outputPrice`       | 输出价格                   | 按 `0` 估算                                   |
| `currency`          | 价格币种                   | 默认 `USD`，系统不做汇率换算                  |
| `pricingSourceUrl`  | 官方或网关价格来源         | 常见官方 Provider 自动带出入口                |
| `pricingVerifiedAt` | 管理员最后核验日期         | 不自动填写                                    |

费用公式：

```text
regularInput = max(inputTokens - cacheReadTokens - cacheWriteTokens, 0)

estimatedCost =
  regularInput / 1M * inputPrice
  + cacheReadTokens / 1M * (cachedInputPrice ?? inputPrice)
  + cacheWriteTokens / 1M * (cacheWritePrice ?? inputPrice)
  + outputTokens / 1M * outputPrice
```

AI SDK 7 的 `inputTokenDetails.cacheReadTokens` 和 `cacheWriteTokens` 会分别进入 Invocation 与 Attempt Trace。Provider 没有返回细分用量时，只能按其返回的普通输入总量估算。

## 2. 官方来源

系统为常见 Provider 提供以下官方核验入口：

| Provider         | 官方来源                                                                      |
| ---------------- | ----------------------------------------------------------------------------- |
| OpenAI           | [OpenAI API Pricing](https://openai.com/api/pricing/)                         |
| Anthropic        | [Claude Pricing](https://platform.claude.com/docs/en/about-claude/pricing)    |
| Google Gemini    | [Gemini API Pricing](https://ai.google.dev/gemini-api/docs/pricing)           |
| DeepSeek         | [DeepSeek API Pricing](https://api-docs.deepseek.com/quick_start/pricing/)    |
| Qwen / DashScope | [Model Studio Pricing](https://help.aliyun.com/zh/model-studio/model-pricing) |
| Moonshot / Kimi  | [Kimi API Pricing](https://platform.kimi.com/docs/pricing/chat)               |
| Zhipu GLM        | [Zhipu AI Pricing](https://open.bigmodel.cn/pricing)                          |
| SiliconFlow      | [SiliconFlow Pricing](https://www.siliconflow.com/pricing)                    |
| OpenRouter       | [OpenRouter Models](https://openrouter.ai/models)                             |

`openai-compatible`、`custom` 和公司内部网关没有统一官方价格，必须填写实际网关的价格来源。Ollama 本地模型通常没有 Token API 价格，若需要成本核算，应使用内部算力成本口径。

## 3. 价格目录同步

模型管理页可以显式刷新 LiteLLM 社区价格目录，并为当前模型读取确定匹配的候选值。目录同步采用以下边界：

- 固定从受信任的 HTTPS 主机读取 JSON，不抓取各服务商网页。
- 限制请求超时、响应大小和模型数量；结构异常时拒绝替换现有快照。
- 每个有效快照保存 SHA-256 和规范化后的模型条目，并保留最近 10 个快照。
- 价格从 LiteLLM 的每 Token 单位转换为 Admin Base 的每 100 万 Token 单位。
- 使用 Provider 类型和模型 ID 确定匹配，不把宽泛的模型系列猜测用于费用配置。
- 刷新只更新候选目录，不修改 `sys_ai_model`。
- 管理员在差异弹窗中逐字段选择应用后，模型才记录 `catalogKey`、目录 Hash 和同步时间。
- 目录应用不填写 `pricingVerifiedAt`；该字段只表示管理员对官方或网关价格来源做过人工核验。
- 后续手工修改任一价格字段时，来源自动恢复为 `manual` 并清除目录版本元数据。

LiteLLM 是社区维护目录，不是服务商官方账单。目录候选适合发现模型和减少录入工作，但不能作为财务结算真值。Provider 提供稳定官方价格 API 时，应增加独立 Provider adapter，并保持人工确认步骤。

相关接口：

```text
GET  /api/system/ai/pricing/catalog/status
POST /api/system/ai/pricing/catalog/refresh
GET  /api/system/ai/pricing/catalog/models
GET  /api/system/ai/model/:id/pricing/preview
PUT  /api/system/ai/model/:id/pricing/apply
```

## 4. 为什么不自动抓取网页价格

- 标准 `/models` API 通常只返回模型标识，不返回价格。
- 各官网价格页没有统一机器契约，同一模型可能按 Batch、区域、上下文长度、缓存 TTL 或服务等级区分价格。
- 网页结构变化会让静默抓取产生错误价格，比要求管理员核验更危险。
- 第三方价格目录可以用于发现变化，但不能替代官方来源和实际账单。

因此系统提供官方入口，并把社区目录明确标记为候选来源，不自动声称价格已经通过官方核验。管理员对照官方来源后填写 `pricingVerifiedAt`；后续如某个 Provider 发布稳定、授权明确的价格 API，再为该 Provider 增加显式同步 adapter 和变更预览。

## 5. Eval 基线

`db:migrate` 和 `db:seed` 会幂等创建全局数据集 `Admin Base Agent 基线回归`，包含：

- 基础指令遵循。
- `calculator` 工具调用。
- `web-search` 工具调用。

数据集不会自动运行。执行前必须配置 Agent 用途模型；联网搜索 Case 还需要可用的 Web Search Provider，并以 `external` 标签标识环境依赖。
