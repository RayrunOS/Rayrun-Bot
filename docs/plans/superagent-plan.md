# 每个账户一个 Superagent：第一版云端协调层

> 状态：2026-11-28，Proposed；**未实现**。本文是计划，不是实现状态事实源；
> 实现状态以 [`../12-status.md`](../12-status.md) 为准。
>
> 背景与逐条来源见 [`../research/superagent-lessons.md`](../research/superagent-lessons.md)。
> 本文只记录从原型、文章和第三方实测中得到的、会改变本计划的约束。

## Context

用户要求：从产品角度参照 Grok Bot，每个账户需要一个 superagent。已确认：

- 形态是 **可见、置顶的默认 primary bot**，不是隐形 router，也不是用单个 bot 取代名册；
- 第一版只做协调层，复用现有 bot / session / cloudHost / approval，不先做完整
  Ticket/Report/Mandate 任务系统；
- **委派编排放在 cloud host**，不是本地 host：用户合盖后，primary 和 worker 的
  委派链仍应在云电脑上完成；
- **worker 的审批汇总到 primary**：用户默认在 primary 对话里处理审批。

现状：Rayrun Bot 有持久名册、每 bot session/transcript、默认 cloudHost、全局串行
队列、send acceptance、审批和 routines；但没有账户级 primary、没有 bot 之间的委派，
名册只是并列 bot。用户要自己决定找哪个 bot，无法做到 Grok Bot 式的“和 lead 说话，
它安排同事”。

目标：每个 DSH profile（一个 Rayrun 账户）有一个默认 primary bot；用户默认和它对话；
它知道 worker 名册，能把明确适合的任务交给 worker；云端完成 worker 后把结果带回
primary，primary 向用户总结；worker 的审批卡出现在 primary。现有 bot 保留为 worker。

## 0. 代码与文章审视后的修正

对照原型 `dsh-superagent-prototype`（单 commit 研究原型）、公开文章和第三方实测后，
以下几点必须写进计划，避免把“文章级设计”当成“原型已实现”：

1. **文章 ≠ 原型**：文章里的 Watchdog、存算分离、主动任务发现，原型没有完整实装；
   原型实装的核心是授权链（Source/Trigger/Thread/Eval/Ticket/Mandate/Assignment）
   和事件过滤。第一版不要声称有模型级 Watchdog；只做硬超时/失败关闭。
2. **Router 是单点**：公开实测出现过 5 个任务被静默跳过（通知延迟 + 轮询游标），
   补发后才全部完成。用户看不到 Router 漏掉的工作。云端委派链必须有 **host 生成的
   fallback 结果/错误**，不能只依赖 primary 的二次总结；否则 primary 失败时 worker
   结果会消失。
3. **成本是真实代价**：公开实验的读缓存 token 约为单会话的 2.15–3.80 倍，单件任务
   反而更慢；第三方实测单任务 63s vs 200s、费用约 2.29 倍。本计划的链是
   “primary 初判 + worker + primary 总结”三次模型轮次，不能对所有消息默认委派。
   primary 必须能直接回答简单任务；委派只用于明确匹配 worker 职责且值得多一轮模型
   调用的任务。
4. **prompt 是软约束**：第三方实测中 Worker 明确看到“方向不明要停下”仍然自行做了
   设计决定；注入防御最终靠模型判断。委派块解析、目标校验、审批 proposal 改写必须
   是 **host 代码**，不能只写在 prompt；primary 仍是有完整工具的云电脑 agent，不是
   纯 router，也不能被描述成安全边界。
5. **审批必须由 host 生成**：worker 的 approval block 由 host 改写成 primary 的
   proposal，不能由 primary 代写/代改；本地 executor 仍重算 action hash。这样
   primary 的“单点”不会变成审批授权的单点。
6. **可审计**：每次委派必须有持久 record（primary task、target、state、worker
   reply/error、approval），即使第一版不做完整 Ticket/Report。用户至少能看到
   primary 的最终总结和失败原因；不能静默丢 worker。
