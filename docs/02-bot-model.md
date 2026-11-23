# 02 — Bot 模型

> 状态：2026-11-24。本文定义 bot 是什么、`bot.json` 的字段与校验、默认指令模板、
> 生命周期与身份边界。产品方向见 [`00-product-direction.md`](00-product-direction.md)；
> 技术基线见 [`01-system-architecture.md`](01-system-architecture.md)；未决决策见
> [`adr/architecture-decisions.md`](adr/architecture-decisions.md)。
> 实现状态以 [`12-status.md`](12-status.md) 为准。

## 0. 与现有文档的关系

| 文档 | 负责什么 |
| --- | --- |
| [`00-product-direction.md`](00-product-direction.md) | 为什么需要 bot、v0.1 范围 |
| [`01-system-architecture.md`](01-system-architecture.md) | bot 在系统中的位置、所有权与信任边界 |
| [`03-client-design.md`](03-client-design.md) | 创建/编辑 bot 的界面与 RPC |
| [`04-cloud-host.md`](04-cloud-host.md) | bot 的 session、队列与执行 |
| [`design/bot-persona.md`](design/bot-persona.md) | 人格、语气、默认模板的完整文案与 UI 位置 |
| [`plans/mvp-plan.md`](plans/mvp-plan.md) | B1–B6 工作项与验收 |
| [`adr/architecture-decisions.md`](adr/architecture-decisions.md) | ADR-002（所有权）、ADR-011（审批 schema）、ADR-012（恢复） |

---

## 1. 定义

**一个 bot 是一个持久对象，不是一次聊天 session。** 它拥有：

| 部分 | 说明 |
| --- | --- |
| 名字与职责 | `name`（Title Case 显示名）与 `label`（一行职责） |
| 头像 | v0.1 是字母 monogram：`{ kind: "monogram", letter, hue }` |
| 指令 | 一段 markdown brief，用户可编辑；上限 8 KB |
| Skills | DSH skills 列表；v0.1 只登记，不提供市场 |
| Memory | 机器上的每 bot 目录，保存笔记、产物与会话日志 |
| Session | 持久 DSH session id；续接而不是重启 |
| Routines | 每 bot 的定时 prompt；存在单独的 `routines.json`，不塞进 `bot.json` |
| Computer | 用户的一台 Rayrun 云电脑；bots 共享，不是安全边界 |

Bot 的定义是**用户意图**，运行态（session、memory、queue）在云电脑上。两者谁写、
冲突怎么处理，见 ADR-002；在它定稿前，本文只定义字段，不定义最终所有权。

---

## 2. `bot.json`

### 2.1 形状

```json
{
  "schema": 1,
  "id": "weekly-watch",
  "name": "Weekly Watch",
  "label": "Watches the weekly numbers and reports",
  "avatar": { "kind": "monogram", "letter": "W", "hue": 152 },
  "instructions": "You are Weekly Watch, a teammate on the user's team.\n...",
  "skills": [],
  "model": "deepseek",
  "createdAt": "2026-11-18T12:00:00.000Z",
  "updatedAt": "2026-11-18T12:00:00.000Z"
}
```

### 2.2 字段与校验

| 字段 | 类型 | 规则 |
| --- | --- | --- |
| `schema` | number | 当前为 `1`；host 拒绝打开更高版本，旧版本走迁移 |
| `id` | string | kebab-case；每用户唯一；创建后不可改；不显示在对话头部 |
| `name` | string | Title Case 显示名；非空；长度上限由 UI/校验共同约束 |
| `label` | string | 一行职责；非空；不换行 |
| `avatar` | object | v0.1 只接受 `kind: "monogram"`；`letter` 单字符；`hue` 为有效色相 |
| `instructions` | string | 纯 markdown；上限 8 KB；新建时填入默认模板 |
| `skills` | string[] | DSH skills 引用；v0.1 只存名字，不提供市场 |
| `model` | string? | 缺省为 `deepseek`；v0.1 不接其他 provider |
| `createdAt` / `updatedAt` | ISO 8601 string | host 生成；客户端不提交 |
| `revision` | number? | **建议**加入，用于乐观并发；见 ADR-002 |
| `deletedAt` | ISO string? | **建议**用 tombstone 表达删除；见 ADR-012 |

