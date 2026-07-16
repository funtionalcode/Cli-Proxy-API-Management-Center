# Releases

CPAMP publishes versions through GitHub Releases. Release note source files are stored in the repository under `docs/release-notes/`.

## Latest Version

- [GitHub Releases](https://github.com/seakee/CPA-Manager-Plus/releases)
- [Latest Release](https://github.com/seakee/CPA-Manager-Plus/releases/latest)

## Release Note Source Files

- [docs/release-notes](https://github.com/seakee/CPA-Manager-Plus/tree/main/docs/release-notes)

File names:

```text
docs/release-notes/<tag>-zh.md
docs/release-notes/<tag>-en.md
```

## Release Process

The release workflow is documented in the repository:

- [docs/release.md](https://github.com/seakee/CPA-Manager-Plus/blob/main/docs/release.md)

Pushing a tag triggers `.github/workflows/release.yml`, which generates:

- `management.html`
- native packages
- Docker images
- GitHub Release body
