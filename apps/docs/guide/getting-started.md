# 快速开始

这页带你从一套最小 Docker 环境跑起：先启动 CPA 网关运行时，再启动 CPAMP 面板，最后确认监控数据能进来。已经有 CPA 在运行的用户，可以直接跳到 [仅部署 CPAMP](../deployment/docker.md#仅部署-cpamp)。

## 使用安装脚本

如果想按向导部署，直接运行安装脚本：

```bash
curl -fsSLO https://raw.githubusercontent.com/seakee/CPA-Manager-Plus/main/bin/install-cpamp.sh
bash install-cpamp.sh
```

脚本会检查环境、选择语言、选择完整安装或仅安装 CPAMP、生成最小配置，并在最后确认后执行部署。想先看它会做什么，可以使用：

```bash
CPAMP_DRY_RUN=1 bash install-cpamp.sh
```

更多选项见 [一键安装脚本](../deployment/installer.md)。

## 推荐部署方式

第一次部署建议用 Docker Compose。它会同时创建 CPA 和 CPAMP 的持久化 volume：

```yaml
services:
  cli-proxy-api:
    image: eceasy/cli-proxy-api:latest
    restart: unless-stopped
    ports:
      - "8317:8317"
    volumes:
      - cpa-data:/app/data

  cpa-manager-plus:
    image: seakee/cpa-manager-plus:latest
    restart: unless-stopped
    ports:
      - "18317:18317"
    volumes:
      - cpa-manager-plus-data:/data

volumes:
  cpa-data:
  cpa-manager-plus-data:
```

启动服务：

```bash
docker compose up -d
```

打开管理面板：

```text
http://<host>:18317/management.html
```

第一次登录需要 CPAMP 管理员密钥。没有显式设置时，Manager Server 会在启动日志里输出一次：

```bash
docker compose logs cpa-manager-plus
```

## 首次配置

进入 setup 后按顺序填写：

1. CPAMP 管理员密钥。
2. CPA 地址，例如 `http://cli-proxy-api:8317`。
3. CPA Management Key。
4. 请求监控采集方式。新部署保持默认 `auto` 即可。

推荐 CPA 版本：`v7.1.39+`。HTTP 用量队列至少需要 `v6.10.8+`。

## 配好后应该看到什么

- 仪表盘能打开，并显示 Manager Server / CPA 连接状态。
- 请求监控在有真实请求后出现实时请求记录。
- 用量分析能按模型、账号、项目和时间范围拆解成本与 Token。
- Codex 账号巡检能看到配额、重置时间、凭证状态和账号健康。

如果面板打开了但监控为空，先看 [请求监控排障](../troubleshooting/request-monitoring.md)，通常是用量发布、CPA URL、队列保留时间或采集器路径问题。

## 下一步

- 还没决定部署形态：阅读 [运行模型](./runtime-model.md)。
- 要配置提供商或客户端：阅读 [网关配置](../gateway/configuration.md)。
- 要理解每个面板页面：从 [仪表盘](../manual/dashboard.md) 开始。
- 使用原生包：阅读 [原生包部署](../deployment/native.md)。
- 从旧项目迁移：阅读 [从 CPA-Manager 迁移](../migration/from-cpa-manager.md)。
