# 发版：tag 触发的 GitHub release 和 npm 包

状态：已实施（`.github/workflows/release.yml`、`ci.yml`）；还没有发过第一个版本，npm 上的包名要等第一次发布才占住。

## 问题

宿主（目前是 Tingly Box）要拿到一个钉住版本、可以校验的 `dist/tingly-design/`（见 [tingly-box-integration.md](./tingly-box-integration.md) §4.4）。在这之前仓库没有 CI，也没有许可证，`package.json` 全是 `private`，没有可以发的东西。

## 发什么

一份与平台无关的 bundle，就是 `pnpm bundle` 产出的文件夹，两个渠道发同一个文件：

- **npm**：`@tingly-dev/tingly-design`。用 `@tingly-dev` 作用域，和 TB 的平台包（`@tingly-dev/tingly-box-<os>-<cpu>`）放在一起；仓库里各包的 `@dc/*` 名字只在工作区内部用，不发。
- **GitHub release**：`tingly-design-<ver>.tgz` 和 `tingly-design-<ver>.tgz.sha256`。这个 tgz 就是 `npm pack` 的产物改了名，所以 release 上的文件和 npm 上的包字节相同，TB 钉一个 sha256 从哪边下载都能校验。解开后顶层是 `package/`（npm 的打包格式），宿主解压时去掉这一层。

包里不放源码、`.design/`、`docs/`、`e2e/`，只有 bundle 本来就有的东西，加上 `README.md`、`LICENSE`、`NOTICE` 和 `THIRD_PARTY_LICENSES.txt`。最后这个是必须的：`server.mjs`、`editor/`、`sandbox/` 把依赖打进了同一个文件，构建时又去掉了许可证注释（`legalComments: 'none'`），MIT/ISC/BSD 要求随副本附上版权声明，所以 `scripts/bundle.mjs` 从 `pnpm licenses list --prod` 收集每个生产依赖的许可证全文。

不发的东西要靠 bundle 的白名单式复制保证：`scripts/bundle.mjs` 只复制它点名的目录，`issue-resolve` skill 也被排除。私有参考材料不在这个仓库里，不会进包。

### 考虑过的

- **每个工作区包分别发**（`@dc/core` 之类）：没有外部使用者，包名作用域也不是我们的；宿主只要能跑的成品。
- **给包加 `bin`，让人 `npx` 直接跑**：服务端默认把项目放在 bundle 目录下的 `projects/`，`npx` 的缓存目录会被清掉，项目跟着丢。等默认项目目录改到用户数据目录再加。
- **release 和 npm 各打一次包**：两份字节不同，宿主钉的 sha256 只能对一边，放弃。

## 怎么触发

推一个 `vX.Y.Z` tag，版本必须和根 `package.json` 的 `version` 一致，不一致直接失败（先改版本、合进 main、再打 tag）。`vX.Y.Z-rc.N` 这类预发布版发到 npm 的 `next` dist-tag，GitHub release 标成 prerelease；正式版走 `latest`。

三个 job 依次跑：

1. **build**：单元测试、typecheck、`pnpm bundle`，再像宿主那样启动一次 bundle（`.github/scripts/smoke-bundle.sh`：`PORT=0`、`/design` 前缀、空的项目目录，等就绪行，查 `/api/health` 的版本、编辑器和沙箱能访问、示例已放入），然后打包、算 sha256。
2. **github**：在 tag 上建 release，附上两个文件；release 已经存在就只补文件。
3. **npm**：在 `npm` environment 里发布同一个 tgz，带 provenance。版本已在 npm 上就跳过，所以重跑是安全的。

npm 排在 GitHub release 后面：npm 发出去就撤不回，前面任何一步失败都不该走到这里。

`ci.yml` 在每个 PR 和 main 上跑同样的检查（不打包、不发布，只 `npm pack --dry-run` 列出包内容），让发版时不出意外。

## 鉴权

用 npm Trusted Publishing（OIDC），不在仓库里放长期 token。它绑定 workflow 文件名 `release.yml` 和 environment `npm`，这两个名字不要改。

包第一次发布之前，npm 上还没有这个包，无法给它配 trusted publisher，所以第一个版本要用一个短期的 granular token：放到仓库 secret `NPM_TOKEN`，发完后在 npmjs.com 的包设置里加 trusted publisher（org `tingly-dev`、repo `tingly-design`、workflow `release.yml`、environment `npm`，允许 `npm publish`），再删掉这个 secret。`NPM_TOKEN` 存在时 npm 用它，不存在时走 OIDC。

`npm` environment 建议配 required reviewers，这样每次发布 npm 前有人点一下。

## 许可证

和 Tingly Box 一致：MPL-2.0，外加 Tingly Inc. 的商业授权（`LICENSE`、`NOTICE`）。

## 还开着的

- TB 那边的下载、校验和缓存（tingly-box-integration.md §4.4）还没做。
- 变更说明现在用 GitHub 自动生成的 release notes，没有手写的 changelog。
- 默认项目目录改到用户数据目录之后，可以给包加 `bin`，支持 `npx @tingly-dev/tingly-design`。
