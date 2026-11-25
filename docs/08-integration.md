# 08 — 集成与平台需求

> 状态：2026-11-25。本文定义与 `dsh-rayrun-computer` 的依赖边界，以及 Rayrun 平台
> 需要补的能力和优先级。技术基线见 [`01-system-architecture.md`](01-system-architecture.md)；
> 云端 bot runtime 见 [`04-cloud-host.md`](04-cloud-host.md)；未决决策见
> [`adr/architecture-decisions.md`](adr/architecture-decisions.md)。
> 本文是 handoff 清单；状态以 [`12-status.md`](12-status.md) 与各平台文档为准。

## 0. 与现有文档的关系

| 文档 | 负责什么 |
| --- | --- |
| [`01-system-architecture.md`](01-system-architecture.md) | 分层、依赖边界、信任模型 |
| [`04-cloud-host.md`](04-cloud-host.md) | 云端 bot runtime 如何使用这些能力 |
| [`05-approvals.md`](05-approvals.md) | 文件控制通道的审批部分 |
| [`06-local-state.md`](06-local-state.md) | 本地/机器文件布局 |
| [`11-dsh-rayrun-computer-issues.md`](11-dsh-rayrun-computer-issues.md) | 依赖自身的问题登记；本文只列需求，不重复具体问题 |
| [`adr/architecture-decisions.md`](adr/architecture-decisions.md) | ADR-003（控制通道）、ADR-004（依赖契约）、ADR-007（常驻 bot runtime） |

---

## 1. 依赖边界

`dsh-rayrun-computer` 是**独立项目**（`RayrunOS/dsh-rayrun-computer`，MIT），不是本仓库
的代码：

- 本仓库通过它已发布的 tools/RPC 表面和版本契约消费它；
- **不修改、不 fork、不 vendor、不复制**它的代码；
- 需要它改行为 → 去它的仓库提 issue/PR，或在本仓库写 adapter；
- 安装：两个包都已发布到 npm；S6 已验证一条 `dsh plugin add` 安装两个包会同时
  启用两个 bundle，而单包声明依赖不会自动启用依赖 bundle；这不是依赖接口问题；
- 本地控制面调用依赖的接口方式（service injection / host RPC / adapter）与 bot
  runtime 的 worker-projection 落地方式，都是 **ADR-004**；未定前 C1/D1 不应动工。

**版本检查**：host 启动时记录依赖版本；缺失/过旧返回 `E_DEP_MISSING` /
`E_DEP_VERSION`，并给一句可执行的安装提示。不要静默降级。

依赖自身在集成中暴露的问题（契约、错误文案、API 缺口、安全边界）登记在
[`11-dsh-rayrun-computer-issues.md`](11-dsh-rayrun-computer-issues.md)；本文只描述
“需要它具备什么能力”，不重复问题证据。

---

## 2. 本地控制面与 bot runtime 对依赖的要求

| 能力 | 用途 | 关键问题 |
| --- | --- | --- |
| 机器 ensure/start/stop | 创建/停止用户的云电脑 | 是否复用 `sandboxName`；幂等 |
| `exec` | 启动 runtime、watchdog、健康检查 | 超时/退出码/输出上限 |
| 文件 read/write/list | 队列、审批、outbox、镜像 | 原子写/ETag/分页/大小上限 |
| agent prompt + SSE | 发任务、流式回复 | session id、取消、`409 sandbox_busy` |
| session create/continue | bot 续接 | 平台不提供 session 对象；bot host 自己写 `/workspace`（R-G008 已实现并本机 dev 全量验收通过；生产 `5c2ff48` 已含 gaps，`/v1/runtimes` 未认证 401；`dsh-bot@1` + hosted cloudHost 聊天 E2E 已通过 `PROD_OK`） |
| credential 注入状态 | 确认模型 key 已注入 | runtime boot 时注入；runtime restart 不刷新，轮换需 sandbox stop→start（ADR-007） |
| balance/usage | 成本栏 | 余额、机器小时；per-sandbox 是 beta |
| worker projection | 把 bot runtime ship 到机器并启动 | 扩展点、hash、启动/重启 |

前几项由**本地控制面**通过依赖的 tools/RPC 调用；`worker projection` 是 **bot
runtime** 的落地路径。在常驻 runtime 路径下，session/agent 由 bot runtime 直接管理；
依赖的 `agent prompt` / `session` 能力是本地控制面的兼容/回退路径。契约要写清：名称、
输入、输出、错误码、是否使用 Rayrun token、启动顺序、版本协商。如果依赖没有相应表面，
adapter 放在我们的包里，不改依赖。

