# MVP 计划 — v0.1（详细）

*状态：2026-11-22。首个版本的详细执行计划。范围已冻结；只交付下面的 P0 项。估算单位
是工程师日，假设 1–2 名工程师加编码 agent；调研给出的 4–6 周估算假设云电脑层原样复用，
且没有平台阻塞。实现状态以 [../12-status.md](../12-status.md) 为准。相关：
[客户端计划](client-plan.md)、[平台需求](../08-integration.md)、
[系统架构](../01-system-architecture.md)、[路线图](roadmap.md)。*

## 0. 怎么读这份计划

- §2 是签收表（A1–A12）；无法演示的行阻塞发布。
- §5 是带 ID、交付物、依赖和估算的工作项；§6 把它们排成里程碑 M0–M5。
- §4 固定接口，让 host、bot runtime 和客户端能对着 stub 并行构建。
- §3 之外都不在范围内；§11 的未决项在 M1 前到期。

## 1. MVP 是什么

一个人，在自己的笔记本上，安装 Rayrun Bot 的 DSH 插件——它把独立的云电脑插件作为
依赖拉进来——登录自己的 Rayrun 账号，存入自己的 DeepSeek key，创建一台云电脑，创建
一个有名字的 bot，和它对话，合上笔记本；bot 完成一个后台任务，并停在一个审批上。
用户在浏览器里批准，bot 继续，机时账单可见。这就是整个 MVP。

Alpha 第一天我们必须能录下来的演示：

1. 全新的 DSH profile；按文档安装路径装两个插件；重启。
2. 登录 Rayrun；存入 DeepSeek key。
3. 创建云电脑（一屏）；打开它的桌面。
4. 创建一个叫“weekly-watch”的 bot；给它一条指令。
5. 给它一个任务；看回复在面板里流式出现。
6. 关闭本地 DSH；bot 继续工作。
7. 重新打开：任务完成，bot 在等一个审批。
8. 批准；bot 执行受限动作；成本栏显示花费。

## 2. 验收任务 — v0.1 签收

每一行都必须以所述证据通过；无法演示的行阻塞发布。自动行用普通 Node 测试
（`node test/*.mjs`）；手动行记录为截图加日志文件。

| ID | 任务 | 通过证据 |
| --- | --- | --- |
| A1 | 干净机器安装 | 全新 DSH profile：按文档安装路径装两个插件，重启，两个页面都加载；缺依赖时显示可执行错误；≤ 3 分钟 |
| A2 | 登录与 key | Rayrun 登录把 token 存进 vault；DeepSeek key 存为 Rayrun credential；没有 token 时工具返回 `token_required` |
| A3 | 创建云电脑 | ≤ 15 秒，至少 2 GB，桌面可选；余额和机时可见 |
| A4 | 创建 bot 并对话 | 带指令的有名字 bot 出现在聊天列表，流式回复，它的目录存在于机器上（`rayrun_files` 证据） |
| A5 | 笔记本合上 | 本地 DSH 关闭时，bot 完成一个后台任务；重新打开显示结果，两侧都有时间戳 |
| A6 | 批准 | 受限动作停下；卡片 10 秒内出现；批准后 bot 10 秒内继续；副作用只在决定之后发生 |
| A7 | 拒绝与过期 | 拒绝意味着没有副作用；后台卡 30 分钟后过期并被拒绝；聊天发起的卡等待；重放、错 bot 和过期请求被拒绝并记录（负向测试） |
| A8 | 续接 | 同一个 bot 的第二次对话接着第一次，host 进程被杀后以及机器 stop/start 后仍能续接 |
| A9 | 恢复 | 杀死 bot runtime 不丢排队工作；watchdog 60 秒内重启它，队列排空 |
| A10 | 成本与生命周期 | 余额和机时可见；idle stop 只停，永不 destroy；`destroy` 只来自明确的人类动作 |
| A11 | 安全回归 | 仓库、日志和工作区扫描不到 token 和 key；没有公网 ingress；审批负向测试全绿；依赖版本检查强制执行 |
| A12 | 发布 | 干净机器上验证三分钟安装路径；npm tarball 包含 host half、client half、locale 和 bundle patch；CI 全绿 |

