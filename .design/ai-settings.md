# AI 模型设置：一个连接，三个用途

状态：**已实施**（快速 AI、Claude Code、ImageGen）。图像生成这一块见 [image-generation.md](./image-generation.md)。测试是 `packages/core/test/aiConfig.test.ts` 和 `e2e/ai_settings.py`。

## 1. 要解决的问题

模型只能靠环境变量配：`ANTHROPIC_API_KEY`、`ANTHROPIC_BASE_URL`、`DC_FAST_MODEL`、`DC_DELEGATE_MODEL`。没配的人看到的是一句"服务端没有 ANTHROPIC_API_KEY"，既不知道去哪配，也不知道已经有 Tingly Box 在本机。快速 AI 和 Claude Code 各看哪几个变量、谁覆盖谁，也要读代码才知道。

## 2. 配置的逻辑

两个用途用模型（图像生成是第三个，地址跟着连接走，见 [image-generation.md](./image-generation.md)）：

- **快速 AI**：服务端用 Anthropic SDK 直接调，改一段文字或几个元素。
- **Claude Code**：服务端起 `claude -p`，做整件事。

决定：**一个连接（地址 + 密钥），两个模型名**。人手里通常就是一个网关（多半是 Tingly Box）或一个 Anthropic 账号，不会给两个用途各配一套。两个用途要的模型不同（一个要快，一个要强），所以模型名各填各的。

Claude Code 另有一个出口：**用它自己的登录**。装了 `claude` 并登录过的人不需要给它任何密钥，这时我们不碰它的环境变量。这是和"连接"正交的一根轴：连接回答"请求发给谁"，Claude Code 的这个选项回答"它用不用这个连接"。默认跟着有没有密钥走（有密钥 → 用连接，没有 → 用它自己的登录），人明确选过之后就记下来，不再自动变。

每个值的来源只有三种，顺序固定：

| 来源 | 谁设 | 能不能在界面改 |
|---|---|---|
| 环境变量 | 宿主（Tingly Box 嵌入时）或运行者 | 不能：界面显示"由宿主设定"，只读 |
| 已保存 | 设置对话框 | 能 |
| 默认 | 代码 | — |

逐项比较，不是整体：宿主只设了网关地址和令牌，模型名仍可以在界面里选。环境变量对应：`ANTHROPIC_BASE_URL`、`ANTHROPIC_AUTH_TOKEN` / `ANTHROPIC_API_KEY`、`DC_FAST_MODEL`、`DC_DELEGATE_MODEL`；它们的含义没变，所以宿主和现有的 e2e 都不用改。

解析是纯函数（`packages/core/src/aiConfig.ts` 的 `resolveAi`），服务端和测试共用；服务端只管读写文件和密钥。

## 3. Tingly Box 为推荐

"连接"一栏三个选项：**Tingly Box（推荐）**、Anthropic、其他地址。选 Tingly Box 就填好它的 Anthropic 兼容地址 `http://localhost:12580/tingly/anthropic`，两个模型名默认都是它的别名 `tingly`（真正用哪家模型由人在 Tingly Box 里按规则决定）。选项下面一行直说本机有没有找到它，没找到时给出获取链接。第一次打开、没配过、而且本机 12580 有响应时，默认选中 Tingly Box。

为什么推荐它：一个令牌，后面是人已经配好的各家供应商和规则，也包括 OAuth 的 Claude Code 额度；不用在这里再为每家填一次密钥。选择 Anthropic 和"其他地址"仍然是一等公民，没有被藏起来。

模型名默认值随连接变：Tingly Box 是 `tingly`，Anthropic 是 `claude-haiku-5-5`（快速 AI）和 Claude Code 自己的默认。输入框空着就是用默认值，占位符里写出具体值而不是"默认"二字。

## 4. 入口

设置不属于某个项目，也不属于某种类型，所以只有一个对话框（`AiSettings.tsx`，挂在 `main.tsx`，由 store 的 `aiSettingsOpen` 打开），三个入口：

- 启动页顶栏的按钮；
- 编辑器里项目菜单（`ProjectMenu`）的一项，六种类型都有；
- 请求栏：快速 AI 还没配密钥时，原来那句"服务端没有 ANTHROPIC_API_KEY"换成"快速 AI 还没有密钥"加一个"去设置"按钮。人是在这里发现问题的，所以修复的入口也放在这里。

对话框里有"测试"：用对话框里现填的值（还没保存）发一个很小的请求，告诉人密钥和模型能不能用，以及耗时。保存之前就能验证，错了不会把好用的配置覆盖掉。

## 5. 密钥

密钥只存在服务端的一个文件里（默认 `.tingly-design/ai.json`，在项目文件夹旁边，由宿主的数据目录决定位置；`DC_CONFIG` 可改；权限 0600，写入用临时文件加改名）。接口不回传密钥，只回传"设了没有"和来源；界面里留空表示保留原来的，要换就输入新的。项目文件夹里没有它，所以不会被提交或分享；`.tingly-design/` 在 `.gitignore` 里。

没有做用户级的钥匙串，理由是服务端要在没有桌面环境的机器上跑（容器、宿主进程），文件加权限是最小的共同做法。

## 6. 没做的

- 图像生成的**测试按钮**：生成每次都花钱，见 [image-generation.md](./image-generation.md) §7。
- 多个具名配置（"工作""个人"）：现在只有一套。
- 按项目覆盖：模型是人的偏好，不是作品的一部分，所以不进项目文件夹。
- 对 Claude Code 的"测试"：只检查 `claude` 命令在不在，不真的发一次请求（会开一个子进程、花额度）。
