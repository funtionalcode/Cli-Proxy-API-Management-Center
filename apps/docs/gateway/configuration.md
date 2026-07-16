# 网关配置

这里配置的是 CPA / CLIProxyAPI，也就是实际承接模型请求的网关运行时。CPAMP 通过 CPA Management API 读取运行状态和配置线索，再把监控、分析和运维动作放到面板里。

如果你刚完成 CPAMP setup，但请求监控没有数据，通常先检查本页提到的远程管理、用量发布和队列保留时间。

## 必要配置

CPAMP 要能管理和观测 CPA，先在 CPA 中开启远程管理：

```yaml
remote-management:
  secret-key: "replace-with-a-long-random-management-key"
  allow-remote: true
```

只要 CPAMP 不是和 CPA 跑在同一个进程里，就要认真检查 `allow-remote`。Docker Compose 里的两个容器虽然在同一个 network，CPA 看到的来源也不是 `localhost`。

请求监控还依赖用量发布：

```yaml
usage-statistics-enabled: true
redis-usage-queue-retention-seconds: 60
```

`redis-usage-queue-retention-seconds` 是 CPAMP 能追回请求事件的时间窗口。先保持默认 `60` 秒；只有在网络抖动、采集端重启频繁或排障时，再适当提高。

## 认证文件目录

认证文件保存提供商账号、OAuth Token 或 API 密钥。要让监控、配额和巡检能长期关联同一个账号，关键是稳定：

- 将 `auths/` 目录挂载到 CPA 容器内。
- 每个账号一个 JSON 文件，或一个文件内保存多个账号条目。
- 给每个账号配置稳定的 `auth_index`，便于 CPAMP 监控、配额和巡检准确关联。
- 禁用账号时优先使用面板或 CPA 管理接口。直接删除文件会切断历史记录和账号动作的关联。

日常维护可以在 CPAMP 的 [认证文件](../manual/auth-files.md) 和 [OAuth 登录](../manual/oauth.md) 页面完成。

## 存储与热重载

CPA 的配置和运行时数据可以放在本地文件，也可以使用 CPA 支持的外部存储。选择时先看你怎么备份、怎么回滚：

| 方案 | 适合场景 | 注意事项 |
|---|---|---|
| 本地文件 | 单机 Docker 或原生部署 | 最容易备份；需要持久化 volume 或宿主机目录。 |
| PostgreSQL | 多实例或云部署 | 确认连接串、迁移和备份策略。 |
| 对象存储 | 配置文件集中管理 | 注意访问密钥和一致性延迟。 |
| Git 存储 | 配置审计和回滚 | 不要把敏感 Token 明文提交到仓库。 |

如果启用了热重载，很多配置可以不重启 CPA 就生效。涉及提供商、认证文件、配额或插件的变更仍建议放在低流量时段，改完后用仪表盘、请求监控和日志观察几分钟。

## CPAMP 与 CPA 的配置边界

由 CPAMP 保存：

- CPA URL 和加密后的 CPA Management Key。
- 请求监控采集模式、轮询间隔、batch size 和 query limit。
- 模型价格、API 密钥别名、账号处理策略和服务端巡检历史。

仍由 CPA 保存：

- 提供商、认证文件、OAuth、配额、API 密钥、日志、插件和路由规则。
- `remote-management`、用量队列、存储后端和热重载。

判断边界的简单方法：面板有编辑入口，就优先在 CPAMP 操作；面板没有暴露的网关运行时行为，仍回到 CPA 配置或 CPA 管理接口处理。
