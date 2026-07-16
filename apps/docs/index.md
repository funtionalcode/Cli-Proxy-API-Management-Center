---
layout: home

hero:
  name: CPA Manager Plus
  text: 使用文档
  tagline: 从部署网关到排查请求失败，这里集中整理 CPAMP 和 CPA 网关运行时的日常使用方式。
  actions:
    - theme: brand
      text: 快速开始
      link: /guide/getting-started
    - theme: alt
      text: 在线演示
      link: https://seakee.github.io/CPA-Manager-Plus/

features:
  - title: 部署
    details: 使用一键安装、Docker 或原生包完成第一次 setup。
  - title: 观测
    details: 看清请求、成本、失败、配额和 Codex 账号状态。
  - title: 运维
    details: 处理备份恢复、管理员密钥、反向代理、迁移和常见故障。
---

<script setup>
import homePreview from './images/home-zh.png';
</script>

<figure class="cpamp-home-preview">
  <img :src="homePreview" alt="CPA Manager Plus 仪表盘截图" />
  <figcaption>一个面板里查看请求监控、用量分析、Codex 账号巡检和 Manager Server 状态。</figcaption>
</figure>

## 按任务阅读

<div class="cpamp-doc-grid">
  <section class="cpamp-doc-card">
    <h3>第一次部署</h3>
    <p>还没有现成环境时，从这里启动 CPA 和 CPAMP，并完成第一次登录。</p>
    <ul>
      <li><a href="./guide/getting-started.html">快速开始</a></li>
      <li><a href="./deployment/installer.html">一键安装脚本</a></li>
      <li><a href="./deployment/docker.html">Docker 部署</a></li>
      <li><a href="./deployment/native.html">原生包部署</a></li>
    </ul>
  </section>
  <section class="cpamp-doc-card">
    <h3>进阶部署与兼容</h3>
    <p>已有环境、反向代理或兼容访问路径，从这里确认入口和边界。</p>
    <ul>
      <li><a href="./deployment/reverse-proxy.html">反向代理</a></li>
      <li><a href="./operations/manager-server.html">Manager Server 指南</a></li>
      <li><a href="./deployment/cpa-panel.html">CPA 托管面板兼容模式</a></li>
    </ul>
  </section>
  <section class="cpamp-doc-card">
    <h3>网关运行时与客户端</h3>
    <p>配置提供商、认证文件和兼容接口，让 Codex、Claude Code、OpenCode 等客户端接入。</p>
    <ul>
      <li><a href="./guide/runtime-model.html">运行模型</a></li>
      <li><a href="./gateway/configuration.html">网关配置</a></li>
      <li><a href="./gateway/providers.html">提供商与兼容接口</a></li>
      <li><a href="./gateway/clients.html">客户端接入</a></li>
    </ul>
  </section>
  <section class="cpamp-doc-card">
    <h3>面板手册</h3>
    <p>按真实面板页面阅读：配置、提供商、认证文件、监控、分析、巡检、插件和日志各有独立说明。</p>
    <ul>
      <li><a href="./manual/dashboard.html">仪表盘</a></li>
      <li><a href="./manual/configuration.html">配置中心</a></li>
      <li><a href="./manual/ai-providers.html">AI 提供商</a></li>
      <li><a href="./manual/monitoring.html">请求监控</a></li>
      <li><a href="./manual/plugins.html">插件管理</a></li>
    </ul>
  </section>
  <section class="cpamp-doc-card">
    <h3>运维与安全</h3>
    <p>先保护 SQLite、data.key 和管理员密钥，后面恢复会简单很多。</p>
    <ul>
      <li><a href="./operations/backup.html">备份与恢复</a></li>
      <li><a href="./operations/reset-admin-key.html">重置管理员密钥</a></li>
      <li><a href="./operations/configuration.html">配置与数据目录</a></li>
      <li><a href="./migration/from-cpa-manager.html">从 CPA-Manager 迁移</a></li>
    </ul>
  </section>
  <section class="cpamp-doc-card">
    <h3>排障</h3>
    <p>监控为空、采集器报错、队列过期或反代路径异常时，从这里查。</p>
    <ul>
      <li><a href="./troubleshooting/request-monitoring.html">请求监控排障</a></li>
      <li><a href="./reference/faq.html">常见问题</a></li>
      <li><a href="./reference/releases.html">版本说明</a></li>
    </ul>
  </section>
</div>

## 运行模式

<div class="cpamp-mode-grid">
  <section class="cpamp-mode-card">
    <h3>完整 Docker</h3>
    <p>推荐的新部署方式。Manager Server 托管面板，浏览器只需要 CPAMP 管理员密钥。</p>
    <a href="./deployment/docker.html">查看 Docker 部署</a>
  </section>
  <section class="cpamp-mode-card">
    <h3>原生包</h3>
    <p>不使用 Docker 时，直接在 Linux、macOS 或 Windows 上运行 Manager Server。</p>
    <a href="./deployment/native.html">查看原生包部署</a>
  </section>
  <section class="cpamp-mode-card">
    <h3>兼容访问</h3>
    <p>已有 CPA 端口面板仍可保留，但完整监控和分析能力来自 Manager Server。</p>
    <a href="./deployment/cpa-panel.html">查看兼容模式</a>
  </section>
</div>