7. **不能照搬并发**：原型的多 Worker 并发依赖额外的 Router/Worker 调度和 token；
   Rayrun 仍是单机串行。第一版只做一层、一次一个 worker，不做并行承诺。
8. **委派是模型行为，不是确定性路由**：公开实验中单会话在 neutral prompt 下 0/5
   委派；primary prompt 明确鼓励，但仍不保证每次都正确委派。第一版只验证“明确匹配
   worker”的场景，不承诺自动最优路由；用户可以直接点名某个 worker。
9. **第一版不是完整任务系统**：没有 Ticket、Thread Subscription、结构化 Report。
   后续消息仍回 primary，worker 的上下文不会自动续接；不要把协调层说成 Super-agent
   的任务层已经完成。
10. **live 验证的机器**：新建的测试机在记录结果后 destroy；不自动 destroy 用户既有
    机器，也不把 destroy 放进产品代码路径。

**审视结论**：原计划的“可见 primary + 云端单层委派 + 审批汇总”方向成立，但不能只靠
prompt 和 primary 的二次总结。第一版保留协调层，同时增加四项硬约束：host 生成的
fallback、持久 delegation record + 失败关闭恢复、host 侧解析/目标校验/审批 proposal
生成、以及显式的成本/委派率验证。完整 Ticket/Report/Thread Subscription 仍留给下一
阶段；本版不声称具备它们。

## 非目标

- 不做完整 Ticket/Report/Mandate 任务系统；这是协调层稳定后的下一阶段。
- 不做 Thread Subscription：委派之后的跟进仍回到 primary，不自动续接 worker 回合。
- 不做主动触发（proactive / observe / auto）；routines 行为不变。
- 不做多 worker 并发或并行；Rayrun 机器仍串行队列。
- 不做群聊、bot-to-bot 自由对话、团队/多租户。
- 不改审批边界：typed 动作仍由本地 approval bridge 导入、本地 fail-closed 执行。
- 不让 primary 成为安全边界；同机 bot 共享云电脑（ADR-020）。
- 不新增仪表盘；不新增“接管/委派”页面。
- 第一版不把 delegated worker 的完整 transcript 镜像到本地 worker 历史；primary 的
  总结和 host fallback 是用户可见的权威结果（见风险）。
- 审批后不自动恢复 worker；用户 Continue 后由 primary 决定重新委派或总结。
- 不做 primary 更换/删除 UI；worker 的创建/删除行为不变。

## 产品行为

1. 账户第一次打开 Bots / 完成 setup 时，若没有 primary，自动创建一个
   `superagent` bot（可改名、改指令，不可删除），置顶、默认选中。Setup 的 bot
   步骤编辑这个 primary，不额外创建 worker。
2. 已有账户升级：没有 primary 时创建新的 `superagent`，现有 bot 保留为 worker；
   不静默改现有 bot 的指令。
3. primary 的 prompt 包含 worker 名册（id/name/label）和委派格式；简单问题或没有
   明确匹配的请求由它直接处理，只有明确适合某个 worker、且值得多一轮模型调用时才
   委派。委派是模型判断，不是默认路径；用户可以直接点名 worker。
4. primary 的委派块由 **cloud host** 解析；cloud host 在云端执行 worker，再把 worker
   结果交回 primary，由 primary 生成最终总结。本地 host 只提交 primary task、收取
   最终 outbox，不负责委派编排。第二次 primary 轮次禁止再委派，host 忽略其中的
   delegate 块。
5. 用户收到的是 primary 的最终总结，总结必须写明实际执行的 worker 和结果；“已交给
   X，等结果”是过程状态，不要求用户打开 worker。若 primary 的第二轮失败/为空，
   cloud host 写入 host 生成的 fallback（worker 结果或错误），不把 worker 工作丢掉。
   worker 仍在名册中，可直接聊天。
