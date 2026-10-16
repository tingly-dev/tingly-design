# 作为 npm 工具发布 Tingly Design：现状与缺口

状态：调研（2026-10-16）。结论定下来后移进 `.design/release.md`。

问题：能不能让用户 `npx tingly-design` / `npm i -g tingly-design` 就用上编辑器？真正发版还差什么？

## 1. 结论

发版流水线已经齐了，但从没跑过；包能打、能装、能跑，但它现在是给宿主（Tingly Box）用的 bundle，不是给人直接用的工具。差两件实事：

1. **没有 `bin`**：装上之后没有命令，`npx tingly-design` 什么也不做。
2. **数据放在包目录里**：项目（`projects/`）和 AI 设置（`.tingly-design/ai.json`，含 API key）默认写在 `node_modules/@tingly-dev/tingly-design/` 下面。**升级一次版本，用户的项目和设置就被 npm 整个删掉**（已实测，见 §3）。

这两件补上、维护者做完一次性的 npm 占位，就能先发一个 rc 试，再发正式版。

## 2. 已经有的

| 部分 | 位置 | 情况 |
|---|---|---|
| PR / main 检查 | `.github/workflows/ci.yml` | 单测、typecheck、bundle、`npm pack --dry-run`；main 上最近几次都是绿的 |
| 发版 | `.github/workflows/release.yml` | 推 `vX.Y.Z` tag：校验版本与 license → 测试 → `pnpm bundle` → 像宿主一样启动冒烟（`smoke-bundle.sh`）→ 打一个 tgz + sha256 → GitHub release → npm |
| npm 发布 | `.github/scripts/npm-publish.sh`、`npm-oidc-check.sh` | 同一个 tgz 以 `@tingly-dev/tingly-design` 和 `tingly-design` 两个名字发，带 provenance；`-rc.N` 走 `next` dist-tag；可重跑 |
| 鉴权 | Trusted Publishing（OIDC） | 没有 `NPM_TOKEN`，也不需要；绑定 `release.yml` + environment `production` |
| 首发占位 | `scripts/npm-bootstrap.sh` | 维护者本机跑一次：发 `0.0.0` 占位、加 trusted publisher、设 2FA 且禁 token |
| 许可证 | `LICENSE`（Apache-2.0）、`NOTICE`、`THIRD_PARTY_LICENSES.txt` | 都进包了 |

注册表现状（`npm view`）：

- `tingly-design`、`@tingly-dev/tingly-design`：**都不存在**（404），名字还没占住。
- `@tingly-dev` 作用域已存在，`@tingly-dev/tingly-box-*` 由 npm 账号 `tinglydev` 维护，已经在用 Trusted Publishing。所以作用域权限没问题，用同一个账号跑 bootstrap 即可。
- 仓库没有任何 tag，也没有 GitHub release。

## 3. 演练（没有发布任何东西）

```
pnpm bundle                               ✓ dist/tingly-design/ 6.0 MB
npm pack                                  ✓ 110 个文件，解包 5.8 MB（含 .claude/skills）
npm publish --dry-run --access public     ✓（只提示没登录）
npm i ./tingly-dev-tingly-design-0.1.0.tgz
  node_modules/.bin                       ✗ 不存在：没有命令
PORT=4791 node node_modules/@tingly-dev/tingly-design/server.mjs
  /api/health                             ✓ version 0.1.0, protocol 1
  /                                       ✓ 200，编辑器能打开
  samples.copied → node_modules/@tingly-dev/tingly-design/projects   ← 项目写进了包目录
再 npm i 同一个包的 0.1.1
  node_modules/@tingly-dev/tingly-design/projects                    ✗ 整个没了，包括手放进去的 my-work/
```

原因在 `apps/server/src/layout.ts`：`PROJECTS_DIR = DC_PROJECTS ?? <bundle>/projects`，`aiconfig.ts` 的设置文件是 `PROJECTS_DIR/../.tingly-design/ai.json`。宿主会设 `DC_PROJECTS`，所以 TB 不受影响；直接装包的人就会踩到。`npm i -g` 还意味着往全局 `lib/node_modules` 里写，系统 Node 下常常要 sudo。

## 4. 要做的

### 必须（发给用户之前）

