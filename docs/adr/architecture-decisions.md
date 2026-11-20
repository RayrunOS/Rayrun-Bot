# 架构决策 — v0.1

*状态：2026-11-20。本文是对 v0.1 架构的评审，以及在 bot runtime 与审批层动工前必须定下来的决策。它记录设计在哪里不完整、互相矛盾或存在安全问题，并为每一项给出建议。本文不描述已实现的行为。只有状态为 **Decided** 的条目才算最终决定；其余都是未决。*

相关：[产品方向](../00-product-direction.md) 是范围；[系统架构](../01-system-architecture.md) 是设计；[MVP 计划](../plans/mvp-plan.md) 是工作分解；[安全](../07-security.md) 是威胁模型；[本地文件设计](../06-local-state.md) 是状态布局；[平台需求](../08-integration.md) 是交给 Rayrun 平台的清单。

## 如何阅读

每项是一个决策。**状态**取 `Open`、`Proposed`、`Decided`；**阻塞**列出在决策前不能安全实现的工作项；**证据**指向当前文本，用章节号而不是行号，以免编辑后失效。

本次评审发现 1 个安全边界错误（ADR-001）、3 个阻塞 bot runtime 的契约缺口（ADR-003、ADR-004、ADR-005），以及一组范围与文档不一致。下面的建议都是提案，不是决定。

## 决策总表