6. worker 回复里的 `rayrun-approval` 块由 cloud host 改写到 **primary** 的
   `proposals/`；本地 approval bridge 只在 primary 上导入和展示。用户在 primary
   卡片上批准/拒绝，本地 executor 执行；用户点 Continue 后 primary 拿到结果并继续。
   host 还会在最终回复中追加确定性的“等待你批准”提示，不依赖 primary 转述。
7. 合盖：primary task 一旦被 cloud host 接受，整个委派链在云端继续；本地 DSH 关闭
   不影响。重开后本地 host poll 收取 primary 最终 outbox。worker 中途停在审批时，
   链在云端结束为 waiting-approval，重开后 primary 显示等待审批。cloud host 在链
   中途崩溃时失败关闭并写 fallback，不静默重跑 worker。
8. primary 不可删除；第一版不提供更换 primary UI。worker 的现有行为不变。

## 数据模型

### 本地账户状态

`$DSH_HOME/state/rayrun-bot/superagent.json`

```json
{
  "schema": 1,
  "botId": "superagent",
  "createdAt": "2026-11-28T..."
}
```

- 一个 DSH profile 恰好一个 primary；读取时校验 botId 存在。
- `bots.list` 返回 `primaryBotId`；客户端据此置顶/默认选中，不把 primary 写进
  `bot.json`。
- `bots.delete` 拒绝删除 primary，返回稳定错误码并补 locale。
- primary bot 不存在时重建默认 primary；`superagent.json` 损坏时失败关闭，不返回
  半状态。

### 云端委派状态

`/workspace/.rayrun/bots/<primaryBotId>/delegations/<id>.json`

```json
{
  "schema": 1,
  "id": "delegation-...",
  "primaryTaskId": "task-...",
  "primaryBotId": "superagent",
  "targetBotId": "weekly-watch",
  "state": "running|done|failed|waiting-approval",
  "phase": "worker|summary",
  "task": "...",
  "reply": "...",
  "errorCode": "...",
  "createdAt": "...",
  "updatedAt": "..."
}
```

- 第一版每次 primary task 最多一个委派、一层深度。
- 状态迁移：
  - 调用 worker 前：`state=running, phase=worker`；
  - worker 完成：写入 `reply`，`state=done, phase=worker`（或
    `state=waiting-approval`）；
  - 调用 primary 总结前：`state=running, phase=summary`；
  - 总结完成：`state=done, phase=summary`。
- 恢复：
  - `state=running, phase=worker`：无法确认 worker 是否已产生副作用，标记 `failed`
    并写 fallback，**不自动重跑**；
  - `state=done, phase=worker` 或 `state=running, phase=summary`：只补 primary
    总结，不重复 worker；
  - `state=waiting-approval`：保持等待，不重跑。
- 记录用于 cloud host 崩溃恢复和避免重复执行；保留有限条数/时间。
- 不把 worker 的完整 transcript 放进 primary outbox（只放最终结果和可选摘要）。

## 云端委派协议

primary 的 prompt 增加名册：

````text
Teammates:
- weekly-watch — Weekly Watch — Watches weekly numbers
- docs-refresh — Docs Refresh — Updates documentation

To delegate, end your reply with exactly:
```rayrun-delegate
{"bot":"weekly-watch","task":"..."}
```
Only one delegation per turn. Never delegate to yourself. Do not claim the delegated
work is done; tell the user you asked the teammate.
````

- 只在 primary 的 prompt 中出现；worker prompt 不含该块。
- primary task 的元数据包含 `delegation` 配置：`primary` 标记和 worker roster
  （id/name/label/instructions）。roster 只用于 cloud host 构建 worker prompt，不全部
  注入 primary prompt（primary 只看 id/name/label）。
