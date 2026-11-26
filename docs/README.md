# Rayrun Bot 文档索引

> 本文件只做导航与约定，不复制项目状态、验收读数或版本号。
> 状态入口：[`12-status.md`](12-status.md)。根 README 是产品页：是什么、给谁、
> 最短安装路径，以及今天能与不能做什么的短述。短述与 12-status 冲突时以 12-status 为准。
> 工程指令：`../CLAUDE.md`。

## 1. 真相源与入口

| 入口 | 负责什么 |
| --- | --- |
| [`../README.md`](../README.md) | 英文产品页。安装和能力短述不替代 12-status |
| [`../README.zh-CN.md`](../README.zh-CN.md) | 中文产品页，与英文同一 commit 更新 |
| [`12-status.md`](12-status.md) | 实现状态的唯一事实源：今天有什么、缺什么、验证到哪一步 |
| [`00-product-direction.md`](00-product-direction.md) | 产品方向：定位、目标用户、v0.1 范围与产品决策 |
| [`01-system-architecture.md`](01-system-architecture.md) | 技术基线：分层、边界、信任模型 |
| [`06-local-state.md`](06-local-state.md) | 本地状态目录、机器布局、原子写与权限 |
| [`07-security.md`](07-security.md) | 安全目标与威胁模型 |
| [`08-integration.md`](08-integration.md) | 依赖契约与 Rayrun 平台需求 |
| [`09-deployment.md`](09-deployment.md) | 安装、运行、配置与故障处理 |
| [`version-matrix.md`](version-matrix.md) | DSH × 依赖 × Rayrun Bot 的兼容范围与已验证组合 |
| [`11-dsh-rayrun-computer-issues.md`](11-dsh-rayrun-computer-issues.md) | `dsh-rayrun-computer` 的契约、错误、API 与安全问题登记 |
| [`plans/mvp-plan.md`](plans/mvp-plan.md) | v0.1 范围、验收任务、工作分解 |
| [`plans/vault-plan.md`](plans/vault-plan.md) | 保险库 / model-invisible 联合设计方案（Proposed） |
| [`adr/architecture-decisions.md`](adr/architecture-decisions.md) | 未决架构决策与 ADR 登记 |
| [`../CLAUDE.md`](../CLAUDE.md) | 编码 agent 的工程指令；不放状态 |

## 2. 文档地图

