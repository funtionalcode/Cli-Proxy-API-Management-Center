# 二开功能保留清单

更新时间：2026-07-09

本文记录当前 `master` 中需要在后续同步上游时保留的二开能力。口径以“用户可感知的功能和数据兼容行为”为主，不逐行记录文件级重构。

## 维护约定

- 每次同步上游、恢复二开能力、发现遗漏的二开入口，或新增二开功能后，都必须同步更新本文。
- 记录时优先写清楚用户能感知的功能、关键数据兼容行为、主要代码位置和必要回归测试。
- 提交说明中需要明确本次是否更新了二开功能保留清单；如果没有更新，需要说明原因。
- 后续排查“功能不见了”时，先对照本文检查，不要只凭当前页面表现判断功能是否已丢失。

主要依据：

- 当前 `master` 相对 `upstream/main` 的业务差异。
- 历史二开提交：`d97e2bb`、`8a53a52`、`6aa9e9b`、`f7690f2`、`831fd03`、`def26b4`、`b1f494e`、`b18c579`、`6278782`、`fc8ea44`。
- 2026-07-03 已恢复并验证的提交：`fc8ea44 fix(frontend): 恢复同步后隐藏的二开功能`。
- 2026-07-03 已补充并验证的提交：`da3e5a0 fix(frontend): 恢复认证文件权重展示`。
- 2026-07-09 已补充并验证的提交：`f0be172 feat(proxy-configs): 新增代理配置总览页面`。

## 当前应保留的二开功能

### 1. Manager Server 与外部面板联动

- 自动识别面板运行模式：Manager Server 同源托管、CPA 面板外接 Manager Server。
- 外部面板可探测 Manager Server 候选地址，支持从 `usage-service` 配置、当前 API base、当前页面 base 推导。
- 请求监控、模型定价、服务端 Codex 巡检等入口通过 `usePanelFeatureAvailability` 统一门控。
- CPA 面板连接外部 Manager Server 时，仍可加载请求监控入口和 API Key 别名。
- 配置页支持查看和保存 Manager Server 配置，包括 CPA 地址、CPA Management Key、请求记录读取开关、采集模式、轮询间隔、批量大小、查询限制。
- 支持 `auto`、`http`、`resp`、`subscribe` 采集模式。

关键位置：

- `src/hooks/usePanelFeatureAvailability.ts`
- `src/services/api/usageService.ts`
- `src/features/config/ConfigPage.tsx`
- `src/features/config/components/ManagerConfigPanel.tsx`

### 2. 请求监控、用量分析和模型定价

- 新增/保留监控中心 `/monitoring`，包含账号维度、API Key 维度、实时请求维度。
- 实时请求表展示模型、渠道、状态、耗时、TTFT、TPS、用量、成本、失败详情。
- 监控数据支持时间范围、模型、账号、来源、API Key 等筛选，并支持自动刷新。
- API Key 别名按哈希保存到 Manager Server，用于历史请求和实时请求展示。
- 用量分析 `/usage-analytics` 支持日看板、趋势、成本、请求量、token、异常原因、下钻到监控。
- 模型定价 `/model-prices` 支持维护 Manager Server 中的模型单价，并用于监控成本计算。
- 认证异常待处理列表 `/monitoring/account-actions` 支持从请求监控识别异常账号。
- 账号处理策略支持自动禁用明确异常的认证文件，能力项包括 `authIssueAutoDisable`。

关键位置：

- `src/features/monitoring/`
- `src/features/usage-analytics/`
- `src/features/monitoring/ModelPricesPage.tsx`
- `src/features/monitoring/AccountActionCandidatesPage.tsx`
- `src/services/api/usageService.ts`

### 3. 日志增强

- 日志页支持错误日志和成功请求日志两个 tab。
- 成功请求日志由 `success-request-log` 控制，错误请求日志由 `request-log` 控制。
- 日志页内联提供 `request-log`、`success-request-log` 开关。
- 支持错误日志、成功请求日志的格式化下载按钮。
- 支持解析 GIN 日志、英文/中文耗时标签、`latency`、排队耗时等 timing 字段。
- 日志行展示 latency/timings pill。
- 支持最小/最大耗时筛选，筛选值按毫秒保存。
- `?tab=errors` 和 `?tab=success` 不再仅受 `logging-to-file` 门控，避免同步后日志入口被误隐藏。

关键位置：

- `src/features/logs/LogsPage.tsx`
- `src/features/logs/logFeatureAvailability.ts`
- `src/features/logs/hooks/logParsing.ts`
- `src/features/logs/hooks/useLogFilters.ts`
- `src/services/api/logs.ts`
- `src/services/api/config.ts`

### 4. Provider 配置增强

