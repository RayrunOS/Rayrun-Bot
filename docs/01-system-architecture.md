# 01 — 系统架构

> 状态：2026-11-24。本文是**技术层的唯一真相源**：系统由什么组成、边界在哪、状态怎么
> 流转、信任模型是什么。
> 产品范围与验收以 [`00-product-direction.md`](00-product-direction.md) 为准；当前实现
> 状态以 [`12-status.md`](12-status.md) 为准；未决架构决策见
> [`adr/architecture-decisions.md`](adr/architecture-decisions.md)。
> 本文中的 **计划 / TBD** 表示未实现或未验证，不要读成已交付。

## 0. 与现有文档的关系

| 文档 | 本文对它的处置 |
| --- | --- |
| [`00-product-direction.md`](00-product-direction.md) | 产品方向唯一真相源；产品与技术冲突时以 00 为准 |
| [`../README.md`](../README.md) | 营销页，不承载事实 |
| [`12-status.md`](12-status.md) | 实现状态的唯一事实源；本文不复制状态 |
| [`07-security.md`](07-security.md) | 威胁模型、凭据边界与“不保护什么”的细节 |
| [`06-local-state.md`](06-local-state.md) | 本地状态目录、原子写、权限与保留规则 |
| [`plans/mvp-plan.md`](plans/mvp-plan.md) | 工作分解、接口草案、A1–A12 验收 |
| [`plans/client-plan.md`](plans/client-plan.md) | 客户端表面、RPC 分组与 DSH 集成 spike |
| [`08-integration.md`](08-integration.md) | 需要 Rayrun 平台补的能力与优先级 |
| [`adr/architecture-decisions.md`](adr/architecture-decisions.md) | ADR 登记册与未决决策；本文引用其编号 |
| [`09-deployment.md`](09-deployment.md) | 怎么把现有插件跑起来 |

---

## 1. 技术基线

### 1.1 选型

| 分类 | 选型 | 约束 |
| --- | --- | --- |
| 语言 | Plain ESM JavaScript | Node 24+；无构建步骤；无运行时库依赖 |
| 客户端 | DSH client half | 只能加载 DSH 提供的模块（`react` 等）；可用浏览器全局对象，不可用 Node 内置模块 |
| Host half | DSH plugin host | 同源 RPC；Rayrun token 只在本侧；不把 token 交给页面 |
| 云 | Rayrun API + `dsh-rayrun-computer` | 后者是独立项目，作为依赖消费；不修改、不 fork、不 vendor |
| 模型 | DeepSeek | 用户自己的 key，经 Rayrun credential injection 注入 agent 进程 |
| 状态 | 机器上的 JSON/JSONL + 本地镜像 | 每个持久文件有 schema 版本；原子写；镜像可重建 |
| 测试 | `node test/*.mjs` | 纯 Node，无框架；审批/密钥负向测试为强制项 |
| 打包 | 私有 workspace + npm 包 | 根 `package.json` 无依赖；`files` 必须包含 host/client/locale/lib |

“无运行时依赖”指 **库依赖**；`dsh-rayrun-computer` 是 peer bundle 依赖，不是被复制进
本仓库的代码（见 [`adr/architecture-decisions.md`](adr/architecture-decisions.md) ADR-004）。

### 1.2 目标拓扑（v0.1）

```
你 ── 聊天 / 审批 ──▶ DSH 客户端（浏览器标签或桌面壳）        [现有：DSH]
                        │  插件 client half：
                        │  聊天列表 · 对话 · 内联审批
                        │  每 bot 详情 · 电脑视图 · 用量
                        ▼
                 本地 DSH host + 插件 host half                  [现有 / 计划 *]
                 tools · 同源 RPC · tool guard
                 bot registry* · bot↔session 映射* · routine scheduler（本地/云 dev live）
                        │  HTTPS；Rayrun token 不离开 host
                        ▼
                 Rayrun API · https://api.rayrunos.com/v1
                 sandboxes · exec · files · agent prompt + SSE ·
                 credentials · billing
                        ▼
        你的 Rayrun 云电脑（一人一台，bots 共享）
          ├─ 常驻 DSH host（web profile）                      [平台 runtimes API
          ├─ 每 bot 一个 session + 一个 profile 目录            已实现并本机 dev 全量验收通过，待生产部署；
          ├─ /workspace · X11 desktop :99 · browser profile     bot host 未实现]
          └─ 模型调用 ──▶ DeepSeek API（你的 key，只注入
                            agent 进程）
```

