---
layout: home

hero:
  name: CPA Manager Plus
  text: Documentation
  tagline: One place to deploy the gateway, run CPAMP, monitor requests, estimate cost, and troubleshoot account health.
  actions:
    - theme: brand
      text: Get Started
      link: /en/guide/getting-started
    - theme: alt
      text: Live Demo
      link: https://seakee.github.io/CPA-Manager-Plus/

features:
  - title: Deployment
    details: Use the installer, Docker, or native packages to finish the first setup.
  - title: Observability
    details: Follow requests, cost, failures, quota, and Codex account state.
  - title: Operations
    details: Handle backups, admin keys, reverse proxies, migration, and common failures.
---

<script setup>
import homePreview from '../images/home.png';
</script>

<figure class="cpamp-home-preview">
  <img :src="homePreview" alt="CPA Manager Plus dashboard screenshot" />
  <figcaption>Request monitoring, usage analytics, Codex account inspection, and Manager Server status in one self-hosted panel.</figcaption>
</figure>

## Read By Task

<div class="cpamp-doc-grid">
  <section class="cpamp-doc-card">
    <h3>First Deployment</h3>
    <p>Start CPA and CPAMP from a minimal Docker setup, then complete the first login.</p>
    <ul>
      <li><a href="./guide/getting-started.html">Get Started</a></li>
      <li><a href="./deployment/installer.html">One-Click Installer</a></li>
      <li><a href="./deployment/docker.html">Docker Deployment</a></li>
      <li><a href="./deployment/native.html">Native Packages</a></li>
    </ul>
  </section>
  <section class="cpamp-doc-card">
    <h3>Advanced Deployment</h3>
    <p>For existing environments, reverse proxies, or compatibility access paths, check the entry point and boundary here.</p>
    <ul>
      <li><a href="./deployment/reverse-proxy.html">Reverse Proxy</a></li>
      <li><a href="./operations/manager-server.html">Manager Server Guide</a></li>
      <li><a href="./deployment/cpa-panel.html">CPA-Hosted Panel Compatibility</a></li>
    </ul>
  </section>
  <section class="cpamp-doc-card">
    <h3>Gateway Runtime And Clients</h3>
    <p>Configure providers, auth files, compatibility APIs, and clients such as Codex, Claude Code, and OpenCode.</p>
    <ul>
      <li><a href="./guide/runtime-model.html">Runtime Model</a></li>
      <li><a href="./gateway/configuration.html">Gateway Configuration</a></li>
      <li><a href="./gateway/providers.html">Providers And Compatibility APIs</a></li>
      <li><a href="./gateway/clients.html">Client Configuration</a></li>
    </ul>
  </section>
  <section class="cpamp-doc-card">
    <h3>Panel Manual</h3>
    <p>Use the manual by real panel page: configuration, providers, auth files, monitoring, analytics, inspection, plugins, and logs each have their own page.</p>
    <ul>
      <li><a href="./manual/dashboard.html">Dashboard</a></li>
      <li><a href="./manual/configuration.html">Configuration</a></li>
      <li><a href="./manual/ai-providers.html">AI Providers</a></li>
      <li><a href="./manual/monitoring.html">Monitoring</a></li>
      <li><a href="./manual/plugins.html">Plugin Management</a></li>
    </ul>
  </section>
  <section class="cpamp-doc-card">
    <h3>Operations And Security</h3>
    <p>Protect SQLite, data.key, and admin credentials before you need to recover them.</p>
    <ul>
      <li><a href="./operations/backup.html">Backup And Restore</a></li>
      <li><a href="./operations/reset-admin-key.html">Reset Admin Key</a></li>
      <li><a href="./operations/configuration.html">Configuration And Data Directory</a></li>
      <li><a href="./migration/from-cpa-manager.html">Migrate From CPA-Manager</a></li>
    </ul>
  </section>
  <section class="cpamp-doc-card">
    <h3>Troubleshooting</h3>
    <p>Start here when monitoring is empty, the collector fails, queue data expires, or reverse proxy paths are wrong.</p>
    <ul>
      <li><a href="./troubleshooting/request-monitoring.html">Request Monitoring Troubleshooting</a></li>
      <li><a href="./reference/faq.html">FAQ</a></li>
      <li><a href="./reference/releases.html">Releases</a></li>
    </ul>
  </section>
</div>

## Runtime Modes

<div class="cpamp-mode-grid">
  <section class="cpamp-mode-card">
    <h3>Full Docker</h3>
    <p>The recommended new deployment. Manager Server hosts the panel and the browser only needs the CPAMP Admin Key.</p>
    <a href="./deployment/docker.html">View Docker Deployment</a>
  </section>
  <section class="cpamp-mode-card">
    <h3>Native Packages</h3>
    <p>Run Manager Server directly on Linux, macOS, or Windows when Docker is not part of the environment.</p>
    <a href="./deployment/native.html">View Native Packages</a>
  </section>
  <section class="cpamp-mode-card">
    <h3>Compatibility Access</h3>
    <p>You can keep an existing CPA-port panel, but full monitoring and analytics come from Manager Server.</p>
    <a href="./deployment/cpa-panel.html">View Compatibility Mode</a>
  </section>
</div>
