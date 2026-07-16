# Get Started

Start here for the shortest working setup: bring up the CPA gateway runtime, bring up CPAMP, then confirm that request monitoring can receive data. If CPA is already running, jump to [Deploy CPAMP Only](../deployment/docker.md#deploy-cpamp-only).

## Use The Installer

For a guided deployment, run the installer:

```bash
curl -fsSLO https://raw.githubusercontent.com/seakee/CPA-Manager-Plus/main/bin/install-cpamp.sh
bash install-cpamp.sh
```

It checks your environment, lets you choose the operation language, chooses full stack or CPAMP-only install, generates minimal config, and asks for final confirmation before it deploys. To preview the plan first:

```bash
CPAMP_DRY_RUN=1 bash install-cpamp.sh
```

See [One-Click Installer](../deployment/installer.md) for all options.

## Recommended Deployment

For a first deployment, use Docker Compose. It creates persistent volumes for both CPA and CPAMP:

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

Start the services:

```bash
docker compose up -d
```

Open the management panel:

```text
http://<host>:18317/management.html
```

The first login requires the CPAMP Admin Key. If you did not set one explicitly, Manager Server prints it once in the startup logs:

```bash
docker compose logs cpa-manager-plus
```

## First Configuration

In setup, enter these values in order:

1. CPAMP Admin Key.
2. CPA URL, for example `http://cli-proxy-api:8317`.
3. CPA Management Key.
4. Request monitoring mode. For a new deployment, keep the default `auto` mode.

Recommended CPA version: `v7.1.39+`. The HTTP usage queue needs `v6.10.8+`.

## What Should Work After Setup

- Dashboard opens and shows Manager Server / CPA connection state.
- Monitoring shows realtime rows after real requests pass through CPA.
- Usage Analytics breaks down cost and tokens by model, account, project, and time range.
- Codex Inspection shows quota, reset time, credential state, and account health.

If the panel opens but monitoring stays empty, start with [Request Monitoring Troubleshooting](../troubleshooting/request-monitoring.md). The usual causes are usage publishing, CPA URL, queue retention, or collector path.

## Next Steps

- To choose the right mode, read [Runtime Model](./runtime-model.md).
- To configure providers or clients, read [Gateway Configuration](../gateway/configuration.md).
- To learn each panel page, start with [Dashboard](../manual/dashboard.md).
- To use native packages, read [Native Packages](../deployment/native.md).
- To migrate from the old project, read [Migrate From CPA-Manager](../migration/from-cpa-manager.md).
