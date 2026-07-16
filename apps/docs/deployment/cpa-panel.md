# CPA 托管面板兼容模式

这个模式主要用于已有 CPA 环境继续从 CPA 端口打开面板。新部署优先使用完整 Docker 或原生 Manager Server；它们由 CPAMP 托管面板，可以使用完整的历史监控、模型价格、导入导出和服务端巡检。

## 和完整 Docker 模式的区别

| 模式 | 面板托管 | 登录凭证 | 适用场景 |
|---|---|---|---|
| 完整 Docker | Manager Server `:18317` | `cpamp_...` 管理员密钥 | 推荐的新部署方式。 |
| CPA 托管面板 | CPA `:8317` | CPA Management Key | 兼容已有 CPA 端口访问习惯。 |
| 前端开发 | Vite dev 或静态 HTML | 浏览器本地 CPA URL + key | 本地开发和调试。 |

## 注意事项

- CPA 托管面板使用 CPA Management Key 登录，不需要 CPAMP 管理员密钥。
- CPA Management Key 保存在浏览器侧，符合 CPA 托管面板的访问方式。
- Manager Server 模式会在服务端管理 CPA 连接：setup / 面板保存的连接加密写入 SQLite，安装器 env/secret 模式从安装目录读取。
- 面板入口相同，但可用数据取决于托管模式；完整历史监控、模型价格和服务端巡检来自 Manager Server 模式。

## 何时使用

只有在下面场景才考虑 CPA 托管面板：

- 已经习惯从 CPA 端口访问管理面板。
- 不想让用户直接访问 Manager Server 面板端口。
- 希望 CPA Management Key 继续作为面板访问凭证。

优先选择完整 Docker 或原生 Manager Server：

- 希望 CPAMP 独立托管。
- 希望 Manager Server 统一保存配置。
- 需要管理员密钥和服务端管理 CPA 连接。