- Provider 页面采用列表、工具栏、详情抽屉、编辑抽屉、健康检查抽屉组织。
- OpenAI、Claude、Codex、Gemini、Vertex 等 Provider 支持模型拉取、模型筛选、模型别名编辑。
- Provider 和 key 级别支持自定义请求头 `headers`。
- Provider 和 key 级别支持权重 `weight`，用于路由或负载策略。
- OpenAI compatible key 支持 `balanceToken` / `balance-token`。
- 保存 Provider 时保留自定义 key 元数据，不丢弃 `headers`、`balanceToken`、`weight`。
- 支持 keyless OpenAI custom entry，即只包含 `headers`、`balanceToken`、`weight` 的条目不应被清理。
- 保存 Provider 时过滤 Xiaomi cookie 文件相关兼容逻辑，避免将不应写入 Provider 的认证文件混入。

关键位置：

- `src/features/aiProviders/`
- `src/components/providers/`
- `src/services/api/providers.ts`
- `src/services/api/transformers.ts`
- `src/types/provider.ts`

### 5. AuthFiles 认证文件增强

- 认证文件页支持列表、筛选、套餐排序、状态展示、批量刷新认证文件和额度。
- 认证文件卡片显示最近请求状态、额度状态、冷却恢复信息、项目 ID、优先级 `priority`、权重 `weight` 等。
- Codex 额度冷却恢复后可触发对应账号额度刷新，避免继续展示过期 Header 快照。
- 支持 Auth JSON 粘贴导入，包含 ChatGPT session/sub2api 到 CPA Codex 登录文件的转换。
- Prefix/Proxy 编辑器支持编辑 `prefix`、`proxy`、`priority`、`weight`、`headers`。
- `priority` 仅接受整数；留空会清理该字段；认证文件页支持按优先级高低排序和批量设置优先级。
- `weight` 仅接受正整数；留空会清理该字段。
- `headers` 按 JSON 对象编辑，支持写入、更新和清空。
- `authFilesApi.patchFieldsForAuthIndexes` 支持写入/清空 `weight` 和 `headers`。
- OAuth 排除模型、OAuth 模型别名页面保留，模型别名支持图形化关系视图。
- 认证文件列表的图形/列表视图偏好、排序偏好需要保留。

关键位置：

- `src/features/authFiles/`
- `src/services/api/authFiles.ts`
- `src/features/authFiles/hooks/useAuthFilesPrefixProxyEditor.ts`
- `src/features/authFiles/sessionAuthConverter.ts`

### 6. 代理配置总览

- 新增代理配置总览页 `/proxy-configs`，在一个列表中整合全局 `proxy-url`、AI Provider/key 代理配置、OpenAI compatible key entry 代理配置和认证文件 `proxy_url`。
- 列表展示配置范围、提供商、名称、覆盖状态、代理协议、主机、端口、代理用户和脱敏后的代理密码。
- 代理 URL 展示层必须脱敏密码；编辑弹窗中保留原始 URL 供用户修改和保存。
- 支持编辑/清空单行代理配置：全局配置写入 `/proxy-url`，Provider 配置复用现有 provider 保存接口，认证文件配置复用 `authFilesApi.patchFields` / `patchFieldsForAuthIndexes`。
- 认证文件带 `authIndex` 时必须按账号粒度写回，避免同一个认证文件内其他账号的代理配置被误改。

关键位置：

- `src/features/proxyConfigs/`
- `src/pages/ProxyConfigsPage.tsx`
- `src/router/MainRoutes.tsx`
- `src/components/layout/MainLayout.tsx`
- `src/services/api/providers.ts`
- `src/services/api/authFiles.ts`
- `src/services/api/config.ts`

### 7. 额度管理增强

- 统一额度页 `/quota` 支持 Claude、Codex、Antigravity、Kimi、xAI 等账号额度。
- Claude 额度支持 `one_day` 日限额窗口。
- Codex 额度支持 5 小时、7 天、月额度等窗口展示，以及 reset credit 数量和过期提示。
- Codex 额度支持从真实查询结果和最近用量响应 Header 快照合并展示。
- Codex 额度支持手动刷新、失败状态保留、按认证文件身份隔离缓存。
- 支持 Codex reset credit 消耗确认。
- Antigravity 额度和套餐查询保留。
- xAI Grok 额度展示保留。
- 额度页和认证文件页的套餐档位排序逻辑需要保留。

关键位置：

- `src/components/quota/`
- `src/features/quota/`
- `src/utils/quota/`
- `src/services/api/codexQuota.ts`
- `src/services/api/antigravitySubscription.ts`
- `src/stores/useQuotaStore.ts`
- `src/types/quota.ts`

### 8. OAuth 与重新登录增强

- OAuth 页面支持 Codex、Claude、Antigravity、xAI 等登录入口。
- Codex 支持重新登录对话框，帮助对指定账号重新授权。
- Vertex 服务账号导入入口保留。
- OAuth 回调、登录状态、错误提示、多语言文案需要同步保留。

关键位置：

- `src/features/oauth/`
- `src/services/api/oauth.ts`
- `src/types/oauth.ts`

### 9. 插件管理

- 插件管理页 `/plugins`、插件商店 tab、插件资源页保留。
- 插件能力通过后端能力位门控，不支持时应隐藏或跳转。
- 插件安装前置确认、轮询、资源展示、宿主样式隔离需要保留。

关键位置：

