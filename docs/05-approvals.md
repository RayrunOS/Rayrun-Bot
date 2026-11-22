# 05 — 审批

> 状态：2026-11-21。本文定义“什么需要审批、谁来执行、失败怎么拒绝、决定怎么绑定
> 动作”。ADR-001 已于 2026-11-21 定为**平台权限隔离**；平台提供 host/agent 隔离与
> 审批端点前，审批执行不实现（见 [`08-integration.md`](08-integration.md) §3.3）。
> 技术基线见 [`01-system-architecture.md`](01-system-architecture.md)；
> 云端 bot runtime 见 [`04-cloud-host.md`](04-cloud-host.md)；本地状态见
> [`06-local-state.md`](06-local-state.md)；威胁模型见
> [`07-security.md`](07-security.md)；未决决策见
> [`adr/architecture-decisions.md`](adr/architecture-decisions.md)。
> 实现状态以 [`12-status.md`](12-status.md) 为准。

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
- **审批不是安全沙箱**：它降低误操作和被 prompt injection 的风险；执行点已定为平台
  权限隔离（ADR-001），平台提供前审批不实现，也不是安全边界。

---

## 2. 信任边界（必须先读）

v0.1 计划中的文件邮箱位于 `/workspace/.rayrun/bots/<botId>/approvals/`，而 bot 以
root、`danger-full-access` 运行，可读写该目录。它可以从 `req-<id>.json` 读到 id 与
nonce，再写一个匹配的 `res-<id>.json` 自批；也可以修改 host、队列或直接绕过工具。

因此：

- 唯一文件名、tmp+rename、checksum 只防半写，不防伪造。
- `超时 / 未知 = 拒绝` 只处理崩溃和无人回答，不处理被控 bot。
- **ADR-001 已定（平台权限隔离）；平台提供隔离前，审批仍是“用户同意/审计”，不能当成
  对被控 bot 的安全边界，也不实现执行。**

ADR-001 的三个选项：

1. **在用户侧执行**：云端只提交提案；本地控制面或平台校验后用该侧凭据执行。推荐用于
   凭据在用户侧的动作。
2. **平台权限隔离**：host 与 agent 使用不同用户/命名空间，host 持有 agent 读不到的
   密钥。当前平台没有，需要写进平台需求。
3. **承认只是同意**：保留文件邮箱，改写安全声明并警告。这是回退，不是安全边界。

**决定（2026-11-21）：选项 2，平台权限隔离。** 平台提供 host/agent 隔离与 host-only
审批端点前，不实现审批执行，E1–E7 与 A6/A7 暂停。按凭据所在的一侧分类仍是长期方向：
在凭据所在处执行，在人类所在处审批；如果动作在用户侧没有凭据路径，不要把它交给
agent，归到平台隔离或从 v0.1 移除。

---

## 3. 流程

1. **提案**：受控动作在云侧生成 request：id、botId、actionId、nonce、actionHash、
   action、risk、origin、createdAt、expiresAt。
2. **送达**：request 写入审批目录；本地控制面每 3 秒轮询（平台无入站通道）。
3. **卡片**：本地控制面显示结构化字段；用户 Deny / Allow once。卡片内容不信任机器
   提供的 HTML/markdown。
4. **决定**：决定写入 `res-<id>.json`；或由本地/平台执行（ADR-001）。
5. **执行**：执行方校验 id、botId、actionId、nonce、actionHash；任何不匹配、过期、
   重放、错 bot 都拒绝并记录。
6. **完成**：写 audit 行与队列状态；失败给错误码与一句可读信息。

**TTL**：

- background（routines/后台任务）：30 分钟后过期即拒绝。
- chat（用户刚发起的对话）：不设计时，一直等待；面板关闭不等于同意。
- 过期/未知/损坏：拒绝，不重试为“已批准”。

---

## 4. 文件邮箱

**授权边界：** 文件邮箱只传提案、卡片和审计；ADR-001 决定执行点必须在 agent 写不到
的地方。平台提供隔离前，下面的文件不能作为批准执行的依据。

| 文件 | 写者 | 读者 | 规则 |
| --- | --- | --- | --- |
| `approvals/req-<id>.json` | bot runtime（提案） | 本地控制面 | 唯一 id；临时文件 + rename；不覆盖已有文件 |
| `approvals/res-<id>.json` | 本地控制面（或平台） | 执行方 | 每个 id 一个决定；重复决定按 id 幂等，第一个有效决定赢 |
| `logs/audit.log` | 本地控制面 | 用户/支持 | 只追加；记录 id、botId、nonce、actionHash、决定、时间；不记录 action payload |

