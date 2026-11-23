# 07 — 安全

> 状态：2026-11-24。本文定义安全目标、威胁模型、凭据边界与“不保护什么”。
> 技术基线见 [`01-system-architecture.md`](01-system-architecture.md)；审批的信任
> 边界见 [`05-approvals.md`](05-approvals.md)；本地状态见
> [`06-local-state.md`](06-local-state.md)；平台 handoff 见
> [`08-integration.md`](08-integration.md)；未决决策见
> [`adr/architecture-decisions.md`](adr/architecture-decisions.md)。
> 本仓库的 bot 层安全属性是**设计意图**，不是已验证行为；实现状态以
> [`12-status.md`](12-status.md) 为准。标记 **TBD** 的项未验证。

本产品带来用户自己的凭据：Rayrun 账号 token、DeepSeek API key 和一台云电脑。本文说明
设计保护什么、怎么保护，以及同样重要的——**不保护什么**。漏洞请按
[`../SECURITY.md`](../SECURITY.md) 私下报告，不要开公开 issue。

## 0. 与现有文档的关系

| 文档 | 负责什么 |
| --- | --- |
| [`01-system-architecture.md`](01-system-architecture.md) | 信任域、执法点、数据流 |
| [`05-approvals.md`](05-approvals.md) | 审批的失败即拒绝与当前文件邮箱的诚实边界 |
| [`06-local-state.md`](06-local-state.md) | 本地状态权限、日志与保留 |
| [`08-integration.md`](08-integration.md) | 平台能力、依赖边界与版本契约 |
| [`adr/architecture-decisions.md`](adr/architecture-decisions.md) | ADR-001（平台隔离）、ADR-019（本地审批执行）、ADR-005（副作用） |

---

## 1. 安全目标

1. **凭据留在用户侧。** 没有项目方服务器、中继或控制面，所以没有地方池化 token。
2. **Rayrun token 不进入页面。** 它只存在于本地 Harness vault、host 侧，只用于
   Rayrun API。
3. **DeepSeek key 只注入、不被读。** Rayrun 存储并注入 agent 进程；插件和工具不读它，
   机器内的 `exec` shell 看不到它。
4. **审批失败即拒绝。** 外部副作用等人；超时或未知状态 = 拒绝。ADR-019 让本地
   DSH host 对 typed 本地动作做审批/执行；云端凭据动作仍等待平台隔离（ADR-001）。
   协议/审计不构成对被控 bot 的通用安全边界，见 §4.4。
5. **默认无遥测。** 项目不收集、不上传使用数据。
6. **没有隐藏出网。** 新云电脑默认关闭出网；host 必须显式列白名单。
7. **bot 层不新增云凭据。** 复用依赖的 token 路径，不引入新账号、key 或 secret。

---

## 2. 今天受保护的内容

下表标注“已实现/已测试”的保证来自独立的 `dsh-rayrun-computer` 包，不是本仓库；
本仓库的 bot 层尚未实现。

| 属性 | 状态 |
| --- | --- |
| Rayrun token 只在 Harness vault、host 侧 | 云电脑包已实现并测试 |
| 页面不收 token；调用同源、origin 校验的 RPC | 已实现；跨源 POST 拒绝，响应不带 token |
| 密码只在内存，不写磁盘/日志 | 云电脑包已实现 |
| DeepSeek key 只注入 agent 进程；`exec` shell 读不到 | Rayrun 侧已验证；插件不读 key |
| `destroy` 不可逆，机器与 workspace 一起删除 | Rayrun API 行为 |
| 新机器默认无出网，按 allowlist 放开 | Rayrun 默认行为 |
| 本项目无遥测 | 本仓库策略 |

**不要把这些行读成“bot 层已经安全”**：bot 层的注册表、审批、session 映射和本地
状态大部分还没有实现。

---

## 3. 遥测与出网

本仓库不发任何东西。bot 层必须保持：未来的遥测必须 opt-in、有文档，且不含 prompt、
key 或 workspace 内容（[`../CLAUDE.md`](../CLAUDE.md) 不变量 10）。

除了它存在的目的——Rayrun API 调用——云电脑包自身唯一的出网调用是 npm registry 的
更新检查，发送包名并读取最新版本。这个调用必须保持有文档；新包要么保持这个窄形状，
要么去掉。

---

## 4. 威胁模型

### 4.1 本地控制面上的凭据

token 是账号级 API token；读到它就能创建/销毁机器并花余额。缓解：vault 存储、token
不进 client/RPC/日志/仓库、同源 RPC。残余风险：本地机器被攻陷、同 profile 的恶意
插件、RPC handler 的 bug。只安装可信的 DSH 与插件。

### 4.2 模型不可信

agent 执行模型输出。文件、网页、邮件、工具输出里的 prompt injection 是常态，不是
例外。**缓解不是沙箱**：云镜像以 root 运行且没有 bubblewrap，worker profile 使用
`danger-full-access`。把 bot 当作拥有整台电脑；不要把两个 bot 当作彼此的隔离边界。

### 4.3 云电脑是共享的

一人一台机器，bots 共享文件、浏览器状态和凭据。这是产品决策（更便宜、更像人的桌面），
不是安全保证。一个 bot 被攻陷可以触及其他 bot 留下的东西。

### 4.4 审批的当前边界（重要）

ADR-019（2026-11-23）把**本地 DSH host** 定为凭据/执行器在本地动作的审批权威与执行
方；云端 bot 只写提案。具体边界：

