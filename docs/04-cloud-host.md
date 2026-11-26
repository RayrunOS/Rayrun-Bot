# 04 — 云端 bot runtime（bot host）

> 状态：2026-11-26。本文定义云电脑上的 **bot runtime**（历史名 bot host）：进程模型、
> 队列、session 映射、执行、心跳与恢复。本地 bot 控制面见
> [`01-system-architecture.md`](01-system-architecture.md) §1.4 与 ADR-016；
> 技术基线见 [`01-system-architecture.md`](01-system-architecture.md)；
> 审批见 [`05-approvals.md`](05-approvals.md)；本地状态见
> [`06-local-state.md`](06-local-state.md)；未决决策见
> [`adr/architecture-decisions.md`](adr/architecture-decisions.md)。
> 实现状态以 [`12-status.md`](12-status.md) 为准；本文中的
> **计划 / TBD** 不是已交付。本层由 **ADR-015** 提案（Proposed）；定稿前它仍是
> 设计方向。

## 0. 与现有文档的关系

| 文档 | 负责什么 |
| --- | --- |
| [`01-system-architecture.md`](01-system-architecture.md) | runtime 在栈中的位置、信任模型 |
| [`05-approvals.md`](05-approvals.md) | 受控动作的审批门 |
| [`06-local-state.md`](06-local-state.md) | `/workspace/.rayrun/` 与本地镜像的格式 |
| [`08-integration.md`](08-integration.md) | 与 `dsh-rayrun-computer` 的能力契约 |
| [`plans/mvp-plan.md`](plans/mvp-plan.md) | C1–C9、D1–D5 工作项与验收 |
| [`adr/architecture-decisions.md`](adr/architecture-decisions.md) | ADR-003（控制通道）、ADR-004（依赖）、ADR-005（副作用）、ADR-007（常驻 runtime）、ADR-012（恢复）、ADR-015（本层）、ADR-016（本地控制面） |

---

## 1. 目标

云电脑上需要一个**受监督的常驻 bot runtime**，而不是每次 prompt 起一个一次性进程：

- 接收本地控制面提交的任务，按 FIFO 执行；
- 为每个 bot 维护持久 DSH session 与 profile/memory 目录；
- 在需要审批时停在卡片上，批准后继续；
- 机器重启/进程被杀后能恢复队列与未完成工作；
- 让“合上笔记本，bot 继续工作”成立（新任务和审批仍受本地/平台限制，见 01 §6.4）。

当前平台按每次 prompt 启动 `dsh --profile headless`，session 不跨 run。平台答复
（2026-11-22）：R-G008 的 runtimes API 已实现并本机 dev 全量验收通过（`rayrun-bot-gaps`，
`4709ac0`），2026-11-24 已部署生产（`5c2ff48`/build 493），`dsh-bot@1` 的 hosted
cloudHost E2E 已通过 `PROD_OK`；它提供受监督常驻进程、
autostart、keep_alive 和 boot 时
credential injection。session 不是平台对象，由 bot host 自己写 `/workspace`；平台保证
workspace 跨 stop/start 保留。bot 侧 supervisor/session 实现仍是本仓库的工作
（ADR-007）；契约见 [`08-integration.md`](08-integration.md) §3.1。2026-11-22 dev
spike：镜像 DSH 0.2.0-rc.2 的 headless `--session-id` 可跨进程续接
（`RUN1_OK` → `ALPHA`）；`packages/dsh-rayrun-bots/cloud-host` 的 DSH agent 已实现两轮
`HOST1_OK` → `BETA`。核心 host 尚未进入包。

### 1.1 在栈里的位置

```
本地 bot 控制面（DSH host + 插件 host half；token/审批/成本）
        │ Rayrun API
Rayrun 平台（机器 / exec / files / credentials / billing）
        │ 云电脑内
本文的 bot runtime（queue / session / DSH 监督 / 事件 / 恢复）
        │
DSH agent sessions（bot）
```

### 1.2 拥有 / 不拥有

| 拥有 | 不拥有 |
| --- | --- |
| FIFO 队列、单飞执行、重试 | Rayrun token |
| bot↔session/profile/memory 映射 | 机器生命周期、billing |
| DSH agent 进程启动/监督/重启 | 审批决定（本地/人类，ADR-016） |
| 心跳、恢复、事件 outbox | 模型 key 存储（由平台注入） |
| 审批**提案**（不是决定/执行；ADR-019） | 多 bot 之间的安全隔离 |

云电脑是 agent 的安全容器（ADR-020）；host 与 agent 同机、以
root/`danger-full-access` 运行，host **不是安全边界**。本地 typed 审批由本地 DSH
host 决定/执行（ADR-019），云端凭据动作仍等待平台隔离（ADR-001），见
[`08-integration.md`](08-integration.md) §3.3。

---

## 2. 进程模型

