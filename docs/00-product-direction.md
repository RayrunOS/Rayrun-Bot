# 00 — 产品方向：定位与 v0.1 范围

> 状态：2026-11-21。本文是**产品层的唯一真相源**：卖给谁、解决什么问题、v0.1 做什么、怎么算做完。
> 实现状态与进度只看 [`12-status.md`](12-status.md)；本文不复制状态。根
> [`../README.md`](../README.md) 是营销页，不作为事实依据。
> 技术方案见 [`01-system-architecture.md`](01-system-architecture.md)；工作分解与验收见
> [`plans/mvp-plan.md`](plans/mvp-plan.md)；未决架构决策见
> [`adr/architecture-decisions.md`](adr/architecture-decisions.md)。

## 0. 与现有文档的关系

| 文档 | 本文对它的处置 |
| --- | --- |
| [`../README.md`](../README.md) | 营销页，不承载事实。本文不重复“今天能做什么” |
| [`12-status.md`](12-status.md) | 实现状态的唯一事实源；本文不复制状态 |
| [`01-system-architecture.md`](01-system-architecture.md) | 技术落点。产品与技术冲突时以本文为准；技术细节以 01 为准 |
| [`plans/mvp-plan.md`](plans/mvp-plan.md) | v0.1 工作分解与 A1–A12 验收。本文只定方向和范围 |
| [`plans/roadmap.md`](plans/roadmap.md) | 里程碑、阶段与不做什么。本文 §8 只给摘要 |
| [`faq.md`](faq.md) | 用户问题的短答；本文不重复 |
| [`design/bot-persona.md`](design/bot-persona.md) | bot 身份、默认指令模板与 UI 出现位置；本文只定产品原则 |
| [`research/inspiration.md`](research/inspiration.md) | 调研材料；不是真相源 |
| [`08-integration.md`](08-integration.md) | 交给 Rayrun 平台的能力清单；本文 §7 只引用风险 |
| [`adr/architecture-decisions.md`](adr/architecture-decisions.md) | 未决架构决策与 ADR 登记；本文 §10 只列未决产品决策 |
| [`07-security.md`](07-security.md) | 安全目标与威胁模型；本文不重复 |

---

## 1. 产品定位

**一句话**：Rayrun Bot 给 DeepSeek Harness 里的 bot 一个名字、一副身体和一个家——bot
有名字、指令、记忆和日程，运行在用户自己的 Rayrun 云电脑上，用用户自己的 DeepSeek
key 思考；没有项目方托管的账号、控制面、代理或中继。

**四块拼图**：

| 部分 | 是什么 | 谁持有 |
| --- | --- | --- |
| 桌面 | DeepSeek Harness：`dsh web` 或桌面壳；聊天、审批、改设置 | 用户自己的电脑 |
| 身体 | 一台 Rayrun 云电脑：Linux、`/workspace`、X11 桌面、浏览器 | 用户的 Rayrun 账号 |
| 大脑 | DeepSeek API key，经 Rayrun credential injection 注入 agent 进程 | 用户的 DeepSeek 账号 |
| 记忆 | 机器上的 DSH profile 与每 bot 目录；session 可续接 | 用户的云电脑 |

**明确不是什么**：

- 不是托管的聊天 SaaS：没有项目方账号、控制面或计费；计算和模型账单都在用户侧。
- 不是模型提供商：不代售 token，不代理 DeepSeek 账号。
- 不是通用 CI / FaaS：调度单位是**有状态、可续接的 bot 会话**，不是无状态函数。
- 不是多租户平台：v0.1 不做组织、RBAC、SSO/SCIM、审计导出或企业控制面。
- 不是 bot 市场：不提供 bot/skill 交易，也不做“主 bot 调度其他 bot”的编排层。

---

## 2. 核心命题

1. **Bot 是同事，不是聊天窗口。** 一个 bot 有名字、职责、指令、记忆和日程；它跨会话
   继续，而不是每次从空上下文开始。
2. **一人一台电脑，不是一 bot 一台。** 更便宜，也更像一个人的桌面：bot 共享文件、
   浏览器状态和凭据。代价是 **bot 不是安全边界**，不能把两个 bot 当作彼此的沙箱。
3. **BYO（bring your own）：Rayrun 账号 + DeepSeek key。** 项目方不持有密钥、不算
   用户用量、不转售计算；Rayrun 收基础设施费，DeepSeek 收模型费。
