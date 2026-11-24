# 06 — 本地文件与状态

> 状态：2026-11-23。本文定义插件包、本地状态目录与云电脑镜像的文件布局、原子写、
> 权限与保留规则。技术基线见 [`01-system-architecture.md`](01-system-architecture.md)；
> 云端 bot runtime 见 [`04-cloud-host.md`](04-cloud-host.md)；审批文件见
> [`05-approvals.md`](05-approvals.md)；未决决策见
> [`adr/architecture-decisions.md`](adr/architecture-decisions.md)。
> 实现状态以 [`12-status.md`](12-status.md) 为准。

## 0. 与现有文档的关系

| 文档 | 负责什么 |
| --- | --- |
| [`01-system-architecture.md`](01-system-architecture.md) | 所有权、信任边界与数据流 |
| [`04-cloud-host.md`](04-cloud-host.md) | 机器上的 bot runtime、队列与 session |
| [`05-approvals.md`](05-approvals.md) | request/decision 文件与审批审计 |
| [`plans/mvp-plan.md`](plans/mvp-plan.md) | §4.2/§4.3 的机器布局与 schema |
| [`adr/architecture-decisions.md`](adr/architecture-decisions.md) | ADR-002（所有权）、ADR-003（单写者）、ADR-012（恢复） |

---

## 1. 原则

1. **安装目录不可变。** 代码在插件包里；所有可变状态在 DSH 状态目录，不写在
   `index.js` 旁边。
2. **本地是镜像与控制面。** 云电脑权威运行态；用户 checkout 权威代码；本地文件是
   派生、可重建的。例外：云端 runtime 落地前，roster 的 `bot.json` 先写在本地，
   它是用户意图源；runtime 落地后再同步到机器。
3. **我们不落密钥。** Rayrun token 在 Harness vault，DeepSeek key 在 Rayrun
   credential；本项目不把它们写到文件、日志或镜像。
4. **每个持久文件有 schema 版本、写者和保留规则。** 格式是 JSON/JSONL；写入原子
   （tmp + rename）；日志只追加。
5. **无构建步骤。** 纯 ESM，kebab-case 文件名，一个模块一个职责。
6. **删除本地状态是安全的。** 丢 `$DSH_HOME/state/rayrun-bot/` 只丢缓存和审计历史；
   bot 可以从机器重建。例外：云端 session 镜像落地前，`bots/` 是 Bot 定义与本地对话
   历史的唯一副本，删除会丢定义和 transcript。

---

## 2. 插件包布局

```
packages/dsh-rayrun-bots/
├── package.json          # name、exports、dsh.bundle、dsh.client、files
├── cordis.patch.yml      # 挂载 host half 的 bundle row
├── index.js              # host half 入口：同源 RPC、tools、路由
├── client.js             # client half；页面启动时加载
├── README.md             # 包级安装与限制
├── locale/
│   ├── en.json           # 源文案
│   └── zh.json           # 镜像；key 必须一致
├── lib/
│   ├── rpc.js            # 信封、origin 校验、大小限制
│   ├── bots.js           # registry CRUD
│   ├── bot-schema.js     # bot.json 校验/默认值（迁移计划）
│   ├── local-store.js    # 状态目录、原子写（锁待建）
│   ├── dependency.js     # 依赖检测、版本检查（能力调用计划）
│   ├── sessions.js       # 本地 session 队列 + transcript
│   ├── routines.js       # 每 bot routine、间隔、下一次运行与原子持久化
│   ├── routine-scheduler.js # 本地到期检查，把 routine 入队普通 turn
│   ├── routine-results.js # 云端 routine 结果校验、保留与 history 合并数据
│   ├── cloud-routine-bridge.js # 定义/bot 镜像上传与结果导入
│   ├── runtime.js        # 单轮/detached runtime 契约；默认失败关闭
│   ├── rayrun-rpc.js     # 同源依赖 RPC 调用器
│   ├── runtime-rpc.js    # 依赖 1.2+ runtime.* client
│   ├── rayrun-runtime.js # 依赖 rayrun_agent 的 runtime adapter
│   ├── rayrun-detached-runtime.js # dsh.start/status/result adapter
│   ├── cloud-host-runtime.js # 常驻 host adapter（runtime.* + rayrun_files）
│   ├── host-projection.js # host 资产 SHA-256 manifest/上传/校验
│   ├── bot-workspace.js  # 每 bot 本地 git checkout
│   ├── queue.js          # 本地队列视图（计划）
│   ├── approvals.js      # 审批 request/decision、action hash、TTL、审计
│   ├── setup.js          # onboarding 状态（计划）
│   ├── cost.js           # 余额/机器小时（计划）
│   ├── errors.js         # 稳定错误码
│   └── log.js            # 脱敏 JSONL 日志（计划）
├── cloud-host/
│   ├── host.mjs          # 随包交付的云 host 入口（projection 到机器）
│   └── lib/
│       ├── host.mjs      # queue/transcript/outbox/session id
│       ├── dsh-agent.mjs # headless DSH + --session-id
│       ├── routines.mjs  # routine 镜像校验、云端 claim
│       └── prompt.mjs    # 用镜像 bot.json 组合 routine prompt；DSH session 带对话
├── test/
│   └── *.mjs             # 纯 Node 测试
└── client/               # 仅当 C-S1 证明相对模块加载可行
```