- worker 可绑定 DSH workspace（见 [`workspace-bots-plan.md`](workspace-bots-plan.md)）；
  roster 可带 workspace id/title 供 primary 判断，但路径由 cloud host 从 bot 定义
  解析。第一版 primary 不绑定 workspace，同一 workspace 只绑定一个 worker。
- roster/task 大小设上限（例如 8 个 worker、总 64 KiB）；超限失败关闭，并提示减少
  worker/指令长度。不能把任意大的 bot 定义塞进任务。
- cloud host 解析 primary 最终回复中的唯一块：
  - 没有块：按普通回复写 outbox，不创建 delegation；primary 不得声称已委派。
  - 目标必须存在、不是 primary、任务非空且有长度上限；
  - 从用户可见回复中剥离块；非法块不执行，primary 收到可见错误；
  - 创建 delegation record（`state=running, phase=worker`），调用 worker 的 turn。
- worker prompt 用 roster 里的 `instructions` + 委派 task 构建；worker 不能继续委派
  （一层限制）。
- worker 完成后，cloud host 用 **同一个 primary DSH session** 追加一轮“worker 结果 +
  请总结、不要再委派”的输入；最终 reply 写入原 primary task 的 outbox。该轮出现
  delegate 块一律不执行，只记录为非法/忽略。
- 初始 primary 的“已交给 X”中间回复不写用户 transcript；只写最终总结。DSH session
  内部可以保留两轮，供上下文。
- **fallback**：若第二次 primary turn 失败、超时或返回空，cloud host 写一条 host
  生成的结果，包含 worker 名、delegation 状态和 worker reply（或错误码）；若 worker
  失败，也写失败摘要。用户不会只看到“Working”后什么都没有。
- **硬时限**：委派链设置比单 task 更短的 deadline（配置常量，例如 600s），超时
  标记 failed/fallback；不是模型 Watchdog，只做硬超时。
- worker 失败：delegation `failed`，primary 第二轮收到失败摘要；若第二轮也失败，
  fallback 写明错误。
- worker 的 approval block：见下一节。

## 审批汇总

- cloud host 的 agent wrapper 在解析 worker 回复时，若发现 `rayrun-approval`：
  - 生成 proposal，但 `botId` 写成 **primaryBotId**，写到 primary 的 `proposals/`；
    proposal 内容由 host 从 worker block 生成，primary 不能代写/代改；
  - worker 的可见回复去掉 approval block，改为“waiting for approval”；
  - primary 的最终回复说明“X 需要你批准 <action>”；host 还会追加一条确定性的
    approval 提示，避免 primary 转述丢失或改写；delegation 标记
    `waiting-approval`，不继续执行 worker。
- 本地 `approvals.sync` 只对选中的 primary 运行，因此卡片出现在 primary 对话；
  现有本地 executor 仍是唯一执行者，审批语义不变。用户在 primary 卡片上看到的
  action summary 来自 host 生成的 proposal，不来自 primary 自由文本。
- 用户批准/拒绝后，结果写到 primary 的 `approval-results/`；用户点 Continue 时，
  primary 的下一轮 context 带最近审批结果，可以重新委派或总结。第一版不自动恢复
  worker；worker 的原回合已经结束。
- approval proposal 的 `botId` 必须与 primary 一致；worker 原 proposal 不落盘，避免
  同一个动作出现两张卡。
- 不把 worker 的审批卡留在 worker；这是本版与旧行为的有意差异。

## 实现步骤

### 1. 本地 primary 身份与 onboarding

- 新增 `packages/dsh-rayrun-bots/lib/superagent.js`：
  - `openSuperagentStore(stateRoot)`：`read()`、`ensure(botStore)`、`primaryBotId()`；
    原子写、校验、失败关闭。
  - `ensure` 创建默认 `superagent` bot（id 冲突时加后缀），已有 roster 不改。
  - `superagent.json` 存在但 botId 对应的 bot 不存在：重建默认 primary 并更新记录；
    记录损坏/无法解析：失败关闭，不返回半状态。
