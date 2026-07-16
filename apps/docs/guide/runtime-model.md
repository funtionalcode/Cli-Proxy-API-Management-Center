# 运行模型

CPAMP 不替代 CPA。日常请求仍然进入 CPA 网关运行时；CPAMP 负责把运行状态、请求事件、成本估算和账号健康整理成可操作的面板。

可以把两者这样理解：

- CPA / CLIProxyAPI：处理真实模型请求，管理提供商、认证文件、OAuth、API 密钥、配额、日志和插件运行时。
- CPAMP：托管管理面板，采集用量队列，保存本地 SQLite，提供仪表盘、请求监控、用量分析、Codex 账号巡检和自动化策略。

排查问题时，先判断问题发生在 CPA 的请求转发链路，还是 CPAMP 的采集、存储和展示链路。

## 请求路径

```text
客户端
  -> CPA 网关运行时
      -> 提供商 / 模型端点
      -> 用量队列 / 请求日志
  -> CPAMP Manager Server
      -> 请求监控 / 用量分析 / 账号巡检 / 仪表盘
```

这条路径决定了两个常见结论：

- 客户端的 Base URL 应该指向 CPA，而不是 CPAMP。
- CPAMP 页面没有数据时，先检查请求是否经过 CPA，再检查用量队列和采集器。

## 登录与密钥

| 场景 | 使用的密钥 | 说明 |
|---|---|---|
| Full Docker / Manager Server 登录 CPAMP | CPAMP 管理员密钥 | 启动日志或 secret 文件中的 `cpamp_...`，只用于管理 CPAMP。 |
| CPAMP 连接 CPA | CPA Management Key | setup / 面板保存时加密写入 SQLite；安装器 env/secret 模式从安装目录读取。 |
| 普通模型 API 请求 | CPA API 密钥 | 客户端请求 `/v1/...`、`/backend-api/codex/...` 等模型接口时使用。 |
| CPA 托管面板登录 | CPA Management Key | 面板由 CPA 托管，浏览器持有 CPA Management Key。 |

排查 401 时先看请求路径。`/v1/...` 属于模型 API，使用 CPA API 密钥；`/v0/management/...` 在 Manager Server 模式下通常使用 CPAMP 管理员密钥。

## 什么时候需要 CPA 原始配置

这些仍然属于 CPA `config.yaml` 或 CPA 管理接口：

- 提供商路由、认证文件目录、OAuth、API 密钥、配额和日志等网关行为。
- 插件安装后的运行时能力。
- `remote-management`、`usage-statistics-enabled` 和 `redis-usage-queue-retention-seconds`。
- 存储后端、热重载和提供商兼容接口等 CPA 运行时设置。

CPAMP 保存的是 Manager Server 自己需要的连接和观测配置，不会重写完整 CPA `config.yaml`。

## 推荐阅读顺序

1. [快速开始](./getting-started.md)
2. [网关配置](../gateway/configuration.md)
3. [提供商与兼容接口](../gateway/providers.md)
4. [客户端接入](../gateway/clients.md)
5. [面板手册](../manual/dashboard.md)