**拒绝规则**：未知字段、错误类型、非法 `id`、超长指令、无效 avatar 一律拒绝，返回
稳定错误码和一句可执行提示。`E_BOT_INVALID` 已在
[`lib/errors.js`](../packages/dsh-rayrun-bots/lib/errors.js) 与
[`lib/bot-schema.js`](../packages/dsh-rayrun-bots/lib/bot-schema.js) 落地。

### 2.3 `id` 与显示名

- `id` 由用户输入或从 `name` 推导；冲突时要求用户换一个，不静默加随机后缀。
- `name` 是显示名，可在后续版本修改；`id` 不变，避免 session/审批/目录迁移。
- 删除后用同一个 `id` 重建会与旧 session/审批混淆；建议 tombstone + 新 id，而不是
  复用（ADR-012）。

### 2.4 `routines.json`

Routine 的调度状态（`nextAt`、`lastRunAt`）会变化，但不应该 bump `bot.json` 的
revision，所以它单独存放：

```json
{
  "schema": 1,
  "botId": "weekly-watch",
  "routines": [
    {
      "id": "routine-<uuid>",
      "title": "Morning inbox",
      "prompt": "Summarize anything urgent in the inbox.",
      "everyMinutes": 15,
      "enabled": true,
      "nextAt": "2026-11-23T10:15:00.000Z",
      "createdAt": "2026-11-23T10:00:00.000Z",
      "updatedAt": "2026-11-23T10:00:00.000Z"
    }
  ]
}
```

- 每 bot 最多 32 条；`everyMinutes` 为 1–10080 的整数；`title` 单行，`prompt` 上限
  8 KB；未知字段和错误类型失败关闭（`E_ROUTINE_INVALID`）。
- 本地 host 是定义的唯一写者；到期后 scheduler 先 claim（写 `lastRunAt` 和下一个
  `nextAt`），再把一条普通 turn 入队。错过多个间隔只补一次；claim 后入队失败不
  重放，等待下一间隔。
- 非 cloudHost 模式由本地 scheduler 执行。cloudHost 模式停用本地 scheduler，
  把定义镜像到云端；云 host 在 `host/routines-state.json` 维护自己的 claim，并在
  本地 DSH 停止时继续调度。云任务完成后写 `routine-results/`，本地
  `routines.sync` 导入，`session.history` 合并展示。该云端路径已在 Rayrun
  dev/test 环境 live 验证（2026-11-24）；生产待 R-G008 部署。
- 机器停止期间不能同步定义；机器启动后，云端可能先按旧定义运行一次，直到本地
  sync 覆盖。MVP 不承诺强一致。
- routine turn 走与手动发送相同的 runtime 路径。机器已停止或暂停时，依赖可能按
  普通 send 的行为唤醒它，产生机时费用；routine 的间隔和开关是持续授权，不是逐次
  审批。
- 删除 bot 时整个目录（含 `routines.json`）一起删除。Routine 不新增权限或审批绕过；
  外部动作仍按 ADR-019 处理，routine 轮次产生的审批标记为 `background`，30 分钟后
  过期。范围见 ADR-009。

---

## 3. 默认指令模板

新 bot 从模板开始，用户可编辑。模板是**内容，不是代码**：它放在
[`locale/en.json`](../packages/dsh-rayrun-bots/locale/en.json) 与
[`locale/zh.json`](../packages/dsh-rayrun-bots/locale/zh.json) 的 `bots.template`，
创建时按当前 locale 填入 `{name}` / `{job}`。

英文：

```text
You are {name}, a teammate on the user's team.
Your job: {job}.
Work in short, factual updates. Say what you did, what you did not do, and what
you need next. Ask before any action that leaves this computer (messages,
publishing, spending, another machine). Never claim work you have not verified.
If something is unclear, ask one question instead of guessing.
```

中文：

```text
你是 {name}，用户团队里的一名同事。
你的职责：{job}。
用简短、事实性的更新汇报：做了什么、没做什么、下一步需要什么。任何离开这台
电脑的动作（发消息、发布、花钱、动另一台机器）先征求同意。不要声称未经验证
的结果。不清楚时只问一个关键问题，不要猜。
```

