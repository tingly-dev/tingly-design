# 发版：tag 触发的 GitHub release 和 npm 包

状态：已实施（`.github/workflows/release.yml`、`ci.yml`）；还没有发过第一个版本，npm 上的包名要等第一次发布才占住。

## 问题

宿主（目前是 Tingly Box）要拿到一个钉住版本、可以校验的 `dist/tingly-design/`（见 [tingly-box-integration.md](./tingly-box-integration.md) §4.4）。在这之前仓库没有 CI，也没有许可证，`package.json` 全是 `private`，没有可以发的东西。

## 发什么

一份与平台无关的 bundle，就是 `pnpm bundle` 产出的文件夹，两个渠道发同一个文件：

- **npm**：同时发 `@tingly-dev/tingly-design` 和 `tingly-design` 两个名字，内容相同，只有 `package.json` 的 `name` 不同。作用域名和 TB 的平台包（`@tingly-dev/tingly-box-<os>-<cpu>`）放在一起，是宿主钉版本用的正式名字；不带作用域的名字好记好搜，也防止被别人抢注，将来加了 `bin` 就是 `npx tingly-design`。和 TB 一样（`tingly-box` 加 `@tingly-dev/…`）。两个名字每次一起发，不留一个永远停在占位版本的空包。仓库里各包的 `@dc/*` 名字只在工作区内部用，不发。
- **GitHub release**：`tingly-design-<ver>.tgz` 和 `tingly-design-<ver>.tgz.sha256`。这个 tgz 就是 `npm pack` 的产物改了名，和 npm 上 `@tingly-dev/tingly-design` 的内容相同；TB 钉的 sha256 以 release 上的文件为准。解开后顶层是 `package/`（npm 的打包格式），宿主解压时去掉这一层。

包里不放源码、`.design/`、`docs/`、`e2e/`，只有 bundle 本来就有的东西，加上 `README.md`、`LICENSE`、`NOTICE` 和 `THIRD_PARTY_LICENSES.txt`。最后这个是必须的：`server.mjs`、`editor/`、`sandbox/` 把依赖打进了同一个文件，构建时又去掉了许可证注释（`legalComments: 'none'`），MIT/ISC/BSD 要求随副本附上版权声明，所以 `scripts/bundle.mjs` 从 `pnpm licenses list --prod` 收集每个生产依赖的许可证全文。

不发的东西要靠 bundle 的白名单式复制保证：`scripts/bundle.mjs` 只复制它点名的目录，`issue-resolve` skill 也被排除。私有参考材料不在这个仓库里，不会进包。

### 考虑过的

- **每个工作区包分别发**（`@dc/core` 之类）：没有外部使用者，包名作用域也不是我们的；宿主只要能跑的成品。
- **给包加 `bin`，让人 `npx` 直接跑**：服务端默认把项目放在 bundle 目录下的 `projects/`，`npx` 的缓存目录会被清掉，项目跟着丢。等默认项目目录改到用户数据目录再加。
- **release 和 npm 各打一次包**：两次构建的产物可能不同，宿主钉的 sha256 只能对一边，放弃；现在只构建一次，npm 发布用的是同一个 tgz 解开后的内容。
- **只占作用域名，或者只发不带作用域的名字**：前者把好记的名字留给别人，后者没法和 TB 的平台包归在一个组织下。

## 怎么触发

推一个 `vX.Y.Z` tag，版本必须和根 `package.json` 的 `version` 一致，不一致直接失败（先改版本、合进 main、再打 tag）。`vX.Y.Z-rc.N` 这类预发布版发到 npm 的 `next` dist-tag，GitHub release 标成 prerelease；正式版走 `latest`。

三个 job 依次跑：

1. **build**：单元测试、typecheck、`pnpm bundle`，再像宿主那样启动一次 bundle（`.github/scripts/smoke-bundle.sh`：`PORT=0`、`/design` 前缀、空的项目目录，等就绪行，查 `/api/health` 的版本、编辑器和沙箱能访问、示例已放入），然后打包、算 sha256。
2. **github**：在 tag 上建 release，附上两个文件；release 已经存在就只补文件。
3. **npm**：在 `production` environment 里先确认 npm ≥ 11.5.1、预先做一次 OIDC 交换（被拒时把 npm 给的原因打出来，什么都还没发），再用 `.github/scripts/npm-publish.sh` 把同一个 tgz 以两个名字发布，带 provenance。某个名字的这个版本已在 npm 上就跳过，所以发了一半失败后重跑是安全的。

