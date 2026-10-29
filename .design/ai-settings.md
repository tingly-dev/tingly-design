# AI 模型设置：三个用途，三张卡，各管各的连接

状态：**已实施**（Claude Code、ImageGen、快速 AI 各一张卡）。图像生成这一块见 [image-generation.md](./image-generation.md)。测试是 `packages/core/test/aiConfig.test.ts`、`e2e/ai_settings.py` 和 `e2e/image_gen.py`；画板是 `projects/tingly-design-ui-canvas` 的 Menus 一页。

## 1. 要解决的问题

模型只能靠环境变量配：没配的人看到的是一句"服务端没有 ANTHROPIC_API_KEY"，既不知道去哪配，也不知道已经有 Tingly Box 在本机。后来有了一个对话框，但三个用途（快速 AI、Claude Code、ImageGen）的字段混在一页：顶上一个共用的"连接"，下面三段各读它，一个字段改了会牵动另外两段（连接换成 Anthropic，ImageGen 就莫名其妙"没有地址"；Claude Code 的配置档只在连接是 Tingly Box 时才出现）。人读这一页要先在脑子里把"这个字段属于谁"拆开。

## 2. 决定：三张独立的卡

整页分成上中下三张卡，**每个用途一张，各带自己的连接信息**，彼此不共用、不联动：

| 卡 | 里面是什么 |
|---|---|
| Claude Code（上） | 一排标签选它怎么跑：**本地登录**（用本机 `claude` 命令自己的登录，没有字段）、**Tingly Box**（令牌、可选配置档、模型）、**自定义地址**（地址、密钥、模型；地址留空就是 Anthropic 官方）。每个标签只显示自己要的字段 |
| ImageGen（中） | Tingly Box 或其他地址（OpenAI 风格），令牌 / 密钥、模型，开关 |
| 快速 AI（下） | Tingly Box、Anthropic 或其他地址，密钥、模型、测试 |

卡的顺序按人的使用频率：Claude Code 做整件事，是主角；ImageGen 是它的工具；快速 AI 是页内的小模型。

每张卡的标题右边有一个状态（已就绪 / 缺令牌 / 缺密钥 / 缺地址 / 已关闭 / 没有 claude 命令），人不用往下读字段就知道这张卡还差什么。

被否决的做法：

- **保留顶部的共用连接，卡片只放模型名**：就是原来的页，混杂的问题不变。
- **每张卡要一个"沿用上面那张的连接"开关**：又是一个模式开关，而且一沿用就又联动了。改成下面的"取用令牌"。
- **三个标签放在页顶，卡片随标签变**：Claude Code 的三种方式是同一个用途的三种路径，才适合标签；ImageGen 和快速 AI 是另外两件事，放进同一排标签会把"选哪个用途"和"选怎么连"混成一根轴。

### 同一个令牌不必输三遍

大多数人只有一个 Tingly Box，三张卡里填的是同一个令牌。让每张卡都从头填一次太烦，所以：当一张卡选了 Tingly Box、自己还没有令牌，而另一张选了 Tingly Box 的卡已有令牌（刚填的或已保存的）时，令牌栏下面出现一行"沿用某某卡的令牌"。点了之后栏里写"与某某卡使用同一个令牌 · 更换"，保存时服务端把那个令牌**复制**到这张卡自己的位置（`KeyFrom`，`saveAi`）。保存之后两张卡互不相干，改一张的令牌不会动另一张。只在 Tingly Box 的卡之间提供：别家的密钥不该发给另一家。

## 3. 配置的逻辑

每个值的来源只有三种，顺序固定：

| 来源 | 谁设 | 能不能在界面改 |
|---|---|---|
| 环境变量 | 宿主（Tingly Box 嵌入时）或运行者 | 不能：界面显示"由宿主设定"，只读 |
| 已保存 | 设置对话框 | 能 |
| 默认 | 代码 | — |

逐项比较，不是整体：宿主只设了网关地址和令牌，模型名仍可以在界面里选。环境变量的含义没有变，所以宿主和现有的 e2e 都不用改：

- `ANTHROPIC_BASE_URL`、`ANTHROPIC_AUTH_TOKEN` / `ANTHROPIC_API_KEY` 是宿主的网关：快速 AI 的地址和密钥，也是 Claude Code「自定义地址」标签的地址和密钥。宿主设了地址，Claude Code 就固定在这个标签上（标签不再显示），按宿主给的原样启动。
- `DC_FAST_MODEL` 是快速 AI 的模型；`DC_DELEGATE_MODEL` 是 Claude Code 的模型，对每个标签都生效（本地登录也会带上）。
- `DC_IMAGE_*` 见 [image-generation.md](./image-generation.md)。

解析是纯函数（`packages/core/src/aiConfig.ts` 的 `resolveAi`），服务端和测试共用；服务端只管读写文件和密钥。结果按卡分：`fast`、`claude`（`mode`、`box`、`custom` 各有自己的令牌和模型）、`image`。

Claude Code 没存过选择时的默认：宿主给了密钥就是自定义地址，否则是本地登录（装了 `claude` 并登录过的人不需要任何密钥，我们不碰它的环境变量）。人明确选过之后就记下来，不再自动变。

## 4. Tingly Box 为推荐