`*` = 未实现。常驻 bot runtime、session 续接和 bot 映射是 v0.1 的未验证项。平台答复
（2026-11-22）：R-G008 runtimes API 已实现并本机 dev 全量验收通过（待部署），session 由 bot host
自己写 `/workspace`；bot 侧 host/session 尚未实现。见 §3、§9 与 ADR-007。

### 1.3 分层

1. **薄客户端。** 用户在与 DSH 本身交互（`dsh web` 或桌面壳）；插件 client half 增加
   bot 页面。复用 DSH 的聊天、session、审批、设置和插件机制，不重写聊天应用。代价是
   受 DSH client API 约束；独立桌面壳推迟到 v1.0。
2. **本地 DSH host + 两个插件半区。** 独立的 `dsh-rayrun-computer` 注册 `rayrun_*`
   tools、同源 RPC 路由与 tool guard；本仓库的 host half 作为本地控制面消费其表面，
   增加 bot 注册表、审批路由、成本与依赖检查（scheduler 的范围见 ADR-009）。
   bot↔session 映射、队列和 DSH 监督属于云端 bot runtime（ADR-015/016）。两者共同
   负责配置、profile 投影和文件合并。
3. **Rayrun API。** 机器生命周期、命令、文件、agent prompt（SSE）、credential 和
   billing 的单一 HTTPS API；token 只存在于本地 Harness vault，且只用在这里。
4. **云电脑。** 一人一台，bots 共享：vCPU/内存、持久 `/workspace`、X11 `:99`、
   browser profile。设计要求一个常驻 **bot runtime**（ADR-015）监督 DSH host，每 bot
   一个 session 与 profile 目录。平台答复（2026-11-22）：R-G008 runtimes API 已实现并有
   本机验收（待部署），提供受监督常驻进程、`autostart`、`keep_alive` 和 boot 时
   credential injection；session 不是平台对象，由 bot host 自己写 `/workspace`。bot
   侧 supervisor/session 仍是本仓库的工作。
5. **Bot↔session 映射。** bot 是持久对象：名字、指令、skills、memory 目录和 session
   id 在机器上。映射必须存在 supervisor 内存之外；平台不提供 session 对象，session
   的 create/continue 由 bot host 在 `/workspace` 内实现。2026-11-22 dev 验证了镜像
   DSH 0.2.0-rc.2 的 headless `--session-id` 可跨进程续接，host 资产已跑通两轮；
   核心 host 尚未进入包，生产未部署。
6. **审批通道。** 受控动作由云端 bot 提案 → 本地控制面卡片 → 本地决定与执行；
   云端不写 decision。ADR-019 决定本地 DSH host 为本地动作的审批权威；ADR-001 的
   平台隔离仍用于云端凭据动作。失败即拒绝；浏览器先做，IM 是 v0.2。当前边界见 §4.3。
7. **Routines / triggers。** 非 cloudHost 模式由本地 DSH host 的 scheduler 检查
   每 bot 的 `routines.json`，到期后入队一条普通 turn；cloudHost 模式停用本地
   scheduler，由云 host 读取镜像定义调度，并在本地 DSH 停止时继续运行（前提是
   机器和 runtime 正在运行）。结果通过 `routine-results/` 回导本地 history。两者
   都不做 backfill、不新增审批绕过；云端路径已在 Rayrun dev/test 环境 live 验证
   （2026-11-24），生产待 R-G008 部署；cron 和事件触发未实现。范围与限制见
   ADR-009。
8. **模型 provider。** v0.1 只接 DeepSeek；其他 provider 由 DSH 负责，不在本仓库设计
   provider 抽象。

### 1.4 控制面与执行面

```
DSH 客户端
  │ 同源 RPC
本地 bot 控制面（DSH host + 插件 host half）        ← Rayrun 之上
  │ Rayrun API（token 只在本地）
Rayrun 平台（机器 / exec / files / credentials / billing）
  │ 云电脑内
云端 bot runtime（queue / session / DSH 监督 / 事件 / 恢复）
  │
DSH agent sessions（bot）
```

- **本地 bot 控制面**：用户意图、审批、token、成本、依赖、watchdog；不是托管服务
  （ADR-016）。