4. **Approval-first，失败即拒绝。** 有外部副作用的动作（花钱、以用户身份发送或发布、
   销毁电脑、触碰另一台机器或凭据）先请求、后执行；超时、错误或未知状态一律拒绝。
5. **Thin client。** 客户端是 DSH 插件，复用 DSH 的聊天、session、设置与插件机制；
   不重写聊天 UI，不把 v0.1 做成独立应用。

---

## 3. 目标用户与首选场景

### 3.1 v0.1 首选：需要长期 / 后台跑 Agent 的开发者与小团队

| 维度 | 内容 |
| --- | --- |
| 痛点 | 在本机把 shell 交给 agent 不放心：误删、误提交、密钥泄露；跑在公司机器上没有审计；自己搭云 VM 又要处理隔离、密钥注入、空闲回收和用量核算 |
| 需求 | 一个“能放心把 shell 交出去”的地方：跑完能查、闲了能停、出事能审批、合上笔记本还能继续 |
| 支付意愿 | 只付基础设施：Rayrun 的机器小时与磁盘；模型 token 直接走用户自己的 DeepSeek 账号 |
| 关键要求 | 凭据不离开用户侧、行为可审批、会话可续接、失败可恢复、账单可见 |

### 3.2 次选（v0.1 之后）

垂直场景、区域 MSP、非技术用户的工作台。v0.1 **不**为它们做模板、角色或托管账号；
先把开发者场景的运行正确性、审批和成本模型跑通，再考虑上层包装。

### 3.3 不适合谁

- 想要一个开箱即用的托管聊天产品、不愿自带 Rayrun / DeepSeek 账号的用户。
- 需要多租户、组织权限、审计导出或 SLA 的企业团队。
- 需要把两个 bot 当作互相隔离的安全边界的用户。

---

## 4. 差异化

| 对手类型 | 代表 | 它们的缺口 | Rayrun Bot 的不同 |
| --- | --- | --- | --- |
| 托管 bot 产品 | Grok Bot | 机器、模型和客户端都由厂商提供，账号与计费不在用户手里 | 开源插件；DSH 做客户端，Rayrun 做身体，用户自带模型 key |
| 本地 agent 原型 | `dsh-superagent` | 只在一个仓库里本地跑，没有云电脑、持久 bot 或远程审批 | 云电脑 + 持久 bot 对象 + 审批桥 |
| 自托管 bot 平台 | OpenMausBot | 更宽的产品面，云桌面是外部服务 | 更窄：只做 Rayrun + DSH 的 bot 层，不碰模型/provider 抽象 |
| 裸云 VM | 任意云主机 | 用户要自己搭隔离、密钥注入、空闲回收、会话续接 | 把 bot 注册表、session 映射、审批和成本栏做成插件 |

**赌注**：DSH 是大脑，Rayrun 是身体，凭据在用户手里。这不是“再做一个模型客户端”，
而是把“一个有名字、有记忆、能被审批的同事”放到用户自己的机器上。

---

## 5. v0.1 范围

### 5.1 v0.1 一句话

一个人在干净的 DSH profile 里安装插件，登录 Rayrun，存好 DeepSeek key，创建一台云
电脑，创建一个有名字的 bot，和它对话，合上笔记本；bot 完成一次后台任务并停在一个
审批上；用户批准后它继续，机器小时与余额可见。

### 5.2 P0 能力

| 能力 | 说明 |
| --- | --- |
| 双插件安装 | Rayrun Bot + 独立的 `dsh-rayrun-computer`；一次安装路径未验证前保留两装路径 |
| 登录与凭据 | Rayrun token 进 Harness vault；DeepSeek key 作为 Rayrun credential；不写入页面、仓库或日志 |
| 一台云电脑 | 一人一台，可创建、打开、停止；不自动销毁 |
| Bot 注册表 | 名字、职责、头像（字母 monogram）、指令、skills、memory 目录 |
| Bot ↔ session 映射 | 持久化在机器上，DSH 重启后仍能续接 |
| 三栏界面 | 聊天列表、对话、bot 详情（Activity / Library）；复用 DSH 壳与 locale |
| 审批卡 | 对话内联卡片；Deny / Allow once；列表上的 attention 点 |
| 失败即拒绝 | 后台卡 30 分钟过期即拒绝；chat 卡等待；重放、错 bot、过期请求拒绝并记录 |
| 队列 | 一台机器同时只跑一个 agent 任务；其余排队，不丢工作 |
| 成本栏 | 余额与机器小时可见；idle 只 stop/pause，绝不 destroy |
| 打包与验收 | npm 包、版本矩阵、A1–A12 验收、干净 profile 的三分钟路径 |

