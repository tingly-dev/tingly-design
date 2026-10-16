# 作为 npm 工具发布 Tingly Design：现状与缺口

状态：调研（2026-10-16，按 main `c8a83d1` 重新验证）。结论定下来后移进 `.design/release.md`。

问题：能不能让用户 `npx tingly-design` / `npm i -g tingly-design` 就用上编辑器？真正发版还差什么？

## 1. 结论

**代码这边已经可以发了。** 第一次检查时的两个阻断项都已在 main 上解决：

- 有命令了：包的 `bin` 是 `cli.mjs`，`tingly-design` 带 open / serve / new / list / check / export / import（[cli.md](../.design/cli.md)）。
- 数据不在包目录了：直接运行时项目在 `~/.tingly-design/projects`、AI 设置在 `~/.tingly-design/ai.json`；宿主设 `DC_PROJECTS` 照旧（[project-folders.md](../.design/project-folders.md)）。升级不再丢项目（§3 实测）。

剩下的只有维护者在 npm 和 GitHub 上的一次性操作，然后推 tag。

## 2. 已经有的

| 部分 | 位置 | 情况 |
|---|---|---|
| PR / main 检查 | `.github/workflows/ci.yml` | 单测、typecheck、bundle、冒烟、`npm pack --dry-run`；main 是绿的 |
| 发版 | `.github/workflows/release.yml` | 推 `vX.Y.Z` tag：校验版本与 license → 测试 → `pnpm bundle` → 冒烟（宿主方式 + 装好的命令）→ 一个 tgz + sha256 → GitHub release → npm |
| npm 发布 | `.github/scripts/npm-publish.sh`、`npm-oidc-check.sh` | 同一个 tgz 以 `@tingly-dev/tingly-design` 和 `tingly-design` 两个名字发，带 provenance；`-rc.N` 走 `next`；可重跑 |
| 鉴权 | Trusted Publishing（OIDC） | 没有 `NPM_TOKEN`，也不需要；绑定 `release.yml` + environment `production` |
| 首发占位 | `scripts/npm-bootstrap.sh` | 维护者本机跑一次：发 `0.0.0` 占位、加 trusted publisher、设 2FA 且禁 token |
| 许可证 | `LICENSE`（Apache-2.0）、`NOTICE`、`THIRD_PARTY_LICENSES.txt` | 都进包 |

注册表现状（`npm view`）：

- `tingly-design`、`@tingly-dev/tingly-design`：**都不存在**（404），名字还没占住。
- `@tingly-dev` 作用域已存在，`@tingly-dev/tingly-box-*` 由 npm 账号 `tinglydev` 维护，已经在用 Trusted Publishing；用同一个账号跑 bootstrap 即可。
- 仓库没有任何 tag，也没有 GitHub release。

## 3. 演练（没有发布任何东西）

用临时的 `HOME` 和全局 prefix，模拟一台干净机器：

```
pnpm bundle                                         ✓
npm pack                                            ✓ 111 个文件，解包 6.4 MB
npm publish --dry-run --access public               ✓
npm i -g ./tingly-dev-tingly-design-0.1.0.tgz       ✓ bin/tingly-design
tingly-design --version / --help                    ✓ 0.1.0，默认项目目录 ~/.tingly-design/projects
tingly-design new slides my-deck                    ✓ 建在 ~/.tingly-design/projects/my-deck
tingly-design list / check my-deck                  ✓ 示例 + my-deck；No problems
tingly-design check                                 ✓ 列出 Chrome、ffmpeg、claude、fast AI 是否可用
tingly-design serve --port 4792                     ✓ ready 行、/api/health、编辑器 200
npm i -g ./tingly-dev-tingly-design-0.1.1.tgz       ✓ 升级后 --version 0.1.1，my-deck 和 ~/.tingly-design 里的文件都还在
npx --package ./…-0.1.1.tgz tingly-design --version ✓ 0.1.1
```

第一次检查（main `37bc2d9`）时，同样的升级会把包目录下的 `projects/` 整个删掉；现在数据在包外，问题不再存在。

## 4. 要做的

### 维护者一次性操作（只有有 npm 2FA 的人能做）

1. 本机 `npm i -g npm@^11.15`，用 `tinglydev` 账号 `npm login`，跑 `scripts/npm-bootstrap.sh`：两个名字各发 `0.0.0` 占位（dist-tag `placeholder`，`npm i tingly-design` 不会装到它）、加 trusted publisher（repo `tingly-dev/tingly-design`、workflow `release.yml`、environment `production`、允许 `npm publish`）、设 `mfa=publish`。这一步现在就能做，越早占住名字越好。
2. GitHub 仓库 Settings → Environments 建 `production`（若还没有），建议加 required reviewers，每次发 npm 前有人点一下。（这一步没能从这里核实是否已存在。）

### 发版步骤

3. 把根 `package.json` 版本改成 `0.2.0-rc.1`，合进 main，推 tag `v0.2.0-rc.1` → npm `next`，GitHub release 标 prerelease。
4. 在一台干净机器上验：`npx tingly-design@next`、`npm i -g tingly-design@next && tingly-design`。
5. 没问题就改成 `0.2.0`、推 `v0.2.0` → `latest`。

### 可以顺手做的（不挡首发）

- 发版冒烟加"升级一个版本后项目还在"的检查（§3 是手工验的）。
- npm 页面显示的包 README 现在很短（两行命令加链接到 `docs/en/cli.md`）；首发后看一眼要不要加一句需要什么（Node ≥ 20.11；视频/PDF 导出要本机 Chrome 和 ffmpeg；交给 Claude Code 要 `claude`）。
- 包的 `package.json` 现在带 `keywords` 和 `bugs`，npm 上好搜。

## 5. 还开着的

- 首个版本号：仓库现在是 `0.1.0` 但从没发过；可以直接发 `0.1.0`，也可以借 CLI 落地升到 `0.2.0`。建议后者，rc 先行。
- 两个包名每次一起发是既定设计（`.design/release.md`）；用户文档只写不带作用域的 `tingly-design`。