- `index.js`：在 host 初始化与 `bots.list` 前都调用同一个幂等 `ensurePrimary()`（不依赖
  `sessions()` 先被调用）；`bots.list` 返回 `primaryBotId`；`bots.delete` 拒绝 primary；
  新增错误码 + locale。
- `client.js`：
  - `bots.list` 后 primary 置顶并默认选中；删除按钮禁用；
  - Setup 的 bot 步骤编辑 primary；New Bot 创建 worker；
  - 不新增页面/横幅；默认名/标签走 locale，用户可改名。
- 测试：`test/superagent.mjs`（幂等、已有 roster、损坏、缺失 bot 重建、删除拒绝）、
  `test/rpc-contract.mjs`（primaryBotId、删除错误）、`test/client-contract.mjs`。

### 2. 本地提交 roster 与 primary prompt

- `lib/rayrun-runtime.js`：`buildPrompt` 增加 `roster` + `primary`；只对 primary 加
  Teammates/delegate 说明，并写明“简单/无明确匹配的任务直接处理；只委派给明确匹配的
  worker”。worker 不加。
- `lib/cloud-host-runtime.js`：`start` 接收/构造 primary task 元数据：
  - `delegation: { primary: true, roster: [{id,name,label,instructions}] }`；
  - worker task 不带；
  - 由 `index.js` 注入 `getRoster`/`getPrimaryBotId`；roster 从 bot store 读取，
    做大小/数量上限校验；
  - 只有实际走 cloudHost 时才注入 roster/delegation；依赖 <1.2.2、detached、
    sync runtime 或 `cloudHost:false` 时 primary 当普通 bot，不出现 delegate 说明。
- 测试：prompt 包含/不包含 roster；worker 不出现 delegate 块；非 cloudHost 路径
  不出现 delegate 块；超限失败关闭。

### 3. cloud host 委派链

- `packages/dsh-rayrun-bots/cloud-host/lib/host.mjs`：
  - 抽取可复用的 `runTurn(botId, task, { sessionId, prompt })`，统一 agent 调用、
    transcript、outbox、结果、错误处理；`processNext` 复用它。
  - `validateTask` 接受有界的 `delegation` 元数据（primary/roster），拒绝未知/超限。
  - primary task 完成后：
    - 解析 `rayrun-delegate` 块；无块则正常写 outbox；
    - 有合法块：写 delegation record（`state=running, phase=worker`），调用 worker
      `runTurn`；worker 结果后写 `state=done, phase=worker`，再调用 primary 的第二次
      `runTurn`（同 session，result prompt），最终写原 primary task outbox；
    - 第二次 primary turn 出现的 delegate 块不执行；只记录为 ignored；
    - 初始中间 reply 不写用户 transcript；worker 的 transcript 写入其 bot 目录；
    - 非法块：不调用 worker，primary 最终回复带可见错误；
    - 第二次 primary turn 失败/为空/超时：写 host fallback 到 outbox，包含 worker
      名、状态、reply 或 error；不丢 worker 结果；
    - 整条链有硬 deadline；超时先写 fallback，再结束 task。
  - `recover()`/`processNext` 识别已有 delegation record：
    - `state=done, phase=worker` 或 `state=running, phase=summary`：只补 primary
      总结，不重复 worker；
    - `state=running, phase=worker`：无法确认副作用是否已发生，标记 failed 并写
      fallback，不自动重跑；
    - `state=waiting-approval`：保持等待，不重跑。
- `cloud-host/lib/proposal.mjs` 或 `cloud-host/host.mjs` 的 wrapper：
  - worker approval block 改写为 primary 的 proposal；保留原有 typed action 校验；
  - 最终回复追加 host 生成的 approval 提示，不依赖 primary 文本。