### 5.3 v0.1 明确不做

IM 审批（v0.2）、移动 App、bot/skill 市场、模型 provider 抽象、独立桌面壳、浏览器
登录状态持久化、公网 ingress 面板、bot 间 handoff、多租户/RBAC、同一台机器上并行
跑多个 bot。完整清单见 [`plans/mvp-plan.md`](plans/mvp-plan.md) §3。

### 5.4 必须端到端跑通的三条旅程

1. **第一次**：干净 profile → 安装 → 登录 Rayrun → 存 key → 创建电脑 → 创建 bot →
   发出第一条消息并看到流式回复（≤ 3 分钟）。
2. **合上笔记本**：发出一个后台任务 → 关闭本地 DSH → bot 继续 → 重新打开时任务已完成，
   并停在一个审批上 → 批准 → 副作用发生 → 成本栏更新。
3. **续接**：同一个 bot 的第二次对话接着第一次；host 进程被杀死、机器 stop/start 后
   仍然接着。

### 5.5 怎么算做完

v0.1 的完成标准是 [`plans/mvp-plan.md`](plans/mvp-plan.md) §2 的 A1–A12 全部有证据通过，其中
四条是硬门槛：

- 干净 profile 三分钟内装好并跑到第一个 bot；
- 合上笔记本后 bot 完成一次后台任务；
- 受控动作停在审批上，批准后才发生副作用；
- 同一个 bot 的第二次对话能续接。

不在本文重复 A1–A12 的表格；验收证据以 `plans/mvp-plan.md` 和 release notes 为准。

---

## 6. 成功指标

这些是内部分析信号，不是公开承诺：

| 指标 | 目标 | 说明 |
| --- | --- | --- |
| 首次 bot 成功率 | ≥ 80% | 从安装到第一条回复；失败按步骤归因 |
| 第 2 周留存 | ≥ 40% | 用户是否还在用同一台机器/同一批 bot |
| 审批延迟 | p50 / p95 记录；目标 p95 < 10 s | 从卡片出现到决定；后台卡 30 分钟过期 |
| 安装 → 登录转化 | 记录 | 依赖安装、Rayrun 登录、key 三步的流失 |
| 计费投诉 | 0 | 余额耗尽/销毁造成的支持事件单独跟踪 |
| 每人每周 Rayrun 花费 | 观察 | 用于验证“一人一台”的成本模型 |

---

## 7. 关键假设与风险

| 假设 | 为什么重要 | 如果不成立 |
| --- | --- | --- |
| 平台能提供 session / 常驻 runtime 契约 | “合上笔记本”和“续接”是核心卖点 | 回退到逐次 headless + transcript replay，并明确 UX/成本降级（ADR-007） |
| 审批执行点在 agent 写不到的地方 | “失败即拒绝”才是安全边界，而不只是 UX | 已选平台权限隔离（ADR-001）；平台提供前 v0.1 不带审批执行，只保留同意/审计 |
| 余额护栏可用 | 余额耗尽会 force-destroy 机器与磁盘，是数据丢失风险 | 只能本地预警 + idle stop，无法阻止平台销毁（平台需求 #2） |
| 常开成本可接受 | 一人一台 2 vCPU / 2 GiB 约 ¥57.6/月（写入时的量级） | idle stop、max lifetime 或云端自停策略；产品页必须说清代价（ADR-006） |
| DSH 客户端 API 能表达产品 | 复用聊天与审批 UI 决定客户端成本 | 自建 inbox + transcript/composer，或收窄 MVP（client-plan C-S2/C-S3） |
| 一台机器串行跑 bot 可接受 | 平台同时只允许一个 agent 任务 | 队列延迟成为 UX 问题；需要平台侧 prompt queue |
| desktop 有安全访问路径 | “watch / take over”是产品承诺 | 只给 public 端口警告，或从 v0.1 推迟 takeover（ADR-008） |

安全边界、威胁模型和“不保护什么”以 [`07-security.md`](07-security.md) 为准。

---

## 8. 阶段路线

