# 版本说明

CPAMP 使用 GitHub Releases 发布版本，release note 源文件保存在仓库的 `docs/release-notes/` 目录。

## 最新版本

- [GitHub Releases](https://github.com/seakee/CPA-Manager-Plus/releases)
- [Latest Release](https://github.com/seakee/CPA-Manager-Plus/releases/latest)

## Release Notes 源文件

- [docs/release-notes](https://github.com/seakee/CPA-Manager-Plus/tree/main/docs/release-notes)

文件命名：

```text
docs/release-notes/<tag>-zh.md
docs/release-notes/<tag>-en.md
```

## 发布流程

发布流程约定见仓库文档：

- [docs/release.md](https://github.com/seakee/CPA-Manager-Plus/blob/main/docs/release.md)

Tag push 会触发 `.github/workflows/release.yml`，生成：

- `management.html`
- 原生运行包
- Docker 镜像
- GitHub Release body