- 测试：fake agent + temp root：
  - primary 委派 → worker transcript/outbox → primary 最终 reply；
  - 无委派块 → 直接回复，不创建 delegation；
  - 第二次 primary turn 的 delegate 块被忽略；
  - primary 第二次 turn 失败 → fallback 含 worker 结果；
  - worker 失败 → primary 收到失败摘要；第二轮也失败 → fallback 含错误；
  - worker approval → primary proposal、delegation waiting-approval、确定性提示；
  - 非法目标/自委派/多块/超限；
  - deadline 超时 → fallback；
  - 崩溃恢复：`done, phase=worker` 不重复 worker；`running, phase=worker` 不重跑、
    写 failed。

### 4. 本地收取最终结果与状态

- `lib/cloud-host-runtime.js` 的 collect 继续返回 primary 最终 reply；task id 不变。
- `lib/sessions.js` 不需要委派 hook；只保持现有 detached collect。
- 本地 UI 在 primary 回合完成时显示最终总结；worker 的 delegation 细节不在本地
  transcript（见风险）。
- 测试：primary outbox final 只产生一条 bot message；worker outbox 不串到 primary；
  重开 poll 收最终结果；多 task/重启后 collect 游标不跳过最终 outbox，重复 poll 不
  重复 bot message。

### 5. 审批汇总接线

- 本地 `cloud-approval-bridge` 继续按 bot 导入；primary 的 proposal 走现有路径。
- 确认 `approvalContextFor` 对 primary 生效；Continue 后 primary 能看到结果。
- 测试：worker approval 不写 worker proposals；primary proposal 导入；批准后本地执行；
  primary Continue；拒绝不执行。

## 关键文件

- `packages/dsh-rayrun-bots/lib/superagent.js`（新）
- `packages/dsh-rayrun-bots/index.js`（primary、roster、delete、RPC）
- `packages/dsh-rayrun-bots/lib/rayrun-runtime.js`（prompt）
- `packages/dsh-rayrun-bots/lib/cloud-host-runtime.js`（task 元数据）
- `packages/dsh-rayrun-bots/cloud-host/lib/host.mjs`（委派链）
- `packages/dsh-rayrun-bots/cloud-host/lib/proposal.mjs` / `cloud-host/host.mjs`
  （worker approval → primary proposal）
- `packages/dsh-rayrun-bots/client.js`（primary 排序/默认/删除禁用/Setup）
- `packages/dsh-rayrun-bots/locale/en.json`、`zh.json`（三处同步）
- 测试：`test/superagent.mjs`、`test/cloud-host.mjs`、`test/cloud-host-runtime.mjs`、
  `test/session-runtime.mjs`、`test/rpc-contract.mjs`、`test/client-contract.mjs`、
  `test/locale-audit.mjs`

## 验证

1. 单元/契约：
   - `node packages/dsh-rayrun-bots/test/superagent.mjs`
   - `node packages/dsh-rayrun-bots/test/cloud-host.mjs`
   - `node packages/dsh-rayrun-bots/test/cloud-host-runtime.mjs`
   - `node packages/dsh-rayrun-bots/test/session-runtime.mjs`
   - `node packages/dsh-rayrun-bots/test/rpc-contract.mjs`
   - `node packages/dsh-rayrun-bots/test/client-contract.mjs`
   - 全量 `test/*.mjs` + `git diff --check`。
2. 页面 smoke：空 profile 自动出现 primary 并默认选中；创建 worker；明确点名 worker
   时 primary 委派；worker 完成；primary 总结；worker approval 出现在 primary；
   删除 primary 被拒；简单问题不产生 delegation。
3. 行为验证：用清晰匹配 worker 的问题和简单问题各跑一轮，检查 delegate 块出现/
   不出现；记录实际是否委派。若模型不委派，不改代码判断为 bug，记录为模型行为，
   在 UI/文案上不承诺“总是自动委派”。
4. 成本/时延：记录简单直答、委派链（primary 初判 + worker + primary 总结）的墙钟
   时间；若 cloud host 日志有 token/usage 读数则一并记录。不在产品文案中声称与单
   bot 成本相同；单任务变慢是已接受的代价。
