# 架构决策 — v0.1

*状态：2026-11-22。本文是对 v0.1 架构的评审，以及在 bot runtime 与审批层动工前必须定下来的决策。它记录设计在哪里不完整、互相矛盾或存在安全问题，并为每一项给出建议。本文不描述已实现的行为。只有状态为 **Accepted** / **Decided** 的条目才算最终决定；其余都是未决。*

相关：[产品方向](../00-product-direction.md) 是范围；[系统架构](../01-system-architecture.md) 是设计；[MVP 计划](../plans/mvp-plan.md) 是工作分解；[安全](../07-security.md) 是威胁模型；[本地文件设计](../06-local-state.md) 是状态布局；[平台需求](../08-integration.md) 是交给 Rayrun 平台的清单。

## 如何阅读

每项是一个决策。**状态**取 `Open`、`Proposed`、`Accepted`、`Decided`；**阻塞**列出在决策前不能安全实现的工作项；**证据**指向当前文本，用章节号而不是行号，以免编辑后失效。

本次评审发现 1 个安全边界错误（ADR-001）、3 个阻塞 bot runtime 的契约缺口（ADR-003、ADR-004、ADR-005），以及一组范围与文档不一致。下面的建议都是提案，不是决定。

## 决策总表

| 编号 | 决策 | 状态 | 建议 | 阻塞 |
| --- | --- | --- | --- | --- |
| [ADR-001](#adr-001) | 审批在哪里执行 | Decided（2026-11-21，平台权限隔离；2026-11-23 由 ADR-019 窄化） | 平台提供 host/agent 隔离与审批端点；此前不实现审批执行 | C4, E1–E7, A6, A7（本地动作按 ADR-019 解阻） |
| [ADR-002](#adr-002) | 所有权矩阵与单写者规则 | Proposed | 每个文件一个写者；本地负责意图，云端负责运行态；公布矩阵 | B1–B4, C3, C8, E2–E4 |
| [ADR-003](#adr-003) | 基于 Rayrun 文件 API 的控制通道协议 | Proposed | 拆分 inbox/state；每项一个文件；不做共享 JSONL 追加 | C3, C5, C8 |
| [ADR-004](#adr-004) | 与 `dsh-rayrun-computer` 的契约 | Proposed | 在依赖仓库写能力/版本契约；不复制 token | A2, C1–C5, D1, G1 |
| [ADR-005](#adr-005) | 副作用执行语义 | Proposed | `actionId`、执行日志、幂等与重试规则 | C8, E1–E7, A7 |
| [ADR-006](#adr-006) | “合上笔记本”意味着什么 | Proposed | 写清允许的工作、审批过期与计费后果 | A5, A6, G3 |
| [ADR-007](#adr-007) | 常驻 bot runtime 的凭据与 DSH profile 模型 | Accepted（2026-11-27；默认 cloudHost 见 ADR-021） | M2 前做 spike；回退到逐次 headless + transcript replay | C1–C4, D1–D5, A5, A8 |
| [ADR-008](#adr-008) | Desktop 访问路径 | Proposed | 核实依赖的路径；没有安全路径就不要承诺 takeover | F5, security |
| [ADR-009](#adr-009) | Routines / scheduler 范围 | Accepted（2026-11-23；cloudHost dev live 2026-11-24） | 本地 host 定时入队普通 turn；cloudHost 模式由云 host 调度；云端队列串行执行 | M1, M4 |
| [ADR-010](#adr-010) | RPC 路由与信封 | Proposed | 选定一个契约，代码、测试、文档一起对齐 | F2, F4 |
| [ADR-011](#adr-011) | 审批 schema 与 canonical action hash | Accepted（2026-11-22，协议已实现；本地执行见 ADR-019） | canonical JSON、完整 decision 字段、本地重算 hash | E2–E6, C-S6 |
| [ADR-012](#adr-012) | 恢复与运行语义 | Proposed | 补字段、时钟规则、限流与审计语义 | C8, D4, E5–E7, A8, A9 |
| [ADR-013](#adr-013) | 文档清理 | Proposed | 与相关决策同批修正下文列出的矛盾 | docs |
| [ADR-014](#adr-014) | 桌面发行版与更新单元 | Accepted（2026-11-21，B1） | v1.0 采用预配置 DSH 发行包（bootstrap 安装器）；B2 整包更新是升级路径；薄壳不做 | v1.0, 09-deployment |
| [ADR-015](#adr-015) | 云端 bot runtime 层 | Proposed（v0.1） | 用户云电脑内的 supervisor；queue/session/DSH/事件/恢复 | C1–C9, D1–D5, E1–E7 |
| [ADR-016](#adr-016) | 本地 bot 控制面 | Proposed（v0.1） | DSH host + 插件 host half；token/审批/成本/依赖；不做托管服务 | A2/A3, B1–B4, E3/E4, G1/G2 |
| [ADR-017](#adr-017) | Bots 作为默认产品表面 | Accepted（2026-11-21） | Rayrun Bot 品牌；加载即激活 Bots；DSH 是宿主，Bots 内不返回 DSH | v0.1, v1.0 |
| [ADR-018](#adr-018) | 文档事实源与语言 | Accepted（2026-11-22） | README 只做营销；`docs/12-status.md` 是实现状态唯一事实源；`docs/` 全中文 | docs |
| [ADR-019](#adr-019) | 审批执行权威 | Accepted（2026-11-23，本地 DSH host） | 云端只提案；本地审批与执行；typed allowlist；平台隔离仍用于云端凭据动作 | E1–E7/A6/A7（本地动作解阻；云提案 bridge、start/stop、denial/Continue 与 context 已 live） |
| [ADR-020](#adr-020) | 云电脑是 agent 的安全容器 | Accepted（2026-11-26） | 容器内 `danger-full-access` 是设计；审批只覆盖离开容器的 typed 动作 | 安全文案/文档 |
| [ADR-021](#adr-021) | 默认执行路径 | Accepted（2026-11-27） | 依赖 1.2+ 默认常驻 cloudHost；`cloudHost:false` 保留 detached；镜像与电脑更新随 runtime | A5, 发布 |

## P0 — bot runtime 与审批动工前必须定

<a id="adr-001"></a>
### ADR-001 — 审批在哪里执行？

**状态：** Decided（2026-11-21，选项 2：平台权限隔离）.

> **2026-11-23 修订：** ADR-019 采纳“本地 DSH host 审批并执行”，对凭据/执行器在
> 本地的 typed 动作生效；本 ADR 的平台隔离仍是云端凭据动作与 host-only 端点要求。

**问题。** 在 bot 以 root、`danger-full-access` 运行于云电脑内的前提下，由哪个组件可信地执行审批？

**当前设计。** 云端 gate 把请求 JSON 写到
`/workspace/.rayrun/.../approvals/`；本地控制面轮询该文件、显示卡片，再把决定
JSON 写回。请求带 nonce、bot id、action hash 和 TTL；bot runtime 读到决定后执行动作
（[MVP 计划](../plans/mvp-plan.md) §4.1(5)、§4.3）。

**问题。** 审批目录位于 agent 可读可写的工作区内。agent 可以读取请求（包括 nonce
和 id），写一个匹配的 `res-<id>.json`，或者修改 host、队列和审批状态。唯一文件名、
临时文件 rename 和 checksum 只能防半写，不能防伪造。`超时 / 未知 = 拒绝` 只处理
崩溃和无人回答的卡片；它不处理被 prompt injection 或被攻陷的 bot。安全页目前说
“对不可信模型的缓解是审批层”（[安全](../07-security.md) “The model is untrusted”），
但只有当执行点位于 agent 写不到的地方时，这句话才成立。

**选项。**

1. **在用户侧执行。** 云端只提交提案；本地控制面（或平台）校验后用该侧持有的凭据
   执行。云端永远拿不到一个它可以伪造的授权。这符合 [CLAUDE.md](../../CLAUDE.md)
   不变量 4（“权限与凭据不离开用户侧”）。
2. **平台提供权限隔离。** host 与 agent 使用不同用户或不同挂载命名空间，host 持有
   agent 读不到的密钥；平台提供审批端点。当前云镜像以 root 运行且没有 bubblewrap，
   所以这是平台改动，应写进[平台需求](../08-integration.md)。
3. **承认它只是同意，不是隔离。** 保留文件邮箱，改写安全声明，并警告被攻陷的 bot
   可以自批。这是有文档的回退方案，不是安全边界。

**建议。** v0.1 的受控动作用选项 1。按凭据所在的一侧给动作分类：**在凭据所在处执行，
在人类所在处审批**。如果某个动作在用户侧没有凭据路径，不要把凭据交给 agent；把它
归到选项 2，或从 v0.1 移除。对凭据必须留在云端的动作，把选项 2 加进平台需求。只有
两者都不可行时才用选项 3，并且改安全页而不是改代码。

**决定（2026-11-21）。** 选 **选项 2：平台权限隔离**。平台提供 host/agent 权限隔离
（不同 UID 或 mount namespace）和 host-only 的审批端点之前：

- **不实现审批执行路径**，E1–E7、A6/A7 暂停；平台需求登记在
  [`08-integration.md`](../08-integration.md) §3.3；（历史原文；本地 typed 动作由
  ADR-019 例外解阻）
- 文件邮箱可以继续作为提案/卡片/审计的传输，但**不是授权边界**；
- 客户端审批卡保持预览，不声称审批已工作；
- 评审建议的选项 1（用户侧执行）仍是长期方向；本次不选它，是因为 v0.1 还没有定义
  本地执行器与凭据路径；
- 同意型回退（选项 3）不作为 v0.1 的审批执行方式。

**平台答复（2026-11-22）。** 同一沙箱内不能做隔离：runtime 与 agent 共享 root，agent
可读 `/proc/<pid>/environ`；平台 host-only 审批端点需要新 ADR，设计 1 周 + 实现 2–4
周，不属于初步支持。平台建议的最小路径是审批权威放在 agent 沙箱之外（本地 DSH 或
单独的 host 沙箱），agent 只执行，host 侧持有凭据并决定/执行——这与选项 1 接近，
但需要新的 ADR、host 执行器和凭据路径；在做出新决策前，本 ADR 的关闭状态维持不变
（[`08-integration.md`](../08-integration.md) §3.3）。

**影响。** E1–E7、A6/A7 阻塞于平台能力；安全页继续声明“审批不是安全边界”，直到平台
隔离可用。ADR-011（schema/hash）与 ADR-012（恢复/限流）仍是 Proposed，恢复审批工作
时先定。

**证据。** [MVP 计划](../plans/mvp-plan.md) §4.1(5)、§4.3；[安全](../07-security.md) “The model
is untrusted” 与 “What is not protected”；[系统架构](../01-system-architecture.md) “Approval
channel”；[平台需求](../08-integration.md) §3–4。

<a id="adr-002"></a>
### ADR-002 — 所有权矩阵与单写者规则

**状态：** Proposed.

**问题。** 每个产物的权威写者是谁？另一侧离线时怎么办？

**当前设计。** 文档之间的措辞不一致：

- [系统架构](../01-system-architecture.md) “Layers” 说本地控制面增加 bot registry，并且是
  configuration 与 profile projection 的一部分权威；“Where the truth lives” 表说
  bot state、sessions、memory 以云电脑为权威，而 profile 与 bot definitions 以本地
  DSH profile 为权威。
- [MVP 计划](../plans/mvp-plan.md) §4.1(3) 说 bot state 在机器上，本地只保留只读镜像。
- [本地文件设计](../06-local-state.md) §3 说机器赢 runtime state，本地赢 user
  intent。

这些可以用“定义在本地、运行态在云端”来解释，但当前文本没有说哪个文件属于哪一侧。
机器停机时用户编辑 bot，编辑暂存在哪里，文档没有答案。

**建议矩阵。**

| 产物 | 唯一写者 | 读者 | 冲突 / 离线规则 |
| --- | --- | --- | --- |
| Bot 定义（`bot.json`） | 本地控制面，在用户明确操作时写 | bot runtime、本地镜像 | 本地意图赢；云端应用后返回 revision。机器不可用时，意图留在本地 outbox。 |
| 运行态：sessions、memory、transcript | bot runtime | 本地镜像与 UI | 云端赢；本地副本只读。 |
| 队列 inbox（新工作） | 本地控制面 | bot runtime | 每项一个文件；机器接收前由本地持有。 |
| 队列状态（`queued` → `done`） | bot runtime | 本地控制面 | 云端赢；本地只渲染。 |
| 审批请求 | 本地 host（提案来自不可信云端） | 本地控制面 | 提案，不是授权；本地重新校验（ADR-019）。 |
| 审批决定 / 执行 claim | 本地控制面 / 本地 executor | 本地 executor / client | 每个 id 一个决定/claim；只在 agent 写不到的地方（ADR-019）。 |
| Outbox 事件 | bot runtime | 本地控制面 | 只追加；本地按 `seq` 读取。 |
| 本地镜像 | 本地控制面（派生） | Client | 可丢弃；从云端重建。 |
| Setup 与 cost 缓存 | 本地控制面 | Client | 有 TTL；永远不是权威。 |

**建议。** 采用这张矩阵，让所有页面链接到它，而不是各自用散文重述权威。若某个文件
需要两个写者，按方向拆文件（见 ADR-003），不要加锁。

**影响。** B1–B4、C3、C8、E2–E4。B1 可以定义字段，但在这一项定下来前不能最终确定
谁写这些字段。

**证据。** [系统架构](../01-system-architecture.md) “Layers” 与 “Where the truth lives”；
[MVP 计划](../plans/mvp-plan.md) §4.1；[本地文件设计](../06-local-state.md) §3；
[CLAUDE.md](../../CLAUDE.md) 不变量 3–4。

<a id="adr-003"></a>
### ADR-003 — 基于 Rayrun 文件 API 的控制通道协议

**状态：** Proposed.

**问题。** 本地控制面与 bot runtime 如何在没有原子追加、没有 compare-and-swap 的
Rayrun 文件 API 上交换队列项和状态？

**当前设计。** `queue.jsonl` 是 append-only FIFO；bot runtime 拥有队列，本地侧又有一个
“local queue view”，可以 enqueue、dispatch、retry（[MVP 计划](../plans/mvp-plan.md) §4.2；
[本地文件设计](../06-local-state.md) §1）。锁只是提示，不跨机器共享。

**问题。** 如果本地追加新项、云端向同一个文件追加状态变化，就是两个写者操作一个没有
CAS 的 API。丢更新或交错追加会丢工作或破坏状态。平台需求里的原子写与 ETag 说明 API
目前不保证这一点（[平台需求](../08-integration.md) §3）。

**建议。** 每个文件一个写者，每项一个文件，不做共享追加：

- `queue/inbox/<itemId>.json` — 本地写，云端读取并 claim。
- `queue/state/<itemId>.json` — 云端写，本地读。
- `approvals/req-<id>.json` — 云端写；`approvals/res-<id>.json` — 本地写。这两者
  已经是一个文件一个写者，保持。
- Outbox 保持云端写、本地读。
- 写入仍然是临时文件 + rename；读者把“文件不存在”当作“还没到”，不是“拒绝”。

如果平台以后提供条件写，形状可以不变，只换 API 调用。

**影响。** C3、C5、C8、E2–E4。当前的单一 `queue.jsonl` 不应该实现。

**证据。** [MVP 计划](../plans/mvp-plan.md) §4.2、§4.3；[本地文件设计](../06-local-state.md)
§1、§4；[平台需求](../08-integration.md) §3。

<a id="adr-004"></a>
### ADR-004 — 与 `dsh-rayrun-computer` 的契约

**状态：** Proposed.

**问题。** 本地控制面通过 `dsh-rayrun-computer` 调用哪些能力、通过哪个表面？bot
runtime 如何由它的 worker projection 落地？

**当前设计。** 本地控制面消费其已发布的 tools/RPC 表面；本地文件设计把
`lib/dependency.js` 写成“detect … tool check, tool calls”（[系统架构](../01-system-architecture.md)
“Layers”；[本地文件设计](../06-local-state.md) §1）。MVP 计划说本地控制面通过依赖的
`rayrun_*` tools 或其 RPC 路由驱动，由 spike S6 决定（[MVP 计划](../plans/mvp-plan.md) §4.4）；
bot runtime 由 worker projection ship/启动。

**问题。** `rayrun_*` 是注册给 DSH agent 的 tools，不一定是 host 可 import 的 API。
本地控制面需要程序化调用：machine ensure/start/stop、`exec`、file read/write/list、
agent prompt + SSE、session create/continue、credential-injection status、balance/
usage。它不能为此复制 Rayrun token。文档没有说这些是 service injection、host RPC
action，还是用依赖的 token 直接调 API。C1 还假设依赖的 worker projection 可以
ship 一个 bot runtime；但没有任何扩展点文档。

**建议。** 在依赖仓库写一份一页的契约并链接到这里，分两部分：
1. 本地控制面的能力调用：名称、输入、输出、错误码、是否使用 token；
2. bot runtime 的 worker projection：ship、启动、重启、hash/版本与扩展点。
把 S6（bundle 能否声明依赖）与这个接口问题分开。如果没有相应表面，adapter 放在我们
的包里，不改依赖。

**影响。** A2、C1–C5、D1、G1。这是 ADR-001/002 之后的第一个实现阻塞。

**证据。** [系统架构](../01-system-architecture.md) “Layers”“What this repo builds”；[MVP 计划](../plans/mvp-plan.md)
§4.4、§4.5；[本地文件设计](../06-local-state.md) §1。

<a id="adr-005"></a>
### ADR-005 — 副作用执行语义

**状态：** Proposed.

**问题。** 审批之后、副作用之前或之后 host 崩溃，会发生什么？

**当前设计。** 队列项有 `attempts` 和 `queued`、`running`、`waiting_approval`、
`done`、`failed`、`cancelled` 状态；审批决定是 `{ id, nonce, decision, decidedAt }`
（[MVP 计划](../plans/mvp-plan.md) §4.3）。单个文件规定了原子写。

**问题。** 原子写文件不能把外部副作用和状态变更变成一个事务。发完消息但未写 `done`
时崩溃，重试可能重复发送；批准后、发送前崩溃，可能丢批准或需要重新批准。decision
schema 还缺 `botId` 和 `actionHash`，而正文要求匹配 bot 并绑定动作。

**建议。**

- 在 request、decision 和 queue item 中加 `actionId`。由执行方生成；重试时不变。
- 每个动作写 append-only 执行日志：`proposed`、`approved`、`executing`、
  `effect_committed`、`done`、`failed`、`denied`、`expired`。
- 外部 API 支持幂等键时传入。不支持时，`executing` 之后不要盲目重试；要求对账或
  重新审批。
- 按动作声明投递语义。不可逆动作（发送、发布、花钱）默认 at-most-once；只有可安全
  重复的动作才接受 at-least-once。
- decision schema 增加 `botId` 和 `actionHash`。

**影响。** C8、E1–E7、A7。审批代码不应在没有这一项的情况下上线。

**证据。** [MVP 计划](../plans/mvp-plan.md) §4.3；[本地文件设计](../06-local-state.md) §4；
[安全](../07-security.md) “What is not protected”。

## P1 — 重复 v0.1 承诺前必须定

<a id="adr-006"></a>
### ADR-006 — “合上笔记本”意味着什么

**状态：** Proposed.

**问题。** 本地 DSH 关闭时，哪些工作继续，代价是什么？

**当前设计。** 产品叙事说合上笔记本不会让 bot 停止；架构上的落点是本地控制面运行
审批轮询、idle-stop 策略和 watchdog。平台没有 idle auto-stop；`max_lifetime_seconds`
只停不重启；后台审批卡 30 分钟后过期（[系统架构](../01-system-architecture.md)；
[FAQ](../faq.md) “如果我忘了停电脑会怎样？”；[MVP 计划](../plans/mvp-plan.md)
G3；[客户端计划](../plans/client-plan.md) “UX 流程与失败状态”）。

**问题。** “继续工作”只对已经排队、且不需要审批的动作成立。后台受控动作会停在卡片
处并过期；新工作无法提交；本地 idle stop 不在运行，机器继续计费。状态文档没有说明
成本后果。

**建议。** 公布一张小矩阵：

| 本地 DSH 关闭期间 | 行为 |
| --- | --- |
| 已排队的非受控工作 | 在 bot runtime 上继续。 |
| 新任务 | 无法提交；在本地排队，等下次打开。 |
| 后台受控动作 | 等待，30 分钟后过期并拒绝。 |
| Chat 发起的受控动作 | 不设计时，一直等待。 |
| Idle stop / watchdog | 不运行；机器继续计费。 |
| 重新打开 | 拉取状态与 outbox；显示 working、unread、pending、expired。 |

增加云端 idle 策略或平台 idle stop（或带警告的默认 max lifetime），让“合上笔记本”
不等于无上限账单。在 [`12-status.md`](../12-status.md) 和 FAQ 中写明限制。

**影响。** A5、A6、G3；12-status 与 FAQ 措辞。

**证据。** [系统架构](../01-system-architecture.md) “Concurrency, cost and failure”；
[FAQ](../faq.md)；[MVP 计划](../plans/mvp-plan.md)
C6、G3。

<a id="adr-007"></a>
### ADR-007 — 常驻 bot runtime 的凭据与 DSH profile 模型

**状态：** Accepted（2026-11-27；默认执行路径见 ADR-021）.

**问题。** 受监督的 bot runtime 能否拿到模型凭据，并按 bot 运行 session/profile？

**当前设计。** Rayrun 把 DeepSeek key 注入 agent 进程。设计想要一个常驻 DSH host，
每个 bot 一个 session 和一个 profile 目录。平台此前按每次 prompt 启动
`dsh --profile headless`（[系统架构](../01-system-architecture.md) “Layers”；
[平台需求](../08-integration.md) §1），2026-11-22 答复提供了 runtimes API（见下）。

**问题。** 平台文档只保证 agent 进程的凭据注入，不保证 supervisor 再 spawn DSH
session 时也能拿到。平台答复（2026-11-22）：受监督 runtime 在 boot 时注入 credential
env；runtime restart 不刷新，轮换需 sandbox `stop → start`。一个 DSH 进程能否承载
多个 bot profile，还是每个 bot 需要独立进程和端口，仍未验证；这决定“合上笔记本”
是否可能。

**建议。** 平台侧 runtimes API 已就绪（待部署）；在 M2 前仍要跑 bot 侧 spike S1/S2
并留下证据：session create/continue、受监督进程重启、一个进程 vs 每 bot 一进程、
CPU/内存、端口分配。保留逐次 headless + transcript replay 作为有文档的回退，并写清
它的 UX 与成本。

**影响。** C1–C4、D1–D5、A5、A8。这是最大的未验证平台赌注。

**证据。** [系统架构](../01-system-architecture.md) “Layers”；[平台需求](../08-integration.md) §1；
[安全](../07-security.md) “Design goals” 3。

**实现（2026-11-22）。** 依赖 1.1 的 `dsh.start/status/result` 已接 detached adapter
（[`lib/rayrun-detached-runtime.js`](../../packages/dsh-rayrun-bots/lib/rayrun-detached-runtime.js)）：
每 turn 一个 task id、每 bot 一个本地 git checkout、`reply.md` 收取，task id 持久化，
host 重启后恢复 poll。常驻 DSH host 的 bot 侧实现仍按本 ADR 的 spike 处理；平台侧
runtimes API（`rayrun-bot-gaps`，`4709ac0`，待部署）已提供受监督进程、`autostart`/
`keep_alive` 和 boot 时 credential injection；session 由 bot host 自己写 `/workspace`
（[`08-integration.md`](../08-integration.md) §3.1）。detached 的页面级实测已完成：
页面关闭 + host 重启后收取 `reply.md`，以及机器 stop/start 后的第二轮续接
（[`10-rayrun-verification.md`](../10-rayrun-verification.md) §3.1，2026-11-22）。
同日 dev spike：镜像内 DSH 0.2.0-rc.2 的 headless `--session-id` 可跨进程续接
（`RUN1_OK` → `ALPHA`）；`packages/dsh-rayrun-bots/cloud-host` 的 DSH agent 已跑通两轮
（`HOST1_OK` → `BETA`）。核心 host 仍未进入包，生产镜像与部署未做。

<a id="adr-008"></a>
### ADR-008 — Desktop 访问路径

**状态：** Proposed.

**问题。** v0.1 用户如何观看或接管机器？

**当前设计。** 客户端计划把 computer view 作为 P0，深链到依赖的 desktop 页面。
安全页说 ingress 的 token 层不可用，只有 `public` 可用，且 public desktop 不能做
产品面板。

**问题。** 如果唯一的 desktop 路径是 public URL，v0.1 不能承诺安全的 takeover。
如果依赖通过本地控制面代理 noVNC，这条路径需要写清并测试。当前文档同时暗示了两种
情况，却没有调和。

**建议。** 核实依赖的 desktop 路由：本地出站代理、本地页面，还是 public URL。把答案
写进文档。如果是 public，给出警告并把“take over”从 v0.1 推迟，或把安全 ingress
加进平台需求。核实前不要把 desktop 描述成私有。

**影响。** F5、安全与客户端计划措辞。

**证据。** [安全](../07-security.md) “Public inbound”；[客户端计划](../plans/client-plan.md)
“Surfaces”；[平台需求](../08-integration.md) “Safe inbound networking”；[MVP 计划](../plans/mvp-plan.md)
§4.1(1)。

<a id="adr-009"></a>
### ADR-009 — Routines / scheduler 范围

**状态：** Accepted（2026-11-23，本地调度；同日补充 cloudHost；2026-11-24 dev live）.

**问题。** v0.1 里 scheduler 是 P0 还是 P1？本地 scheduler 与云端队列是什么关系？

**决定。** v0.1 做最小 routines：每个 bot 有一份 `routines.json`，记录标题、
prompt、间隔、开关和下一次运行时间。本地 DSH host 的 scheduler 周期检查到期项，
把一条普通 prompt 送入该 bot 的本地 session 队列；云端 runtime 和串行队列仍负责
执行。scheduler 只决定“何时入队”，不是第二个执行队列。

**边界。**
- 每 tick 每 bot 最多入队一条；bot 正在 running/queued 时跳过，下一 tick 再试。
- 错过多个间隔只补一次，不 backfill；runtime 不可用时保留 due，下一 tick 重试。
- 运行前先写 `lastRunAt`/下一个 `nextAt` 作为 claim，再入队；入队失败不重放，等待
  下一间隔。这样本地 host 在 claim 后崩溃也不会在重启后重复同一轮。

- routine 只是普通用户轮次，不新增审批绕过；外部动作仍按 ADR-019 由本地审批和
  执行。routine 轮次产生的提案标记为 `background`，沿用 30 分钟过期规则，不会
  因为来自 routine 而无限等待。
- routine turn 使用与手动 send 相同的 runtime 路径，因此可能按依赖的既有语义唤醒
  已停止/暂停的机器并产生机时费用。routine 的间隔与开关是持续授权，不是逐次
  审批；UI 和文档必须说明这一点。
- 默认的本地 scheduler 随本地 DSH host 运行。本地 host 停止时 routine 不会触发；
  重启后只补一次。
- cloudHost runtime 启用时，本地 scheduler 停用，避免双调度；云端 host 读取本地
  镜像到 `.rayrun/bots/<id>/routines.json` 的定义，在
  `bots/<id>/host/routines-state.json` 维护下一次运行时间，先 claim 再入队。它可以
  在本地 DSH 停止时运行，前提是机器和 cloudHost runtime 正在运行。结果写入
  `bots/<id>/routine-results/`，本地 `routines.sync` 导入，`session.history` 合并
  展示。此路径有 fake E2E，并已在 Rayrun dev/test 环境完成 live E2E
  （2026-11-24，本地 DSH 停止后云端执行）；生产仍待 R-G008 部署。机器停止时不会
  同步或运行。
- 机器停止期间编辑 routine 无法上传；机器启动后，云端可能先按旧定义跑一次，直到
  本地 `routines.sync` 覆盖。MVP 记录此限制，不声称强一致。
- v0.1 只做每 N 分钟重复；cron 表达式和事件触发不在范围内。

**影响。** M1、M4 的范围与估时；客户端详情面板可以创建、启停和删除 routine。

**证据。** [系统架构](../01-system-architecture.md) §1.3；[路线图](../plans/roadmap.md) “v0.1”；
[MVP 计划](../plans/mvp-plan.md) §3、§11 决策 2；`packages/dsh-rayrun-bots/lib/routines.js`、
`packages/dsh-rayrun-bots/lib/routine-scheduler.js`、`packages/dsh-rayrun-bots/lib/cloud-routine-bridge.js`、
`packages/dsh-rayrun-bots/cloud-host/lib/routines.mjs`、`packages/dsh-rayrun-bots/cloud-host/lib/prompt.mjs`、
`packages/dsh-rayrun-bots/test/routines.mjs`、
`packages/dsh-rayrun-bots/test/cloud-host-routines.mjs`、`packages/dsh-rayrun-bots/test/cloud-routine-bridge.mjs`、
`packages/dsh-rayrun-bots/test/cloud-routine-e2e.mjs`、[状态](../12-status.md)。

## P2 — 契约与文档对齐

<a id="adr-010"></a>
### ADR-010 — RPC 路由与信封

**状态：** Proposed.

**问题。** 客户端使用哪个路由、body 和信封？

**当前设计。** 已实现的 host 路由是 `/plugins/rayrun-bots`，`GET ?action=health`
或 POST body 包含 `action`；错误是
`{ ok: false, error: { code, message, status } }`
（[index.js](../../packages/dsh-rayrun-bots/index.js)；[rpc.js](../../packages/dsh-rayrun-bots/lib/rpc.js)）。
客户端计划与 MVP 计划却写 `/plugins/<bundle-id>/rpc`、`{ action, payload }` 和扁平的
`{ ok: false, code, message }`（[客户端计划](../plans/client-plan.md) “与 host 的 RPC
契约”；[MVP 计划](../plans/mvp-plan.md) §4.4）。

**问题。** 按文档实现的客户端会调用不存在的路由，或发送 host 不读的 body。这是接线
失败，不是文案问题。

**建议。** 选定一个契约，并在同一次变更里对齐代码、测试、文档和两份计划。建议形状：
保留已测试的 `/plugins/rayrun-bots`，把 body 统一为 `{ action, payload? }`，保留嵌套
错误信封，然后更新文档；或改名为 `/plugins/rayrun-bots/rpc` 并更新测试。不要同时保留
两套契约。

**影响。** F2、F4；客户端接线。

**证据。** [index.js](../../packages/dsh-rayrun-bots/index.js)；
[rpc.js](../../packages/dsh-rayrun-bots/lib/rpc.js)；[客户端计划](../plans/client-plan.md)
“RPC contract”；[MVP 计划](../plans/mvp-plan.md) §4.4。

<a id="adr-011"></a>
### ADR-011 — 审批 schema 与 canonical action hash

**状态：** Accepted（2026-11-22，协议已实现；本地 typed 执行见 ADR-019）。

**问题。** 哪些字段和 hash 能让一个决定只绑定一个动作？

**当前设计。** 请求是 `{ schema, id, botId, nonce, actionHash, action, risk, origin,
createdAt, expiresAt }`；决定是 `{ schema, id, nonce, decision, decidedAt }`。正文说
决定必须匹配 bot id，action hash 覆盖“normalized action payload”，但决定 schema
两者都没有，normalization 也没有定义（[MVP 计划](../plans/mvp-plan.md) §4.3）。

**建议形状。**

```json
{
  "schema": 1,
  "id": "approval-id",
  "botId": "weekly-watch",
  "actionId": "action-id",
  "nonce": "random-256-bit",
  "actionHash": "sha256-hex",
  "action": { "kind": "send-message", "target": "...", "text": "..." },
  "risk": "external-side-effect",
  "origin": "chat",
  "createdAt": "2026-11-18T12:00:00.000Z",
  "expiresAt": null
}
```

决定增加 `botId`、`actionId`、`actionHash` 和 `decisionId`；chat 请求显式带
`expiresAt: null`，后台请求 30 分钟。

**建议。** 对 canonical JSON（RFC 8785/JCS，或一份小型、写明的 canonical serializer）
计算 hash，范围至少是 `{ botId, actionId, action, risk, origin, expiresAt }`。本地侧
对“它实际显示的内容”重算 hash，任何不匹配都拒绝。为 key 顺序、空白、Unicode 和被
篡改的动作加测试向量。只渲染结构化字段，不渲染机器提供的 HTML 或 markdown；显示精确的
target、amount、recipient 和 URL。

**影响。** E2–E6、C-S6、审批卡。

**证据。** [MVP 计划](../plans/mvp-plan.md) §4.3；[安全](../07-security.md) “The model is
untrusted”；[客户端计划](../plans/client-plan.md) C-S6。

**实现（2026-11-22）。** [`lib/approvals.js`](../../packages/dsh-rayrun-bots/lib/approvals.js)
按本形状实现 request/decision 文件、canonical action hash、TTL、幂等/重放/错 bot
负向测试和审计；`approvals.list/get/decide/propose` 已接线。ADR-019（2026-11-23）
起，本地 typed 动作（机器 start/stop/pause/resume）由本地 executor 执行；其他动作仍受 ADR-001
限制。真实 bot 的页面已消费真实审批列表。

<a id="adr-012"></a>
### ADR-012 — 恢复与运行语义

**状态：** Proposed.

**问题。** A8/A9 恢复需要哪些字段和规则？

**当前设计。** 队列项是 `{ id, botId, kind, text, createdAt, state, attempts }`；
`bot.json` 没有 tombstone；outbox 没有 schema 版本；TTL、时钟、文件大小与限流没有
规定（[MVP 计划](../plans/mvp-plan.md) §4.3）。

**建议。**

- 队列项增加 `updatedAt`、`sessionId`、`approvalId`、`actionId`、`startedAt`、
  `finishedAt` 和 `error`。定义允许的状态迁移。
- 给 `bot.json` 加 revision 与 delete/tombstone 规则，避免把删除误判为镜像缺失。
- 给 outbox 事件加 schema 版本。
- 过期判断使用执行方的时钟；两侧时钟偏差超过一个小阈值时拒绝并重新请求，不要猜。
- 限制审批文件大小、每 bot 待审批数和队列长度；定义 `E_QUEUE_FULL` 的行为。
- 定义多客户端决策：第一个有效决定赢；后续返回 stale/duplicate 错误，UI 刷新。
- 决定审计日志是 tamper-evident（哈希链）还是运行历史；按实际能力命名。

**影响。** C8、D4、E5–E7、A8、A9。

**证据。** [MVP 计划](../plans/mvp-plan.md) §4.3；[本地文件设计](../06-local-state.md) §4；
[平台需求](../08-integration.md) §3。

<a id="adr-013"></a>
### ADR-013 — 文档清理

**状态：** Proposed.

**已处理（2026-11-20）。**

- [客户端计划](../plans/client-plan.md) 开头的断句已修：链接回到 `mvp-plan.md`，
  句子已重排。
- [系统架构](../01-system-architecture.md) 的 “Concurrency, cost and failure” 已
  重写为中文“并发、成本与失败”，不再有 “the DSH host on their machine” 的歧义。
- [安全](../07-security.md) 的措辞已按 ADR-001 的开放状态改写：审批不是安全边界，
  文件邮箱可被 root agent 伪造；不再写 “mitigation is the approval layer”。

**仍开放。**

- “no runtime dependencies”（`CLAUDE.md`、01）与声明 `dsh-rayrun-computer`：
  区分库依赖与 peer bundle。
- [errors.js](../../packages/dsh-rayrun-bots/lib/errors.js) 和 MVP 错误码表缺
  `E_BOT_INVALID`，但 B1 要求非法定义返回一个 code。
- ADR-010 里的 RPC 路由/信封不一致。
- 带日期的状态陈述与“今天能做什么”必须与代码一致；本文不改变它们。

<a id="adr-014"></a>
### ADR-014 — 桌面发行版与更新单元

**状态：** Accepted（2026-11-21，B1）.

**问题。** 是否把 DSH、两个插件和首启向导打包成一个桌面 App？如果打包，更新单元
是什么？

**已确认（2026-11-19，DSH `master`）。** DSH 已经有 Electron 桌面：

- `electron-updater`；壳 + 匹配的 dsh runtime + pnpm 是**一个签名更新单元**；
- 外部插件装在 `$DSH_HOME/profiles/desktop`，通过 plugin manager / plugin market /
  `dsh plugin --profile desktop add` 安装；
- 官方安装器**不预装**第三方插件；official bundle lists 编译进 DSH 安装，profile
  不能扩展 optional/on-demand 列表；
- `ctx.approval`、`ctx.permissionPresets`、`ctx.sessions` /
  `ctx.sessionPersistence` / `ctx.sessionController`、`ctx.clientModules` 已存在；
- DSH desktop 自带 product analytics；官方更新 feed 是 DeepSeek 的
  （`download.deepseek.com`），第三方不能发布。

**问题。** 如果壳、DSH、两个插件各自更新，会出现版本错配；本地 DSH 与云端镜像的
DSH 版本也可能不一致。用户要的是“打开即用”，但 DSH 官方签名的更新单元**不包含**
external plugins。要预装插件或把它们放进同一个更新单元，必须自己控制安装/分发层，
或接受首启安装/单独更新。

**选项。**

1. **A. 官方 DSH 桌面 + 首启安装两个插件（开发路径）**：DSH 用官方 updater；插件用
   plugin manager/market 单独更新；首启装一次插件。成本最低，不是单一更新单元。
2. **B1. 预配置 DSH 发行包**：自己的安装器装好官方 DSH，再把两个插件写进 desktop
   profile；DSH 保持官方 updater，插件由我们的签名 manifest/bootstrap 更新。打开
   即用，但不是单一更新单元。
3. **B2. 自定义 DSH 桌面发行版**：从 MIT 源码构建，定制品牌/签名/更新 feed，把两个
   插件加入 official bundle list 或预置 profile；DSH + 插件整包更新。真正“打开即
   用”，但维护成本最高。
4. **C. 自建薄壳**：重复 DSH desktop 已有的 host/updater；只在 DSH 桌面无法满足硬
   需求时考虑，当前不做。

**决策（2026-11-21）。** v1.0 采用 **B1：预配置 DSH 发行包（bootstrap 安装器）**。
用户下载一个 Rayrun 品牌的安装器；安装器安装或检测官方 DSH，然后把
`dsh-rayrun-bots` 和 `dsh-rayrun-computer` 的发布包装进
`$DSH_HOME/profiles/desktop`，打开后 Bots 已就绪，不需要手动装插件。

- DSH 本身保持官方构建和官方 updater；我们只定制安装/分发层，不 fork DSH core。
- 插件更新由我们自己的签名 manifest 或安装器在版本变化时重跑 bootstrap 负责；
  不是单一签名更新单元。
- **B2（自定义 DSH 桌面发行版）** 保留为升级路径：只有“必须单一签名更新单元 /
  完整 Rayrun 品牌 / DSH analytics 或更新 feed 不可接受”成为硬需求时才做。
- **A** 仍用于开发和早期试用（用户自己的 DSH 手动装插件）；**C** 不做。

B1 必须先跑 spike **D-S1a**，验证：

- DSH 升级是否保留 `$DSH_HOME/profiles/desktop` 和已装插件；不保留时 bootstrap 能否
  幂等修复；
- 官方安装器/二进制的再分发条款与 “DeepSeek Harness” 商标使用；
- 两个插件能否无人值守、离线安装，失败时回滚且不留半装状态；
- 卸载/升级后的 profile、token 和 workspace 数据处置；
- DSH desktop analytics 能否声明或关闭；B1 继承 DSH 的 analytics，B2 必须关闭/替换。

两者都必须：更新默认“提示 + 用户确认”，签名 manifest，失败即停并回滚，版本矩阵
包含本地 DSH、两个插件与云端镜像 DSH。设计细节和 D-S1a 清单见
[桌面发行版设计](../design/desktop-distribution.md)。

**影响。** v1.0 范围、[部署](../09-deployment.md)、[产品方向](../00-product-direction.md)
§8、[集成](../08-integration.md) 的镜像版本；不阻塞 v0.1。B2 仍需 DSH 桌面构建/
签名/更新源与 analytics 配置的确认。

**证据。** DSH `apps/desktop/README.md`、`packages/util/official-bundles/README.md`、
`docs/capability-seams.md`、`docs/user/guide/plugin-market.md`；
[桌面发行版设计](../design/desktop-distribution.md)；[产品方向](../00-product-direction.md)
§8；[架构](../01-system-architecture.md) “薄客户端”；[路线图](../plans/roadmap.md)
v1.0；[部署](../09-deployment.md) §7；[安全](../07-security.md) §4.6；
[集成](../08-integration.md) §5。

<a id="adr-015"></a>
### ADR-015 — 云端 bot runtime 层

**状态：** Proposed（v0.1）.

**问题。** Rayrun 平台和 bot（DSH agent）之间是否需要一个专门的 bot runtime
中间层？它承接什么、不承接什么？

**当前设计。** [`04-cloud-host.md`](../04-cloud-host.md) 已经描述了“云端 bot
host”：常驻 supervisor、FIFO 队列、每 bot session/profile、心跳/恢复、审批提案。
它是事实上的中间层，但没有被当作独立层命名，职责和 `dsh-rayrun-computer` 的边界
混在一起。

**问题。** 如果把 bot 语义（队列、session 映射、恢复、事件）塞进 DSH 插件、本地
host 或 Rayrun adapter：

- DSH 重启会丢队列/状态；
- 本地控制面需要理解云内进程；
- Rayrun API 变化会穿透到 bot 层；
- 测试需要真云。

中间层把这些收敛到一个可测试的 supervisor。

**决策。** 采用一个**每用户云电脑内的 bot runtime**：

- **拥有**：FIFO 队列/单飞、bot↔session/profile 映射、DSH 进程监督、心跳/恢复、
  事件 outbox、审批提案（不是决定/执行，ADR-019）。
- **不拥有**：Rayrun token、机器生命周期/计费、审批决定/执行（本地，ADR-019）、
  模型 key 存储（注入）、多 bot 安全隔离。
- **向上**：与本地控制面通过版本化控制协议（queue inbox/state、approval、outbox；
  单写者 ADR-003）。
- **向下**：DSH agent sessions/profile、workspace、模型调用。
- **信任**：与 agent 同机、root/`danger-full-access`，**不是安全边界**；本地 typed
  审批由本地 DSH host 决定/执行（ADR-019），云端凭据动作仍按 ADR-001 等待平台隔离。
- **生命周期**：由平台 worker projection 或本地 watchdog 启动；心跳写
  `host/state.json`；版本进入版本矩阵。
- **不调用 Rayrun API 的账号 token**；由依赖的 worker projection ship/启动；平台
  能力由本地控制面通过依赖调用（ADR-004/016）。

**理由。** 稳定契约、可测试、可恢复、串行执行、隔离 Rayrun API 变化。

**替代方案。** 本地-only runtime（合上笔记本失败）；DSH 插件即 runtime（耦合、
丢恢复）；项目方托管 runtime（违反不变量 3/4）。

**影响。** C1–C9、D1–D5、E1–E7；ADR-003/004/005/007/012。不改变 ADR-001 的执行点。

**证据。** [`04-cloud-host.md`](../04-cloud-host.md)；
[`01-system-architecture.md`](../01-system-architecture.md) §3；
[`08-integration.md`](../08-integration.md)。

<a id="adr-016"></a>
### ADR-016 — 本地 bot 控制面

**状态：** Proposed（v0.1）.

**问题。** Rayrun API 之上、用户与 bot 之间的控制层放在哪里？它拥有什么？

**当前设计。** 本地控制面（host half）已经承担 token、setup、审批、成本等；文档没有把它
作为独立层命名，容易和云端 bot runtime 混淆。

**决策。** **Rayrun 之上是用户侧控制面**：DSH host + `dsh-rayrun-bots` host
half，不是项目方托管服务。

- **拥有**：Rayrun token/vault、登录/setup、机器 ensure/start/stop 命令、bot
  定义/注册表（ADR-002）、审批 UI/决定、成本汇总、依赖版本检查、watchdog、本地
  镜像/outbox cursor、审计。
- **不拥有**：bot 任务执行、DSH sessions、模型调用、billing、多租户/RBAC、项目方
  控制面。
- **接口**：向上同源 RPC（ADR-010）；向下 Rayrun API（token 只在本地）与 bot
  runtime 控制文件。
- **信任**：本地用户侧可信；同 profile 的恶意插件是残余风险；不做托管。
- **拒绝**：项目方托管的 SaaS 控制面、共享账号、代管 token、统一调度。

**理由。** 权限/凭据留在用户侧；Rayrun 是可替换的基础设施；控制面可以吸收 API
变化；没有项目服务器。

**替代方案。** 项目方托管控制面（违反不变量 3/4）；纯云端控制（丢失本地权威/
token）；provider 抽象（v0.1 不做）。

**影响。** A2/A3、B1–B4、E3/E4、G1/G2；ADR-002/004/010。本地 typed 审批执行由
ADR-019 决定；云端凭据动作由 ADR-001 决定（平台隔离）。

**证据。** [`01-system-architecture.md`](../01-system-architecture.md) §3.1；
[`05-approvals.md`](../05-approvals.md)；[`08-integration.md`](../08-integration.md)；
[`00-product-direction.md`](../00-product-direction.md) §1。

<a id="adr-017"></a>
### ADR-017 — Bots 作为默认产品表面

**状态：** Accepted（2026-11-21，产品决策）.

**问题。** 客户端的运行时是 DSH 插件，但产品品牌和默认入口是什么？Bots 只是 DSH
里的一个 panel，还是用户打开后直接进入的产品表面？

**选项。**

1. **Panel**：保留 DSH 侧栏和默认对话；Bots 通过侧栏入口打开。最贴近“薄插件”，
   但品牌弱，用户先看到的是 DeepSeek Harness。
2. **Bots 默认表面（选中）**：Rayrun Bot 是品牌，Bots 是默认表面；客户端加载后自动
   `layout.selectPanel('rayrun-bots')`，全屏覆盖 DSH 外壳；DSH 是宿主，Bots 内不提供
   返回 Harness 的入口。
3. **B2 品牌发行版**：从 DSH 源码构建完整品牌发行版，维护成本最高，只在 B1 不足时做。

**决策（2026-11-21）。** 采用 2：**Bots 是 Rayrun Bot 的默认产品表面**。打开 DSH
web/桌面壳时，插件加载后自动激活 Bots；Bots 全屏覆盖 DSH 侧栏和底栏，Rayrun Bot 的
roster 是最左列。DSH 仍是宿主和运行时，不是被 fork/重写的客户端。**Bots 内不提供
返回 DSH 的入口**；Plugins、云电脑、Workspaces 等流程需要由 Bots 自己接管（尚未
实现），在接管前它们是已知缺口，而不是隐藏入口。

**后果。**

- 品牌：Rayrun Bot 是产品名，Bots 是默认表面；Bots 激活时页面标题为 Rayrun Bot。
- 导航：默认入口即 Bots；Bots 是唯一产品表面，没有 in-product 退出；DSH 的 setup/
  Plugins/云电脑 入口必须由 Bots 接管。
- 依赖：Bots 仍通过 DSH 插件机制运行；不修改 DSH core，不做 B2。
- 未闭合：setup/Plugins/云电脑 的入口、DSH key 引导归属、无障碍 inert/焦点、
  DSH 版本矩阵；见 2026-11-21 UX/产品审核与
  [`10-rayrun-verification.md`](../10-rayrun-verification.md)。
- B1：预配置 DSH 发行包可以直接打开 Bots；B2 仍只在品牌/单一更新单元成为硬需求时做。

**证据。** 2026-11-21 产品决策（形成自己的品牌、进去即激活 Bots、品牌立场是 Bots）；
2026-11-21 UX/产品独立审核；[`design/ui-design.md`](../design/ui-design.md) §1.1；
`packages/dsh-rayrun-bots/client.js` 的 `selectPanel(PANEL_ID)` 与全屏 `.rb-frame`；
[`10-rayrun-verification.md`](../10-rayrun-verification.md) R-G001/R-G008。

<a id="adr-018"></a>
### ADR-018 — 文档事实源与语言

**状态：** Accepted（2026-11-22，文档重构）.

**问题。** README 同时承担营销和事实来源，导致状态、版本、安装步骤散落在产品页，文档
之间互相以 README 的 Status 段为准；`docs/` 里还有多份英文文档，语言不一致。

**选项。**

1. **继续让 README 作为状态真相源，只翻译文档。** 改动小，但营销与事实继续耦合，任何
   状态更新都要改两份 README，其他文档继续依赖产品页。
2. **README 只做营销，新增 `docs/12-status.md` 作为实现状态唯一事实源，`docs/` 全中文
   （选中）。** README 保留英中双语和产品叙事，状态/版本/安装/验证读数移入 docs；
   所有文档的状态引用指向 12-status；英文 docs 翻译为中文。
3. **把 README 也改成纯中文。** 会削弱英文受众和 GitHub/npm 首屏。

**决策（2026-11-22）。** 采用 2。

- `README.md` / `README.zh-CN.md`：英中双语营销页，英文为准，同一 commit 更新；只放
  产品叙事、价值主张、概念图和指向 `docs/` 的入口，不承载状态、版本、安装步骤、配置表、
  验证读数或 CI 细节。
- `docs/12-status.md`：实现状态的唯一事实源；带日期，证据指向
  [`10-rayrun-verification.md`](../10-rayrun-verification.md) 和
  [`version-matrix.md`](../version-matrix.md)。
- 其他文档提到实现状态时引用 12-status，不引用 README。
- `docs/` 全部用中文；技术标识、代码、schema、UI 文案保持英文。
- 新增用户可见行为时更新 12-status；营销叙事变化时同步两份 README。

**理由。** 营销和事实分离，状态只有一处；中文文档降低维护和阅读成本；英文 README
保留对外展示。

**影响。** `docs/00`–`12`、[`docs/README.md`](../README.md)、[`CLAUDE.md`](../../CLAUDE.md)、
[`SECURITY.md`](../../SECURITY.md)、[`CONTRIBUTING.md`](../../CONTRIBUTING.md) 和包
README 的状态引用；不影响代码和 RPC 契约。

**证据。** 本次文档重构；[`docs/12-status.md`](../12-status.md)；
[`docs/README.md`](../README.md) §5 文档约定。

<a id="adr-019"></a>
### ADR-019 — 审批执行放在本地 DSH host

**状态：** Accepted（2026-11-23，用户决定；参考 Grok Bot 的本地审批/执行形态）.

**问题。** ADR-001 在 2026-11-21 选择“平台权限隔离”，在平台提供 host/agent 隔离与
host-only 审批端点前不实现执行。平台 2026-11-22 答复：同一沙箱内无法隔离
（runtime 与 agent 共享 root，agent 可读 `/proc/<pid>/environ`），平台审批端点不属于
初步支持。结果是审批执行长期停摆，而产品示例和 v0.1 退出标准都需要它。

Grok Bot 的设计提供另一条路：远端 box 只发出“ask”，桌面客户端是瘦的，本地
daemon/原生 helper 持有执行权限与凭据，用户批准后本地执行。**在凭据所在处执行，
在人类所在处审批。** 本仓库采纳这条路径，作用于凭据和执行器在本地的动作。

**决策。** 对凭据/执行器在本地的受控动作，**本地 DSH host 是审批权威和执行方**；
云端 bot 只能提案。ADR-001 的“平台隔离前不实现审批执行”不再阻塞这些本地动作；
平台隔离仍保留给凭据只在云端、且必须在云端执行的动作。

必须保持的规则：

1. **决定只在本地。** 云端 workspace/文件只传提案和结果，绝不传 decision、执行
   claim 或执行权限。云端写来的 decision 一律忽略。
2. **提案不可信。** 本地用 typed allowlist 校验动作；risk 由本地推导；nonce、
   actionHash 与 request id 由本地生成；显示内容与实际执行内容绑定。
3. **首版动作最小。** 只允许 `rayrun.machine.start` 和 `rayrun.machine.stop`。
   `destroy`、创建机器、shell、任意 URL/命令、任意可执行 payload 都不在 allowlist；
   新增动作必须单独立项。
4. **本地执行，失败即拒绝。** 执行器使用本地 Harness vault 中的 Rayrun token；token
   不进入 action、response、日志或页面。pending/denied/expired 永不执行；批准后先写
   `executing` claim，再执行；at-most-once；失败或崩溃不自动重试，也不重复副作用。
5. **本地不在线就等待。** 本地 DSH 不在线时，chat 审批等待，background 审批按 TTL
   过期拒绝；没有后台自动批准。
6. **真实状态。** 客户端显示本地校验后的动作、目标和风险；执行失败显示失败，不把
   “已批准”显示成“已完成”。

**边界（必须和实现一起说）。** 云端 bot 仍是 `danger-full-access`，能在自己的
workspace 内任意运行，也能写/改提案；本 ADR 只保护“需要本地执行的动作”，不是沙箱、
不是每 bot 隔离，也不使被 prompt injection 的 agent 变得可信。多 bot 仍共享机器。
云端凭据动作在平台隔离或 host-only 端点落地前继续不执行。

**Grok Bot 参考。** 参考其“thin client + local execution daemon + approval gate”的
形态、ask 不挂起半启动进程、审批记录绑定动作/目标、凭据不进入远端 box；不复制其
实现、协议或客户端代码。本文档只引用公开调研结论，不把 Grok 的行为当作 Rayrun 的
已验证保证。

**后果。**

- E1–E7、A6/A7 中依赖“在本地执行”的部分解阻；平台端点不再是唯一路径。
- 云端提案 bridge 已实现并 live：bot 输出结构化 block，cloud host 写提案，本地
  `rayrun_files` 导入并去重，结果写回；真实 start/stop、denial/Continue 和下一轮结果
  context、pause/resume 已通过；其他动作类型仍待做。
- 本地 DSH 必须在线才能执行；关闭页面不等于批准，关闭后不会自动执行。
- 云端凭据动作、host/agent 隔离和远程（手机）审批仍是平台/后续工作。

**证据。** Grok Bot 调研见 [`docs/research/inspiration.md`](../research/inspiration.md)；
平台答复见 [`08-integration.md`](../08-integration.md) §3.3；当前实现与测试见
[`05-approvals.md`](../05-approvals.md)、[`12-status.md`](../12-status.md)；
`lib/approval-actions.js`、`lib/approval-executor.js` 和
`test/approval-executor.mjs`。

<a id="adr-020"></a>
### ADR-020 — 云电脑是 agent 的安全容器，容器内 `danger-full-access`

**状态：** Accepted（2026-11-26，用户决定）.

**问题。** 云端 agent 需要 shell、文件、浏览器和工具才能工作。早期文档把
`danger-full-access` 写成“workaround、不是沙箱”，容易被读成“缺少 containment，
应该改成受限沙箱”；产品评审据此把“云端 agent 可执行 shell/发布/花钱”当成审批承诺
的缺口。

**决策。** 云电脑（用户自己的 Rayrun 机器/VM）是 agent 的**安全容器**；容器内 agent
需要完整工具权限，worker profile 故意使用 `danger-full-access`。这是产品设计，不是
待修的沙箱缺口。安全边界是这台云电脑，不是 bot 进程内的权限层：

- 同一台机器上的 bot 共享容器，不互为沙箱。
- 审批只覆盖离开容器、影响账号的 typed 动作（首版为本地
  `rayrun.machine.start/stop/pause/resume`）；容器内的工作（shell、文件、浏览、
  模型输出）不受审批 containment。
- 不把 `danger-full-access` 描述成 agent 级隔离或沙箱保证；被攻陷的 bot 可以在
  容器内任意操作，这是已知残余风险（[`07-security.md`](../07-security.md) §4.2/§4.4）。
- 云端凭据动作仍等待平台 host/agent 隔离与 host-only 端点（ADR-001）；本 ADR 不解决
  凭据问题，也不使云端 agent 可信。

**后果。**

- 产品文案和 onboarding 必须写“云电脑是容器；容器内完整权限是设计；审批保护
  typed 的离开容器动作”，不再写“所有副作用都等你批”。
- 同机多 bot 仍是产品选择；per-bot 隔离需要新的 ADR 或平台能力。
- 安全测试和文档继续把模型输出当不可信输入；审批不是 containment。

**证据。** 用户 2026-11-26 决定；[`07-security.md`](../07-security.md) §4、
[`08-integration.md`](../08-integration.md) §3.3、[`12-status.md`](../12-status.md)
§4/§5；`CLAUDE.md` §6.11。

<a id="adr-021"></a>
### ADR-021 — 常驻 cloudHost 是依赖 1.2+ 的默认执行路径

**状态：** Accepted（2026-11-27，用户决定）.

**问题。** 产品要求“合上笔记本后 Bot 继续做完”，且用户不应管理本地/云端交接。
detached 每轮由本地 host 提交；发送后立即合盖存在尚未提交到云端的窗口。常驻
cloudHost 在用户的 Rayrun 机器上拥有 turn，任务一旦上传，本地页面或进程停止不影响
执行。

**决策。**

- 依赖 1.2+ 且未显式配置时，默认使用常驻 `cloudHost`；`cloudHost: false` 保留
  detached，依赖 1.1 仍走 detached，1.0 走 `rayrun_agent`。
- 新机器镜像随 runtime：cloudHost 用 `dsh-bot@1`，detached 用
  `deepseek-harness@1`；电脑更新也按当前 runtime 选择镜像。
- 云 host spec 未显式配置 credential 时，沿用机器已绑定的第一个凭据。
- 旧镜像以 `E_GUESTD_OUTDATED` 失败关闭，并在聊天里提示更新电脑；不静默 fallback
  到 detached，避免同一任务重复执行、审批/ routine 双调度和两套 session 语义。
- 客户端不为这次切换增加交接提示或后台状态徽标；用户只看现有的 Working 和结果。

**后果。**

- 旧 `deepseek-harness@1` 机器需要先经电脑更新换到 `dsh-bot@1`；更新前聊天会以
  `E_GUESTD_OUTDATED` 失败并给出可执行提示。
- 默认 cloudHost 的“发送 → 立即合盖 → 重开收结果”仍需生产干净账号验收；现有
  A5 dev 证据是 detached 路径。发送尚未到达本地 host 前的物理窗口仍在；真正的
  零丢失需要云端入口，另行决策。
- `cloudHost: false` 是显式回退；1.2+ 的 detached 仍可用于迁移或诊断。

**证据。** 用户 2026-11-27 决定；[`01-system-architecture.md`](../01-system-architecture.md)
§1/§2；[`04-cloud-host.md`](../04-cloud-host.md) §1；[`09-deployment.md`](../09-deployment.md)；
[`12-status.md`](../12-status.md) §3.1；`test/rpc-contract.mjs`、
`test/cloud-host-runtime.mjs`、`test/computer-update.mjs`。

## 建议顺序

1. **先定 ADR-015 与 ADR-016。** 它们决定控制面/执行面的分层与权威；没有它们，
   审批和所有权没有落点。
2. **再定 ADR-001 与 ADR-002。** 它们决定信任边界与所有权模型，其他项依赖它们。
3. **ADR-004。** 在 C1/D1 之前确认依赖的 host 表面；这是第一个实现阻塞。
4. **ADR-003、ADR-005、ADR-011 一起定。** 它们把控制协议、执行日志和审批 schema
   定义成一组一致的契约。
5. **ADR-007 spike。** M2 前必须拿到 session、常驻 bot runtime 和凭据注入的证据。
6. **ADR-006、ADR-008、ADR-009 并行。** 它们是范围/产品决策，不是代码阻塞。
7. **ADR-010 与 ADR-013 作为清理。** 在客户端接 host 之前对齐 RPC 契约和文档。
8. **ADR-014 定为 B1。** v1.0 做预配置 DSH 发行包（bootstrap 安装器）；B2 整包更新
   是升级路径，C 不做。先跑 spike D-S1a 验证 profile 保留、再分发条款、离线安装/
   回滚、卸载与 analytics。不在 v0.1 做桌面发行版。

B1（`bot.json` schema）可以在 ADR-002 与 ADR-011 定下字段和所有权后开始；不要先
finalize 一个会被所有权模型推翻的 schema。