---

## 3. 阻塞 v0.1 的平台能力

### 3.1 Session 与常驻 runtime 契约（P0）

今天（2026-11-21 记录）：一台机器一次只跑一个 agent 任务（`409 sandbox_busy`，不
排队）；文档没有说 session id 能否跨 prompt 创建/续接；机器进程是否跨 stop/start
存活、是否有 startup hook，都没有文档。

需要：

1. 按 id 创建/续接 session 的契约；
2. 在机器内运行受监督的常驻进程：启动命令、重启策略、stop/start/reboot 行为；
3. startup hook 或平台 supervisor，让 bot runtime 在机器重启后回来。

为什么：bot↔session 映射和“合上笔记本继续工作”是产品核心。

没有它时的回退：逐次 headless + transcript replay（更慢、更贵），以及本地 watchdog
通过 `exec` 重启 host。

**Rayrun 答复（2026-11-22）。** 平台侧 R-G008 已实现并本机 dev 全量验收通过（`rayrun` 仓库
`rayrun-bot-gaps`，`4709ac0`），并已于 2026-11-24 部署到生产 `5c2ff48`
（build 493，tag `prod-20261124-2`），包含 gaps；生产 `/v1/runtimes` 已注册
（未认证 401）。`dsh-bot@1`（guestd 0.6.0）已发布，hosted 用户租户 cloudHost
聊天 E2E 已通过（`PROD_OK`）；生产 routine E2E 已通过（`CLOUD_ROUTINE_PROD_OK`，2026-11-24）。初步支持的契约：

- `PUT/GET/POST/DELETE /v1/sandboxes/{id}/runtimes[/{name}]`；spec 包含 `argv`、
  `workdir`、`env`、`credentials`、`restart`、`autostart`、`keep_alive`、
  `stop_signal`、`stop_timeout_seconds`。
- guestd 0.6.0 监督常驻进程：崩溃按 1s→60s 退避重启；sandbox `stop → start` 后
  `autostart=true` 自动拉起；daemon 重启后重连并幂等同步；Paused/Resume 保留现场；
  `keep_alive=true` 不被 idle sweeper 自动 stop。
- **session 不是平台对象。** bot host 自己把 session/transcript 写到 `/workspace`
  （tmp + rename + fsync）；平台保证 workspace 跨 stop/start 保留。session
  create/continue 在 bot 进程内实现。
- `credentials` 必须是沙箱创建时已绑定的凭证名子集；值只在 boot 注入，runtime
  restart 不刷新；轮换需 sandbox `stop → start`；`argv` 不得放秘密。
- 旧镜像（guestd < 0.6.0）调用 runtimes 返回 `409 guestd_outdated`。目标环境需部署
  新 daemon + `builder@1`，bot 用 `POST /v1/builds` 构建含 guestd 0.6.0 的自定义镜像；
  平台不接收本地 rootfs。
- 验收：PUT 后 Running；sandbox stop→start 后 runtime 自动 Running、session 文件还在；
  kill runtime 后按 restart 策略回来；凭证 env 注入但日志无明文；`keep_alive` 不被
  idle 停；旧镜像 409；daemon 重启后 GET 仍 Running。
- 2026-11-22 本机 dev 全量验收（dev daemon HEAD `648f6c5`，测试机 `rayrun-bot`，镜像
  `dsh-bot-devcheck@1`/guestd 0.6.0）：PUT runtime 后 Running；runtime 内
  `DEEPSEEK_API_KEY` 存在（heartbeat `credential=set`，未打印值）；sandbox
  stop→start 后 autostart；`kill -9` 后重启、restarts=1；DELETE 后清空。`keep_alive`
  在 `rayrun-bot-idle`（60s idle）上等 150s 机器仍 Running，删除 runtime 后约 240s
  自动 Stopped。dev daemon 2026-11-22 23:28:36 +08:00 重启后，`rayrun-bot` 上的
  `daemon-restart-probe` 仍 running（pid 不变、restarts=0）。测试后机器 stop，未
  destroy。旧镜像负测：`rayrun-bot-old`（`ci@1`，guestd 0.5.0）GET `/runtimes` →
  200 `{"runtimes":[]}`，PUT → 409 `{"error":"guestd_outdated"}`。
- 前提与时间：生产部署 + 联合验收约 2–3 天，需我方授权；bot 侧 host/session 实现是
  本仓库的工作量。