- **云端 bot runtime**：机器内 supervisor；不持有 Rayrun token、不做审批授权、不是
  安全边界（ADR-015）。
- **Rayrun**：基础设施；不承载 bot 语义。
- **DSH**：agent 会话与 UI。

名字固定后，`04-cloud-host.md` 的“host”就是 bot runtime；`03-client-design.md` 的
host half 属于本地控制面。**ADR-015/016 目前是 Proposed**；在它们标为 Decided 前，
这一分层是设计方向，不是已定契约。

---

## 2. 设计原则与取舍

| 决策 | 理由 | 代价 |
| --- | --- | --- |
| 薄客户端 on DSH | 不重写聊天/审批/插件；分发是插件安装，不是签名应用 | 受 DSH client API 约束；多租户和推送要自己做 |
| Local-first for ownership | 用户的 checkout 权威，云端工作可审查；session 在机器上，可拉回 | 两个写者要经 review/merge；常驻 bot runtime 落地前，合上笔记本不能继续 |
| BYO accounts | 没有项目方控制面、密钥池或计量 | 没有项目方的保护层：余额、花费和 provider 条款由用户承担 |
| 一人一台电脑 | 更便宜，更像人的桌面 | **bot 不是安全边界**；两个 bot 不能互相当沙箱 |
| 云电脑插件独立 | 复用成熟云层，不 fork/合并仓库 | 两个包、版本契约、安装摩擦；特性请求跨仓库 |
| Bot = 持久对象 | 不只是 session：指令、skills、memory、schedule | durable-object 契约（session 续接、每 bot 目录）未验证 |
| 审批失败即拒绝 | 外部副作用需要人类同意 | UX 成本；本地 typed 动作与云提案 bridge、start/stop/pause/resume、denial/Continue、下一轮 context 已 live；云端凭据动作未落地 |
| 成本护栏 | 常开机器有真实账单 | 平台没有 idle auto-stop 或 spend cap；插件只能 stop，不能强制执行预算 |
| v0.1 只接 Rayrun | 一个集成做透 | 以后换后端是重写；provider 抽象是未决项 |

---

## 3. 系统组成

### 3.1 本地侧

这一侧就是**本地 bot 控制面**（ADR-016）。

- **DSH host**：加载两个 bundle；本仓库的 host half 用 `ctx.inject(['webServer'])`
  注册同源路由，最小路由见 [`../packages/dsh-rayrun-bots/index.js`](../packages/dsh-rayrun-bots/index.js)；
  实现状态以 [`12-status.md`](12-status.md) 为准。
- **Client half**：DSH 页面里的三栏 bot 界面；只调用同源 RPC，不直接访问 Rayrun API，
  不持有 Rayrun token 或 DeepSeek key。
- **Harness vault**：Rayrun token 的宿主；host 在需要调用 Rayrun API 时取值，不写入
  页面、RPC 响应或日志。
- **同源 RPC**：page→host 的动作保持同源、origin 校验、大小限制；当前路由与信封在
  代码和计划之间尚未统一，接线前按 ADR-010 定一个契约。
- **Tool guard**：由云电脑插件提供，负责 cloud/local 路由选择；本仓库不复制它。

### 3.2 云端

这一侧是**云端 bot runtime**（ADR-015）。

- 一人一台机器，bots 共享 `/workspace`、X11、browser profile 和文件；不是安全边界。
- 平台同时只允许一个 agent 任务；第二个 prompt 返回 `409 sandbox_busy`，不排队。
- v0.1 设计要常驻 DSH host + 每 bot session/profile。平台答复（2026-11-22）：R-G008
  runtimes API 已实现并本机 dev 全量验收通过（待部署），提供受监督进程、`autostart`、
  `keep_alive` 和 boot 时 credential injection；session 由 bot host 自己写
  `/workspace`。bot 侧 supervisor/session 已有 dev 预览并通过多 bot live E2E；
  生产镜像未交付；见 ADR-007 与 [`08-integration.md`](08-integration.md) §3.1。
- 机器按秒计费；stop 保留磁盘，destroy 删除机器与 workspace；余额耗尽可能被平台
  force-destroy。成本模型见 §7。

### 3.3 Rayrun API

单一 HTTPS API，负责机器生命周期、`exec`、文件、agent prompt + SSE、credential 和
billing。token 只在本地控制面使用；云端 agent 只拿模型 key，不拿 Rayrun token。

### 3.4 依赖边界

