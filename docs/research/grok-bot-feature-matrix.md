# Grok Bot 功能矩阵与 Rayrun Bot 满足度

> 状态：2026-11-27。研究文档，不是实现状态事实源。实现状态以
> [`../12-status.md`](../12-status.md) 为准；本表用于判断“像 Grok Bot 一样无感知”
> 还差什么。Grok Bot 的官方页面在本机网络下不能直接抓取，表中事实来自 2026-11-27
> 的官方文档/新闻搜索摘要与二手分析；置信度逐项标注，未确认的细节不应当作承诺。
>
> 相关：[灵感与取舍](inspiration.md)、[产品方向](../00-product-direction.md)、
> [路线图](../plans/roadmap.md)、[云端 bot runtime](../04-cloud-host.md)。

## 1. 口径

“Grok Bot”指 xAI/SpaceXAI 的常驻个人 AI agent 产品，不是 Grok 聊天 App，也不是
Grok Build 的编码工作流。二者容易混淆：

- **Grok Bot**：常驻云电脑上的 AI teammate，有名字、记忆、Skills、Routines，
  可驱动浏览器/桌面，多 bot 可协作；本表的主体。
- **Grok Build**：终端编码 agent、`/goal`、并行 Workflows；只在“长任务/多 agent”
  行作为旁证，不并入 Grok Bot 的核心能力。

判定含义：

- **满足**：Rayrun Bot 有对应能力，且证据达到 v0.1 验收口径。
- **部分**：有机制或雏形，但缺产品表面、生产验收或关键约束。
- **不满足**：没有实现，或明确不在当前路线图。
- **不同路线**：不是缺点，而是本项目刻意选择的 BYO/local-first 路线。

## 2. 功能矩阵

### 2.1 执行与持久化

| 能力 | Grok Bot | Rayrun Bot | 判定 | 证据 / 差距 |
| --- | --- | --- | --- | --- |
| 常驻云电脑 | 每个用户一台云电脑，所有 bot 共享；文件、浏览器会话、CLI 跨任务保留 | 用户自己的 Rayrun 云电脑，bots 共享；cloudHost 常驻 `bot-host` | 满足 | `docs/04-cloud-host.md`、ADR-020；默认 cloudHost 已 dev live，生产干净账号待签收 |
| 合上笔记本后继续 | 云电脑 24/7 运行，本地 App 可关闭 | 默认 cloudHost 在 dev 通过“kill 本地 DSH → 云端写文件 → 重开收结果” | 部分 | dev 已过；生产干净账号、dependency 发版未完成；发送响应前的物理窗口仍在 |
| 后台/长任务 | 任务在云端持续执行，回来汇报 | detached/cloudHost 每轮任务；cloudHost 有队列 | 部分 | 单轮后台任务已过；多步/多小时任务的进度与取消未产品化 |
| 持久 session/transcript | 每 bot 对话、记忆、工作日志 | 每 bot `session.json` + `transcript.jsonl`，host 重启恢复 | 满足 | A8/A9；`session-runtime` 契约 |
| 队列与恢复 | 云端队列、进程监督、恢复 | 每 bot 单飞队列；detached poll；`bot-host` 重建 | 满足 | A8/A9、cloud host recovery |
| 本地执行可选 | 默认云电脑；本地执行需逐命令批准 | bot 始终在云电脑执行；本地 host 只做审批/凭据 | 不同路线 | 不是缺口；local-first 决策见 ADR-016/019 |
| 浏览器/桌面操作 | 登录网站、填表、点按，覆盖无 API 系统 | 云电脑有桌面/浏览器，agent 可在容器内使用 | 部分 | 能力在容器里，但没有产品化的登录/接管流程 |
| 持久浏览器登录 | 共享浏览器会话和登录状态跨任务保留 | 不持久；跨 stop/start 的浏览器 profile 未实现 | 不满足 | 受 Rayrun 平台阻塞；见 `docs/08-integration.md` |

### 2.2 Bot 模型

| 能力 | Grok Bot | Rayrun Bot | 判定 | 证据 / 差距 |
| --- | --- | --- | --- | --- |
| 有名字/职责的 bot | 名册、角色、轻人格 | `bot.json` 的 name/label/instructions；名册持久化 | 满足 | `docs/02-bot-model.md`、客户端名册 |
| 每 bot 独立记忆 | preferences、rules、带日期 work log；共享事实（名字、时区） | session/transcript 持久；`skills` schema 有字段 | 部分 | 没有自动总结、记忆审阅或“它记得什么”面板；`memory/` 目录未成为产品表面 |
| Skills（可复用做法） | 教一次，保存为可复用技能 | `bot.json` 有 `skills: []` 字段，无 UI/执行语义 | 部分 | schema 是接缝，不是功能 |
| Routines（何时做） | 观察一次学会，按计划/事件重复 | 手工创建间隔 routine；cloudHost 云端调度 | 部分 | 无学习、无事件触发、无 webhook；cron 未实现 |
| 主动发现任务 | 扫描邮件/消息/日历，主动提出工作 | 无 | 不满足 | 路线图未承诺 |
| 结果 receipt | 结果、产物、成本、需要你做什么 | transcript 有回复；真实 bot 不展示 Library/Recent；按 bot 花费未归因 | 部分 | `docs/research/inspiration.md` 已有设计；尚未实现 |
| 每 bot 成本 | 计划内配额/用量 | 余额/机时可见；按 bot 花费未归因 | 部分 | A10 成本栏 Pass；归因缺口登记在 `docs/12-status.md` §4 |