**依赖侧（2026-11-22）。** `dsh-rayrun-computer` 1.2.0 的
`runtime.*` host RPC（main `fe965c1`，2026-11-22 合入；CI run 45041519563 在 Node
22/24 全绿；未发布 npm）提供：
`runtime.put/list/get/start/stop/restart/delete`。spec 字段与平台一致；sandbox 必须
已存在，绝不创建或唤醒；`credentials` 只接受绑定名；`guestd_outdated`、
`sandbox_paused`、`sandbox_not_running`、`runtime_not_found`、`runtimes_unavailable`
等错误码透传。Bots 侧客户端 `lib/runtime-rpc.js` 已有 fake-fetch 测试（5/5），
依赖侧契约测试 12/12；2026-11-22 在临时 DSH profile + scoped dev token 上做了
live 联调：`rayrun-bot` 启动后 `put → running`、`get/list`、`delete → null`，测试后
机器 stop。已接入 cloud host adapter（预览）；adapter 页面 E2E 已通过（2026-11-23，`HOST_E2E_OK`）。

审批隔离不在这个初步支持范围内，见 §3.3。

### 3.2 余额宽限与 spend 护栏（P0）

今天：余额耗尽会 force-destroy 组织内所有沙箱，包括磁盘；只有 `max_lifetime_seconds`，
且只停不重启；没有 spend cap。

需要：零余额时 suspend 而不是 destroy、低余额事件/通知、按沙箱或账号的预算上限。

为什么：24/7 bot 丢 workspace 是数据丢失和支持灾难，不只是账单事件。

回退：本地余额轮询、警告、idle stop；无法阻止 force-destroy。

期望形状：`balance.low` / `sandbox.suspended` 事件、destroy 前宽限期、每机器 budget
字段。

### 3.3 Host/agent 权限隔离与云端审批端点（P0，ADR-001；本地路径见 ADR-019）

今天：云镜像以 root 运行，worker profile 是 `danger-full-access`；host 与 agent 同
用户、同工作区、同凭据面。任何放在 `/workspace/.rayrun/.../approvals/` 的文件邮箱都
能被 agent 读写；agent 可以读 nonce/id 并写一个匹配的 decision 自批。唯一文件名、
tmp+rename 和 checksum 只防半写，不防伪造。

需要：

1. 每沙盒一个 host runtime 身份（不同 UID 或 mount namespace），agent 不能读写 host
   的状态、队列、审批目录和密钥；
2. 平台审批端点或 host-only 通道：人类决定只进入隔离侧，agent 只能提交提案；
3. 受控动作需要的凭据只在 host 侧可用，agent 不可读。

为什么：ADR-001（2026-11-21）仍要求云端凭据动作由平台隔离/端点保护。ADR-019
（2026-11-23）已把**凭据/执行器在本地的 typed 动作**改为本地 DSH host 审批并执行；
这不解决云端凭据动作，也不使云端 agent 可信。

回退：云端凭据动作继续不执行，云端 bot 保持 `approval: never`；本地 typed 动作走
ADR-019 的本地 executor。状态文档必须分别写明两者的边界，不能声称审批阻止了被攻陷
的 bot。

期望形状：host runtime 以独立身份启动；平台提供 host-only 的审批/决定 API；agent
进程无法读取 host 状态目录或凭据；决定带 id、botId、actionId、nonce、actionHash 和
TTL（schema 见 ADR-011）。

**Rayrun 答复（2026-11-22）。** 同一沙箱内不能做隔离：runtime 与 agent 共享 root，
agent 可读 `/proc/<pid>/environ`，放在沙箱里的任何 token/key 都可能被拿走；R-G011
只收窄 scope，不创造信任域。平台 host-only 审批端点需要新 ADR（host principal 如何
认证、agent 如何不能冒充、凭据放哪），约设计 1 周 + 实现 2–4 周，**不属于初步支持，
也不属于 R-G011**。

平台建议的最小路径已被本项目采纳（ADR-019，2026-11-23）：审批权威放在 agent
沙箱之外——本地 DSH；agent 只提案，本地 host 持有 Rayrun token 并决定/执行受限的
typed 动作。这样不需要新增平台审批端点，用现有 API 即可；代价是本地 DSH 不在线时
审批等待。首版覆盖机器的 start/stop/pause/resume；云端提案 bridge 已 live（结构化
block → host 解析写 proposal → 本地 `rayrun_files` 导入 → 真实 start/stop、denial/
Continue、pause/resume → 下一轮结果 context）；云端凭据动作仍需平台隔离。