| 阶段 | 目标 | 关键范围 |
| --- | --- | --- |
| v0.1 | 闭环保通 | 双插件、一台电脑、bot 注册表、续接、审批、成本栏、打包与 A1–A12 |
| v0.2 | 手机上也能批 | 用户自己的 IM bot token（Telegram / Feishu）；无项目方中继；浏览器路径保持可用 |
| v1.0 | 桌面发行版 | 预配置 DSH 发行包（B1）：安装器装好官方 DSH 和两个插件，打开即用；B2 自定义整包更新是升级路径；薄壳不做。设计见 [桌面发行版](design/desktop-distribution.md)（ADR-014） |
| 不计划 | 见 [`plans/roadmap.md`](plans/roadmap.md) “Not planned” | 多租户 SaaS、托管账号、团队/RBAC、市场、移动 App、provider 抽象、转售计费、多区域/SLA |

v0.1 的估算与排序见 [`plans/mvp-plan.md`](plans/mvp-plan.md)；里程碑摘要见
[`plans/roadmap.md`](plans/roadmap.md)。估时是工程判断，不是承诺。v1.0 的桌面发行版
已定为 **B1：预配置 DSH 发行包（bootstrap 安装器）**；B2 自定义整包更新是升级路径，
薄壳不做，见 [桌面发行版](design/desktop-distribution.md) 和
[ADR-014](adr/architecture-decisions.md#adr-014)。它不是 v0.1 承诺。

---

## 9. 已确认的产品决策

| 编号 | 决策 | 理由 |
| --- | --- | --- |
| D1 | 用户自带 Rayrun 账号与 DeepSeek key | 没有项目方控制面，密钥和账单都在用户侧 |
| D2 | 不做项目方托管的账号、代理或中继 | 与“用户付费、用户所有”一致；也避免成为数据/密钥的中间人 |
| D3 | 一人一台云电脑，bots 共享 | 更便宜、更像人的桌面；明确 bots 之间不是安全边界 |
| D4 | Bot 是持久对象，不是一次 session | 名字、指令、记忆、日程和续接是产品核心 |
| D5 | 审批失败即拒绝 | 外部副作用必须等人；超时/未知=拒绝 |
| D6 | 永不自动 destroy | destroy 不可逆；idle 只 stop/pause，销毁必须人类明确请求 |
| D7 | 默认无遥测 | 不收集、不上传；未来的遥测必须 opt-in 且不含 prompt/key/workspace |
| D8 | v0.1 是 DSH 插件 + `dsh web` | 不重写聊天；桌面壳是 v1.0 的可选赌注 |
| D9 | v0.1 只接 Rayrun + DeepSeek | 一个后端做透，不提前做 provider 抽象 |
| D10 | 不做 bot/skill 市场 | 先把运行、审批和成本跑通，不引入双边市场 |
| D11 | v1.0 走 B1 预配置 DSH 发行包 | 用户下载即带好两个插件；DSH 保持官方 updater，B2 只在必须整包签名时升级 |
| D12 | Bots 是默认产品表面 | Rayrun Bot 品牌；打开即进入 Bots，DSH 是宿主；Bots 内不返回 DSH（ADR-017） |

---

## 10. 未决产品决策

这些会改变产品范围或承诺；未决细节见 [`adr/architecture-decisions.md`](adr/architecture-decisions.md)：

- **审批是安全边界还是用户同意？** 已定：平台权限隔离（ADR-001）；平台提供前不实现
  审批执行，审批保持“用户同意/审计”。
- **routines / scheduler 进不进 v0.1？** 架构层写了 scheduler，MVP 计划标 P1，需统一（ADR-009）。
- **“合上笔记本”期间哪些工作继续、计费怎么处理？** 后台审批 30 分钟过期，本地 idle stop 不在运行（ADR-006）。
- **desktop / takeover 的安全路径是什么？** public 端口不能当产品面板（ADR-008）。
- **IM 审批何时做？** v0.2，用户自己的 bot token，无项目方中继。
- **per-bot 成本归因是否进 v0.1？** MVP 计划标 P1。

---

## 11. 文档约定

- 产品方向以本文为准；实现状态以 [`12-status.md`](12-status.md) 为准。
- 根 [`../README.md`](../README.md) 是营销页，不作为事实依据。
- 技术基线以 [`01-system-architecture.md`](01-system-architecture.md) 为准。
- 工作分解与验收以 [`plans/mvp-plan.md`](plans/mvp-plan.md) 为准。
- 架构决策以 [`adr/architecture-decisions.md`](adr/architecture-decisions.md) 为准；ADR-001
  已定（平台权限隔离），ADR-002 等仍是 C/E 相应工作的门槛。
- 用户短答见 [`faq.md`](faq.md)；操作步骤见 [`09-deployment.md`](09-deployment.md)。
