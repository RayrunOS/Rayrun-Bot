# 05 — 审批

> 状态：2026-11-23。本文定义“什么需要审批、谁来执行、失败怎么拒绝、决定怎么绑定
> 动作”。ADR-019（2026-11-23）把**本地 DSH host** 定为凭据/执行器在本地动作的审批
> 权威与执行方；云端 bot 只提案。ADR-001 的平台隔离仍用于凭据只在云端、必须云端
> 执行的动作。技术基线见 [`01-system-architecture.md`](01-system-architecture.md)；
> 云端 bot runtime 见 [`04-cloud-host.md`](04-cloud-host.md)；本地状态见
> [`06-local-state.md`](06-local-state.md)；威胁模型见
> [`07-security.md`](07-security.md)；未决决策见
> [`adr/architecture-decisions.md`](adr/architecture-decisions.md)。
> 实现状态以 [`12-status.md`](12-status.md) 为准。
>
> **实现状态（2026-11-23）：** 协议后端与 `approvals.list/get/decide/propose/sync`
> RPC 已实现；本地 typed 执行器允许 `rayrun.machine.start/stop/pause/resume`，
> 批准后在本机使用 Rayrun token 执行，先写 `executing` claim，再写结果与审计。云端
> proposal bridge 已接：cloud host 解析 bot 回复末尾的结构化 `rayrun-approval` block
> （`propose.mjs` 为可选 shell 路径），本地用 `rayrun_files` 导入并去重；结果写回
> `approval-results/`，机器停机时先落本地 outbox。客户端真实
> 卡片已接入。真实 cloud proposal → 本地 sync → Allow/Deny → 真实
> start/stop/pause/resume、denial 与 Continue → 停机 outbox → 重启补传，以及下一轮
> 结果 context 已 live 通过（2026-11-23）；其他动作类型和云端凭据动作尚未验证；
> host-only `approvals.propose` 仍作为本地/测试 seam。

## 0. 与现有文档的关系

| 文档 | 负责什么 |
| --- | --- |
| [`01-system-architecture.md`](01-system-architecture.md) | 审批在系统中的位置与信任边界 |
| [`03-client-design.md`](03-client-design.md) | 审批卡 UI、状态与失败文案 |
| [`04-cloud-host.md`](04-cloud-host.md) | 队列如何进入 `waiting_approval`、执行与恢复 |
| [`06-local-state.md`](06-local-state.md) | request/decision 文件、目录、原子写与审计 |
| [`07-security.md`](07-security.md) | 威胁模型与“不保护什么” |
| [`plans/mvp-plan.md`](plans/mvp-plan.md) | E1–E7 工作项与 A6/A7/A11 验收 |
| [`adr/architecture-decisions.md`](adr/architecture-decisions.md) | ADR-001（执行点）、ADR-005（副作用）、ADR-011（schema） |

---

## 1. 原则

- **审批优先，失败即拒绝。** 任何有外部副作用的动作先请求、后执行；超时、错误、
  未知状态一律拒绝，绝不继续。
- **需要 yes**：花钱、以用户身份发送或发布、销毁电脑、触碰另一台机器或凭据。
- **不需要 yes**：读写自己的工作区、在自己电脑内跑命令、调用模型。
- **默认拒绝**：无人回答、面板关闭、文件缺失/损坏、非预期来源都是 no。
- **审批永不自己回答**：没有“永远允许”、没有默认放行、没有自动重试绕过。
- **撤销即时**：停 bot、停电脑、或在 Rayrun 控制台吊销 token。
- **在凭据所在处执行，在人类所在处审批。** 本地 host 持有 Rayrun token 并执行本地
  动作；云端只提交提案。
- **审批不是安全沙箱**：它降低误操作和被 prompt injection 的风险；云端 agent 仍在
  自己的 workspace 内以 `danger-full-access` 运行，多 bot 仍共享机器。ADR-019 只
  保护需要本地凭据/执行器的 typed 动作；平台隔离仍是云端凭据动作的长期前提
  （ADR-001/019）。

## 2. 信任边界（必须先读）

ADR-019 的本地权威模型：

- **云端只写提案。** 云端 bot 在回复末尾输出结构化 `rayrun-approval` block；cloud
  host 解析后写 `bots/<id>/proposals/`（`propose.mjs` 保留为可选 shell 路径）。
  proposal 是请求，不是授权。云端 agent 可以读、改、重放或伪造 proposal，因此本地
  bridge 必须把它当不可信输入重新校验。
- **决定只在本地。** 本地 host 生成 request id、nonce、actionHash 和 risk，用户决定
  写本地 `res-<id>.json`；云端写来的 decision 一律忽略。