A6/A7 中“本地 typed 动作”已由 ADR-019 解阻；云端凭据动作仍受 [08 §3.3](../08-integration.md)
限制，云提案 bridge + stop 已 live；它们仍是签收
标准。

A1–A12 之后的 alpha 门：10–20 名种子用户；首个 bot 成功率 ≥ 80%；第 2 周留存 ≥ 40%；
零计费投诉。这些是信号，不是发布门。

## 3. 范围

范围内——P0，除非标 P1：

| 项 | 说明 |
| --- | --- |
| Bot 注册表：名字、标签、头像、指令、技能、记忆目录 | bot 是机器上的 profile 目录，不是代码 |
| 聊天列表、对话和每 bot 详情面板 | Grok Bot 三栏壳；在 API 允许的地方复用 DSH 聊天 |
| Bot↔session 映射 | 持久化在机器上，本地镜像 |
| 云端 bot runtime：队列、inbox/outbox、watchdog | 一次一个 agent 任务 |
| Fail-closed 审批门 | TTL 30 分钟、防重放、本地执行 claim、审计行；ADR-019 本地 typed 动作与云提案 bridge 已实现，真实 cloud proposal + stop 已 live |
| 内联审批卡 | 对话里的卡片；聊天列表的点标记关注 |
| 云电脑依赖集成 | 依赖声明、版本检查、缺插件错误 |
| 成本栏：余额和机时 | 按 bot 归因是 P1 |
| Onboarding 向导 | 登录 → key → 电脑 → 第一个 bot |
| npm 包、CI、DSH 版本矩阵 | 发布 v0.1.0 必需 |
| 定时唤醒，每 bot 一个 cron（P1） | 只在 W3 按计划结束时做 |

范围外——刻意不做：多租户 SaaS、托管账号、团队/RBAC、IM 通道（v0.2）、移动 App、
市场、供应商抽象、独立桌面壳、浏览器登录持久化、公网 ingress 面板、bot-to-bot 交接和
协调者 bot（v0.2 候选），以及一台电脑上并行执行多个 bot。MVP 用队列串行化 bot；在
平台能一台机器跑多个 agent 任务之前，这是特性。

## 4. 架构与接口

本地（插件侧）文件布局见 [06-local-state.md](../06-local-state.md)。

### 4.1 冻结决策

1. **没有入向网络。** 本地 → 云端控制走 Rayrun API；云端 → 本地状态写成
   `/workspace/.rayrun/` 下的文件。公网桌面端口绝不用作产品面板。
2. **每人一台电脑**，由这个人的 bot 共享。Rayrun 一台机器只跑一个 agent 任务
   （`409 sandbox_busy`），所以 bot runtime 拥有一个 FIFO 队列。
3. **Bot 状态住在机器上**；本地保留只读镜像，并把它拉回来作为恢复锚点。
4. **机器上的常驻 host**：一个小 Node supervisor，由现有 worker projection 交付，
   运行队列和 DSH session；本地 watchdog 通过 `exec` 重启它。
5. **审批执行采用本地权威（ADR-019，2026-11-23 定）。** 云端只提案；本地 DSH host
   生成并保存决定/执行 claim，用本地 Rayrun token 执行 typed 动作。首版允许机器
   start/stop，`destroy`/创建/shell/任意命令不在 allowlist。云端凭据动作仍等待平台
   host/agent 隔离和 host-only 端点（[08-integration.md](../08-integration.md) §3.3）。
   云提案 bridge + stop 已 live 验证；文件邮箱不是授权路径。
6. **Session 策略由 spike S1 决定**：优先机器上的长驻 DSH 进程；回退到每轮 headless
   加 session id；最后手段是 transcript 重放。
7. **独立项目，一条依赖边。** `dsh-rayrun-computer` 留在自己的仓库，作为 npm 依赖
   （MIT）被消费。bundle 计划声明该依赖，让一次安装带两个；S6 决定，文档化的两装路径
   是回退。
