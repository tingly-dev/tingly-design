# 图像生成：OpenAI 风格的 images 接口

状态：**已实施**：配好图片模型且没关掉时，"交给 Claude Code"这一路在执行时多一个生图工具；设置对话框里有"ImageGen"一块（带全局开关），请求栏里有每个项目自己的开关，默认都开。其余入口见 §6，没做。测试是 `packages/core/test/aiConfig.test.ts`（解析）和 `e2e/image_gen.py`（对话框、路由、改图、错误），外加 `e2e/mock_images.py` 作模拟网关。

## 1. 要解决的问题

编辑器里的图片只能是人带进来的（附件、导入、粘贴）。人想在请求里说一句"给封面加一张插图"就得到一张，也想改一张已有的图。

接口用 OpenAI 的形状：`POST {base}/images/generations` 生成，`POST {base}/images/edits` 改图（multipart，原图）。OpenAI、xAI 等都是这个形状，Tingly Box 的网关也提供（`/tingly/imagegen/v1`，背后按它的规则转给各家），所以嵌在 Tingly Box 里时不用额外配置。

## 2. 做法：配好了，才在执行时给 Claude Code 多一个工具

最小的形状：**图片模型配好（有地址、有密钥、有模型名）时，服务端启动 Claude Code 的那一次执行里多带一个生图工具；没配好就没有这个工具**，所以没配的人不会看到一个调用就报错的东西。

- 工具是 `scripts/image-gen.mjs <项目文件夹> "<描述>" [--size] [--quality] [--edit uploads/<图>]`。它通过 `DC_SERVER_URL`（服务端启动后写进环境，Claude Code 的子进程继承）调 `POST /api/projects/:p/images`，打印新图在项目里的路径。
- `delegate.ts` 在配好时把 `Bash(node scripts/image-gen.mjs:*)` 加进允许的命令，并在系统提示里加一段说明：什么时候做（请求要一张还不存在的图，或要改 `uploads/` 里的一张），做完按各类型 skill 里 `uploads/` 的引用写法放进作品。
- 引擎只有一个：`generateImage`（`apps/server/src/imagegen.ts`）：调网关，按文件头识别格式（PNG / JPEG / WebP，不信网关的 content-type），网关回 `b64_json` 或 `url` 都认，上限 25 MB，网关的报错原话回给人。

不需要改任何一种类型的编辑器代码，也不用在 skill 里新增内容：生成的图落在 `uploads/`，每种类型本来就会显示、引用那里的图。"交给 Claude Code"的所有入口（编辑器的请求栏、命令行 `prompt`、MCP `prompt`）走的是同一个 delegate，所以都有这个工具。

**快速 AI 不生成。** 它的输出是同步执行的 jQuery 语句，放不下一次几秒到几十秒的异步调用。这个阶段它也不特意转交：需要图的请求由人用"交给 Claude Code"发。

### 开关：配好了也能关，关了不丢配置

配好（`ready`）不等于要用：生图每次都花钱，有的设计人不想让 Claude Code 自作主张去画图。所以有两层开关，**默认都是开**（配好就能用，不多一步），工具只在两层都开时才出现：

| 层 | 在哪 | 存哪 | 关掉后 |
|---|---|---|---|
| 全局 | 设置对话框"ImageGen"一块的勾选框（没配好时灰掉，不能勾） | 已保存的配置里只记 `imageEnabled: false`；环境变量 `DC_IMAGE_ENABLED=0` 由宿主强制关，对话框显示"由宿主设定" | 地址、密钥、模型名都留着，再勾上就能用 |
| 项目 | 请求栏输入框下一排选项里的"ImageGen"开关（亮着是开、划线灰色是关；只在选了 Claude Code 时出现，全局关掉时灰掉并说明原因；看板和设计系统没有） | 项目文件夹里的 `.image.json`（`{ "enabled": false }`），和 `.runs.json` 一样是本机状态：不进 zip、不进提交（`git.ts` 的 LOCAL 和 `.gitignore`），所以共享的项目不会带着某个人的选择 | 这个项目的执行里没有工具，路由回 403 `imageOff` |

只有 `false` 被记下，"开"是没有文件、没有字段；这样默认值以后要变，改一处解析就行。项目开关属于"人在这个设计里的选择"，所以放在请求栏上、写请求的地方：输入框下面一排"这次请求的设置"，和"新对话 / 接着上次"放在一起（一眼看得到当前是开是关；放进项目菜单或夹在输入框旁都试过，一个太隐晦、一个太挤）；名字和设置里那一块同名，叫"ImageGen"，不放在要进设置对话框才能改的地方；它不改全局配置，也不影响别的项目（"副作用限定在当前界面"）。

