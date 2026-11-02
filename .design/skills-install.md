# Agent Skills 安装

状态：已实施；外部约定和验证见 [调研](../.research/skills-install.md)。

## 契约

工作目录中运行 `npx skills add tingly-dev/tingly-design`，由 skills CLI 让用户选择格式 skill 和目标 agent。六种格式以 `.claude/skills/<name>/` 为唯一来源，目录内资源随对应 skill 安装；无需记忆名字。支持 CLI 自己的 `--skill`、`-g`、`--copy` 等选项。安装的是格式知识，不安装 Tingly Design 命令或编辑器；CLI 的 Node 要求由 skills CLI 决定。

仓库的 `issue-resolve` 是维护者工作流，以 `metadata.internal: true` 从 skills CLI 的默认发现隐藏，保留原位置供仓库内 Claude Code 使用，也继续从应用 bundle 排除。该元数据不是保密或安全边界；显式设置 `INSTALL_INTERNAL_SKILLS=1` 可发现它，其他安装器可能不识别此约定。

单装 slides 或 motion 不保证另一个 skill 同时存在，因此跨 skill 的可选说明同时给上游链接；要离线使用两个格式时安装两者。dashboard 的仓库脚本不由 skills CLI 携带，说明给出只读 SQLite 客户端替代。已有 `tingly-design skills add` 保留，仍以不覆盖用户改动为默认，只面向 `.claude/skills/`，与外部安装器的 agent 选择和更新规则分别生效。

## 取舍与维护

沿用 CLI 已支持的 `.claude/skills/`，避免复制一套 `skills/` 或改变应用、MCP、bundle 与本仓库 Claude Code 路径。每增加格式 skill 时检查它的描述、内部文件引用、单独安装时的依赖，以及 CLI 默认发现结果。更新内部工作流时保留 internal 标记；更新 slides 参考页时验证目录随安装器复制。使用 `node scripts/test-skills-install.mjs <skills-cli的bin/cli.mjs路径>` 可用已安装的真实 skills CLI 在临时目录验证发现、内部项开关和安装（不修改用户 agent 目录）。远端安装需要先将修改合并到远端默认分支。