| 分类 | 文档 | 负责什么 |
| --- | --- | --- |
| 产品与方向 | [产品方向](00-product-direction.md)、[路线图](plans/roadmap.md)、[FAQ](faq.md) | 定位、目标用户、v0.1 范围、里程碑与用户常见问题 |
| 技术基线 | [系统架构](01-system-architecture.md)、[安全](07-security.md)、[本地状态](06-local-state.md) | 分层、边界、状态布局、威胁模型 |
| Bot 与云端 | [Bot 模型](02-bot-model.md)、[云端 bot runtime](04-cloud-host.md)、[审批](05-approvals.md) | bot 定义、队列/session、审批语义 |
| 客户端与设计 | [客户端设计](03-client-design.md)、[UI 设计](design/ui-design.md)、[Bot 人格](design/bot-persona.md)、[桌面发行版](design/desktop-distribution.md)、[mockups](mockups) | 表面、RPC、视觉规范、bot 身份、v1.0 桌面 B1/B2 方案 |
| 计划与验收 | [MVP 计划](plans/mvp-plan.md)、[Vault 方案](plans/vault-plan.md)、[v0.1 验收记录](plans/v0.1-acceptance.md)、[客户端计划](plans/client-plan.md) | v0.1 工作分解、Vault 联合设计、A1–A12 当前证据与缺口、客户端交付 |
| 平台集成 | [集成与平台需求](08-integration.md)、[dsh-rayrun-computer 问题登记](11-dsh-rayrun-computer-issues.md) | 依赖契约、平台能力与优先级；依赖自身问题的证据、workaround 与上游修复方向 |
| 状态与验证 | [实现状态](12-status.md)、[Rayrun 验证与缺口](10-rayrun-verification.md) | 实现状态事实源；测试资源政策、Rayrun 验证路径、缺口登记 |
| 部署与操作 | [部署与运行](09-deployment.md)、[版本矩阵](version-matrix.md) | 安装、配置、检查、故障处理；DSH × 依赖 × 包的已验证组合 |
| 调研 | [灵感](research/inspiration.md) | Grok Bot 等参考；不是真相源 |
| 决策 | [架构决策](adr/architecture-decisions.md) | [ADR-001–ADR-020](#3-adr-登记册)；下一个可用 ADR-021；只有 Accepted / Decided 才算最终 |

`00`–`12` 是编号顶层文档；`plans/`、`adr/`、`design/`、`research/` 放细节，
`mockups/` 放视觉素材。`00`/`01` 分别是产品与技术的第一真相源；`12` 是实现状态的
唯一事实源；其余编号文档是各自领域的规范。

## 3. ADR 登记册

> 状态取 `Proposed` / `Accepted` / `Decided`；`Open` 表示还没有提案。本表只登记，
> 决策细节、证据和修订以 [architecture-decisions.md](adr/architecture-decisions.md)
> 为准。**下一个可用编号：ADR-021。** 编号一旦占用不再复用。

| 编号 | 标题 | 状态 | 文件 |
| --- | --- | --- | --- |
| ADR-001 | 审批在哪里执行 | Decided（2026-11-21，平台权限隔离；2026-11-23 由 ADR-019 窄化） | [architecture-decisions.md](adr/architecture-decisions.md#adr-001) |
| ADR-002 | 所有权矩阵与单写者规则 | Proposed | [architecture-decisions.md](adr/architecture-decisions.md#adr-002) |
| ADR-003 | 基于 Rayrun 文件 API 的控制通道协议 | Proposed | [architecture-decisions.md](adr/architecture-decisions.md#adr-003) |
| ADR-004 | 与 `dsh-rayrun-computer` 的契约 | Proposed | [architecture-decisions.md](adr/architecture-decisions.md#adr-004) |
| ADR-005 | 副作用执行语义 | Proposed | [architecture-decisions.md](adr/architecture-decisions.md#adr-005) |
| ADR-006 | “合上笔记本”意味着什么 | Proposed | [architecture-decisions.md](adr/architecture-decisions.md#adr-006) |
| ADR-007 | 常驻 bot runtime 的凭据与 DSH profile 模型 | Proposed | [architecture-decisions.md](adr/architecture-decisions.md#adr-007) |
| ADR-008 | Desktop 访问路径 | Proposed | [architecture-decisions.md](adr/architecture-decisions.md#adr-008) |
| ADR-009 | Routines / scheduler 范围 | Accepted（2026-11-23；cloudHost dev live 2026-11-24） | [architecture-decisions.md](adr/architecture-decisions.md#adr-009) |
| ADR-010 | RPC 路由与信封 | Proposed | [architecture-decisions.md](adr/architecture-decisions.md#adr-010) |
| ADR-011 | 审批 schema 与 canonical action hash | Accepted（2026-11-22） | [architecture-decisions.md](adr/architecture-decisions.md#adr-011) |
| ADR-012 | 恢复与运行语义 | Proposed | [architecture-decisions.md](adr/architecture-decisions.md#adr-012) |
| ADR-013 | 文档清理 | Proposed | [architecture-decisions.md](adr/architecture-decisions.md#adr-013) |
| ADR-014 | 桌面发行版与更新单元 | Accepted（2026-11-21，B1） | [architecture-decisions.md](adr/architecture-decisions.md#adr-014) |
| ADR-015 | 云端 bot runtime 层 | Proposed（v0.1） | [architecture-decisions.md](adr/architecture-decisions.md#adr-015) |
| ADR-016 | 本地 bot 控制面 | Proposed（v0.1） | [architecture-decisions.md](adr/architecture-decisions.md#adr-016) |
| ADR-017 | Bots 作为默认产品表面 | Accepted（2026-11-21） | [architecture-decisions.md](adr/architecture-decisions.md#adr-017) |
| ADR-018 | 文档事实源与语言 | Accepted（2026-11-22） | [architecture-decisions.md](adr/architecture-decisions.md#adr-018) |
| ADR-019 | 审批执行权威 | Accepted（2026-11-23，本地 DSH host） | [architecture-decisions.md](adr/architecture-decisions.md#adr-019) |
| ADR-020 | 云电脑是 agent 的安全容器，容器内 `danger-full-access` | Accepted（2026-11-26，用户决定） | [architecture-decisions.md](adr/architecture-decisions.md#adr-020) |

**ADR-019 已定（本地 DSH host 审批/执行）；ADR-020 明确云电脑是 agent 的安全容器，
容器内 `danger-full-access` 是有意设计，审批只覆盖 typed 的离开容器动作；ADR-001 的
平台隔离仍只用于云端凭据动作。** ADR-015/016、
ADR-002 等仍决定控制面/执行面的分层与产物所有权，未定前相应 C/E 工作流不动工。
ADR-014 已定为 B1，属于 v1.0，不阻塞 v0.1。

## 4. 进行中的计划

> 本表只登记仍未收口的计划；完成度、验收证据和状态以各文件头与正文为准，本表不复制。

| 计划 | 未闭合项 | 详情 |
| --- | --- | --- |
| [MVP 计划](plans/mvp-plan.md) | A1–A12 验收、B/C/D/E 工作流 | §2、§5、§6 |
| [客户端计划](plans/client-plan.md) | C-S1–C-S6 spike 与客户端接线 | Week 0、交付波次 |
| [集成与平台需求](08-integration.md) | 会话/常驻 runtime、余额护栏 | §3 |
| [架构决策](adr/architecture-decisions.md) | ADR-001–ADR-019 | 本文 §3 |

## 5. 文档约定

- **真相源优先级**：产品方向 → `00-product-direction.md`；实现状态 → `12-status.md`；
  技术基线 → `01-system-architecture.md`；安全 → `07-security.md`；范围与验收 →
  `plans/mvp-plan.md`；未决架构 → `adr/architecture-decisions.md`；导航 → 本文件。
  文档冲突时按此顺序回落。根 README 的产品短述与 `12-status.md` 冲突时以
  `12-status.md` 为准。
- **分类**：`plans/` 记“为什么这么做、怎么做”；`adr/` 记不可轻易逆转的决策；
  `design/` 记视觉、交互与人格；`research/` 是调研材料，不是真相源；
  `09-deployment.md` 记“怎么跑起来”。
- **语言**：`docs/` 全部用中文（技术标识、代码、schema、UI 文案保持英文）；根
  README 是英中双语产品页，英文为准并维护中文镜像；代码、注释、接口命名和提交信息
  用英文。
- **新增文档**：先在本文件 §2 加一行；新增决策在 §3 加一行，并把“下一个可用编号”
  加一；新增未收口计划在 §4 加一行。
- **链接**：Markdown 链接必须可解析；相对链接以本文件所在目录为基准。
- 本文件不复制状态、验收读数或版本号；这些只出现在各自的真相源中。
- 以上事实源与语言约定由 [ADR-018](adr/architecture-decisions.md#adr-018)（2026-11-22）决定。