- **决定和执行只在本地。** 本地生成 request id、nonce、actionHash 和 risk；用户决定
  写本地 decision；本地 executor 持 Rayrun token 并执行。云端 workspace/文件只传
  提案和结果，不传 decision 或执行权限。
- **云端 agent 不能自批本地动作。** 它即使被 prompt injection，也不能写本地 decision
  或 `exec-<id>.json` claim；但**它仍能读/改自己的 workspace、提案和 transcript**，
  所以 proposal 必须当不可信输入重新校验。
- **首版只保护 typed 本地动作。** allowlist 只有 `rayrun.machine.start` /
  `rayrun.machine.stop` / `rayrun.machine.pause` / `rayrun.machine.resume`；
  `destroy`、创建机器、shell、任意命令/URL 不在其中。其他本地动作、云端凭据动作
  仍需后续工作。
- **不是沙箱、不是每 bot 隔离。** 云端 agent 仍是 root、`danger-full-access`；多 bot
  仍共享机器。审批只保护需要本地执行的动作，不使被攻陷的 bot 变得可信。
- **本地不在线就等待。** chat 审批等待，background 按 TTL 拒绝；没有后台自动批准。
- **云端凭据动作仍等待平台隔离。** ADR-001 仍适用于凭据只在云端、必须云端执行的动作；
  平台 host/agent 隔离和 host-only 端点落地前，这些动作不执行。
- **不要声称审批阻止了被攻陷的 bot。** 本机制阻止的是“云端 agent 直接伪造本地决定
  并执行受控本地动作”；它不阻止 agent 在自己的 workspace 内做其他事。
- **当前验证边界。** 本地 executor、拒绝/过期/重放/崩溃 claim 有 Node 测试；页面
  E2E 验证了“拒绝无执行、批准执行失败不假成功”；真实 cloud proposal → Allow →
  machine.stop → 停机 outbox → 重启补传，以及 machine.start 审批和下一轮
  recent-approval context 已 live 通过（2026-11-23）。云端凭据动作尚未 live 验证；
  见 [`12-status.md`](12-status.md)。

### 4.5 Routine 定义与结果

- routine 定义是用户意图，但云端镜像 `routines.json`、`routines-state.json` 和
  `routine-results/` 都在 agent 可写 workspace 内，必须当不可信输入重新校验。
  cloud host 校验定义并维护自己的 claim；本地 bridge 校验每个结果后才写本地。
- routine 结果只作为展示历史，不写 decision、execution claim 或 session 队列；
  它不能批准动作。routine 轮次产生的审批仍是 `background`，30 分钟过期。
- routine turn 走普通 send 路径，可能唤醒停止/暂停的机器并产生费用；启用 routine
  是持续授权，不是逐次审批。cloud routine scheduler 已在 Rayrun dev/test 环境
  live 验证（2026-11-24），生产待 R-G008 部署。
- 被攻陷的云端 agent 仍能在自己的 workspace 内写定义/结果；本地校验失败即拒绝，
  不把 workspace 内容当作可信控制面。

## 5. 不保护什么

- **云电脑上的浏览器登录与保存的 session。** 不持久化，也不在 v0.1；设计不做替模型
  填表的凭据 vault。
- **云厂商对模型 key 的可见性。** 已验证 agent 的 `exec` 环境读不到 key；Rayrun 员工
  或平台本身是否能读存储的 credential **未验证**。不要写“Rayrun 看不到你的 key”。
- **本地审批执行（首版）。** 覆盖 typed 机器 start/stop/pause/resume；云端凭据动作
  和其他动作仍未保护。云提案 bridge、start/stop、denial/Continue 和下一轮结果 context
  已 live。云 worker 仍是 `approval: never`，只在你准备失去的
  凭据和机器上运行。
- **不可信模型输出。** 模型可能错、被操纵或恶意；审批降低影响面，不使模型可信。
- **多 bot 隔离。** 没有；bots 共享一台电脑。
- **破坏性误操作。** `destroy` 删除 workspace；没有恢复。
- **余额耗尽。** 平台可能 force-destroy 机器与磁盘；这是数据丢失风险。

---

## 6. 用户与贡献者实践

- 不要把 Rayrun token、API key 或密码放进仓库文件、fixture、issue、PR 或聊天。
- token 放 Harness vault；优先用可吊销的专用 Rayrun 账号/ token。
- `egress_allow` 尽量窄；新机器默认无网。
- 优先 stop，不要 destroy，除非机器本来就该消失。
- 关注余额：耗尽可能 force-destroy 机器与磁盘。
- 仓库层面：无运行时依赖、无构建步骤；新增依赖或 installer 要像代码一样审查。

---

## 7. 未决项

| 问题 | 影响 | 决策 |
| --- | --- | --- |
| 审批执行点与安全边界 | 失败即拒绝是否成立 | ADR-019：本地 typed 动作由本地 DSH host 执行；ADR-001 仍用于云端凭据动作；云提案 bridge、start/stop、denial/Continue 和下一轮 context 已 live |
| 副作用崩溃/重试 | 重复发送/花钱 | ADR-005 |
| desktop 安全路径 | watch/takeover | ADR-008 |
| 本地审计是否 tamper-evident | 审计声明 | ADR-012 |
| Harness vault 的后端 | token 存储强度 | TBD |

---

## 8. 相关文档

- [`01-system-architecture.md`](01-system-architecture.md)
- [`05-approvals.md`](05-approvals.md)
- [`06-local-state.md`](06-local-state.md)
- [`08-integration.md`](08-integration.md)
- [`../SECURITY.md`](../SECURITY.md)
