# 07 — 安全

> 状态：2026-11-21。本文定义安全目标、威胁模型、凭据边界与“不保护什么”。
> 技术基线见 [`01-system-architecture.md`](01-system-architecture.md)；审批的信任
> 边界见 [`05-approvals.md`](05-approvals.md)；本地状态见
> [`06-local-state.md`](06-local-state.md)；平台 handoff 见
> [`08-integration.md`](08-integration.md)；未决决策见
> [`adr/architecture-decisions.md`](adr/architecture-decisions.md)。
> 本仓库的 bot 层安全属性是**设计意图**，不是已验证行为；实现状态以
> [`../README.md`](../README.md) 的 **Status** 段为准。标记 **TBD** 的项未验证。

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
| [`adr/architecture-decisions.md`](adr/architecture-decisions.md) | ADR-001（审批执行点）、ADR-005（副作用） |

---

## 1. 安全目标

1. **凭据留在用户侧。** 没有项目方服务器、中继或控制面，所以没有地方池化 token。
2. **Rayrun token 不进入页面。** 它只存在于本地 Harness vault、host 侧，只用于
   Rayrun API。
3. **DeepSeek key 只注入、不被读。** Rayrun 存储并注入 agent 进程；插件和工具不读它，
   机器内的 `exec` shell 看不到它。
4. **审批失败即拒绝。** 外部副作用等人；超时或未知状态 = 拒绝。**注意**：ADR-001
   已定为平台权限隔离；平台提供隔离前审批不实现，也不是对被控 bot 的安全边界，
   见 §4.4。
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

设计契约是失败即拒绝；但 v0.1 计划中的审批文件邮箱位于
`/workspace/.rayrun/.../approvals/`，而 bot 以 root 运行、可读写该目录。它可以从请求
文件读到 nonce/id，并写一个匹配的决定自批；也可以修改 host/queue 或绕过工具。

ADR-001 已定（2026-11-21，选项 2：平台权限隔离）。平台提供 host/agent 隔离与审批
端点之前：

- **不实现审批执行**；文件邮箱只传提案与审计，不是授权边界。
- 审批仍是“用户同意/审计”，**不是对被控 bot 的安全边界**。
- 不要声称“审批阻止了被攻陷的 bot”。
- 平台能力清单见 [`08-integration.md`](08-integration.md) §3.3。

### 4.5 公网入站

Rayrun 机器的 desktop 端口可以 public；ingress 的 token 层目前不可用。不要把 public
desktop URL 当产品面板，也不要假设它私密。bot 层自己的流量应走认证网关 + 短期 token
（TBD；见 ADR-008）。

### 4.6 供应链

DSH bundle 的 host 代码以用户权限运行在 DSH 进程里；只从可信来源安装。两个 bundle
来自两个仓库：`dsh-rayrun-bots`（本仓库）和 `dsh-rayrun-computer`（独立项目）。任一
被篡改都是风险。两个包的版本兼容属于依赖契约；若未来加依赖或 installer，按代码审查，
lockfile/provenance 实践 TBD。

### 4.7 云与模型厂商条款

Rayrun 运行机器，DeepSeek 服务模型；它们的条款、数据处理和可用性适用于到达它们的
数据。本项目不能代它们承诺 DPA、SOC 2、区域驻留或删除请求，也不做这种承诺。

### 4.8 CI 部署凭据（可选）

main-only 的 Rayrun deploy job 需要把 Rayrun token 存成 GitHub Actions secret
`RAYRUN_TOKEN`，把目标 sandbox id 存成仓库变量 `RAYRUN_SANDBOX_ID`。这是**维护者
凭据**，不是产品运行时路径：它只用于上传包和重启指定沙盒的 `dsh web`，不会进入
client、RPC、沙盒环境、工作区或日志；PR/fork 永远不运行这个 job。部署写入的
`/workspace/dsh-web-url.txt` 含 DSH 进程 token，mode 600，取链接时按凭据处理。
launch token 每个 `dsh web` 进程随机生成；token 交换后的签名 cookie 默认 30 天、
绑定 host:port，签名 secret 存在沙盒 DSH 的 credential store，因此同一浏览器跨
部署仍可用不带 token 的公网 URL。新浏览器/设备需要新的 token URL。

残余风险：今天 Rayrun token 是账号级、无 scope；能改 main 的人可以触发部署并使用
它。缓解：专用、可吊销的 Rayrun 账号/token；GitHub environment protection 或
required reviewers；定期轮换；固定 sandbox id；只在 main 上运行。部署会把 DSH 暴露
在 public 6080 ingress，唯一门禁是该进程 token；不用时 stop 沙盒。

---

## 5. 不保护什么

- **云电脑上的浏览器登录与保存的 session。** 不持久化，也不在 v0.1；设计不做替模型
  填表的凭据 vault。
- **云厂商对模型 key 的可见性。** 已验证 agent 的 `exec` 环境读不到 key；Rayrun 员工
  或平台本身是否能读存储的 credential **未验证**。不要写“Rayrun 看不到你的 key”。
- **审批路径（平台权限隔离落地之前）。** 云 worker 目前 `approval: never`；审批执行
  不实现，云 bot 是无人监督的。只在你准备失去的凭据和机器上运行。
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
| 审批执行点与安全边界 | 失败即拒绝是否成立 | ADR-001：已定（平台权限隔离）；平台提供前不实现 |
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