`dsh-rayrun-computer` 在自己的仓库里，本仓库只消费其发布表面：

- **我们使用**：`rayrun_*` tools 的语义、同源 RPC 路由、worker projection 和版本
  契约。
- **未定**：本地控制面通过 service injection、host RPC 还是其他 adapter 调用它；
  bot runtime 如何由它的 worker projection ship/启动，也是 ADR-004。S6 已解决
  安装组合（一条 `dsh plugin add` 装两个包），不等于这个接口问题。
- **禁止**：修改、fork、vendor 或复制它的代码；需要它改行为 → 去它的仓库提
  issue/PR，或在本仓库写 adapter。
- **版本检查**：host 启动时记录已安装版本，缺失/过旧返回 `E_DEP_MISSING` /
  `E_DEP_VERSION` 和一句可执行的安装提示（A2）。

---

## 4. 信任模型与执法边界

### 4.1 信任域

| 域 | 谁 | 能做什么 | 不能假设 |
| --- | --- | --- | --- |
| 用户本地 | 用户、DSH host、Harness vault、本地审批 | 持有 Rayrun token；做审批决定；改本地 profile | 本地机器可能被攻陷；同 profile 的恶意插件是残余风险 |
| 云电脑 | bot、模型输出、agent 进程、workspace | 以 root 运行；`danger-full-access`；可读写自己的 workspace | **没有 bubblewrap，不是沙箱**；模型输出不可信；bots 之间没有隔离 |
| Rayrun 平台 | 云厂商 | 运行机器、注入 credential、计费 | 平台是否能看到静态凭据未验证；条款适用 |
| DeepSeek | 模型厂商 | 接收 prompt 和输出 | 条款适用；不做 DPA/SOC 2/区域驻留承诺 |

### 4.2 执法点

- **凭据**：Rayrun token 只在本地的 Harness vault；DeepSeek key 只经 Rayrun
  credential injection 进入 agent 进程；两者都不进 client、RPC、日志、仓库、fixture、
  prompt 或聊天。
- **同源 RPC**：page→host 的动作保持同源、origin 校验；不把 token 交给页面来绕过。
- **审批**：有外部副作用的动作必须请求并获批；超时/未知=拒绝；永不自动放行。
  本地 DSH host 只执行 typed allowlist 并在本地写决定/claim（ADR-019）；云端凭据
  动作仍等待平台隔离（ADR-001）。
- **销毁**：`destroy` 只能由人类明确请求；idle 只能 stop/pause。
- **网络**：不使用入站网络；public desktop 不作为产品面板；新机器默认无出网，按需
  allowlist。
- **遥测**：默认无；未来必须 opt-in、有文档，且不含 prompt/key/workspace 内容。

### 4.3 当前审批的诚实边界

ADR-019（2026-11-23）把凭据/执行器在本地动作的审批权威移到**本地 DSH host**：

- 云端 bot 只能提案；本地重新校验并生成 request/decision/execution claim。云端
  workspace 里的提案可被 root agent 读写，因此它是不可信输入，不是授权。
- 本地 host 持 Rayrun token，按 typed allowlist 执行 `rayrun.machine.start/stop/pause/resume`；
  token 不进 action、RPC 响应、日志或页面。
- 云端 agent 不能写本地 decision/claim，所以不能自批这些本地动作；但它仍能在自己的
  workspace 内任意运行，能改提案/transcript。**审批不是沙箱，也不是每 bot 隔离。**
- 凭据只在云端、必须云端执行的动作仍适用 ADR-001：平台 host/agent 隔离与
  host-only 端点落地前不执行。
- 本地 DSH 不在线时，chat 审批等待，background 按 TTL 拒绝；没有后台自动批准。
- 平台需求见 [`08-integration.md`](08-integration.md) §3.3；这与
  [`07-security.md`](07-security.md) “The model is untrusted” 一致。

**当前缺口：** 云 bot 结构化提案 + 本地导入 + 真实 start/stop、denial/Continue 和
下一轮审批结果 context 已 live 通过（2026-11-23）；云端凭据
动作尚未验证；不要把 host-only propose seam 当成完整闭环。

### 4.4 其他边界

- **Bot 不是安全边界**：一台机器上的 bots 共享文件、浏览器状态和凭据；一个 bot 被
  攻陷可以触及其他 bot 留下的东西。