规则：

- `package.json` 的 `files` 必须包含 `index.js`、`client.js`、`cordis.patch.yml`、
  `lib/*.js`、`cloud-host/**`、`locale/*.json` 和 `README.md`；漏一个 host 模块就是坏安装。
- `client.js` 在 v0.1 是**单文件**；DSH 以 client module 加载，无构建步骤。只有
  C-S1 证明相对 import 可用后，才拆 `client/`。
- 依赖方向单向：`index.js` → `lib/*`；`client.js` 自包含；`lib/` 不 import client。
- 用户文案在 `locale/en.json`（源）和 `locale/zh.json`（镜像）；key 用 `bots.*`、
  `approval.*`、`setup.*`、`cost.*`、`error.*`。
- 测试镜像模块：`test/<module>.mjs`；无框架。
- S6 已验证（2026-11-24）：安装文档使用一条 `dsh plugin add` 安装两个包；单包声明依赖
  不会自动启用依赖 bundle。见 [`08-integration.md`](08-integration.md)。

---

## 3. 本地状态目录

`$DSH_HOME` 从环境解析（Windows `%USERPROFILE%\.dsh`，其他 `~/.dsh`）。未设置时不要
静默猜：setup 返回 `E_HOST_DOWN` 和期望路径。首次启动创建，权限仅用户可读。

```
$DSH_HOME/state/rayrun-bot/
├── schema.json              # { schema: 1, pluginVersion, createdAt }
├── bots/<botId>/
│   ├── bot.json             # v0.1 本地意图源；runtime 落地后同步到机器
│   ├── session.json         # 本地 session 状态与队列
│   ├── transcript.jsonl     # 用户/bot/system 消息，只追加
│   ├── routines.json        # routine 定义、间隔、开关和下一次运行；用户意图 + 本地调度状态
│   ├── routine-results/     # 从云端导入的 routine 展示历史，一 task 一文件；不改 session.json
│   ├── approvals/
│   │   ├── req-<id>.json    # 本地校验后的审批提案；不是授权边界
│   │   ├── res-<id>.json    # 本地用户决定
│   │   └── exec-<id>.json   # 本地执行 claim/结果（at-most-once）
│   ├── approval-results/    # 待上传云端的决定/执行结果 outbox
│   └── workspace/           # detached task 的本地 git checkout；.dsh/ 被忽略
├── mirror/
│   └── bots/<botId>/
│       ├── bot.json         # 机器定义的副本（只读）
│       ├── queue.json       # 最近队列快照
│       └── approvals.jsonl  # 云端提案/执行状态镜像（不含本地决定）
├── cache/
│   ├── dependency.json      # 依赖版本/路径，TTL 1h
│   ├── cost.json            # 余额/小时，TTL 15s
│   └── setup.json           # onboarding 状态，TTL 5s
├── outbox/cursor.json       # 客户端已消费的 seq
├── locks/<botId>.lock       # { pid, host, acquiredAt, beatAt }
├── tmp/                     # 原子写暂存；启动时清理
└── logs/
    ├── host.log             # JSONL，5 MB 轮转，保留 3 份
    └── audit.log            # 审批请求/决定/执行，只追加
```