### 2.3 协作

| 能力 | Grok Bot | Rayrun Bot | 判定 | 证据 / 差距 |
| --- | --- | --- | --- | --- |
| 多 bot 同用户 | 一队有角色的 bot | 多 bot 共享一台电脑/一个 host | 满足 | 多 bot 单 host E2E 已过 |
| bot 间交接 | 群聊/消息/任务交接 | 无；共享 workspace 的 handoff 是 v0.2 候选 | 不满足 | `inspiration.md` §4 设计 |
| Primary/chief-of-staff | 一个协调者 check-in/分派 | 无 | 不满足 | v0.2 候选，未承诺 |
| 共享 workspace | 文件/产物共享 | `/workspace` 共享；每 bot 有目录 | 满足 | `docs/06-local-state.md` |
| 群聊 | 多 bot 群聊、handoff | 无 | 不满足 | 明确不在 v0.1；v0.2 也未承诺群聊 |
| 团队/企业共享 | Team Bots、Skills、Review Learnings、企业治理 | 无多租户/RBAC/共享 bot | 不满足 | 明确不做 |

### 2.4 安全、凭据与审批

| 能力 | Grok Bot | Rayrun Bot | 判定 | 证据 / 差距 |
| --- | --- | --- | --- | --- |
| 敏感动作审批 | Auto Review：发送邮件等敏感动作前暂停；覆盖有已知缺口 | typed 机器动作 fail-closed 审批；云端凭据动作未解 | 部分 | A6/A7；其他动作类型、云端凭据动作仍缺 |
| 登录/卡/联系人 Vault | 账号级 Vault；bot 只见引用，不见值；Secure Form | Rayrun token 在本地 vault；DeepSeek key 作为 Rayrun credential | 部分 | 没有面向用户的登录/支付/联系人 Vault；不存卡号 |
| Secure Form | 一次性敏感输入，可保存到 Vault | 无 | 不满足 | 未实现 |
| 同用户隔离 | 一用户一云电脑；bot 不是安全边界 | 一用户一 Rayrun 机器；同机 bot 共享容器 | 满足 | ADR-020；与 Grok 的边界一致 |
| 审批/审计历史 | 审批记录、团队审计（企业能力部分未文档化） | 本地 approval store/transcript；无导出/团队审计 | 部分 | `docs/05-approvals.md`、`docs/07-security.md` |
| 永不自动 destroy | 产品层不承诺？ | Bots 永不调用 destroy；依赖 RPC 仍暴露 destroy | 部分 | 依赖 RC-010 仍 Open；Bots 侧有约束 |
| 本地命令逐条批准 | 本地执行 opt-in，默认每次询问 | 不适用：bot 不在本地执行 | 不同路线 | 我们的本地侧只做审批/执行 typed 动作 |

### 2.5 表面、分发与商业

| 能力 | Grok Bot | Rayrun Bot | 判定 | 证据 / 差距 |
| --- | --- | --- | --- | --- |
| 移动端/桌面 App | macOS/Windows/iPhone 首发；Linux/Android 说法冲突 | DSH web；无原生 App；v1.0 做桌面发行版 | 不满足 | 路线图 v1.0；移动端由 v0.2 IM 部分替代 |
| 通知/check-in | App 推送、IM、群聊 | 列表 attention 点；无推送；v0.2 IM | 部分 | 浏览器内可见；后端完成无主动通知 |
| 安装/首次运行 | 下载 App/登录 | 两个 DSH 插件；约 1m55s–3m03s 分段 | 部分 | A1/A12；单一连续三分钟未签收 |
| API/MCP/集成 | MCP、API 工具、企业集成 | DSH 工具面；不是 Bots 产品化集成 | 部分 | 取决于 DSH/云电脑工具，未做成产品矩阵 |
| 定价/账号 | 订阅/席位；托管控制面 | BYO Rayrun + DeepSeek；无项目方控制面 | 不同路线 | 这是产品定位，不是缺口 |
| 团队/企业治理 | Team/Enterprise 方向 | 不做 RBAC/SSO/审计导出/SLA | 不满足 | 明确不计划 |