三张卡里 Tingly Box 都是第一个选项，带"推荐"。选它就填好它的地址：快速 AI 是 Anthropic 兼容的 `http://localhost:12580/tingly/anthropic`，ImageGen 是 `…/tingly/imagegen/v1`，Claude Code 是它那套路由的 `…/tingly/claude_code`。快速 AI 的模型名默认是它的别名 `tingly`，Claude Code 的是路由的默认档 `cc`，ImageGen 的是 `tingly`；真正用哪家模型由人在 Tingly Box 里按规则决定。本机 12580 没有响应时，卡里说一句并给出获取链接；响应着就什么也不说（三张卡各说一遍"正在运行"只是噪音）。第一次打开、没配过、而且 12580 有响应时，快速 AI 默认选中 Tingly Box。

为什么推荐它：一个令牌，后面是人已经配好的各家供应商和规则，也包括 OAuth 的 Claude Code 额度；不用在这里再为每家填一次密钥。Anthropic 和"其他地址"仍然是一等公民，没有被藏起来。

模型名默认值随选择变，输入框空着就是用默认值，占位符里写出具体值而不是"默认"二字。

### Claude Code 走 Tingly Box 的哪条路由

Tingly Box 给 Claude Code 单独的一套路由（场景 `claude_code`）：规则、用量和额度都按它记，人在 Box 里为 Claude Code 配的档位（haiku / sonnet / opus 各对应哪个模型）也在这里。它的地址是 `<box>/tingly/claude_code`，Box 自己启动 Claude Code 时给的就是这个；再分出的**配置档**（profile）是 `<box>/tingly/claude_code:<名称或 ID>`，同一个模型令牌，认证方式不变。

决定：
- 「Tingly Box」标签里 `claude` 拿到的地址是 Box 的 `claude_code` 路由，而不是快速 AI 用的 `anthropic` 路由。快速 AI 要的是"一个名字、一次回答"，Claude Code 要的是人给它配好的那套档位，所以两个用途走两条路由。
- 配置档是一个可选的文本框，空着就是主路由；不做下拉，也不加模式开关。原因：列出 Box 的配置档要用 Box 的管理令牌（`/api/v1/scenario/claude_code/profiles`），而这里只有模型令牌；让设置对话框去要第二个令牌，比让人敲一个名字更重。名字只接受字母、数字、`-`、`_`（Box 自己的别名规则，它也是 URL 的一部分），ID 形如 `p1` 同样可用。
- 标签里直接写出 `claude` 实际会拿到的完整地址，人能看到填了配置档之后变成了什么。
- 配置档只属于 Tingly Box 标签；切到别的标签再存，已填的名字会保留。

没验证的：这一块对着 Box 的源码（路由、配置档别名解析、默认模型名）实现，没有对着运行中的 Box 做过端到端的真实请求；`e2e/ai_settings.py` 检查的是对话框和写入的地址。

## 5. 入口

设置不属于某个项目，也不属于某种类型，所以只有一个对话框（`AiSettings.tsx`，挂在 `main.tsx`，由 store 的 `aiSettingsOpen` 打开），三个入口：

- 启动页顶栏的按钮；
- 编辑器里项目菜单（`ProjectMenu`）的一项，六种类型都有；
- 请求栏：快速 AI 还没配密钥时，原来那句"服务端没有 ANTHROPIC_API_KEY"换成"快速 AI 还没有密钥"加一个"去设置"按钮。人是在这里发现问题的，所以修复的入口也放在这里。

快速 AI 那张卡里有"测试"：用对话框里现填的值（还没保存）发一个很小的请求，告诉人密钥和模型能不能用，以及耗时。保存之前就能验证，错了不会把好用的配置覆盖掉。三张卡很高，对话框在视口里滚动，标题和按钮留在原处。

## 6. 密钥和旧文件

密钥只存在服务端的一个文件里（默认 `.tingly-design/ai.json`，在项目文件夹旁边，由宿主的数据目录决定位置；`DC_CONFIG` 可改；权限 0600，写入用临时文件加改名）。每张卡一把自己的钥匙（快速 AI 的、Claude Code 的 Tingly Box 令牌、Claude Code 自定义地址的、ImageGen 的）。接口不回传密钥，只回传"设了没有"和来源；界面里留空表示保留原来的，要换就输入新的。项目文件夹里没有它，所以不会被提交或分享；`.tingly-design/` 在 `.gitignore` 里。

没有做用户级的钥匙串，理由是服务端要在没有桌面环境的机器上跑（容器、宿主进程），文件加权限是最小的共同做法。

**旧文件会被读成三张卡**：以前保存的是一个共用连接（`baseUrl`、`apiKey`）加 Claude Code 的路线（`claudeRoute`）。读到这种文件时（`migrateSaved`）：快速 AI 拿到那个地址和密钥；Claude Code 选过"自己的登录"就是本地登录，否则按连接是不是 Tingly Box 落到 Tingly Box 标签或自定义地址标签，带着同一把密钥和原来的模型名；ImageGen 原来"跟着连接走"的地址和借用的密钥（只在 Tingly Box 或同一主机时借）各自落成自己的地址和密钥。每个人原来能用的，迁移后仍能用；下一次保存才写成新格式，在那之前文件不动。

## 7. 没做的

- 图像生成的**测试按钮**：生成每次都花钱，见 [image-generation.md](./image-generation.md) §7。
- 多个具名配置（"工作""个人"）：现在只有一套。
- 按项目覆盖：模型是人的偏好，不是作品的一部分，所以不进项目文件夹。
- 对 Claude Code 的"测试"：只检查 `claude` 命令在不在，不真的发一次请求（会开一个子进程、花额度）。
- 清除某张卡已保存的密钥：界面没有这个动作（留空即保留）；要全部清掉，用 `PUT /api/ai-config {"reset": true}`。