npm 排在 GitHub release 后面：npm 发出去就撤不回，前面任何一步失败都不该走到这里。

`ci.yml` 在每个 PR 和 main 上跑同样的检查（不打包、不发布，只 `npm pack --dry-run` 列出包内容），让发版时不出意外。

## 鉴权：只走 Trusted Publishing，其余要一次性密码

和 Tingly Box 的 `npm.yml` 一样，仓库里不放任何 npm token，workflow 里也没有 `NPM_TOKEN` / `NODE_AUTH_TOKEN`。npm job 申请 GitHub Actions 的 OIDC id-token（`id-token: write`），npm ≥ 11.5.1 拿它换一个只能用于这一次发布的凭据，带 provenance。

- **npm 那边**：两个包各有一条 trusted publisher：GitHub Actions、org `tingly-dev`、repo `tingly-design`、workflow `release.yml`、environment `production`，允许 `npm publish`（2026-09-03 之后新建的配置默认只允许 stage publish，那样 `npm publish` 会报笼统的 "package not found"）。字段都是精确匹配，改 workflow 文件名或 environment 名都会让发布失败，直到 npm 上同步改。
- **发布权限**：两个包都设为 "Require two-factor authentication and disallow tokens"（`npm access set mfa=publish`）。CI 之外，只有开了 2FA 的维护者在本机输入一次性密码才能发；泄露的 token 发不了包。
- **为什么不用 token**：npm 已经停用 classic token，granular token 最长 90 天，"bypass 2FA" 也在取消，放在 GitHub secret 里的 token 迟早发不了，还多一个泄露面。
- **`production` environment**：建议在 GitHub 上配 required reviewers，每次发 npm 前有人点一下。

### 第一次发布前：手工占位

trusted publisher 只能加在已经存在的包上，而 CI 只能用 OIDC 发布，所以新包名要先由维护者在本机占位。`scripts/npm-bootstrap.sh` 做完这三步，每一步 npm 都会要一次性密码：

1. 给两个名字各发一个空的 `0.0.0` 占位版本（dist-tag `placeholder`），只为让包名存在；
2. `npm trust github` 加上面那条 trusted publisher（需要 npm ≥ 11.15）；
3. `npm access set mfa=publish`。

之后每个真实版本都由 CI 发布，占位版本不再碰。脚本可以重跑：已存在的包不再发，已有的 trusted publisher 不重复加。

## 许可证

Apache-2.0（`LICENSE`、`NOTICE`）。目标是让编辑器传得快、谁都能拿去用和改：比 MPL-2.0 少了"改过的文件要开源"的义务，又比 MIT 多了专利授权条款，企业用起来顾虑更少。Tingly Box 本身仍是 MPL-2.0 加商业授权，两个仓库各自独立。

release 的 build 一步在根 `package.json` 没有 `license` 时直接失败，保证不会发出没有许可证的包。

## 主页：GitHub Pages，视频由 CI 渲染

主页是 `site/` 里的一页静态 HTML（中英双语，随浏览器语言切换），`.github/workflows/pages.yml` 在 main 上构建并部署；PR 上只构建不部署，渲染坏了在合并前就能看到。

主页上的宣传视频是 `projects/design-motion` 这个示例本身，由 `scripts/build-site.sh` 调用 `tingly-design export`（[cli.md](./cli.md)）在 CI 里渲染出 16:9 和 9:16 两版加封面，不提交进仓库。没选直接拷贝一份 mp4，因为那份会和示例项目脱节：示例改了，主页还是旧片子；仓库里也会多出几 MB 的二进制，每次重渲染都是一次新的 blob。代价是 CI 要装 Chromium 和 ffmpeg，渲染约一两分钟；只在 `site/`、该示例、sandbox 运行时、`render.ts` 或命令行变化时才触发。

六种类型的截图和分享封面用 README 的素材 `docs/images/readme/`（中英文各一套，页面按语言切换），同样构建时拷入。部署用官方的 `upload-pages-artifact` + `deploy-pages`，不用 gh-pages 分支，所以仓库里没有构建产物分支。第一次部署前要有人在仓库设置里把 Pages 的来源选成 GitHub Actions（见 Settings → Pages）。

## 还开着的

- TB 那边的下载、校验和缓存（tingly-box-integration.md §4.4）还没做。
- 变更说明现在用 GitHub 自动生成的 release notes，没有手写的 changelog。
- 默认项目目录改到用户数据目录之后，可以给包加 `bin`，支持 `npx tingly-design`。
