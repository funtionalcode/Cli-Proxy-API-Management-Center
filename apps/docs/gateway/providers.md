# 提供商与兼容接口

提供商决定客户端请求最终发往哪个模型服务。请求路径仍由 CPA 执行；CPAMP 读取提供商、认证文件、模型列表、请求事件和价格信息，用来展示监控、成本和账号状态。

## 常见提供商类型

| 类型 | 用途 | CPAMP 中的关联页面 |
|---|---|---|
| Codex | Codex CLI / Codex API 账号、配额和请求监控。 | AI 提供商、认证文件、配额管理、Codex 账号巡检。 |
| Claude Code | Claude Code 账号和兼容请求。 | AI 提供商、认证文件、请求监控。 |
| OpenAI 兼容 | OpenAI 风格的中转或自建模型服务。 | AI 提供商、模型价格、用量分析。 |
| Gemini / AI Studio | Gemini API 或 AI Studio 相关接入。 | AI 提供商、OAuth 登录、请求监控。 |
| Vertex | Google Cloud Vertex AI 项目接入。 | AI 提供商、认证文件、用量分析。 |
| xAI / Grok / Antigravity | CPA 支持的其他提供商。 | AI 提供商、请求监控。 |

保存提供商前先把四件事核对清楚：Base URL 指向哪里、用哪种认证方式、暴露哪些模型名、是否绑定认证文件 / `auth_index`。这四项错一个，请求监控里通常只会看到请求失败，而不一定能直接指出配置字段。

## 兼容接口

不同客户端使用不同兼容接口。反向代理和客户端配置时，先按路径判断它应该进 CPA 还是 CPAMP：

| 路径 | 用途 | 典型客户端 |
|---|---|---|
| `/v1/...` | OpenAI-compatible API。 | OpenAI SDK、OpenCode、通用模型客户端。 |
| `/v1beta/...` | Gemini-compatible API。 | Gemini SDK 或兼容工具。 |
| `/backend-api/codex/...` | Codex 相关接口。 | Codex CLI。 |
| 提供商回调 | OAuth 回调。 | Codex、Claude、Google、Antigravity 等 OAuth 流程。 |

模型 API 路径应直接转给 CPA。CPAMP 只接管 `/management.html`、`/usage-service/*`、`/v0/management/*`、`/v0/resource/plugins/*` 和 `/models` 等管理或兼容代理路径。完整 Nginx 示例见 [反向代理](../deployment/reverse-proxy.md)。

## 模型列表与价格

模型价格只影响 CPAMP 的成本估算，不会改变 CPA 提供商路由，也不会改变提供商的真实账单。价格可以手动编辑，也可以主动同步 LiteLLM / OpenRouter 数据；同步只在你触发时访问外部价格源。

`/models` 返回 `412` 时，先别查提供商。它通常表示 CPAMP 还没完成 setup，或者缺少 CPA URL / CPA Management Key。

## 排障顺序

1. 先在 CPA 中确认提供商本身可用。
2. 再到 CPAMP 的 AI 提供商页面核对提供商和认证文件绑定。
3. 到认证文件页面确认账号没有被手动禁用、配额冷却或自动化策略禁用。
4. 到请求监控查看失败摘要和状态码。
5. 最后用日志查看网关运行时的详细错误。