- **单一写者**：request 与 decision 是不同文件，各自只有一个写者；不要把它们合并成
  一个 JSONL。
- **原子写**：写 `name.tmp-<random>`，fsync，rename；读者把缺文件当作“还没到”，不是
  “拒绝”。损坏/半写按拒绝处理。
- **清理**：过期 request/decision 由 host 清理；保留 audit 行；不要让目录无限增长。
- **大小/数量限制**：单个 request 有上限；每 bot 的待审批数量有上限；洪泛要拒绝并
  记录（见 ADR-012）。

---

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
  "action": { "kind": "send-message", "target": "...", "text": "..." },
  "risk": "external-side-effect",
  "origin": "chat",
  "createdAt": "2026-11-18T12:00:00.000Z",
  "expiresAt": null
}
```

### 5.2 决定（Decision）

建议字段：`schema`、`id`、`botId`、`actionId`、`actionHash`、`nonce`、`decision`
（`approve` / `deny`）、`decidedAt`、`decisionId`。

当前 MVP 草案的 decision 只有 `{ schema, id, nonce, decision, decidedAt }`，缺
`botId`/`actionId`/`actionHash`；正文却要求匹配 bot 并绑定动作。接线前按 ADR-011 补齐。

### 5.3 规范化 action hash

- 对 canonical JSON（RFC 8785/JCS，或一份写明的 canonical serializer）计算 SHA-256。
- 覆盖至少 `{ botId, actionId, action, risk, origin, expiresAt }`，并带 schema 版本。
- 本地侧对“实际显示的内容”重算 hash；任何不匹配 = 拒绝。
- 测试向量：key 顺序、空白、Unicode、数字格式、被篡改的 action、错 bot、过期。
- `expiresAt`：chat 显式 `null`；background 为 30 分钟后的时间。不要用缺省值表示两种
  语义。

---

## 6. 执行语义

- **actionId**：执行方生成；重试时不变；request/decision/queue 都引用它。
- **执行日志**：append-only，状态 `proposed`、`approved`、`executing`、
  `effect_committed`、`done`、`failed`、`denied`、`expired`。
- **幂等**：外部 API 支持 idempotency key 时传入；不支持时，`executing` 之后不要盲目
  重试，要求对账或重新审批。
- **投递语义**：不可逆动作（发送、发布、花钱）默认 at-most-once；只有可安全重复的
  动作才接受 at-least-once。
- **崩溃**：批准后、副作用前崩溃 → 不自动当作已执行；副作用后、`done` 前崩溃 →
  不能重复副作用；两者都要靠执行日志判断。
- **拒绝**：deny 是终态；不要因为队列重试而重新执行。

详见 ADR-005。

---

## 7. UI 规则

- 卡片显示结构化字段：动作类型、目标、金额/收件人/URL、风险、来源、TTL。
- 不渲染机器提供的 HTML/markdown；链接要显示真实目标，防止钓鱼/同形字。
- 两个动作：**Deny**、**Allow once**；没有“永远允许”。
- 已答/过期/重放显示明确状态并刷新；不要静默变成成功。
- 列表 attention 点标记“等你”；不显示未读 bait。
- 多个标签页同时决策：第一个有效决定赢，其余显示 stale/duplicate。
- 卡片安全测试见 C-S6；审批拒绝、超时、重放、错 bot 的负向测试是 A7/A11 的强制项。

---

## 8. 审计与日志

- 每个 request 和 decision 一行 audit：`at`、`requestId`、`botId`、`nonce`、
  `actionHash`、`decision`、`decidedAt`；不记录 action payload。
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

---

## 10. 未决项

| 问题 | 影响 | 决策 |
| --- | --- | --- |
| 审批在哪里执行？ | 它是不是安全边界 | ADR-001：已定（平台权限隔离）；平台提供前不实现 |
| decision 字段与 canonical hash | 绑定动作、负向测试 | ADR-011（Proposed；恢复审批工作时先定） |
| 副作用崩溃/重试语义 | 重复发送/花钱 | ADR-005 |
| TTL/时钟/限流/多客户端 | 状态机与恢复 | ADR-012 |
| 审计是否 tamper-evident | 安全声明 | ADR-012 |

---

## 11. 相关文档

- [`01-system-architecture.md`](01-system-architecture.md)
- [`03-client-design.md`](03-client-design.md)
- [`04-cloud-host.md`](04-cloud-host.md)
- [`06-local-state.md`](06-local-state.md)
- [`07-security.md`](07-security.md)
- [`plans/mvp-plan.md`](plans/mvp-plan.md) E1–E7、A6/A7/A11
- [`adr/architecture-decisions.md`](adr/architecture-decisions.md)