| 路径 | 写者 | 读者 | 密钥 | 保留 | 可重建 |
| --- | --- | --- | --- | --- | --- |
| `schema.json` | host | host | 否 | 永久 | 否（重建） |
| `bots/<id>/bot.json` | host | client、host | 否 | 永久 | runtime 落地前否；之后是机器副本 |
| `bots/<id>/session.json` | host | client、host | 否 | 永久 | session 镜像落地前否；之后可从机器重建 |
| `bots/<id>/transcript.jsonl` | host | client、host | 否 | 永久 | session 镜像落地前否（本地对话历史）；之后可从机器重建 |
| `bots/<id>/routines.json` | 本地 host（用户操作） | host、client | 否 | 永久 | 否；interval/开关是用户意图，nextAt/lastRunAt 是本地调度状态 |
| `bots/<id>/routine-results/<taskId>.json` | 本地 host（从云端导入的展示历史） | host、client | 否 | 最近 400 个 | 是，云端结果仍在时 |
| `bots/<id>/approvals/req-<id>.json` | 本地 host（host-only propose/未来 bridge；proposal 不可信） | host、client | 否 | 永久/过期清理 | 否（审计） |
| `bots/<id>/approvals/res-<id>.json` | 本地 host（用户决定） | 本地 executor、client | 否 | 永久 | 否（审计） |
| `bots/<id>/approvals/exec-<id>.json` | 本地 executor（claim/结果） | host、client | 否 | 永久 | 否（审计） |
| `bots/<id>/approval-results/<id>.json` | 本地 host（待上传云端的结果） | 本地 bridge | 否 | 上传后删除 | 否（审计） |
| `bots/<id>/workspace/` | host（初始化）/依赖的 `dsh.start`（任务 push） | 依赖 worker | 否 | 任务生命周期 | 是（任务结果进入 transcript） |
| `mirror/bots/<id>/` | host | client、host | 否 | 最近状态 | 是，从机器 |
| `cache/*.json` | host | client、host | 否 | 上述 TTL | 是 |
| `outbox/cursor.json` | host | client | 否 | 永久 | 是 |
| `locks/*.lock` | host | host | 否 | 2× 轮询后 stale | 是 |
| `logs/host.log` | host | 用户按需 | 否 | 轮转 | 否 |
| `logs/audit.log` | host | 用户按需 | 否 | 永久 | 否（重要） |

规则：

- **v0.1 没有配置文件。** 非密钥设置放在 profile 的 `cordis.patch.yml` bundle row；
  这个目录只放派生数据和缓存。
- **镜像是可丢弃的。** `rm -rf` 后重开面板，bot 从机器重新列出；只有审计历史不会
  回来，runbook 要明说。session 镜像落地前，`bots/<id>/transcript.jsonl` 也是本地
  对话历史的唯一副本。
- **锁是提示，不是权威。** 超过两个轮询间隔的锁可回收；机器侧队列仍是真相。
- **日志不含 token、key、prompt 或 workspace 内容。** 只记 id、字节数、错误码和耗时；
  审批 action payload 留在本地 approval 文件并会过期/清理。
- 启动时清理 `tmp/`；没人读它们。

---

## 4. 机器上的布局

权威运行文件在 [`plans/mvp-plan.md`](plans/mvp-plan.md) §4.2：

```
/workspace/.rayrun/
├── bots/<botId>/
│   ├── bot.json            # 定义 + schema 版本
│   ├── routines.json       # 本地 host 镜像的 routine 定义（只读；云端不写）
│   ├── routine-results/    # 云端 routine 结果；保留最近 200 个，供本地 sync 导入
│   ├── memory/             # 每 bot 笔记与产物
│   ├── sessions/           # session id + transcript 引用
│   ├── queue.jsonl         # 旧草案；建议拆 inbox/state（ADR-003）
│   ├── approvals/          # req-<id>.json、res-<id>.json
│   ├── host/routines-state.json # 云端 scheduler 的 claim（nextAt/lastRunAt）
│   └── log/bot.jsonl       # host 日志，无密钥
├── host/state.json         # supervisor pid、health、schema
└── outbox/events.jsonl     # 给本地 UI 的事件，只追加
```