- `src/features/plugins/`
- `src/services/api/plugins.ts`
- `src/types/plugin.ts`
- `src/router/MainRoutes.tsx`

### 10. 配置管理和可视化编辑增强

- 配置页保留可视化编辑器和源码 diff。
- 配置分组支持 `request-log`、`success-request-log`、`success-logs-max-files`、`logging-to-file`、`plugins`、`ws-auth`、`routing/strategy`、各 Provider 配置等 section。
- API Keys 卡片编辑器保留。
- 账号处理策略配置保留，包括额度冷却、认证异常待处理、自动禁用明确异常认证文件。
- 运行时开关、Header 默认值、Codex 身份混淆、Antigravity 签名缓存、额度策略等配置项需要保留。

关键位置：

- `src/components/config/`
- `src/entities/config/sections.ts`
- `src/hooks/useVisualConfig.ts`
- `src/hooks/visualConfigPayloadRules.ts`
- `src/features/config/components/AccountProcessingPolicySection.tsx`

### 11. Dashboard、Demo 和构建输出

- Dashboard 保留用量摘要、请求记录读取状态、健康告警、流量概览、版本信息等卡片。
- Demo 模式 `/demo` 和演示 fixtures 保留，用于无后端预览。
- 生产构建输出需要从 `dist/index.html` 改名为 `dist/management.html`。
- 依赖以 `pnpm-lock.yaml` 为准，构建链路需支持 `pnpm test` 和 `pnpm run build`。

关键位置：

- `src/features/dashboard/`
- `src/features/demo/`
- `vite.config.ts`
- `package.json`
- `pnpm-lock.yaml`

## 历史出现但当前需单独复核的功能

以下功能在历史二开提交中出现过，但当前 `master` 代码中没有完整入口或上一轮恢复时明确未纳入。后续如需要，应单独开任务恢复，不要在同步上游时误判为已经完整存在。

- Xiaomi 验证弹窗显示邮箱，并从 API response 传递邮箱。
  - 历史提交：`3cda7eb feat: show email in Xiaomi verification modal and pass email from API response`
  - 历史文件：`src/components/providers/OpenAISection/XiaomiVerificationModal.tsx`
- Xiaomi Provider key 的 token usage 显示。
  - 历史提交：`f64ddee feat: add token usage display for Xiaomi provider keys`
  - 当前只保留了泛化后的 `recentRequests` 状态能力，未确认 Xiaomi 专属 UI。
- Provider 行级刷新按钮和部分旧版 Provider UI 细节。
  - 上一轮恢复提交 `fc8ea44` 的 `Constraint` 已明确未迁移该类更大 UI 重构项。

## 同步上游后的检查清单

每次同步上游后，至少检查以下项目：

- 路由可见性：`/monitoring`、`/usage-analytics`、`/model-prices`、`/codex-inspection/server`、`/logs?tab=success`、`/plugins`、`/proxy-configs`。
- 外部 CPA 面板连接 Manager Server 时，请求监控入口和 API Key 别名是否仍可用。
- 配置页能否显示和保存 Manager Server 的 CPA 连接、采集模式、请求监控开关。
- 日志页能否切换成功请求日志，能否下载格式化错误/成功日志，耗时筛选是否有效。
- Provider 保存后是否保留 `headers`、`weight`、`balanceToken`，keyless OpenAI custom entry 是否不会被丢弃。
- AuthFiles Prefix/Proxy 编辑器是否能保存和清空 `weight`、`headers`。
- 代理配置总览页是否能展示全局、Provider、OpenAI key entry、认证文件代理配置；代理用户是否可见、代理密码是否脱敏；按 `authIndex` 编辑认证文件代理是否只影响目标账号。
- AuthFiles 卡片是否展示 `priority` 和 `weight`，优先级排序、套餐排序、批量设置优先级是否仍可用。
- Claude `one_day` 日额度窗口是否正常展示。
- Codex 额度 Header 快照、手动刷新、冷却恢复刷新是否不会相互覆盖错误状态。
- API Key 别名是否能创建、删除、复用历史别名，并在监控/用量分析中显示。
- 插件能力不支持时是否正确隐藏或跳转。

建议验证命令：

```bash
pnpm test
pnpm run build
```

重点定向测试：

```bash
pnpm test \
  src/hooks/usePanelFeatureAvailability.test.ts \
  src/features/config/ConfigPage.test.ts \
  src/services/api/logs.test.ts \
  src/services/api/transformers.test.ts \
  src/features/logs/hooks/useLogFilters.test.ts \
  src/features/logs/hooks/logParsing.test.ts \
  src/features/logs/logFeatureAvailability.test.ts \
  src/utils/quota/providerRequests.test.ts \
  src/services/api/providers.test.ts \
  src/features/authFiles/constants.test.ts \
  src/services/api/authFiles.test.ts \
  src/features/authFiles/hooks/useAuthFilesData.test.ts \
  src/features/authFiles/components/AuthFileCard.test.tsx \
  src/features/proxyConfigs/proxyConfigModel.test.ts \
  src/components/quota/QuotaSection.test.tsx
```