- **公网 desktop**：ingress 的 token 层目前不可用，只有 `public`；不要把 public
  desktop 当产品面板。desktop 的安全路径见 ADR-008。
- **供应链**：两个 bundle 都运行在 DSH 进程中，拥有用户权限；只从可信来源安装。
- **审计**：本地 `audit.log` 是运行历史；是否 tamper-evident 见 ADR-012。

---

## 5. 数据与状态

### 5.1 真相在哪

下表是 ADR-002 的**建议矩阵**；在 ADR-002 定稿前它不是最终规则。

| 层 | 权威 | 机器上 | 冲突规则 |
| --- | --- | --- | --- |
| 代码与 workspace | 用户的 checkout | `/workspace` 的副本 | push 校验两侧 hash；pull 落 `.dsh/incoming/`，不自动应用；用户合并 |
| Bot 定义（`bot.json`） | 本地用户意图 | 机器上的副本 | 本地意图赢；云端应用后返回 revision；离线时留在本地 outbox（ADR-002） |
| 运行态：session、memory、transcript | 云电脑 | 活的 session、profile/memory 目录 | 本地只读镜像；拉回用于审查与恢复 |
| 队列 | 云端负责状态，本地负责新工作 | `queue/inbox/`、`queue/state/` | 每个文件一个写者；不做共享 JSONL 追加（ADR-003） |
| 审批请求 | 本地 host 生成（提案来自不可信云端） | 本地 `approvals/req-<id>.json` | 提案不是授权；本地重新校验并绑定 actionHash（ADR-019） |
| 审批决定 / 执行 claim | 本地控制面 / 本地 executor | 本地 `res-<id>.json` / `exec-<id>.json` | 只在本地；每个 id 一个决定/claim；agent 写不到 |
| Outbox 事件 | bot runtime | `outbox/events.jsonl` | 本地按 `seq` 读；忽略旧 checkpoint 之前的空档 |
| 本地镜像与缓存 | 本地控制面（派生） | `$DSH_HOME/state/rayrun-bot/` | 可丢弃；从机器重建；不写回机器 |

完整的所有权矩阵与单写者规则见 ADR-002、ADR-003；本地目录、权限、原子写和保留规则
见 [`06-local-state.md`](06-local-state.md)。

### 5.2 控制通道

v0.1 没有入站网络。本地 → 云端通过 Rayrun API 写文件；云端 → 本地状态通过
`/workspace/.rayrun/` 下的文件，本地每 3 秒轮询。审批、队列和 outbox 都走这个文件
邮箱。平台的原子写/ETag 语义尚未确认（[`08-integration.md`](08-integration.md) §3），
所以协议必须按“无 CAS”设计：每项一个文件、一个写者、临时文件 + rename。

### 5.3 Schema

固定格式见 [`plans/mvp-plan.md`](plans/mvp-plan.md) §4.3：

- `bot.json`：`schema`、`id`、`name`、`label`、`avatar`、`instructions`、`skills`、
  `model?`、`createdAt`、`updatedAt`；指令上限 8 KB。
- Queue item：`id`、`botId`、`kind`、`text`、`createdAt`、`state`、`attempts`；
  状态 `queued → running → waiting_approval → done | failed | cancelled`。
- Approval request / decision：见 ADR-011；建议 decision 补 `botId`、`actionId`、
  `actionHash`。
- Outbox event：`seq`、`at`、`botId?`、`type`、`payload`；建议加 schema 版本
  （ADR-012）。

这些 schema 仍有未决项：队列缺 `sessionId`/`approvalId`/时间戳，`bot.json` 缺
tombstone，action hash 的 canonicalization 未定义；见 ADR-011/012。

---

## 6. 关键流程

以下流程是目标设计；标注 ADR 的步骤在对应决策定稿前不是最终契约。

### 6.1 创建 bot

1. 用户在客户端填写名字、职责、指令；client 发同源 RPC。
2. 本地控制面校验 `bot.json`（B1）、写本地 outbox，向 bot runtime 提交创建意图。
3. bot runtime 在 `/workspace/.rayrun/bots/<id>/` 落目录与 `bot.json`，返回 revision。
4. 本地镜像记录；机器不可用时，意图留在本地 outbox，等机器可用再应用。
5. 谁是定义的唯一写者、创建失败如何回滚：ADR-002，尚未定。

### 6.2 发任务 / 对话