验收：从 agent 进程读写 host 审批目录和凭据失败；agent 伪造的 decision 被执行方拒绝
并记录；用户决定经平台端点到达 host；超时/未知状态拒绝。证据记录在
[`10-rayrun-verification.md`](10-rayrun-verification.md) 或平台答复记录中。

本地 typed 动作不走这个平台端点，其验收见 [`12-status.md`](12-status.md) 和
[`05-approvals.md`](05-approvals.md) §9；平台隔离仍只用于云端凭据动作。

---

## 4. v0.1 质量项

### 4.1 文件控制通道语义（P1）

今天：用 workspace 文件做审批/控制邮箱，每 3 秒轮询。

需要：原子写/rename 语义、下载 revision/ETag、list 分页、文档化限流；或下面的消息
通道。

为什么：读到半写的审批文件是正确性 bug；轮询有请求预算。

回退：唯一文件名、write-then-rename、payload 内 checksum。**注意 checksum 只防损坏，
不防伪造**；ADR-019 已把本地决定/执行移出 agent 可写区，云端文件仍不是授权边界，见
[`05-approvals.md`](05-approvals.md) §2。

### 4.2 出站控制通道（P1，推荐）

需要：本地认证的订阅通道（SSE/WebSocket），云端可发布，无入站网络，按序投递、
at-least-once、有限流。

为什么：替代文件轮询，降低审批/状态延迟，同时保持“无公网入站”。

回退：上面的文件邮箱。

### 4.3 动态调整资源（P1）

今天：`dsh-rayrun-computer@1.0.0` 只在创建时设置 `cpu_cores` / `memory_mb`
（`POST /v1/sandboxes`）；`machine.action` 只有 start/stop/pause/resume/rename。
2026-11-21 对公开 API 的探测没有找到调整入口：`PATCH` / `PUT /v1/sandboxes/{id}`、
`POST /v1/sandboxes/{id}/resize`、`POST /v1/sandboxes/{id}/update`、
`PUT` / `PATCH /v1/sandboxes/{id}/spec`、`GET /v1/sandboxes/{id}/resources` 都返回
404。控制台是否另有入口需要 Rayrun 确认。

需要：对已有沙盒调整 vCPU / memory，保留 `/workspace`、rootfs 和已安装的
DSH/profile/插件；至少支持 stop → resize → start，最好支持运行中调整。调整后
`GET /v1/sandboxes/{id}` 立即反映新规格；计费从调整时刻按新规格计算。异步时返回
job/status，不靠调用方轮询猜测。

为什么：一台电脑由一个人的所有 bot 共享，负载会变。没有 resize 时，省成本只能
新建一台目标规格的机器并重装，丢失已安装状态；规格选大了只能一直付费，选小了
只能重建。这是“用户付费、用户所有”下的成本控制要求。

回退：创建时选对规格；需要变更时新建机器，重新安装 DSH/profile/插件。不得为了
省成本自动 destroy 旧机器。

期望形状：

```http
PATCH /v1/sandboxes/{id}
{ "cpu_cores": 2, "memory_mb": 4096 }
```

或等价的 `POST /v1/sandboxes/{id}/resize`；接受 stopped 状态；返回 machine 或 job。
约束：remote desktop 至少 2048 MB；保留磁盘；不改变 sandbox id；文档化升降配的
最小/最大规格和计费规则。

验收：一台 2C/4G 沙盒 stop 后改成 4C/16G，start 后 `GET` 返回 4/16384，`/workspace`
里的文件和已安装 DSH/profile 仍在；再改回 2C/4G，sandbox id 不变；账单按新规格计费。
插件侧随后加 `machine.resize` RPC/tool，Bots 的机器卡提供带确认的规格调整（计费）。

---

## 5. v0.2 / beta

- **安全入站**：每实例主机名与证书、token/gateway 认证、WebSocket/SSE 透传。今天
  ingress 的 token 层不可用（403），只有 `public`；不作为产品面板。阻塞远程 UI、
  手机审批和跨设备 takeover。
- **Scoped credentials**：只限 sandbox CRUD + prompt 的 API token/device flow，可命名、
  可过期、可吊销，不带 billing/org 权限。今天持有账号 token。
- **通用 secret injection**：模型槽位之外的 GitHub/IM/SaaS token，注入机器且 `exec`
  不可读。