| 编号 | 决策 | 状态 | 建议 | 阻塞 |
| --- | --- | --- | --- | --- |
| [ADR-001](#adr-001) | 审批在哪里执行 | Proposed | 在凭据所在的一侧执行受控动作；把平台权限隔离作为平台需求 | C4, E1–E7, A6, A7 |
| [ADR-002](#adr-002) | 所有权矩阵与单写者规则 | Proposed | 每个文件一个写者；本地负责意图，云端负责运行态；公布矩阵 | B1–B4, C3, C8, E2–E4 |
| [ADR-003](#adr-003) | 基于 Rayrun 文件 API 的控制通道协议 | Proposed | 拆分 inbox/state；每项一个文件；不做共享 JSONL 追加 | C3, C5, C8 |
| [ADR-004](#adr-004) | 与 `dsh-rayrun-computer` 的契约 | Proposed | 在依赖仓库写能力/版本契约；不复制 token | A2, C1–C5, D1, G1 |
| [ADR-005](#adr-005) | 副作用执行语义 | Proposed | `actionId`、执行日志、幂等与重试规则 | C8, E1–E7, A7 |
| [ADR-006](#adr-006) | “合上笔记本”意味着什么 | Proposed | 写清允许的工作、审批过期与计费后果 | A5, A6, G3 |
| [ADR-007](#adr-007) | 常驻 bot runtime 的凭据与 DSH profile 模型 | Proposed | M2 前做 spike；回退到逐次 headless + transcript replay | C1–C4, D1–D5, A5, A8 |
| [ADR-008](#adr-008) | Desktop 访问路径 | Proposed | 核实依赖的路径；没有安全路径就不要承诺 takeover | F5, security |
| [ADR-009](#adr-009) | Routines / scheduler 范围 | Proposed | 除非 W3 有余量，否则定为 P1；从核心分层图移除 scheduler | M1, M4 |
| [ADR-010](#adr-010) | RPC 路由与信封 | Proposed | 选定一个契约，代码、测试、文档一起对齐 | F2, F4 |
| [ADR-011](#adr-011) | 审批 schema 与 canonical action hash | Proposed | canonical JSON、完整 decision 字段、本地重算 hash | E2–E6, C-S6 |
| [ADR-012](#adr-012) | 恢复与运行语义 | Proposed | 补字段、时钟规则、限流与审计语义 | C8, D4, E5–E7, A8, A9 |
| [ADR-013](#adr-013) | 文档清理 | Proposed | 与相关决策同批修正下文列出的矛盾 | docs |
| [ADR-014](#adr-014) | 桌面发行版与更新单元 | Proposed（v1.0） | 默认官方 DSH 桌面 + 首启装插件；单一更新单元才做自定义发行版；薄壳 fallback | v1.0, 09-deployment |
| [ADR-015](#adr-015) | 云端 bot runtime 层 | Proposed（v0.1） | 用户云电脑内的 supervisor；queue/session/DSH/事件/恢复 | C1–C9, D1–D5, E1–E7 |
| [ADR-016](#adr-016) | 本地 bot 控制面 | Proposed（v0.1） | DSH host + 插件 host half；token/审批/成本/依赖；不做托管服务 | A2/A3, B1–B4, E3/E4, G1/G2 |

## P0 — bot runtime 与审批动工前必须定

<a id="adr-001"></a>
### ADR-001 — 审批在哪里执行？

**状态：** Proposed.

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

**影响。** 改变审批桥、E1–E7、安全页和平台需求。任何审批代码动工前应先定这一项。

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
| 审批请求 | bot runtime，作为提案 | 本地控制面 | 提案，不是授权；执行点按 ADR-001。 |
| 审批决定 | 本地控制面，或平台审批服务 | 执行方 | 每个 id 一个决定；执行方必须在 agent 写不到的地方。 |
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

**当前设计。** README 说合上笔记本不会让 bot 停止。本地控制面运行审批轮询、
idle-stop 策略和 watchdog。平台没有 idle auto-stop；`max_lifetime_seconds` 只停不
重启；后台审批卡 30 分钟后过期（[README](../../README.md) “How it works”；
[FAQ](../faq.md) “What happens if I forget to stop the computer?”；[MVP 计划](../plans/mvp-plan.md)
G3；[客户端计划](../plans/client-plan.md) “UX flows and failure states”）。

**问题。** “继续工作”只对已经排队、且不需要审批的动作成立。后台受控动作会停在卡片
处并过期；新工作无法提交；本地 idle stop 不在运行，机器继续计费。产品页没有说明
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
不等于无上限账单。在 README 和 FAQ 中写明限制。

**影响。** A5、A6、G3；README 与 FAQ 措辞。

**证据。** [README](../../README.md) “How it works”；[FAQ](../faq.md)；
[系统架构](../01-system-architecture.md) “Concurrency, cost and failure”；[MVP 计划](../plans/mvp-plan.md)
C6、G3。

<a id="adr-007"></a>
### ADR-007 — 常驻 bot runtime 的凭据与 DSH profile 模型

**状态：** Proposed.

**问题。** 受监督的 bot runtime 能否拿到模型凭据，并按 bot 运行 session/profile？

**当前设计。** Rayrun 把 DeepSeek key 注入 agent 进程。设计想要一个常驻 DSH host，
每个 bot 一个 session 和一个 profile 目录；今天平台按每次 prompt 启动
`dsh --profile headless`（[系统架构](../01-system-architecture.md) “Layers”；[平台需求](../08-integration.md)
§1）。

**问题。** 平台文档只保证 agent 进程的凭据注入，不保证 supervisor 再 spawn DSH
session 时也能拿到。也没有验证一个 DSH 进程能否承载多个 bot profile，还是每个 bot
需要独立进程和端口。这决定“合上笔记本”是否可能。

**建议。** 在 M2 前跑 spike S1/S2 并留下证据：session create/continue、受监督进程
重启、监督进程的凭据注入、一个进程 vs 每 bot 一进程、CPU/内存、端口分配。把监督进程
的凭据注入与重启语义加进[平台需求](../08-integration.md)。保留逐次 headless + transcript
replay 作为有文档的回退，并写清它的 UX 与成本。

**影响。** C1–C4、D1–D5、A5、A8。这是最大的未验证平台赌注。

**证据。** [系统架构](../01-system-architecture.md) “Layers”；[平台需求](../08-integration.md) §1；
[安全](../07-security.md) “Design goals” 3。

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

**状态：** Proposed.

**问题。** v0.1 里 scheduler 是 P0 还是 P1？

**当前设计。** [系统架构](../01-system-architecture.md) “Layers” 把 scheduler 放进本地控制面核心；
[路线图](../plans/roadmap.md) “v0.1” 包含最小 routines；[MVP 计划](../plans/mvp-plan.md) §3 把 routines
标为 P1，§11 又把决定列为 W0 到期。

**问题。** 范围与估时不一致。P1 scheduler 会改变 M1 和 M4，而且本地 scheduler 与
云端队列的关系没有定义。

**建议。** 除非 W3 结束时有余量，否则定为 P1。若 P1，从核心分层图移除 scheduler，
并写明 routines 不在 v0.1。若 P0，更新估时和里程碑。无论哪种，写清本地 scheduler 只
决定何时唤醒 bot，云端队列负责串行执行；它们不是两个队列。

**影响。** M1、M4、范围与估时。

**证据。** [系统架构](../01-system-architecture.md) “Layers”；[路线图](../plans/roadmap.md) “v0.1”；
[MVP 计划](../plans/mvp-plan.md) §3、§11 决策 2。

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
`{ ok: false, code, message }`（[客户端计划](../plans/client-plan.md) “RPC contract with the
host”；[MVP 计划](../plans/mvp-plan.md) §4.4）。

**问题。** 按文档实现的客户端会调用不存在的路由，或发送 host 不读的 body。这是接线
失败，不是文案问题。

**建议。** 选定一个契约，并在同一次变更里对齐代码、测试、README 和两份计划。建议形状：
保留已测试的 `/plugins/rayrun-bots`，把 body 统一为 `{ action, payload? }`，保留嵌套
错误信封，然后更新文档；或改名为 `/plugins/rayrun-bots/rpc` 并更新测试。不要同时保留
两套契约。

**影响。** F2、F4；客户端接线。

**证据。** [index.js](../../packages/dsh-rayrun-bots/index.js)；
[rpc.js](../../packages/dsh-rayrun-bots/lib/rpc.js)；[客户端计划](../plans/client-plan.md)
“RPC contract”；[MVP 计划](../plans/mvp-plan.md) §4.4。

<a id="adr-011"></a>
### ADR-011 — 审批 schema 与 canonical action hash

**状态：** Proposed.

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

- “no runtime dependencies”（README、CLAUDE.md）与声明 `dsh-rayrun-computer`：
  区分库依赖与 peer bundle。
- [errors.js](../../packages/dsh-rayrun-bots/lib/errors.js) 和 MVP 错误码表缺
  `E_BOT_INVALID`，但 B1 要求非法定义返回一个 code。
- ADR-010 里的 RPC 路由/信封不一致。
- 带日期的状态陈述与“今天能做什么”必须与代码一致；本文不改变它们。

<a id="adr-014"></a>
### ADR-014 — 桌面发行版与更新单元

**状态：** Proposed（v1.0）.

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
external plugins。要预装插件或把它们放进同一个更新单元，必须定制 DSH 桌面发行版，
或接受首启安装/单独更新。

**选项。**

1. **A. 官方 DSH 桌面 + 首启安装两个插件（默认）**：DSH 用官方 updater；插件用
   plugin manager/market 单独更新；首启装一次插件。成本最低，不是单一更新单元。
2. **B. 自定义 DSH 桌面发行版**：从 MIT 源码构建，定制品牌/签名/更新 feed，把两个
   插件加入 official bundle list 或预置 profile；DSH + 插件整包更新。真正“打开即
   用”，但维护成本最高。
3. **C. 自建薄壳**：重复 DSH desktop 已有的 host/updater；只在 DSH 桌面无法满足硬
   需求时作 fallback。

**建议。** 默认 **A**。只有“必须一个签名更新单元、且用户不能做插件安装步骤”是硬
需求时才做 **B**。**C** 作为 fallback，不和 B 同时做。

- A：写清首启安装（plugin index / CLI）、插件更新、DSH 升级后的兼容检查，以及
  DSH analytics 的声明。
- B：先做 spike D-S1：用 DSH 桌面源码构建自定义品牌、签名和更新 feed，预置 bundle，
  关闭/声明 analytics，验证 DSH + 插件整包更新与回滚。
- 两者都必须：更新默认“提示 + 用户确认”，签名 manifest，失败即停并回滚，版本矩阵
  包含本地 DSH 与云端镜像 DSH。

设计细节见 [桌面发行版设计](../design/desktop-distribution.md)。

**影响。** v1.0 范围、[部署](../09-deployment.md)、[产品方向](../00-product-direction.md)
§8、[集成](../08-integration.md) 的镜像版本；不阻塞 v0.1。B 还需要 DSH 桌面构建/
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
  事件 outbox、审批提案、执行日志（ADR-005）。
- **不拥有**：Rayrun token、机器生命周期/计费、审批决定（本地/人类，ADR-016）、
  模型 key 存储（注入）、多 bot 安全隔离。
- **向上**：与本地控制面通过版本化控制协议（queue inbox/state、approval、outbox；
  单写者 ADR-003）。
- **向下**：DSH agent sessions/profile、workspace、模型调用。
- **信任**：与 agent 同机、root/`danger-full-access`，**不是安全边界**；审批执行点
  按 ADR-001。
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

**影响。** A2/A3、B1–B4、E3/E4、G1/G2；ADR-002/004/010。审批执行点仍由 ADR-001
决定。

**证据。** [`01-system-architecture.md`](../01-system-architecture.md) §3.1；
[`05-approvals.md`](../05-approvals.md)；[`08-integration.md`](../08-integration.md)；
[`00-product-direction.md`](../00-product-direction.md) §1。

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
8. **ADR-014 是 v1.0 的前置。** 先确认 A/B：默认 A（官方 DSH 桌面 + 首启装插件）；
   只有必须单一签名更新单元时才做 B，并先跑 spike D-S1。不在 v0.1 做桌面发行版。

B1（`bot.json` schema）可以在 ADR-002 与 ADR-011 定下字段和所有权后开始；不要先
finalize 一个会被所有权模型推翻的 schema。