```
云电脑
├── bot runtime (supervisor)       # 本项目 ship 的 Node 进程
│   ├── queue worker               # 一次一个 agent 任务
│   ├── session/profile manager    # 每 bot 一个 session + 目录
│   ├── approval gate              # 受控动作先写 request
│   └── heartbeat / state.json     # 供本地 watchdog 检查
└── DSH agent process(es)          # 实际思考与执行
```

- **一个 supervisor** 管理队列与 session；agent 任务串行执行。平台答复
  （2026-11-22）：R-G008 runtimes API 已实现并本机 dev 全量验收通过；2026-11-24
  已部署生产（`5c2ff48`），用 `restart=always`、
  `autostart`、`keep_alive` 启动/监督它。
- **每 bot 一个 session 与 profile 目录**：平台不提供 session 对象，session 由 host
  自己写 `/workspace`；是否能在同一个 DSH 进程里承载多个 profile，还是每 bot 一个
  进程/端口，尚未验证；见 ADR-007。
- **不把 Rayrun token 放进云电脑**：本地控制面通过 Rayrun API 写文件/读文件；bot runtime
  只使用模型 key 与本地文件。它如何被启动/监督，以
  [`08-integration.md`](08-integration.md) §3.1 的 runtimes 契约为准。
- **权限现实**：云电脑是 agent 的安全容器（ADR-020）；agent 以 root、
  `danger-full-access` 运行，host 与 agent 在同一台机器上没有强隔离。平台答复
  （2026-11-22）：同沙箱内无法隔离，平台审批端点不是首版；ADR-001 的关闭状态维持，
  host/agent 分域是新决策。

---

## 3. 队列

### 3.1 模型

- FIFO；一台机器同时只有一项 `running`。
- 平台返回 `409 sandbox_busy` 时重试，不丢工作；重试预算与退避见 C9。
- 队列项状态：`queued → running → waiting_approval → done | failed | cancelled`。
- 一项审批被拒绝/过期时，队列项进入 `failed` 或回到 `queued` 的规则必须明确；不要
  静默重试已拒绝的动作。

### 3.2 建议的队列项

```json
{
  "id": "q-...",
  "botId": "weekly-watch",
  "kind": "message",
  "text": "...",
  "createdAt": "2026-11-18T12:00:00.000Z",
  "updatedAt": "2026-11-18T12:00:00.000Z",
  "state": "queued",
  "attempts": 0,
  "sessionId": null,
  "approvalId": null,
  "actionId": null,
  "startedAt": null,
  "finishedAt": null,
  "error": null
}
```

当前预览 host 的任务文件是 `{ schema, id, text, at, origin?, routineId? }`；
`origin: "routine"` 由本地 scheduler 或云端 routine scheduler 设置，host 保留它，
并把该轮产生的审批提案标为 `background`（30 分钟过期）。完整字段、状态机与恢复
规则见 ADR-012；在执行日志/幂等定稿前不要实现副作用重试（ADR-005）。

### 3.3 控制通道

本地 → 云端的任务写入 `queue/inbox/<itemId>.json`；云端状态写
`queue/state/<itemId>.json`。**每个文件一个写者，不做共享 JSONL 追加**；平台文件 API
目前没有可用的 CAS（[`08-integration.md`](08-integration.md) §4）。详见 ADR-003。

### 3.4 Routine 调度（dev live；生产 E2E 已通过）

cloudHost runtime 启用时，本地 DSH host 停用本地 scheduler，把每 bot 的
`routines.json` 和 `bot.json` 镜像到 `/workspace/.rayrun/bots/<id>/`。云 host：

- 读取并重新校验镜像定义；损坏或未知字段只记录，不阻塞其他 bot；
- 在 `bots/<id>/host/routines-state.json` 保存 `updatedAt`、`lastRunAt`、
  `nextAt`；定义 `updatedAt` 变化时从新定义的 `nextAt` 重新开始；
- 先写 state claim，再写 inbox task；崩溃不会重放同一间隔；
- bot 有 inbox/processing 工作时跳过，下一 tick 再试；
- 任务带 `origin: "routine"`、`routineId`；任务文本只是 routine prompt，执行前
  `lib/prompt.mjs` 用镜像的 `bot.json` 组合完整 prompt（含 instructions 和结构化
  审批提示），再交给 DSH；持久 DSH session 已带对话，prompt 不重放 transcript。
  完成后写 `bots/<id>/routine-results/<taskId>.json`（保留最近 200 个）。

本地 `routines.sync` 只在机器 Running 时上传定义和下载结果，不唤醒机器。结果经
schema 校验后写本地 `routine-results/`（保留最近 400 个），由 `session.history`
按时间合并；它不修改 `session.json`，也不是审批/执行记录。失败任务写
`state: failed` + `error`，本地 history 显示为 `E_ROUTINE_FAILED` system error。
机器停止期间的定义编辑无法上传，启动后旧定义可能先运行一次，直到 sync 覆盖。该
路径有 fake E2E，并已在 Rayrun dev/test 环境 live 验证（2026-11-24）；生产待
R-G008 部署。详见 ADR-009。