解析在 `resolveAi` 里多两项：`image.enabled`（值加来源）和 `image.active`（= `ready` 且开着）。服务端的 `imageState(project)` 把三层合成一个答案（`configured` / `global` / `project` / `on`），`GET|PUT /api/projects/:p/image-gen` 把它给编辑器，`delegate.ts` 只看 `on`，路由 `POST /images` 也检查，所以脚本被绕过也不会生成。

## 3. 生成的图放哪

**`uploads/`，按内容命名**（`<提示词的前 24 个字符>-<8 位哈希>.png`），和附件一样：同一张图只存一份，画板、幻灯片、动效场景 `src="uploads/…"`，文档 `../uploads/…`。没有另开 `generated/`：能把"人带来的"和"模型做的"分开，但要改每个技能、每种类型的引用检查和导入逻辑，换来的区分用处不大。提示词只在服务端日志里记长度（日志从不记提示词本身）。

不接的类型：**看板**只读 `data/`；**设计系统**的图片放它自己的 `assets/`，不用 `uploads/`，delegate 在这两种类型里不给这个工具。

## 4. 配置：自己的一张卡

沿用 [ai-settings.md](./ai-settings.md) 的规则：每一项"环境变量 > 已保存 > 默认"逐项比较，解析是 `packages/core/src/aiConfig.ts` 的纯函数 `resolveAi`，结果里的 `image`。

图片是对话框里自己的一张卡，**不再借别处的连接**。图片走的是 OpenAI 兼容的 `/v1/images/*`，和 Claude Code、快速 AI 用的 Anthropic 兼容入口路径和协议都不同，原来"默认跟着连接走"要靠一串条件（连接是 Box 才跟、同一主机才借密钥）才说得通，人读不懂。现在卡里自己选：

| 选择 | 图片地址 | 模型默认 | 密钥 |
|---|---|---|---|
| Tingly Box | `http://localhost:12580/tingly/imagegen/v1`，界面只读 | `tingly`（由它的规则决定实际模型） | 自己的令牌（可以在保存时取用另一张 Tingly Box 卡的，见 ai-settings.md §2） |
| 其他地址 | 人自己填一个 OpenAI 兼容的地址（如 `https://api.openai.com/v1`） | `gpt-image-1` | 自己的密钥 |

Anthropic 没有图片接口，所以这张卡没有 Anthropic 这一项；没存过地址时卡显示 Tingly Box 选中、缺令牌。

"准备好"（`image.ready`）= 有地址、有密钥、有模型名。没准备好时：路由回 501 和一句指向设置的话，Claude Code 没有这个脚本，`/api/health` 的 `imageGen` 为 `false`。关着（见上面的开关）时路由回 403，`imageGen` 同样为 `false`。

环境变量是宿主的覆盖：`DC_IMAGE_BASE_URL`、`DC_IMAGE_MODEL`、`DC_IMAGE_API_KEY`，加上 `DC_IMAGE_ENABLED=0`（关掉）。宿主设了的值在对话框里显示为"由宿主设定"，只读。单独的图片密钥和连接的密钥一样，只存在服务端的文件里，接口只回"设了没有"和来源（`saved` / `env`）。

## 5. 改图

`/images/edits` 随生成一起做了：路由的 `edit` 收一张项目里 `uploads/` 下的 PNG / JPEG / WebP 的路径（服务端自己读，不让调用者传任意路径），以 multipart 发给网关，结果是另一张新图，**原图不动**。Claude Code 通过 `--edit` 用它。没有蒙版：编辑器里没有画蒙版的界面。

## 6. 没做的 / 待定

- **其他入口**：命令行 `image`、MCP 工具、快速 AI 转交、编辑器里的按钮或"选中图片后为这里生成"。做过一版命令行和 MCP，撤掉了：这个阶段只要 Claude Code 能用。引擎的接口（`POST /api/projects/:p/images`）已经是它们要的那一层。
- **来历**：生成用的提示词只在日志里记长度，图片旁没有记录，"重新生成一张类似的"要靠人再说一遍。是否在 `uploads/` 旁放一个来历文件、是否记进改动记录，没定。
- **设置对话框里的"测试"**：快速 AI 的测试发一个很小的请求；生成图片每次都花钱，所以这一块没有测试按钮，只在填好后写"可以用了"。真正的错误由网关的原话在生成时回给人。
- 张数（`n`）固定为 1；`response_format`、`output_format` 等不传，各家网关的默认就好。