- **执行只在本地。** 本地 executor 持有 Rayrun token，按 typed allowlist 执行；token
  不进入 action、RPC 响应、日志或页面。批准后先写 `executing` claim，再执行。
- **本地不在线就等待。** 本地 DSH 不在线时，chat 审批等待，background 按 TTL 过期
  拒绝；没有后台自动批准。
- **不是沙箱。** 云端 agent 仍能在自己的 workspace 内任意运行，能写/改提案，也能绕过
  自己的工具；本机制只保护“需要本地执行的动作”。它不是每 bot 隔离，不使被攻陷的
  agent 变得可信。
- **云端凭据动作仍等待平台。** 凭据只在云端、必须云端执行的动作，在平台提供
  host/agent 隔离或 host-only 端点前继续不执行（ADR-001 仍适用）。

**当前验证：** 真实云端 bot 提案 → 本地导入 → Allow/Deny → 真实
start/stop/pause/resume、denial 与 Continue → 停机 outbox → 重启补传、下一轮结果
context 已 live 通过（2026-11-23）。其他动作和云端凭据动作仍未验证；host-only
`approvals.propose` 只作为本地/测试 seam。

## 3. 流程

1. **提案**：云端 bot 在回复末尾输出结构化 `rayrun-approval` block；cloud host 解析
   并写 `bots/<id>/proposals/`（`propose.mjs` 是可选 shell 路径）。本地 host 通过
   `rayrun_files` 导入，重新校验 typed action，生成 request：本地 id、botId、actionId、
   nonce、actionHash、action、risk、origin、createdAt、expiresAt。host-only
   `approvals.propose` 保留为本地/测试 seam。
2. **送达**：request 写入本地 approval store；云端不持有 request/decision 的授权。
3. **卡片**：客户端读取 `approvals.list/get`，显示结构化字段；Deny / Allow once。
   卡片内容不信任机器提供的 HTML/markdown。
4. **决定**：用户决定写本地 `res-<id>.json`；重复决定按 id 幂等，第一个有效决定赢。
5. **执行**：approved 后本地 executor 校验 action allowlist、目标、TTL 与 claim；
   写 `exec-<id>.json` 的 `executing` 状态，然后调用本地 Rayrun RPC。失败不自动重试。
6. **完成**：写 execution 结果与 audit 行；客户端显示真实状态。结果写回云端
   `bots/<id>/approval-results/<id>.json`；机器停机时先落本地 outbox，下次 Running
   时补传。下一次 bot turn 的 prompt 还会带上最近审批结果（kind/target/state/
   execution/status），避免依赖 shell 读文件。失败给稳定错误码与一句可读信息，不假成功。

**TTL**：

- background（routines/后台任务）：30 分钟后过期即拒绝。本地 routine 轮次把
  `origin: routine` 传到 cloud task，cloud host 写出的提案标为 `background`。
- chat（用户刚发起的对话）：不设计时，一直等待；面板关闭不等于同意；本地 DSH 不在线
  时也不会自动执行。
- 过期/未知/损坏：拒绝，不重试为“已批准”。

## 4. 文件与本地状态

| 文件 | 写者 | 读者 | 规则 |
| --- | --- | --- | --- |
| 云端 `proposals/<id>.json` | cloud host（解析结构化 block；`propose.mjs` 可选） | 本地 bridge（`rayrun_files`） | 不可信输入；不是授权；本地重新校验并生成 request |
| `approvals/req-<id>.json` | 本地 host（提案 seam/bridge） | 本地控制面 | 本地生成 id/nonce/hash/risk；原子写；不覆盖 |
| `approvals/res-<id>.json` | 本地控制面（用户决定） | 本地 executor | 只在本地；每个 id 一个决定；重复按 id 幂等 |
| `approvals/exec-<id>.json` | 本地 executor | 本地控制面 | 先写 `executing` claim；结果 `done`/`failed`；不自动重试 |
| 本地 `approval-results/` outbox | 本地 host | 本地 bridge | 结果先落本地；机器 Running 时上传并删除 |
| `logs/audit.log` | 本地 host | 用户/支持 | 只追加；不记录 action payload、token 或 key |

- **决定与 claim 绝不放在 agent 可写的工作区**；它们只在本地状态目录。
- **原子写**：写 `name.tmp-<random>`，fsync，rename；request/decision 用唯一文件发布
  （hard link），execution claim 先唯一发布再原子替换。损坏/半写按拒绝处理。
- **清理**：过期 request/decision 由本地清理；保留 audit 行；不要让目录无限增长。
- **大小/数量限制**：单个 request 有上限；每 bot 的待审批数量有上限；洪泛要拒绝并
  记录（ADR-012）。