## 3. 满足度汇总

按上表 34 项粗分：

- **满足 7**：共享云电脑、持久 session、队列恢复、有名字的 bot、多 bot、共享 workspace、
  同用户隔离。
- **部分 15**：合盖继续、后台任务、浏览器/桌面、记忆、Skills、Routines、receipt、
  每 bot 成本、审批、Vault、审计、destroy 防线、通知、安装、MCP/集成。
- **不满足 9**：持久浏览器登录、主动发现、bot 交接、primary bot、群聊、Secure Form、
  移动/桌面 App、团队/企业共享、团队/企业治理。
- **不同路线 3**：本地执行、本地优先审批、BYO 计费。

这个分布符合产品定位：**三根支柱（做事、共享电脑、独立 session）已经对齐；“团队
胶水”、用户级 Vault、持久浏览器和移动表面仍是差距。** 不能说“Grok Bot 等价物已完成”。

## 4. 产品含义

### 4.1 应该补齐的

1. **Receipt + 记忆/技能的真实表面**：用户能看见“做了什么、产物在哪、花了多少、
   还需要我做什么”；记忆可审阅、可遗忘。这比再加一个聊天按钮更接近“AI 同事”。
2. **Routines 的学习与事件触发**：先做“观察一次 → 保存为 routine”，再做 webhook/
   邮件触发；不要先做 cron 表达式。
3. **多 bot 交接**：用共享 workspace 的 handoff 文件 + 交接卡，不做群聊服务；
   primary bot 只做 check-in，不造调度平台。
4. **用户级 Vault/Secure Form**：如果产品要继续“替你登录、替你填表”，必须在
   Bots 侧有 write-only 凭据界面；否则不要承诺无 API 系统自动化。
5. **通知/移动**：v0.2 的 IM 审批是正确的最小路径；原生 App 不是 v0.2 目标。
6. **持久浏览器 profile**：依赖 Rayrun 平台；没有它，老系统自动化只能是半成品。

### 4.2 不应该复制的

- 订阅/席位与托管控制面：本项目的 BYO 与 local-first 是差异，不是待补功能。
- “每个 bot 一台电脑”或“bot 是安全边界”：如果 Grok 的公开描述是每用户共享一台，
  我们与它一致；不要为了对齐营销而拆机器或承诺隔离。
- 群聊/社交信息流、市场、模板、企业 RBAC：不在路线图。
- 用并行 bot 的宣传掩盖串行队列：平台一次只跑一个 agent 任务，诚实写队列。

## 5. 映射到路线图

| 里程碑 | 本矩阵中最该做的 |
| --- | --- |
| v0.1 收尾 | 生产 cloudHost 合盖签收、dependency 发版、A11/A12、三分钟计时 |
| v0.2 远程审批 | IM 通知/审批；候选：handoff、primary check-in、记忆审阅 |
| v1.0 桌面发行版 | 安装器、签名更新、版本矩阵；不重写聊天 |
| 平台依赖 | 持久浏览器 profile、安全入站、云端凭据动作、spend cap |

## 6. 来源与置信度

官方入口（本机不能直接抓取，按 2026-11-27 搜索摘要记录）：

- [Grok Bot overview](https://docs.x.ai/grok-bot/overview)
- [How Grok Bot works](https://docs.x.ai/grok-bot/how-grok-bot-works)
- [Use the computer and apps](https://docs.x.ai/grok-bot/computer-and-apps)
- [Vault and secure sign-in](https://docs.x.ai/grok-bot/vault)
- [Introducing Grok Bot](https://x.ai/news/introducing-grok-bot)
- [Grok Bot included with more plans](https://x.ai/news/grok-bot-more-plans)

二手分析（用于交叉核对，不作为承诺）：

- [Grok Bot product study](https://github.com/oneiron-dev/oneiron/blob/main/apps/web/docs/product-studies-20260907/grok-grokbot-product.md)
- [Grok Bot architecture guide](https://codepick.dev/en/guides/grok-bot-architecture/)
- [Grok Bot security for a fleet](https://www.permit.io/blog/grok-bot-security-fleet-of-ai-agents)
- [Grok Bot guide / pricing](https://mem0.ai/blog/grok-bot-guide)

置信度：

- 高：一用户一共享云电脑、每 bot 记忆、Vault 的 write-only 语义、审批/Auto Review
  的存在、Skills/Routines、多 bot 群聊/交接、移动/桌面 App 的定位。
- 中：Auto Review 的具体覆盖范围、Teams/Enterprise 治理细节、各计划的准入。
- 低/有冲突：Linux/Android 首发支持、具体价格与配额、1.0 更新细节。表中已按
  “部分/待核实”处理，不写成确定承诺。