1. 本地控制面把任务写入 `queue/inbox/<itemId>.json`。
2. bot runtime claim 一项，状态写 `queue/state/<itemId>.json`；一台机器同时只有一项
   `running`。
3. agent 在 DSH session 中执行；事件写 outbox；本地轮询并渲染。
4. 需要审批时进入 `waiting_approval`；批准后执行，失败/过期按 §6.3。
5. claim/状态协议尚未定；ADR-003、ADR-005。

### 6.3 审批

1. 受控动作由云端 bot 用 `propose.mjs` 生成 proposal；本地 host 通过 `rayrun_files`
   导入，host-only `approvals.propose` 仍可作为本地 seam。proposal 是请求，不是授权。
2. 本地 host 校验 typed allowlist，生成 request：本地 id、botId、actionId、nonce、
   actionHash、action、risk、origin、TTL；写入本地 approval store。
3. 本地控制面显示卡片；卡片内容来自结构化字段，不信任机器提供的 HTML/markdown。
4. 用户 Deny / Allow once；决定只写本地 `res-<id>.json`。
5. 本地 executor 校验 id、botId、actionId、nonce、actionHash、TTL 和 allowlist；任何
   不匹配、过期、重放、错 bot 都拒绝；批准的本地动作先写 `exec-<id>.json` claim，再
   执行。云端 agent 不能写这些文件。
6. 后台卡 30 分钟过期即拒绝；chat 卡不设计时，一直等待；本地 DSH 不在线时不会自动
   执行。云端凭据动作在平台隔离/host-only 端点落地前仍不执行。
7. 副作用执行后的崩溃/重试语义见 ADR-005；本地 executor 已实现 at-most-once claim，
   崩溃后不自动重试。云端提案 bridge、start/stop、denial/Continue 和下一轮 context
   已 live；其他动作仍待做。

### 6.4 合上笔记本

- 已排队的**非受控**工作可以在 bot runtime 上继续。
- 新任务无法提交；gated 后台动作等待并在 30 分钟后过期；chat 卡等待。
- 本地 idle stop 与 watchdog 不运行，机器继续计费；平台没有 idle auto-stop。
- 重新打开时拉状态/outbox，显示 working、unread、pending、expired。
- 详见 ADR-006；产品页和 FAQ 必须说清这条边界。

### 6.5 恢复

- 本地 watchdog 通过 `exec` 检查心跳，host 丢失后尝试重启（C6）。
- bot runtime 重启后重读队列与审批状态，不丢已排队工作（C8）。
- 平台 runtimes API 已实现并本机 dev 全量验收通过（待生产部署）；session 由 bot host 自己写 `/workspace`，端到端
  未验证前回退到 transcript replay（ADR-007、D1–D5）。
- 机器 stop/start 保留磁盘；destroy 删除一切，只能由人类明确请求。
- A8/A9 的字段与状态机缺口见 ADR-012。

### 6.6 销毁

- idle 策略只能 stop/pause；`destroy` 必须由人类明确请求。
- 删除前应提示 workspace 不可恢复；本地镜像可保留 bot 定义，但不是完整备份。
- 余额耗尽可能触发平台 force-destroy；这是平台行为，不是本插件的 destroy 路径
  （[`08-integration.md`](08-integration.md) #2）。

---

## 7. 并发、成本与失败

- **并发**：平台一台机器一次只跑一个 agent 任务（`409 sandbox_busy`）。bot runtime 拥有
  全局串行队列；第二项等待，不丢。host 已实现 round-robin；host 侧任务超时、
  取消和队列上限尚未定义（ADR-012）。
- **成本**：按秒计费；stop 保留磁盘，destroy 删除机器与 workspace。余额耗尽可能
  force-destroy 整个组织的机器；平台没有 spend cap。本地可以轮询余额、警告、idle
  stop，但不能阻止平台销毁。
- **常开**：2 vCPU / 2 GiB 约 ¥57.6/月（写入时的量级，24/7）；“合上笔记本继续工作”
  意味着机器继续计费，直到 idle stop、max lifetime 或余额耗尽。
- **可用性**：只有用户的 Rayrun 账号 + DSH host；没有 HA、SLA 或跨区域。
- **失败**：依赖缺失/过旧、没有 token、没有 key、机器停机、host down、审批过期、
  余额低、网络离线。每个状态给一句可执行的提示，不给假成功；审批相关失败一律拒绝。

---

## 8. 本仓库与 Rayrun 平台的边界

