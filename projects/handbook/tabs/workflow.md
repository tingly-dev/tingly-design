# 开发流程

## 跑起来

```sh
pnpm install
pnpm dev        # 沙箱、服务端、编辑器一起起来
```

编辑器在 5173 端口，服务端在 8787 端口。服务端监听 `projects/` 下的文件，外面改了文件，编辑器会立刻刷新。

## 改代码之前

1. 从最新的 `main` 开一个分支。
2. 想清楚改动属于哪一层：格式与回写在 `packages/core`，沙箱里跑的在 `packages/sandbox`，读写文件在 `apps/server`，界面在 `apps/editor`。
3. 改格式的，先在 `packages/core/test` 里写测试。

## 提交之前

- `pnpm test` 和 `pnpm typecheck` 都要过。
- 改了哪种项目的界面，就跑那种项目的端到端测试，例如 `python3 e2e/docs.py`。
- 端到端测试会把演示项目恢复成 git 里的样子：没提交的演示改动会丢，先提交。