1. **加 `bin`**。由「CLI 与服务化使用」那边（#119，`/mnt/project-files/cli-service/cli-service.md`）设计的 `tingly-design` 命令负责：`scripts/bundle.mjs` 写进包的 `package.json` 里加 `"bin": { "tingly-design": "cli.mjs" }`，并把 `cli.mjs` 复制进 bundle。最小可发版本只需要 `tingly-design`（= `serve`）：起服务、打印地址、可选 `--open`。其余子命令可以后续版本再加，不必挡住首发。
2. **默认数据目录移出包目录**。直接运行（不是宿主）时：
   - 项目默认 `~/.tingly-design/projects`（或 `--projects <dir>`），设置默认 `~/.tingly-design/ai.json`；
   - `DC_PROJECTS` / `DC_CONFIG` 照旧优先，宿主不变；
   - 判断"直接运行"最简单的办法是让 CLI 自己设好 `DC_PROJECTS` 和 `DC_CONFIG` 再起服务，`server.mjs` 的默认值不动，宿主协议不受影响。
   - 备选是用当前目录（`./projects`），像 `vite` 那样"在哪个文件夹里跑就编辑哪个文件夹"。对"装一个设计工具"来说，用户数据目录更不容易丢东西；当前目录适合"我的仓库里有设计稿"。建议默认用户目录，`--projects .` 覆盖。这个要 YZ 定。
3. **发版冒烟加一步**：`smoke-bundle.sh` 现在只按宿主方式启动。加一个"`npm i` 打出来的 tgz → 跑 `tingly-design` 命令 → 等就绪 → 查 health → 确认项目落在包目录外"的检查，CI 和 release 都跑。

### 应该（首发前最好有）

4. **包里的 README 是写给宿主的**（"`node server.mjs`，变量见 Embedding"），npm 页面会显示它。改成给人看的：一行安装、一行运行、需要什么（Node ≥ 20.11；导出视频/PDF 需要本机 Chrome 和 ffmpeg；交给 Claude Code 需要 `claude`），宿主嵌入链接到 docs。
5. **`package.json` 补 `keywords`、`bugs`**，npm 上好搜。
6. **CLI 用到的脚本进包**：`motion-render.mjs`、HTML 导入现在不在包里（CLI 调研已列出）。属于 #119 的范围，跟着 CLI 一起做。
7. **`.design/release.md` 更新**：它在"考虑过的"里写了"等默认项目目录改到用户数据目录再加 `bin`"，做完以上就把这段改成现状；`docs/*/` 加一页"用 npm 安装"。

### 维护者一次性操作（只有有 npm 2FA 的人能做）

8. 本机 `npm i -g npm@^11.15`、用 `tinglydev` 账号 `npm login`，跑 `scripts/npm-bootstrap.sh`：两个名字各发 `0.0.0` 占位、加 trusted publisher（repo `tingly-dev/tingly-design`、workflow `release.yml`、environment `production`、允许 `npm publish`）、设 `mfa=publish`。
9. GitHub 仓库 Settings → Environments 建 `production`（若还没有），建议加 required reviewers，每次发 npm 前有人点一下。（这一步没能从这里核实是否已存在。）

### 发版步骤

10. 上面 1–3 合进 main 后，把 `package.json` 版本改成 `0.2.0-rc.1`，合进 main，推 tag `v0.2.0-rc.1` → 发到 `next`，GitHub release 标 prerelease。
11. 在一台干净机器上验：`npx tingly-design@next`、`npm i -g tingly-design@next && tingly-design`，升一次版本确认项目还在。
12. 没问题就改成 `0.2.0`、推 `v0.2.0` → `latest`。

占名字（第 8 步）可以现在就做，不依赖其他改动：`0.0.0` 走 `placeholder` dist-tag，不会被 `npm i tingly-design` 装到。

## 5. 还开着的

- 默认数据目录：用户目录还是当前目录（§4.2）。
- 首个版本号：仓库现在是 `0.1.0` 但从没发过；可以直接发 `0.1.0`，也可以借加 CLI 升到 `0.2.0`。建议后者，rc 先行。
- 两个包名每次一起发是既定设计（`.design/release.md`）；用户文档只写不带作用域的 `tingly-design`。