- **机器生命周期事件**：started/stopped/failed、低余额；webhook 或 SSE。
- **Per-sandbox usage**：按沙箱的 `vm_hours`/egress 时间序列，支持 per-bot 成本。
- **Prompt queue**：平台侧排队，替代 `409 sandbox_busy`，让多个 bot 优雅串行。
- **Golden image 与 DSH 版本**：官方镜像带当前 DSH（镜像为 `0.2.0-rc.2`，本地页面
  验证基线为 `0.2.2-rc.5`），文档化版本矩阵（[`version-matrix.md`](version-matrix.md)），
  可选镜像构建/固定。

---

## 6. 后期 / 企业（不属于 OSS MVP）

SSO/SAML/SCIM、组织 RBAC、审计导出/SIEM、DPA 与数据驻留、marketplace/agent API、
多区域与 SLA。只有出现企业版时才重新考虑。

---

## 7. API 卫生

- 版本化 API，发布 OpenAPI 作为真相源，维护 changelog 与弃用策略。今天不同页面
  endpoint 数不一致（67 vs 93）。
- 错误码字典、文档化限流、`Retry-After`。
- 确认或标记 beta：运行时 `PUT /egress`、任意端口 ingress、PTY `/terminals`、
  image builds 在 2026-11-01 测试中都“文档有、实际不可用”。

---

## 8. 优先级总表

| 需求 | 需要时间 | 今天阻塞发布？ |
| --- | --- | --- |
| 1. session + 常驻 runtime 契约 | v0.1 | 平台侧已实现并本机 dev 全量验收；2026-11-24 已部署生产 `5c2ff48`；`dsh-bot@1` + hosted 用户租户 cloudHost 聊天 E2E 已通过 `PROD_OK`；生产 routine E2E 已通过（`CLOUD_ROUTINE_PROD_OK`，2026-11-24） |
| 2. 余额宽限 / 护栏 | v0.1 | 风险接受并警告 |
| host/agent 权限隔离 + 云端审批端点（§3.3） | v0.1 | 云端凭据动作是（ADR-001）；本地 typed 动作已按 ADR-019 解阻 |
| 3. 文件通道语义 | v0.1 | 否（有 workaround） |
| 4. 出站控制通道 | v0.1 质量 | 否（轮询） |
| 5. 动态调整资源（resize） | v0.1 质量 | 否（创建时选规格） |
| 安全入站 | v0.2 | 否 |
| Scoped credentials | v0.2 | 否 |
| secret/生命周期/usage/queue/image | beta | 否 |
| 企业项 | later | 否 |

---

## 9. 错误码与版本

| 场景 | 码 |
| --- | --- |
| 依赖缺失 | `E_DEP_MISSING` |
| 依赖版本不匹配 | `E_DEP_VERSION` |
| 缺少 Rayrun token | `E_TOKEN_REQUIRED` |
| 缺少 DeepSeek key | `E_KEY_REQUIRED` |
| 机器停止 | `E_MACHINE_STOPPED` |
| 机器忙碌 | `E_MACHINE_BUSY` |
| bot runtime 不可用 | `E_HOST_DOWN` |

完整错误表见 [`plans/mvp-plan.md`](plans/mvp-plan.md) §4.3；响应不得携带 token 或 key。

---

## 10. 未决项

| 问题 | 影响 | 决策 |
| --- | --- | --- |
| 依赖接口 / worker projection | C1/D1 能否开工 | ADR-004 |
| 常驻 bot runtime 的凭据注入 | “合上笔记本” | ADR-007 |
| 文件通道的双写/CAS | 队列与审批 | ADR-003 |
| 审批执行点 | E1–E7、A6/A7 | ADR-001：已定（平台权限隔离）；需求见 §3.3 |
| 安全入站 | desktop/手机审批 | v0.2 平台需求 |
| 已有沙盒的 resize API | 成本与规格调整 | 待 Rayrun 确认；没有时新建机器 |
| 版本矩阵与一次安装 | 发布路径 | 两个包已发布到 npm；S6 已验证（2026-11-24，一条命令装两个包）；`dsh-rayrun-bots` 走 OIDC Release 发布 |

---

## 11. 相关文档

- [`01-system-architecture.md`](01-system-architecture.md)
- [`04-cloud-host.md`](04-cloud-host.md)
- [`05-approvals.md`](05-approvals.md)
- [`06-local-state.md`](06-local-state.md)
- [`10-rayrun-verification.md`](10-rayrun-verification.md)（验证/测试缺口登记）
- [`adr/architecture-decisions.md`](adr/architecture-decisions.md)