- **当前实现路径（2026-11-23）。** 本地 request/decision/claim/audit 在
  `$DSH_HOME/state/rayrun-bot/bots/<botId>/approvals/` 和
  `$DSH_HOME/state/rayrun-bot/logs/audit.log`；待传结果在 `approval-results/`。
  云端 proposal bridge 已 live 验证（2026-11-23）。

## 5. Schema 与 action hash

### 5.1 请求（Request）

```json
{
  "schema": 1,
  "id": "approval-id",
  "botId": "weekly-watch",
  "actionId": "action-id",
  "nonce": "random-256-bit",
  "actionHash": "sha256-hex",
  "action": { "kind": "rayrun.machine.stop", "machine": "rayrun-bot" },
  "risk": ["outside"],
  "origin": "chat",
  "createdAt": "2026-11-23T12:00:00.000Z",
  "expiresAt": null
}
```

- allowlist 只接受 typed machine action：`rayrun.machine.start`、`stop`、`pause`、
  `resume`，字段只有 `kind` 和 `machine`（机器名或 id）。`destroy`、创建机器、shell、
  任意命令/URL 不在 allowlist。
- `risk` 由本地 action registry 推导：start/resume 为 `["outside","cost"]`，
  stop/pause 为 `["outside"]`；不信任提案里自报的 risk。
- `approvals.propose` 只接受 host-side 调用（无浏览器 `Origin`）；浏览器请求返回 403。
  它把 `requestedAction` 交给本地校验，生成上面的 request。云端 bridge 通过 proposal
  文件导入，不走这个页面路由。

### 5.2 决定（Decision）

建议字段：`schema`、`id`、`botId`、`actionId`、`actionHash`、`nonce`、`decision`
（`approve` / `deny`）、`decidedAt`、`decisionId`。

2026-11-22 的实现已按 ADR-011 补齐：decision 包含 `botId`、`actionId`、
`actionHash`、`nonce`、`decision`、`decidedAt` 和 `decisionId`。页面只提交
`approve`/`deny` 和 approval id；本地实现从 request 构造决定，免得页面伪造 nonce
或 hash。

### 5.3 规范化 action hash

- 对 canonical JSON（RFC 8785/JCS，或一份写明的 canonical serializer）计算 SHA-256。
- 覆盖至少 `{ botId, actionId, action, risk, origin, expiresAt }`，并带 schema 版本。
- 本地侧对“实际显示的内容”重算 hash；任何不匹配 = 拒绝。
- 测试向量：key 顺序、空白、Unicode、数字格式、被篡改的 action、错 bot、过期。
- `expiresAt`：chat 显式 `null`；background 为 30 分钟后的时间。不要用缺省值表示两种
  语义。

---

## 6. 执行语义

- **本地执行器**：`lib/approval-actions.js` 只做 typed allowlist；`lib/approval-executor.js`
  写 `exec-<id>.json` claim 后执行。执行使用本地 `runtime.*`/Rayrun RPC，token 留在
  Harness vault。动作是机器 start/stop/pause/resume；不是任意云命令。
- **at-most-once**：claim 在执行前写入；同一 id 的重复 approve 返回已有 claim，不重复
  调用外部 API。崩溃后 claim 可能停在 `executing`；不自动重试；客户端显示等待/失败。
- **actionId**：执行方生成；重试时不变；request/decision/execution 都引用它。
- **执行日志**：append-only，状态 `proposed`、`approved`、`executing`、
  `effect_committed`、`done`、`failed`、`denied`、`expired`；当前实现记录
  `execution-start/done/failed/refused` 与 request/decision。
- **幂等**：外部 API 支持 idempotency key 时传入；不支持时，`executing` 之后不要盲目
  重试，要求对账或重新审批。
- **投递语义**：不可逆动作（发送、发布、花钱）默认 at-most-once；只有可安全重复的
  动作才接受 at-least-once。首版 stop/start 仍遵守 claim，不因重复点击重复执行。
- **崩溃**：批准后、副作用前崩溃 → 不自动当作已执行；副作用后、`done` 前崩溃 →
  不能重复副作用；两者都要靠 claim/执行日志判断。
- **拒绝**：deny 是终态；不要因为队列重试而重新执行。
- **云端凭据动作**：不在本地 executor 的 allowlist；在平台隔离/host-only 端点落地前
  继续不执行。
- **云端提案/结果**：proposal 由 `rayrun_files` 导入，结果写回 `approval-results/`；
  两者都不是授权。机器停机时 sync 不唤醒机器，结果留在本地 outbox。

详见 ADR-005；ADR-019 决定本地执行权威。

## 7. UI 规则

- 真实 roster bot 的卡片读取本地 `approvals.list/get`；显示动作、目标、金额/收件人/
  URL、风险、来源、TTL 和执行结果。示例 bot 的卡片仍是页内预览。