方向规则：机器赢运行态（session、队列），本地赢用户意图（创建/编辑/删除）、
审批决定和执行 claim，仓库赢代码。本地镜像**不整体写回**机器；只发送明确动作。

**授权边界：** ADR-019 把本地 DSH host 定为本地 typed 动作的审批权威；`res-` 与
`exec-` 只在本地状态目录，云端 agent 写不到，云端 proposal 只作为不可信请求。云端
凭据动作仍受 ADR-001 平台隔离约束（[`08-integration.md`](08-integration.md) §3.3）。

---

## 5. 格式与原子性

格式固定在 [`plans/mvp-plan.md`](plans/mvp-plan.md) §4.3（`bot.json`、queue item、
approval request/decision、outbox event）。本文补四个本地格式：

- **`schema.json`** — `{ schema: 1, pluginVersion, createdAt }`；host 拒绝更新版本的
  状态，旧版本走迁移。
- **`locks/<botId>.lock`** — `{ pid, host, acquiredAt, beatAt }`；持有者存活时重写，
  干净退出时删除。
- **`approvals.jsonl`** — 计划中的云端镜像；本地实现的审计在 `logs/audit.log`，见下。
- **`logs/audit.log`** — 每行 `{ at, event: "request" | "decision" | "refused",
  requestId, botId, actionId?, nonce?, actionHash?, decision?, decidedAt?,
  decisionId?, code? }`；无 action payload、无密钥；只追加。
- **`logs/host.log`** — `{ at, level, code?, botId?, event, n? }`；字段稳定，runbook
  可 grep。

**写入规则**：所有 JSON/JSONL 写 `name.tmp-<random>`，fsync，rename 到目标；读者在
目标缺失时回退 `name.bak`。JSONL 追加在每 bot 锁下用一次 `appendFile`。**每个文件
一个写者**；需要两个方向时拆文件，不共享追加（ADR-003）。

---

## 6. 权限

- POSIX：目录 `0700`，文件 `0600`；不做 world/group 可读。
- Windows：继承用户 profile ACL；不添加 everyone 可读路径。
- 镜像可能包含用户指令和会话元数据；即使没有凭据，也按私有用户数据处理。
- Harness vault（`.credentials.yaml`）和 Rayrun credential slot **不直接读**；host
  只在需要调用时向 Harness API 取值，且不缓存到磁盘。

---

## 7. 生命周期

| 事件 | 发生什么 |
| --- | --- |
| 首次启动 | 创建状态目录，写 `schema.json`，清 `tmp/`，检测依赖，启动轮询 |
| 升级 | 备份到 `state/rayrun-bot.bak-<version>/`，跑迁移，增加 `schema` |
| 依赖缺失 | 保留状态，写 `cache/dependency.json` 错误，setup 显示 `E_DEP_MISSING` |
| 机器丢失/销毁 | 镜像保留；定义可恢复；destroy 前应拉取；runbook 说明 |
| 卸载 | 删 `$DSH_HOME/state/rayrun-bot/` 和包；Rayrun token 由用户在 vault 吊销 |
| 缓存增长 | TTL、日志轮转、`tmp/` 清理、删除 bot 时清镜像 |

---

## 8. 未决项

| 问题 | 影响 | 决策 |
| --- | --- | --- |
| DSH 是否有每插件状态目录约定？ | 状态路径 | 待确认；没有就沿用本布局 |
| 队列用 `queue.jsonl` 还是 inbox/state？ | 双写/丢更新 | ADR-003 |
| `bot.json` 谁写、删除是否 tombstone？ | 镜像/恢复 | ADR-002、ADR-012 |
| 本地审计是否 tamper-evident？ | 安全声明 | ADR-012 |
| transcript 是否镜像、上限多少？ | 隐私/磁盘 | P1；v0.1 默认只镜像元数据 |

---

## 9. 相关文档

- [`01-system-architecture.md`](01-system-architecture.md)
- [`04-cloud-host.md`](04-cloud-host.md)
- [`05-approvals.md`](05-approvals.md)
- [`07-security.md`](07-security.md)
- [`plans/mvp-plan.md`](plans/mvp-plan.md) §4
- [`adr/architecture-decisions.md`](adr/architecture-decisions.md)