模板只定义工作方式和边界，不替代审批：模型仍可能忽略提示，真正的门是审批层
（[`05-approvals.md`](05-approvals.md)）。ADR-019 让本地 DSH host 对 typed 本地动作
做审批/执行；云端凭据动作仍按 ADR-001 等待平台隔离。

---

## 4. 身份与界面

- **创建对话框**：名字、一行职责、可选指令、monogram 预览；两个动作：Cancel、
  Create bot。v0.1 没有 personality picker。
- **Roster**：头像、显示名、职责标签、状态点。
- **对话头部**：头像、显示名、状态；不显示 `id`。
- **Bot 详情**：名字、职责、头像（P1 编辑）、指令、电脑、Library tab。
- **消息**：纯文本；除小 monogram 外不加头像框。

**Bot 不能改自己的名字、职责或头像**；这些是用户动作。Persona 不能覆盖安全不变量：
审批失败即拒绝、凭据留在用户侧、不自动 destroy、无遥测。Persona 文案不含密钥或系统
内部信息。

完整文案、语气与 UI 位置见 [`design/bot-persona.md`](design/bot-persona.md)。

---

## 5. 生命周期

| 阶段 | 发生什么 | 归属 |
| --- | --- | --- |
| 创建 | 客户端提交名字/职责/指令 → 本地控制面校验 → bot runtime 落 `bot.json` 与目录 | 本地意图，云端应用（ADR-002 待定） |
| 首次运行 | 建立 bot↔session 映射；profile/memory 目录就绪 | bot runtime |
| 编辑 | 用户改名字/职责/指令 → revision 检查 → 更新 | 本地意图 |
| 删除 | 删除 bot 目录与镜像；是否保留 tombstone 见 ADR-012 | 用户明确动作 |
| 机器丢失 | 本地镜像保留定义；拉回/重建；完整恢复要求机器未销毁 | 本地镜像 + 用户操作 |
| 机器销毁 | workspace 删除；只能由人类明确请求；不自动 destroy | 用户 |

v0.1 不提供“复制 bot”“模板市场”“bot 间 handoff”；这些不在路线图。

---

## 6. 与 session / memory 的关系

- **Session**：每个 bot 一个持久 DSH session id；第二次对话接着第一次。平台不提供
  session 对象，session 由 bot host 自己写 `/workspace`；端到端未验证前回退到逐次
  headless + transcript replay（ADR-007）。
- **Memory**：每 bot 一个目录，保存笔记、产物和会话日志；机器上权威，本地只读镜像。
- **Transcript**：D3 计划写 `sessions/*.jsonl`，脱敏；v0.1 默认只镜像元数据，不镜像
  完整对话（[`06-local-state.md`](06-local-state.md)）。
- **Bot 与电脑**：一台电脑共享给该用户的 bots；bot 不是安全边界，不能互相当沙箱。

---

## 7. 未决项

| 问题 | 影响 | 决策 |
| --- | --- | --- |
| `bot.json` 的权威写者是谁？ | B1–B4、创建/编辑/删除 | ADR-002 |
| 删除用 tombstone 还是直接移除？ | 恢复、id 复用、session 混淆 | ADR-012 |
| `skills` 的 schema 与加载方式 | B1、DSH 集成 | 待定；v0.1 只存名字 |
| 非法定义返回哪个错误码？ | B1、客户端错误文案 | 已定：`E_BOT_INVALID` |
| 头像是否允许非 monogram？ | UI、schema | v0.1 只 monogram；上传/生成不在范围 |

---

## 8. 相关文档

- 产品范围：[`00-product-direction.md`](00-product-direction.md)
- 技术基线：[`01-system-architecture.md`](01-system-architecture.md)
- 客户端创建/编辑：[`03-client-design.md`](03-client-design.md)
- 云端 session/队列：[`04-cloud-host.md`](04-cloud-host.md)
- 本地状态与镜像：[`06-local-state.md`](06-local-state.md)
- 工作分解：[`plans/mvp-plan.md`](plans/mvp-plan.md) B1–B6
- 决策：[`adr/architecture-decisions.md`](adr/architecture-decisions.md)
