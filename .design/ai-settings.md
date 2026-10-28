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

"连接"一栏三个选项：**Tingly Box（推荐）**、Anthropic、其他地址。选 Tingly Box 就填好它的 Anthropic 兼容地址 `http://localhost:12580/tingly/anthropic`，快速 AI 的模型名默认是它的别名 `tingly`，Claude Code 的是它那套路由的默认档 `cc`（见下面一节）；真正用哪家模型由人在 Tingly Box 里按规则决定。选项下面一行直说本机有没有找到它，没找到时给出获取链接。第一次打开、没配过、而且本机 12580 有响应时，默认选中 Tingly Box。

为什么推荐它：一个令牌，后面是人已经配好的各家供应商和规则，也包括 OAuth 的 Claude Code 额度；不用在这里再为每家填一次密钥。选择 Anthropic 和"其他地址"仍然是一等公民，没有被藏起来。

模型名默认值随连接变：Tingly Box 是 `tingly`（Claude Code 是 `cc`），Anthropic 是 `claude-haiku-5-5`（快速 AI）和 Claude Code 自己的默认。输入框空着就是用默认值，占位符里写出具体值而不是"默认"二字。

### Claude Code 走 Tingly Box 的哪条路由

Tingly Box 给 Claude Code 单独的一套路由（场景 `claude_code`）：规则、用量和额度都按它记，人在 Box 里为 Claude Code 配的档位（haiku / sonnet / opus 各对应哪个模型）也在这里。它的地址是 `<box>/tingly/claude_code`，Box 自己启动 Claude Code 时给的就是这个；再分出的**配置档**（profile）是 `<box>/tingly/claude_code:<名称或 ID>`，同一个模型令牌，认证方式不变。默认模型名是这一套路由的默认档 `cc`。

决定：
- 选了 Tingly Box 且 Claude Code 用共享连接时，`claude` 拿到的地址是 Box 的 `claude_code` 路由，而不是快速 AI 用的 `anthropic` 路由。快速 AI 要的是"一个名字、一次回答"，Claude Code 要的是人给它配好的那套档位，所以同一个连接下两个用途走两条路由。
- 配置档是一个可选的文本框，空着就是主路由；不做下拉，也不加模式开关。原因：列出 Box 的配置档要用 Box 的管理令牌（`/api/v1/scenario/claude_code/profiles`），而这里只有模型令牌；让设置对话框去要第二个令牌，比让人敲一个名字更重。名字只接受字母、数字、`-`、`_`（Box 自己的别名规则，它也是 URL 的一部分），ID 形如 `p1` 同样可用。
- 对话框在输入框下面直接写出 `claude` 实际会拿到的完整地址，人能看到填了配置档之后变成了什么。
- 配置档只对 Tingly Box 有意义：连接是 Anthropic 或其他地址时不显示，也不会写进地址。宿主已经用 `ANTHROPIC_BASE_URL` 固定了地址时，我们不改它（宿主要走某个配置档，就把地址写成 `…/tingly/claude_code:<名称>`），这时配置档输入框不出现，模型名默认也仍是 `tingly`。配置档只在 Claude Code 用共享连接时显示和校验；换到别的连接再存，已填的名字会保留。

没验证的：这一块对着 Box 的源码（路由、配置档别名解析、默认模型名）实现，没有对着运行中的 Box 做过端到端的真实请求；`e2e/ai_settings.py` 检查的是对话框和写入的地址。

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