5. 合盖 live（dev/生产 sandbox，按现有验收规范）：
   - primary task 被接受后 kill 本地 DSH；
   - 云端 primary→worker→primary 链继续，worker 写出真实文件；
   - 重开同一 `DSH_HOME`，primary 收到最终总结；
   - worker 中途审批：重开后 primary 卡片 pending，批准/拒绝后 Continue；
   - 测试机在记录结果后 destroy，不留下创建给本次测试的机器。
6. 恢复：cloud host 在 worker 完成后、primary 总结前被杀；重启后不重复 worker，
   只补 primary 总结；在 worker 执行中被杀则失败关闭并写 fallback，不重跑。记录可在
   `delegations/` 验证。
7. 迁移：已有 roster 新增 primary，worker 不变；primary 记录损坏失败关闭；记录的
   bot 缺失时重建默认 primary。

## 风险与开放问题

- **链的恢复/幂等**：cloud host 在 primary 初始回复后、worker 完成前崩溃，必须避免
  重复副作用。第一版用 delegation record 做“worker 完成后不重复”的恢复；如果 worker
  中途崩溃，失败关闭并让用户重试，不静默重放。
- **链的时长/成本**：primary 链包含两次 primary + 一次 worker，可能超过单 task 900
  秒，token/时延也明显高于直答。第一版给委派链设更短硬上限；超时返回 failed/
  fallback，不假装成功；不把委派包装成“总是更快”。
- **委派是模型行为**：公开实验显示中立 prompt 下单会话 0/5 委派，原型也没有证明
  自动路由稳定。prompt 只能提高概率；第一版不承诺“总是委派给正确 worker”。如果
  实测委派率低，下一步是规则/显式点名，不是继续堆 prompt。
- **Router 单点/总结失败**：即使 host 有 fallback，primary 的初判仍可能不委派、委派
  错对象或总结遗漏。fallback 只保证 worker 结果不丢，不保证 primary 的判断正确。
- **worker transcript/审计**：第一版不把 delegated worker 的完整 transcript 镜像到
  本地 worker 历史；primary 总结和 host fallback 是权威，delegation record 只在云端。
  若用户打开 worker，可能只看到本地旧历史。后续可把 worker 结果写回本地 transcript
  或提供只读的 delegation 详情；在做到之前不要声称“完整可审计”。
- **跟进上下文**：委派之后的后续消息仍回 primary，不自动续接 worker 的上下文；第一版
  没有 Thread Subscription。primary 只能靠自己的会话和 worker 结果继续。
- **审批 owner**：v1 明确“审批后不自动恢复 worker”：worker proposal 改写到 primary，
  worker 原回合结束；用户批准/拒绝后 Continue，由 primary 重新委派或总结。若产品
  后续要求无缝续跑 worker，需要任务层和 worker session 恢复，不在本版。
- **primary 权限**：primary 仍有完整云电脑工具，可能自己做而不是委派；prompt 只做
  引导，不是确定性 router，也不构成安全边界。
- **账户边界**：一个 DSH profile = 一个 Rayrun 账户；多账号/多 profile 不做。
- **多 worker 并发**：平台仍串行；不要承诺并行。
- **primary 删除/更换**：第一版拒绝删除，不做更换 UI；需后续产品决策。

## 来源

- [Super-agent 启示：从 Session 到任务系统](../research/superagent-lessons.md)
- [dsh-superagent-prototype](https://github.com/deepseek-ai/dsh-superagent-prototype)（研究原型，不是生产依赖）
- [阿里云：DeepSeek Super-agent 架构解析](https://developer.aliyun.com/article/1779111)（二手分析）
- 公开转载与第三方实测（知乎、CSDN、掘金等）用于校验轮询漏任务、token/时延和
  prompt 软约束；它们是二手材料，不作为实现事实源。