- 不渲染机器提供的 HTML/markdown；链接要显示真实目标，防止钓鱼/同形字。
- 两个动作：**Deny**、**Allow once**；没有“永远允许”。
- 已答/过期/重放显示明确状态并刷新；不要静默变成成功。批准后本地执行失败必须显示
  “已批准，但执行失败”，不能显示成已完成。
- 真实审批卡在决定后提供 **Continue bot**；点击才发下一轮，不自动消耗模型调用。下一轮
  prompt 带最近审批结果，不依赖 shell 读文件。
- 列表 attention 点标记“等你”；不显示未读 bait。
- 多个标签页同时决策：第一个有效决定赢，其余显示 stale/duplicate。
- 卡片安全测试见 C-S6；审批拒绝、超时、重放、错 bot 的负向测试是 A7/A11 的强制项。

## 8. 审计与日志

- 每个 request、decision 和 execution 一行 audit：`at`、`requestId`、`botId`、
  `nonce`、`actionHash`、`decision`、`decidedAt`、execution 状态/错误码；不记录
  action payload。
- 本地 `audit.log` 只追加；是否 tamper-evident（哈希链）见 ADR-012。
- 审批拒绝/超时要记录原因码，便于支持排查；不记录密钥、prompt 或 workspace 内容。

---

## 9. 负向测试（强制）

- 拒绝后没有副作用。
- 超时/未知/损坏 → 拒绝。
- 重放同一 decision → 拒绝或幂等，不重复副作用。
- 错 bot / 错 actionId / 错 nonce / stale actionHash → 拒绝。
- 过期 background 卡 → 拒绝；chat 卡继续等待。
- 多个客户端同时决定 → 一个赢，其余 stale。
- 审批洪泛/超大文件 → 拒绝并记录。
- 日志/响应不含 token、key 或 action payload。
- 未知 action kind、额外字段、非 allowlist 目标、空/歧义目标 → 拒绝且不调用 Rayrun。
- 同一 approved request 重复执行 → 只有第一个 claim 执行；后续返回已有结果。
- 执行前崩溃留下 `executing` claim → 不自动重试；损坏 claim → 失败关闭。
- 执行失败/缺少本地 Rayrun 连接 → 记录失败，不假成功；错误脱敏。

> 2026-11-23：协议测试（8 项）、executor 测试（7 项）、cloud proposal bridge 测试
> （6 项）、cloud host proposal 测试（4 项）和 RPC 契约覆盖上述大部分；页面 E2E
> 用无 Rayrun 凭证的临时 profile 验证了“拒绝无执行、批准执行失败不假成功”。真实
> cloud proposal → Allow/Deny → 真实 machine.start/stop/pause/resume、denial 与
> Continue → 停机 outbox → 重启补传，以及下一轮 recent-approval context 已 live
> 通过；**其他动作和云端凭据动作仍未验证。** 见 `test/approvals.mjs`、
> `test/approval-executor.mjs`、`test/cloud-approval-bridge.mjs`、
> `test/cloud-host-proposal.mjs`、`test/rpc-contract.mjs`。

## 10. 未决项

| 问题 | 影响 | 决策 |
| --- | --- | --- |
| 审批在哪里执行？ | 它是不是安全边界 | ADR-019：本地 DSH host 执行本地动作；ADR-001 的平台隔离仍用于云端凭据动作 |
| 云端 bot 如何提案？ | 自主审批闭环 | 结构化 block + host 解析已 live 验证；`propose.mjs` shell 路径未 live；host-only `approvals.propose` 仍为本地 seam |
| 首版支持哪些动作？ | allowlist 与风险 | start/stop/pause/resume 已定义；其他动作逐项加，默认拒绝 |
| decision 字段与 canonical hash | 绑定动作、负向测试 | ADR-011：Accepted（2026-11-22，协议已实现） |
| 副作用崩溃/重试语义 | 重复发送/花钱 | ADR-005；本地 executor 已写 claim、不自动重试 |
| TTL/时钟/限流/多客户端 | 状态机与恢复 | ADR-012 |
| 审计是否 tamper-evident | 安全声明 | ADR-012 |
| 真实 Rayrun 执行 E2E | 证明成功路径 | machine.start/stop/pause/resume、denial、Continue 和下一轮结果 context 均已 live |

## 11. 相关文档

- [`01-system-architecture.md`](01-system-architecture.md)
- [`03-client-design.md`](03-client-design.md)
- [`04-cloud-host.md`](04-cloud-host.md)
- [`06-local-state.md`](06-local-state.md)
- [`07-security.md`](07-security.md)
- [`plans/mvp-plan.md`](plans/mvp-plan.md) E1–E7、A6/A7/A11
- [`adr/architecture-decisions.md`](adr/architecture-decisions.md)