---

## 4. Session 与 profile

- **映射**：`botId → sessionId`，DSH profile 共享；session id 持久化在机器上，host
  重启后重读。
- **续接**：第二次对话接着第一次；DSH headless 的 `--session-id` 已在 dev 镜像
  验证（2026-11-22）。
- **回退**：逐次 headless + transcript replay；更慢、更贵，且可能丢掉工具状态；
  必须在 UI 和文档里说明降级。
- ** transcript**：D3 计划写 `sessions/*.jsonl`，脱敏；本地镜像默认只存元数据，不存
  完整对话（[`06-local-state.md`](06-local-state.md)）。
- **多 bot**：共享机器，全局串行 + round-robin；一个 bot 的长任务会阻塞其他 bot。
  host 侧任务超时和取消尚未定义（ADR-012）。

---

## 5. 执行与审批

1. 从队列 claim 一项，写 `state = running`、`startedAt`。
2. 在 bot 的 session 中执行 prompt；事件写入 outbox，本地轮询/订阅。
3. 需要外部副作用时，调用审批门；队列项进入 `waiting_approval`，写 request 文件。
4. 批准后执行动作；副作用与状态迁移的崩溃/重试语义见 ADR-005：
   `actionId` + 执行日志 + 幂等键；不可逆动作默认 at-most-once。
5. 完成后写 `done`/`failed`；失败要落错误码与一句可读信息，不吞错。

审批的完整流程、TTL、重放/错 bot/过期拒绝见 [`05-approvals.md`](05-approvals.md)。

---

## 6. 心跳、恢复与退出

- host 定期写 `host/state.json`（pid、状态、schema、心跳时间）。
- 本地 watchdog 通过 `exec` 检查心跳；host 丢失时尝试重启（C6）。
- host 重启后重读队列、session 映射与未决审批；不丢已排队工作（C8）。
- 机器 stop/start 保留磁盘；destroy 删除一切，只能由人类明确请求。
- 恢复的字段与状态机缺口见 ADR-012；A8/A9 需要这些才能验收。
- 退出/崩溃时不要把 `running` 项直接标成成功；交给恢复流程判断，避免假成功。

---

## 7. 凭据与依赖

- **模型 key**：Rayrun 把 DeepSeek key 注入 agent 进程；宿 host 如何拿到注入、监督
  进程是否也能拿到，未验证（ADR-007）。
- **Rayrun token**：不进入云电脑；本地控制面通过 Rayrun API 操作机器与文件。
- **依赖**：`dsh-rayrun-computer` 提供云能力；本地控制面通过其发布表面调用（service
  injection / host RPC / adapter 未定，ADR-004）；bot runtime 由它的 worker projection
  ship/启动，不直接调用本地依赖。不复制 token，不修改依赖。
- **版本检查**：启动时记录依赖版本；缺失/过旧返回 `E_DEP_MISSING` /
  `E_DEP_VERSION`。

---

## 8. 日志与审计

- 日志写 JSONL；字段稳定：`at`、`level`、`code?`、`botId?`、`event`、`n?`。
- 不记录 token、key、完整 prompt、workspace 内容或审批 payload；只记录 id、字节数、
  错误码与耗时。
- 审批请求/决定另写 audit 行；是否 tamper-evident（哈希链）还是运行历史，见 ADR-012。
- 日志轮转与保留见 [`06-local-state.md`](06-local-state.md)。

---

## 9. 未决项

| 问题 | 影响 | 决策 |
| --- | --- | --- |
| 常驻 bot runtime 能否拿到模型凭据？ | “合上笔记本”能否成立 | ADR-007 |
| 一个 DSH 进程还是每 bot 一进程？ | 资源、端口、隔离 | ADR-007 |
| 队列/状态的单写者协议 | 丢工作/丢更新 | ADR-003 |
| 副作用崩溃/重试语义 | 重复发送/花钱 | ADR-005 |
| 队列字段、状态机、恢复 | A8/A9 | ADR-012 |
| 依赖接口 / worker projection | C1/D1 能否开工 | ADR-004 |
| 本地控制面 ↔ runtime 的契约 | 启动、任务、审批、事件 | ADR-015/016 |

---

## 10. 相关文档

- [`01-system-architecture.md`](01-system-architecture.md)
- [`05-approvals.md`](05-approvals.md)
- [`06-local-state.md`](06-local-state.md)
- [`08-integration.md`](08-integration.md)
- [`plans/mvp-plan.md`](plans/mvp-plan.md) C1–C9、D1–D5
- [`adr/architecture-decisions.md`](adr/architecture-decisions.md)