**本仓库可以建**：

- 云电脑插件的 adapter：能力调用、版本检查、缺失时的清晰错误；
- bot 注册表、roster UI、bot↔session 持久化；
- 本地审批执行器与浏览器卡（typed 机器 start/stop/pause/resume；云提案 live E2E 与 IM 后续）；
- routines 的本地调度（MVP）与未来 trigger 接线；
- 成本栏与诚实的状态报告；
- 打包、测试和文档。

**平台必须补**（细节与优先级见 [`08-integration.md`](08-integration.md)）：

- host/agent 权限隔离与 host-only 审批端点：云端凭据动作的前提（ADR-001）。
  平台答复（2026-11-22）：同沙箱内不可行，平台端点设计 1 周 + 实现 2–4 周、非首版。
  本地 typed 动作已按 ADR-019 在本地执行；云端凭据动作仍等待平台；
- R-G008 常驻 runtime：平台 runtimes API 已实现并本机 dev 全量验收通过（`rayrun-bot-gaps`，
  `4709ac0`），待生产部署；bot 侧 host/session 已在 dev 预览实现并通过多 bot live
  E2E（2026-11-23），生产镜像未交付；
- 余额宽限与 spend 护栏：余额耗尽今天会 force-destroy 机器和磁盘；
- 安全的入站网络：token ingress 不可用，只有 `public`；
- idle auto-stop 或 wake-on-request；
- 动态调整资源：已有沙盒的 vCPU/memory 调整，保留磁盘和已安装状态；今天只能在
  创建时选规格；
- 运行期 egress 更新、通用 secret injection、per-sandbox usage、镜像/DSH 版本对齐。

**依赖边界**：`dsh-rayrun-computer` 永远是独立项目；需要它改行为 → 去它的仓库，
或在我们的包里写 adapter。`dsh-rayrun-computer` 的接口/worker projection 契约是
ADR-004，未定之前 C1/D1 不应动工。

---

## 9. 未决架构决策

完整的决策、选项和建议见
[`adr/architecture-decisions.md`](adr/architecture-decisions.md)；登记册见
[`docs/README.md`](README.md) §3。**ADR-019 已定**（本地 DSH host 审批/执行本地 typed 动作）；ADR-001 的平台隔离
仍用于云端凭据动作。ADR-015/016（控制面/执行面）与 ADR-002（所有权）仍是相应工作
的门槛：

| 编号 | 决策 | 为什么阻塞 |
| --- | --- | --- |
| ADR-015 | 云端 bot runtime 层 | 决定执行面落点 |
| ADR-016 | 本地 bot 控制面 | 决定控制面权威 |
| ADR-001 | 审批在哪里执行 | 已定（平台权限隔离）；ADR-019 窄化本地动作 |
| ADR-019 | 审批执行权威 | 已定（本地 DSH host）；云提案 bridge、start/stop、denial/Continue 和下一轮 context 已 live |
| ADR-002 | 所有权矩阵与单写者规则 | 决定 `bot.json`、队列、审批谁写 |
| ADR-003 | 文件控制通道协议 | 决定队列/状态怎么交换，避免双写丢更新 |
| ADR-004 | 与 `dsh-rayrun-computer` 的契约 | 决定 bot runtime 能否调用云能力 |
| ADR-005 | 副作用执行语义 | 决定崩溃/重试会不会重复发送或花钱 |

其余：ADR-006–ADR-013（合上笔记本、常驻 runtime/凭据、desktop、routines、RPC、
审批 schema、恢复、文档清理）；ADR-014（B1 预配置 DSH 发行包）属于 v1.0。

---

## 10. 文档约定

- 产品方向：00；技术基线：本文；实现状态：[`12-status.md`](12-status.md)。
- 根 `README.md` 是营销页，不作为事实依据。
- 安全与威胁模型：`07-security.md`；本地状态：`06-local-state.md`。
- 工作分解与验收：`plans/mvp-plan.md`；客户端：`plans/client-plan.md`；平台 handoff：
  `08-integration.md`。
- 未决/已定架构决策：`adr/architecture-decisions.md`，登记册在 `docs/README.md` §3。
- v1.0 桌面发行版：`design/desktop-distribution.md`（ADR-014，B1）；不阻塞 v0.1。
- 与代码冲突时：先核实当前行为，再修正错误的一方；不要凭记忆描述现状。