8. **一个队列，一个 agent 任务。** Host 绝不依赖平台排队；busy 重试，绝不丢弃。
9. **权限划分。** 所有权和决策 local-first，执行在云端；见
   [01-system-architecture.md](../01-system-architecture.md#51-真相在哪)。

### 4.2 机器内布局

```
/workspace/.rayrun/
├── bots/<botId>/
│   ├── bot.json            # definition + schema version
│   ├── memory/             # per-bot notes and artifacts
│   ├── sessions/           # session ids + transcript refs
│   ├── queue.jsonl         # append-only FIFO work items
│   ├── approvals/          # req-<id>.json, res-<id>.json
│   └── log/bot.jsonl       # host log, no secrets
├── host/state.json         # supervisor pid, health, schema version
└── outbox/events.jsonl     # events for the local UI, append-only
```

### 4.3 Schema（数据结构）

**`bot.json`** — `{ schema: 1, id, name, label, avatar, instructions, skills: [], model?: "deepseek", createdAt, updatedAt }`。
`id` 是 kebab-case，每个用户唯一；`name` 是 Title Case 显示名；`label` 是名字下方的一行
职责；`avatar` 在 v0.1 是字母头像规格（`{ kind: "monogram", letter, hue }`）；指令是
纯 markdown，上限 8 KB。新 bot 从
[bot-persona.md](../design/bot-persona.md) §6 的默认指令模板开始。

**队列项** — `{ id, botId, kind: "message" | "task" | "wake", text, createdAt, state, attempts }`，
状态为 `queued → running → waiting_approval → done | failed | cancelled`。每台机器
一个在途项；其余保持 `queued`。

**审批请求** — `{ schema: 1, id, botId, actionId, nonce, actionHash, action,
risk: string[], origin: "chat" | "background", createdAt, expiresAt }`；**决定** —
`{ schema: 1, id, botId, actionId, actionHash, nonce, decision: "approve" | "deny",
decidedAt, decisionId }`。两者都先写临时文件名再就位，且不覆盖已有文件；决定必须匹配
id、botId、actionId、nonce 和 actionHash。聊天消息发起的卡无限等待；后台工作发起的
卡 30 分钟后过期并拒绝。Action hash 对 canonical JSON（排序后的 key，无空白）覆盖
`{ schema, botId, actionId, action, risk, origin, expiresAt }`，所以过期卡不能批准
另一个动作。

**Outbox 事件** — `{ seq, at, botId?, type: "status" | "message" | "approval" |
"error", payload }`；客户端按 `seq` 游标读取，忽略早于其 checkpoint 的 gap。

**错误码**（稳定，RPC 和日志共用）：`E_DEP_MISSING`、`E_DEP_VERSION`、
`E_TOKEN_REQUIRED`、`E_KEY_REQUIRED`、`E_MACHINE_STOPPED`、`E_MACHINE_BUSY`、
`E_APPROVAL_EXPIRED`、`E_APPROVAL_REPLAY`、`E_APPROVAL_UNKNOWN`、`E_APPROVAL_INVALID`、
`E_HOST_DOWN`、`E_BOT_UNKNOWN`、`E_BOT_INVALID`、`E_BOT_EXISTS`、`E_QUEUE_FULL`、
`E_SESSION_INVALID`、`E_RUNTIME_UNAVAILABLE`、`E_BALANCE_LOW`、`E_INTERNAL`。

### 4.4 RPC 表面

客户端 ↔ host 契约定义在 [client-plan.md](client-plan.md)：同源
`/plugins/<bundle-id>/rpc`，大小限制的 JSON，入 `{ action, payload }`，出 `{ ok, data }`
或 `{ ok: false, code, message }`。响应绝不携带 Rayrun token 或 DeepSeek key。Bot
runtime 没有公开 RPC；它由 host half 通过依赖的 `rayrun_*` 工具或 RPC 路由驱动，由
spike S6 决定。

### 4.5 依赖契约

- **我们使用：** `rayrun_*` 工具（create/stop/pause/resume/destroy、`exec`、`files`、
  `agent`、`dsh`、`workspace`），它们确切的名称和语义，以及 host-to-host 直接调用
  更便宜时的同源 RPC 路由。
- **版本检查：** host 启动时记录已安装版本，缺失/不兼容时以 `E_DEP_MISSING` /
  `E_DEP_VERSION` 失败，并给一句该装什么。
- **绝不：** 编辑、fork 或 vendor `dsh-rayrun-computer`；它需要改的地方去它自己的仓库
  开 issue。
- **不是依赖：** `dsh-superagent-prototype`——只供参考的研究原型，没有云电脑、持久
  bot 对象或远程审批。我们借想法，不借代码，v0.2 事件触发器时再回来看。

## 5. 工作流与任务分解

估算包含测试；“完成条件”是证据，不是代码写完的声明。

### A. 仓库、打包、发布

| ID | 任务 | 交付物 | 依赖 | 估算 | 完成条件 |
| --- | --- | --- | --- | --- | --- |
| A1 | 搭 `packages/dsh-rayrun-bots` | package.json（`dsh.bundle` + `dsh.client.inject`）、`cordis.patch.yml`、`index.js`、`client.js`、`lib/`、`locale/en+zh`、`test/` | — | 2 | bundle 能在 profile 加载并渲染空页面 |
| A2 | 依赖声明 + 版本检查 | 依赖范围、`E_DEP_MISSING`/`E_DEP_VERSION` 文案 | A1 | 1 | 没有依赖的新 profile 显示动作，而不是崩溃 |
| A3 | Host RPC 路由 + 信封 + 限制 | `/plugins/<id>/rpc`、`{ok,data}` / `{ok:false,code,message}`、64 KB body 上限 | A1 | 1 | 成功和每个错误码都有契约测试 |
| A4 | CI | `node --check`、`node test/*.mjs`、locale 审计、`git diff --check`、Node × DSH profile 安装冒烟 | A1 | 1 | 失败测试或 DSH 安装让 CI 变红 |
| A5 | npm 发布流程 | tarball 检查、bootstrap token → OIDC trusted publishing | A4 | 1 | dry run 列出 host/client/locale/bundle 文件 |
| A6 | 版本矩阵 | DSH × `dsh-rayrun-computer` × Rayrun Bot 表 | A2 | 0.5 | 表已提交，并从 12-status 与版本矩阵链接 |
| A7 | 包文档 | 带安装路径和限制的包 README | A5 | 0.5 | 新用户能从 tarball 安装 |

### B. Bot 模型与本地状态

| ID | 任务 | 交付物 | 依赖 | 估算 | 完成条件 |
| --- | --- | --- | --- | --- | --- |
| B1 | `bot.json` schema + 校验 | id/name/label/avatar/instructions 校验器 + 默认人格模板；`schema` 版本 | A1 | 1 | 非法定义返回 code 被拒；新 bot 得到默认模板 |
| B2 | 机器布局初始化 | 幂等目录创建 | B1 | 0.5 | 重复运行不丢文件 |
| B3 | 注册表 + 本地镜像 | host 缓存、刷新时轮换 | B1 | 1 | 镜像在 host 重启后仍存在 |
| B4 | Bot CRUD RPC | list/get/create/update/delete | A3, B1 | 1.5 | 契约测试，delete 移除机器目录 |
| B5 | 恢复拉取 | 把 bot 目录拉到本地快照 | B3 | 1 | 丢失机器后可恢复 |
| B6 | 迁移跑道 | schema 字段 + 升级函数 | B1 | 0.5 | 旧 `bot.json` 仍能打开 |

### C. 云端 bot runtime

| ID | 任务 | 交付物 | 依赖 | 估算 | 完成条件 |
| --- | --- | --- | --- | --- | --- |
| C1 | Supervisor 模块 | 由 worker projection 交付的 host 代码，哈希校验 | A2 | 2 | 文件落到新机器 |
| C2 | 启动 + 握手 | `exec` 启动、pid/state、首次心跳 | C1 | 1 | host 无需手工 shell 就能启动 |
| C3 | 队列 worker | FIFO、单飞、重试/退避 | C2 | 2 | 第二个项等待，绝不丢弃 |
| C4 | DSH 调用 | 按 S1 策略：prompt 进，stream 出 | C3 | 2 | 任务 → session 里的回复 |
| C5 | Inbox/outbox 轮询 | 3 秒轮询、游标、去重 | C3 | 1.5 | 消息往返 < 5 秒 |
| C6 | Watchdog | 本地 `exec` 在心跳缺失时重启 | C2 | 1 | 被杀 host 60 秒内回来 |
| C7 | 健康与状态 | 心跳 → `host/state.json` → 名册状态 | C2 | 1 | 聊天列表显示 needs-attention / working / idle |
| C8 | 恢复 | 重启后重读队列和审批状态 | C3 | 1.5 | 杀死 host 不丢工作 |
| C9 | Busy 处理 | 409 映射、重试预算、绝不丢弃 | C4 | 1 | busy 测试：所有项最终都运行 |

平台答复（2026-11-22）：R-G008 runtimes API 已实现并本机 dev 全量验收通过（`rayrun-bot-gaps`，
`4709ac0`），待部署。C2/C6 应改为向 `/v1/sandboxes/{id}/runtimes` 注册受监督进程
（`restart=always`、`autostart`、`keep_alive`），不再依赖本地 `exec` watchdog；C1 仍需
把 host 代码送进镜像。D1 的 session 由 host 自己写 `/workspace`，平台不提供 session
对象。host 资产已在 `cloud-host/`；自动 projection 页面 E2E 已通过（2026-11-23）。
本地 typed 审批执行与云提案 bridge 已按 ADR-019 实现，真实 cloud proposal + stop 已
live；云端凭据动作仍待做；见
[`../08-integration.md`](../08-integration.md) §3.1/§3.3。

### D. Session（会话）

| ID | 任务 | 交付物 | 依赖 | 估算 | 完成条件 |
| --- | --- | --- | --- | --- | --- |
| D1 | S1 策略实现 | 按选定方案创建/继续 session | C4 | 2 | 两个 prompt 共享一个 session |
| D2 | 映射持久化 | bot↔session↔profile 目录，重启安全 | D1 | 1 | 映射在 host 重启后仍存在 |
| D3 | Transcript 捕获 | 脱敏的 `sessions/*.jsonl`、UI 游标 | D1 | 1.5 | 历史按顺序重放 |
| D4 | 续接测试 | host kill、机器 stop/start、新聊天 | D2 | 1 | A8 证据 |
| D5 | 回退路径 | 契约失败时重放 transcript | D3 | 1 | 回退已测试并记录 |

### E. 审批

**本地执行（ADR-019，2026-11-23）。** E2/E4/E5/E6/E7 的协议、RPC、TTL、负向
测试和审计已实现；E1 的本地 typed executor（`lib/approval-actions.js`、
`lib/approval-executor.js`）允许机器 start/stop，带 at-most-once claim；E3 的云提案
poller 已由 `approvals.sync` + `cloud-approval-bridge` 实现（fake 测试和真实 cloud
proposal 闭环均通过；host-only `approvals.propose` 仍为本地 seam）。云端凭据动作仍等待平台
隔离/端点（[08 §3.3](../08-integration.md)）。

| ID | 任务 | 交付物 | 依赖 | 估算 | 完成条件 |
| --- | --- | --- | --- | --- | --- |
| E1 | Gate API | `requestApproval(action)` 在副作用前阻塞 | C4 | 1.5 | 受限步骤绝不提前运行 |
| E2 | Request writer | nonce、actionHash、TTL、原子 rename | E1 | 1 | 两个文件的 schema 测试 |
| E3 | 本地 poller | 轮询、去重、驱动卡片状态 | E2 | 1.5 | 卡片 10 秒内出现（fake + 真实 cloud proposal 已通过） |
| E4 | 审批 RPC | `list/get/decide`，按 id 幂等 | A3, E3 | 1 | 契约测试 |
| E5 | TTL 与过期 | 默认 30 分钟，过期即拒绝，清理 | E2 | 1 | 过期请求不能执行 |
| E6 | 负向测试 | 重放、错 bot、stale action、格式错误 | E4 | 2 | 套件全绿，并在 A7/A11 引用 |
| E7 | 审计行 | 每个请求和决定一行，无密钥 | E4 | 0.5 | 日志格式已检查 |

### F. 客户端

详见 [client-plan.md](client-plan.md)；估算也在那里。工作流 C1–C6（壳、聊天列表、内联
审批、onboarding/用量、电脑视图、打磨）从 M1 起对着 stub RPC 构建，所以客户端和 host
可以并行推进。

### G. 成本与运维

| ID | 任务 | 交付物 | 依赖 | 估算 | 完成条件 |
| --- | --- | --- | --- | --- | --- |
| G1 | 余额/机时读取 | adapter 调用 + 解析，不泄漏 token | A2 | 1 | 值在面板可见 |
| G2 | 成本摘要 RPC | 余额、机时、低余额阈值 | G1 | 1 | 警告渲染 |
| G3 | Idle stop 集成 | 只停，任务运行时跳过 | C7 | 1 | 空闲机器停机，永不 destroy |
| G4 | Destroy 护栏 | destroy 只来自明确的人类动作 | C7 | 0.5 | 代码路径审计 |
| G5 | 恢复 runbook | 机器丢失、余额耗尽、依赖丢失 | B5 | 1 | runbook 在 `docs/` |
| G6 | 错误文案审计 | 处处一句 + 一个动作 | F 流 | 1 | 所有 code 都有文案 |

### H. 验收、alpha、发布

| ID | 任务 | 交付物 | 依赖 | 估算 | 完成条件 |
| --- | --- | --- | --- | --- | --- |
| H1 | 验收 runner | A1–A12 清单，带证据槽 | 全部 | 1 | 跑一次产出填好的清单 |
| H2 | 集成 harness | 假 Rayrun API + 假 DSH 用于 CI | C4 | 2 | 端到端闭环在 CI 运行 |
| H3 | 实时冒烟 | 真实账号、一个 bot、一次审批 | H2 | 1 | 证据附到 release |
| H4 | 首次发布 | npm 包 + provenance | A5 | 1 | 干净 profile 安装成功 |
| H5 | 发布 | notes、tag `v0.1.0`、版本矩阵 | H1–H4 | 0.5 | release 页面链接证据 |
| H6 | Alpha kit | 20 用户邀请、issue 模板、反馈表 | H5 | 1 | 第一位用户完成 onboarding |

**工作量汇总：** A 7、B 5.5、C 13、D 6.5、E 8.5、F ~22（客户端计划）、G 5.5、
H 6.5 ≈ **74 工程师日**，外加 W0 3 天和 2 周 alpha。两名工程师并行做 host 和客户端
流时，MVP 是 6–8 周日历工作量；一名工程师应按 10–12 周计划。

## 6. 里程碑与排期

| 里程碑 | 周 | 交付工作 | 退出标准 | 演示 |
| --- | --- | --- | --- | --- |
| M0 | W0（3 天） | spike S1–S6，平台问题发出 | 决策记录，go/no-go | 书面决策日志 |
| M1 | W1 | A1–A3、B1–B3、F1、G1 | 名册从 stub 数据只读 | 面板里从空到 stub 聊天列表 |
| M2 | W2 | C1–C5、B4、D1–D2、F2 | bot 端到端回复 | 创建 bot、发任务、得到回复 |
| M3 | W3 | E1–E4、D3、F3、G2–G3（本地 typed 执行与云提案 bridge 已实现，真实 stop live） | 审批闭环工作 | 受限动作 → 卡 → 批准 → 继续 |
| M4 | W4 | E5–E7、D4–D5、C6–C8、F4–F5 | 续接与恢复通过 | 合上笔记本、重开、仍在工作 |
| M5 | W5 | C9、G4–G6、F6、H1–H4 | 干净机器上 A1–A12 通过 | 验收运行录像 |
| Alpha | W6–W7 | H6、修复 | alpha 门 | 10–20 名用户跑闭环 |

如果只有一名工程师：顺序跑 M1→M5，把客户端流并入 host 流，退出标准相同。

## 7. 测试与证据

- **单元** —— 纯模块（队列、审批状态机、bot schema、formatter）作为
  `node test/*.mjs`；无框架。
- **契约** —— 对着 stub 的 RPC 请求/响应和错误码。
- **集成** —— H2 harness：假 Rayrun API 和假 DSH；CI 在没有真实凭据的情况下跑闭环。
- **实时冒烟** —— 真实 Rayrun 账号，手动，绝不在 CI；记录验收清单。
- **验收** —— 干净 profile 上跑 A1–A12；证据（截图、日志）附到 release notes，绝不
  连同密钥提交。
- v0.1 没有浏览器测试框架；客户端的手工 golden path 是
  [client-plan.md](client-plan.md) 里的清单。

## 8. 平台依赖

来自 [08-integration.md](../08-integration.md) 的 MVP 阻塞项：session/长驻 runtime
契约（#1）、余额宽限（#2）、host/agent 权限隔离与 host-only 审批端点（#3.3，
ADR-001，针对云端凭据动作）。其他都有 workaround：文件邮箱轮询做控制、本地
watchdog 重启、账号 token 放 vault、无入向网络、S6 失败时两装路径。ADR-019 已给
本地 typed 动作提供本地执行路径；云端凭据动作仍没有执行 workaround。

## 9. 风险

| 风险 | 触发 | 缓解 | 回退 |
| --- | --- | --- | --- |
| Session 契约不是我们以为的那样 | S1 的 host 和 id 续接都失败 | transcript 重放，砍范围 | 不带续接发布，并明确说明 |
| 长驻 host 无法重启 | S2 显示无法保活 | 本地 watchdog + open-on-connect | 记录“打开面板时 host 重启” |
| 审批延迟太高 | S3 p95 超过 10 秒 | 更短轮询、基于 exec 的邮箱 | 把 IM 提前到 v0.2 |
| 依赖安装摩擦 | 一次安装失败，或包一直不上 npm | 文档化两装路径、版本检查 | alpha 期间从 checkout 装两个 |
| 依赖漂移 | 上游工具名/RPC 变化 | 版本契约 + adapter + 契约测试 | 固定已知版本 |
| 余额耗尽销毁数据 | 账号归零 | 警告、建议生命周期上限、本地拉取状态 | 恢复 runbook |
| 范围蔓延 | IM、桌面、routines 进入 W3 | W3 门砍 P1 | 只交付 P0 |
| 公网 ingress 诱惑 | 有人要面板 URL | 禁止：无入向、不用 `public` 桌面 | 本地 UI |
| DSH 版本漂移 | 镜像与笔记本不一致 | M5 的版本矩阵 | 固定镜像请求 |

## 10. 指标

安装 → 登录转化；首个 bot 成功率；审批延迟 p50/p95；第 2 周留存；每用户恢复事件
（watchdog 重启、续接 session）；每用户支持问题；每用户每周 Rayrun 花费。

## 11. 未决决策

1. **Bot 并发** —— v0.1 串行队列（推荐）还是每 bot 一台机器。W0 到期。
2. **Routines** —— 每 bot 一个 cron 作为 P1（推荐）还是完全砍掉。W0 到期。
3. **审批通道** —— v0.1 文件邮箱，v0.2 IM（推荐）。W0 到期。
4. **已解决（2026-11-11）** —— `dsh-rayrun-computer` 保持不动，留在自己的仓库；
   Rayrun Bot 是依赖它的独立项目。未决子决策：一次安装依赖（S6）还是文档化两装回退。
5. **npm 所有权** —— 哪个账号拥有两个包、谁发布依赖、谁配置 trusted publishing。
   W1 到期。

统一评审与决策日志，包括信任边界、所有权和控制通道问题，见
[architecture-decisions.md](../adr/architecture-decisions.md)。

## 12. v0.1.0 发布清单

- [ ] A1–A12 在干净机器上带证据通过。
- [ ] CI 全绿：检查、单元测试、契约测试、集成 harness。
- [ ] Locale 审计通过；每个错误码都有一句文案。
- [ ] 版本矩阵更新；依赖范围固定。
- [ ] diff、日志、fixture 或 tarball 中没有密钥、token 或 key。
- [ ] `12-status.md`、`09-deployment.md` 和 README 营销叙事与已发布行为一致。
- [ ] npm tarball 包含 host half、client half、locale 和 bundle patch。
- [ ] `v0.1.0` 从 `main` 打 tag；release notes 链接验收证据。
- [ ] 发布后验证一次从 npm 的干净 profile 安装。
- [ ] Alpha kit 就绪：邀请文案、issue 模板、反馈表。

## 13. v0.1 之外

多租户 SaaS、托管账号、团队/RBAC、IM 通道、移动 App、市场、供应商抽象、独立桌面壳、
浏览器登录持久化、公网 ingress 面板、按 bot 的成本图表、自定义主题，以及多 bot 并行
执行。

## 14. Week 0 清单

第 1 天 —— S1 session 契约；S2 长驻 host；客户端 spike C-S1（壳）。
第 2 天 —— S3 审批邮箱延迟；S6 bundle 依赖；把
[08-integration.md](../08-integration.md) 的问题 #1 和 #2 发给 Rayrun。
第 3 天 —— 记录决策日志（session 策略、一次安装 vs 两次安装、routines 进/出），冻结
§4 接口，开始 M1。
