# Agent Skills 安装方式调研

状态：调研（2026-11-02）；设计决策见 [skills 安装](../.design/skills-install.md)。

## 问题与证据

用户希望通过通用的 `npx skills add` 安装 Tingly Design 的 agent 指南，而不是记住六个名称。调研的是安装与发现约定，不把示例当成生态占有率统计。

- [skills CLI 官方 README](https://github.com/vercel-labs/skills/blob/main/README.md#install-a-skill) 的首选用法是 `npx skills add vercel-labs/agent-skills`，随后选择 skill 和 agent；`--skill` 是按名称选取的可选用法，`-g` 切到用户级。当前文档要求 Node.js 22.20+。
- [skills CLI 创建指南](https://github.com/vercel-labs/skills/blob/main/docs/creating-skills.md) 列出 `skills/`、`.agents/skills/`、`.claude/skills/` 等发现位置；`metadata.internal: true` 默认隐藏内部 skill，`INSTALL_INTERNAL_SKILLS=1` 可显式发现。它是发现过滤，不是访问控制。
- [Agent Skills 规范](https://agentskills.io/specification) 以含 YAML frontmatter 的 `SKILL.md` 和同目录可选资源构成一个 skill，支持渐进读取与相对路径；规范本身没有定义一个跨 skill 自动安装依赖的机制。
- [Vercel agent-skills](https://github.com/vercel-labs/agent-skills#installation) 给出短仓库命令；[Anthropic skills](https://github.com/anthropics/skills) 也以独立 skill 目录组织，但其 Claude Code 插件市场是另一安装途径。两者是范例，不足以推断所有 agent 的行为。

## 仓库实测与边界

仓库已经有六份 `.claude/skills/<name>/SKILL.md` 及 slides 参考页，另有只供仓库维护的 `issue-resolve`。实测 skills CLI 1.7.4 的本地仓库发现原先列出七项；为后者加 `metadata.internal: true` 后默认列出六项，显式启用内部项时列出七项。隔离目录内通过真实安装器验证选择六项、Codex 安装、默认安装及 `--copy`，对照文件与 slides 参考页；本地源测试不会证明远端 main 已包含本次修改。

把六个名称写进用户命令能避开维护 skill，但把内部组织暴露给每个用户，新增类型时命令还会过时。创建第七个聚合 skill 会复制或重新组织六份格式说明，带来同步与按需加载问题；搬到 `skills/` 则会影响编辑器、bundle 和 Claude Code 的既有路径。当前 CLI 支持现有位置和内部标记，故没有这些迁移的必要。不同安装器不一定识别内部标记；不能声称它在所有工具里不可见。
