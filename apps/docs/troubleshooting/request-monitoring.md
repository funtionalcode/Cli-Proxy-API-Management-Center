# 请求监控排障

仪表盘或请求监控为空时，不要先刷新页面或改筛选条件。先判断链路断在哪一段：CPA 是否发布、Manager Server 是否采集、SQLite 是否入库、前端是否显示。

## 快速判断

1. 确认 CPA 已经产生真实请求。
2. 确认 CPA 用量发布已开启。
3. 打开 Manager Server `/status`，检查 `collector`、`lastConsumedAt`、`lastInsertedAt` 和 `lastError`。
4. 确认同一个 CPA queue 没有被多个 Manager Server 同时消费。
5. 确认 `pollIntervalMs` 小于等于 CPA 用量队列保留时间。

## `/status` 字段

| 字段 | 说明 | 判断方式 |
|---|---|---|
| `collector` / `mode` | 当前采集器状态和模式。 | 应与配置的 `USAGE_COLLECTOR_MODE` 或面板配置一致。 |
| `queue` | 使用的 CPA 用量队列名称。 | 默认通常是 `usage`。 |
| `lastConsumedAt` | 最近一次从 CPA queue 取到事件的时间。 | 长时间为空说明没有消费到事件。 |
| `lastInsertedAt` | 最近一次写入 SQLite 的时间。 | 有消费但无入库时，看 `lastError` 和跳过计数。 |
| `totalInserted` | 累计入库事件数。 | 持续增长说明采集链路正常。 |
| `totalSkipped` | 累计跳过事件数。 | 可能是重复事件、无效事件或已处理事件。 |
| `lastError` | 最近错误。 | 优先按错误内容定位网络、认证或数据格式问题。 |

## 采集模式

`USAGE_COLLECTOR_MODE=auto` 会按顺序尝试：

1. RESP Pub/Sub。
2. HTTP queue。
3. RESP pop。

如果部署在反向代理后：

- RESP Pub/Sub 和 RESP pop 必须直连 CPA API 端口，通常是 `8317`。
- HTTP 反向代理不能代理 RESP。
- HTTP queue 可以经过 HTTP proxy。
- 如果只能走 HTTP proxy，确认 CPA 版本至少为 `v6.10.8+`。

## Retention 与轮询间隔

CPA 用量队列保留时间默认 60 秒，最大 3600 秒。`pollIntervalMs` 不能超过保留时间。

典型问题：

- Manager Server 停止时间超过 retention，旧事件已经过期，无法补回。
- `pollIntervalMs` 设置过大，事件在下一次轮询前过期。
- 多个 Manager Server 消费同一个 queue，其中一个实例先把事件取走。

## 常见症状

### 面板为空，`lastConsumedAt` 也为空

检查：

- CPA 用量发布是否开启。
- CPA 地址是否是 Manager Server 可访问的地址。
- CPA Management Key 是否正确。
- 采集模式是否和网络路径匹配。

### `lastConsumedAt` 有值，但 `lastInsertedAt` 不更新

检查：

- `lastError` 是否有 SQLite、JSON 或字段兼容错误。
- SQLite 数据目录是否可写。
- 是否恢复过不匹配的 `usage.sqlite` 和 `data.key`。

### 偶发丢数据

检查：

- retention 是否太短。
- Manager Server 是否被频繁重启。
- 是否有多个 Manager Server 同时消费 queue。
- CPA 和 Manager Server 的时间是否明显偏移。

## 修复顺序

1. 先让 Manager Server 直连 CPA `:8317`，排除代理问题。
2. 将 `USAGE_COLLECTOR_MODE` 临时设为 `auto`。
3. 增大 CPA 用量队列保留时间，并确保 `pollIntervalMs` 更小。
4. 保证只有一个 Manager Server 消费同一个 CPA queue。
5. 如果仍然为空，保留 `/status`、Manager Server 日志和 CPA usage 配置用于进一步定位。
