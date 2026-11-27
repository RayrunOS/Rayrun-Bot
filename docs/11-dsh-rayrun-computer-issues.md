# 11 — dsh-rayrun-computer 问题登记

> 状态：2026-11-27。本文登记依赖项目 `RayrunOS/dsh-rayrun-computer` 在集成中暴露的
> 契约、错误、API、可靠性和安全问题。登记方式参考
> [`10-rayrun-verification.md`](10-rayrun-verification.md)：每条有 ID、日期、证据、
> 影响/workaround 和下一步。
> **本仓库不修改、不 fork、不 vendor 它**；修复应去它的仓库，或在本仓库写 adapter。
> 实现状态仍以 [`12-status.md`](12-status.md) 为准。

## 0. 与 10 的分工

| 文档 | 记录什么 |
| --- | --- |
| [`10-rayrun-verification.md`](10-rayrun-verification.md) | 验证/测试环境在 Rayrun 上的缺口（平台、镜像、测试资源、egress 等） |
| [`11-dsh-rayrun-computer-issues.md`](11-dsh-rayrun-computer-issues.md) | `dsh-rayrun-computer` 自身的问题（本文） |
| [`08-integration.md`](08-integration.md) | 平台能力需求与 handoff；不重复依赖问题 |
| [`12-status.md`](12-status.md) | 实现状态与已验证/未验证结论 |

10 里的 R-G 编号只表示“测试环境能不能做”；本文的 RC 编号表示“依赖本身需要改什么”。
同一个现象可能同时出现在两边（例如 egress 缺失导致 `fetch failed`），但结论和下一步不同。

## 1. 登记规则

1. 只记录**实际观察**或从其发布代码/契约可验证的问题；不凭猜测。
2. 每条有可复现证据：RPC 响应、错误码、源码位置、截图或测试输出。
3. 修复方向默认去 `RayrunOS/dsh-rayrun-computer` 仓库；本仓库只做 workaround/adapter，
   并在“影响/workaround”列写清。
4. 已解决保留行，更新状态；不删除历史行。
5. 安全、凭据、销毁相关问题优先，标 severity。
6. 不把设计选择写成 bug；有争议的放 §4“按设计/非问题”。

## 2. 版本基线

- 观察对象：`dsh-rayrun-computer@1.3.1`（`49b69d9`，2026-11-27；npm `latest`，含
  `shapeSandbox.credentials`）；`1.2.2` 首次发布 machine credential 绑定名；
  `1.1.0` main（`720f30a`，2026-11-22，含 `dsh.start/status/result`）用于 detached
  页面验证。
- DSH：Rayrun 镜像 `0.2.0-rc.2`；升级验证 `0.2.2-rc.5`。
- 集成版本范围：本仓库 `lib/dependency.js` 接受 `>=1.0.0 <2.0.0`。
- 观察方式：Rayrun 沙箱内 Chrome + CDP 调 `/plugins/rayrun/rpc`；未使用真实 Rayrun
  token（真实 token 不进入测试沙箱，见 10 §1）。

## 3. 问题登记

| ID | 日期 | 严重度 | 类型 | 问题与证据 | 影响 / workaround | 状态与下一步 |
| --- | --- | --- | --- | --- | --- | --- |
| RC-001 | 2026-11-21 | High | 契约 | 未配置 Rayrun 时 `overview` 返回 `{ ok: true, connection: { configured: false }, machines: [] }`；`ok` 不代表已连接。证据：沙箱 RPC 响应；Bots 起初把空机器显示成 “No cloud computer yet”。 | 调用方若把 `ok` 当就绪会误导用户。Workaround：Bots 先检查 `connection.configured === true`，否则提示先连接。 | Open；Bots 已规避。上游应在响应/文档中明确该语义，或提供独立的 connection status。 |
| RC-002 | 2026-11-21 | Medium | 错误 UX | RPC 错误 message 是硬编码用户文案，混用中英文并指向插件自己的设置页和内部路径。证据：`account` 无 token 返回 `token_required`，message 为 “No Rayrun token. Save one in the 云电脑 settings, write it to /workspace/.rayrun/home/.rayrun/token, or set RAYRUN_TOKEN.” | Bots 不能直接展示；现在按 `code` 映射自己的 locale。内部路径不应出现在用户文案。 | Open；Bots 按 code 映射。上游应返回稳定 code + 结构化参数，文案由调用方决定。 |
| RC-003 | 2026-11-21 | High | API 缺口 | 没有独立的 model credential 写入 RPC；`credentials.list` 只读，写入只发生在 `machine.create(modelKey)` 或 `login.password(modelKey)`。证据：`index.js` action switch 与 `ensureModelCredential` 调用点。 | Bots 的 DeepSeek key 步骤只能和创建机器绑定；已有机器时无法通过 Bots 更新 key；当前 setup 在已有机器时跳过 key。 | Resolved（2026-11-27，`1.3.0+` 提供 `credentials.save` / `modelCredential.save`；可传 `modelKey`/`secret` 和可选 `name`，轮换已有机器绑定，不回显 key）。Bots 尚未接入 UI。 |
| RC-004 | 2026-11-21 | High | 可靠性/计费 | `machine.create` 没有 idempotency key，也没有名称唯一性保证；每次调用都 POST 新 sandbox。证据：`lib/rayrun.js createMachine()` 直接 POST `/sandboxes`，`cleanName()` 只做清洗。 | 超时/重试可能创建重复的计费机器。Workaround：Bots 在进入云电脑步骤和点击创建前各查一次 `overview`，按名称或第一台采用；仍有竞态。 | Resolved（2026-11-27，`1.3.0+` 接受 `idempotency_key`，平台 24h 幂等缓存 + 活跃名称唯一；并发同名/同 key 的 check-then-create 竞态仍是平台限制，Bots 的双重检查保留）。Bots 尚未传 idempotency key。 |
| RC-005 | 2026-11-21 | Medium | 副作用/清理 | `machine.create` 的 `modelKey` 路径先 `ensureModelCredential` 再建机器；建机器失败时 credential 已留下。证据：`index.js` `case 'machine.create'` 在 `ray.createMachine(input)` 前调用 `ensureModelCredential`。 | 失败重试会留下孤立 credential；没有 delete credential RPC，Bots 无法回滚。 | Resolved（2026-11-27，`1.3.0+` 在平台明确拒绝 4xx 或冷启动销毁时删除本次新建的 credential；已存在凭证和结果不明的网络失败不删）。 |
| RC-006 | 2026-11-21 | Medium | UX/进度 | 建机器是长请求（`timeoutMs: 180000`，冷启动还会重试），但 RPC 没有进度或取消；插件自己的 `createHint` 写“约 15 秒”。证据：`lib/rayrun.js createMachine()` 与插件 locale。 | Bots 只能显示静态 “Creating…”，慢冷启动看起来卡住，用户不能取消。 | Open；Bots 目前只显示静态文案。上游应提供 create job/status 或阶段事件。 |
| RC-007 | 2026-11-21 | Medium | 可观测性 | `overview` 的 balance/usage 用 `optional()` 包住，失败返回 null，`ok` 仍为 true；无法区分“没有数据”和“读取失败”。证据：`overview()` 的 `optional(api(.../billing/balance))` 与 `optional(.../usage)`。 | Bots Settings 只能显示 “—”，余额读取失败会静默；低余额提醒可能不触发。 | Open；上游应返回 per-field warning 或 `degraded` 标志。 |
| RC-008 | 2026-11-21 | Medium | 错误 UX | 网络失败统一成 `internal: fetch failed`，不区分 token 拒绝、egress 缺失或超时。证据：setup 测试在 egress 未放行 `api.rayrunos.com` 时返回该错误；放行后 401 才可区分（10 §2）。 | 用户无法判断该检查网络还是 token；Bots 只能显示原始串。 | Open；上游应映射 `ENOTFOUND` / `ECONNREFUSED` / timeout 为独立 code + 提示。 |
| RC-009 | 2026-11-21 | Low | API 缺口 | 没有机器状态订阅或事件流；只有 `overview` / `machine.get` 轮询。证据：RPC action 列表。 | Bots Open 每 1.5 秒轮询最多 60 秒；状态有延迟并产生额外请求。 | Open；Bots 按 1.5 秒轮询。上游可提供 SSE/长轮询或文档化轮询契约。 |
| RC-010 | 2026-11-21 | High | 安全 | `machine.action` 同时接受安全动作和 `destroy`，RPC 层没有独立能力或确认令牌；确认只在插件 UI。证据：`index.js` `machine.action` 把 `verb` 直接传给 `machineAction`。 | 任何同源页面脚本都能调用 destroy；Bots 绝不暴露它，但依赖层没有防线。 | Open；方案在依赖 `docs/rpc-authorization.md`，未改行为。短期拆分 destroy/一次性票据/审计只防误操作，真正边界需 Host-only 能力或 noVNC 密码代理；等用户决策。Bots 永不调用 destroy。 |
| RC-011 | 2026-11-21 | Medium | 安全 | `machine.password` 通过同源 RPC 直接返回桌面密码（stdout/stderr），没有额外授权或一次性限制。证据：`index.js` `machine.password` → `desktopPassword(id)`；插件 UI 同样读取。 | 同源脚本可在用户不知情时读取密码；Bots 只在用户点击 Open 后调用且不记录，但依赖层没有门槛。 | Open；方案在依赖 `docs/rpc-authorization.md`，未改行为；等用户决策。Bots 继续只在用户动作后读取。 |
| RC-012 | 2026-11-21 | Low | 契约 | RPC surface 没有机器可读的 schema 或版本；action 名称和返回形状靠源码/文档约定。证据：`index.js` action switch；本仓库 `lib/dependency.js` 只检查包 semver。 | 依赖升级可能静默改形状；Bots 的 contract 测试只能测自己的假设。 | Open；上游应发布 action/schema 版本或 JSON schema；Bots 在版本检查之外加形状探测。 |
| RC-013 | 2026-11-21 | Low | 契约 | `machine.desktopRepair` 返回 exec 输出而不是更新后的 machine；调用方要再 `machine.get`。证据：`index.js` 返回 `{ ok: true, result }`。 | Bots Open 多一次往返；当前 repair 不改 `desktop_url`，所以用旧对象未出错。 | Open；Bots 可按需 refetch。上游应返回 machine 或文档说明需要 refetch。 |
| RC-014 | 2026-11-21 | Medium | 隐私/契约 | `ensureModelCredential` 用本机 hostname 生成 credential 名称（`dsh-model-<hostname>`）。证据：`lib/rayrun.js` 的 `modelCredentialName()` 调 `hostname()`；2026-11-21 真实测试返回的名称含本机主机名（本文不记录具体值）。 | Rayrun 账号会看到本机主机标识；换机器会生成新 credential，产生重复；Bots 无法给用户稳定、友好的凭据名。 | Open；上游应接受调用方提供的显示名或用稳定标签；Bots 目前不能改名。 |
| RC-015 | 2026-11-21 | Medium | i18n/契约 | 云电脑插件的 client half 读 `locale.getLocale()?.id`，但 DSH 0.2.2-rc.5 的 locale 快照字段是 `active`；该插件的 client 导出还只有 `inject: ['slots']`，没有注入 `locale`。证据：`client.js` 的 `useT()` / `english()` 读 `.id`；本机 DSH web 把语言切到 English 后，DSH 壳和 Bots 变英文，云电脑侧栏与页面仍为中文。 | 云电脑插件自己的界面无法跟随 DSH 语言；产品的双语只覆盖 Bots 部分。Workaround：Bots 自己声明 `inject: ['slots', 'locale']` 并读 `.active`；不改依赖。 | Resolved（2026-11-27，`1.3.0+` client 注入 `locale`，优先读 `snapshot.active`，`.id` 兜底）。 |
| RC-016 | 2026-11-22 | High | API 缺口 | `rayrun_dsh` 只作为 agent tool 注册；`startTask` 通过 `localDirectory(exec.agent)` 取本地 workspace，host half 没有 agent session/workspace，无法启动或收取 detached worker turn。证据：`index.js` 的 `rayrun_dsh` tool、`lib/delegate.js` 的 `startTask/checkTask/collectTask`；本仓库 session runner 只有单轮 `rayrun_agent` adapter。 | 页面关闭后继续（v0.1 A5/A8）无法在 Bots host 中实现；单轮 `rayrun_agent` 在本地 DSH 关闭后无法收取结果。Workaround：暂无干净方案。 | Resolved（2026-11-22，`dsh-rayrun-computer` 1.1.0（main `720f30a`）提供 `dsh.start/status/result`；未发布 npm；Bots 已接 detached adapter，页面关闭 + host 重启后继续已在本机页面 + 已有 Rayrun 机器验证，见 [`10-rayrun-verification.md`](10-rayrun-verification.md) §3.1）。 |
| RC-017 | 2026-11-27 | High | 契约/凭据 | `lib/rayrun.js` 的 `shapeSandbox()` 丢弃平台返回的 `credentials` 绑定名，导致 `overview.machines[]` / `machine.get` 没有 `machine.credentials`；默认 cloudHost 只能向 runtime spec 传空数组，云端 DSH 以 `MISSING_CREDENTIAL` 退出。证据：dev API `GET /v1/sandboxes/:id` 返回 `credentials:["dsh-model-acceptance-20261127"]`，依赖 RPC 返回无该字段；修复前 host log `hasCredential:false`。 | 无显式 `cloudHost.credentials` 时默认 cloudHost 无法注入模型 key。Workaround：Bots 的 `machineCredentialNames()` 读取 `machine.credentials`；依赖修复后生效。 | Resolved（2026-11-27，npm `1.2.2`，gitHead `75e285d`；当前 `latest` `1.3.1` 同样包含；保留字符串绑定名，新增 `machine-shape` 3/3、`runtime-rpc` 13/13）。 |

## 4. 按设计/非问题

以下行为是依赖的既定设计，不单独作为 bug 登记；相关风险已在上表对应行说明：

- `overview` 在未配置时仍返回 `ok: true`，是设置页展示“未连接”状态的需要；问题在就绪
  信号不显式（RC-001），不是这个行为本身。
- `destroy` 出现在 RPC 表面，是插件自己的 UI 需要；问题在缺少独立能力边界（RC-010）。
- 远程桌面至少 2 GB、`machine.create` 的冷启动重试是文档化行为；进度缺口见 RC-006。
- `connection.save` / `login.logout` 把 token 存进 DSH vault，符合本仓库“token 留在
  host 侧”的边界；不是问题。
- `machine.password` 返回 stdout/stderr 文本是当前格式；问题在授权边界（RC-011），
  不是格式本身。

## 5. Bots 已采取的 workaround

| 问题 | Bots 的处理 |
| --- | --- |
| RC-001 | `openComputer` 和 setup 云电脑步骤检查 `connection.configured` |
| RC-002 | `rayRpc` 抛 `code`，Bots 按 code 映射自己的 locale |
| RC-004 | 进入云电脑步骤和点击创建前各查一次 `overview`，按名称/第一台采用 |
| RC-008 | 显示原始错误，不猜测网络原因 |
| RC-010 | Bots 不暴露 destroy；未来 idle 只 stop/pause |
| RC-011 | 只在用户点击 Open 后读密码，不记录、不持久化 |
| RC-016 | 已接 detached adapter（依赖 1.1+ 的 `dsh.start/status/result`）；1.0.x 仍用单轮 `rayrun_agent` |
| RC-017 | 依赖 `1.2.2+` 暴露 `machine.credentials`；Bots 的 `machineCredentialNames()` 用它填 runtime spec，未显式配置时继承机器已绑定凭据 |

## 6. 记录规则

- 新问题从 `RC-017` 起编号；写日期、严重度、类型、证据、影响/workaround、状态与下一步。
- 上游 issue/PR 引用本文 ID；解决后把状态改为 `Resolved（日期）`，保留行。
- 只记录**依赖自身**的问题；测试环境缺口放 10，平台能力需求放 08。
- 不在本仓库修改、fork 或 vendor `dsh-rayrun-computer`；需要适配就写在我们包里。

## 7. 相关文档

- [`10-rayrun-verification.md`](10-rayrun-verification.md)
- [`08-integration.md`](08-integration.md)
- [`07-security.md`](07-security.md)
- [`03-client-design.md`](03-client-design.md)
- [`../packages/dsh-rayrun-bots/README.md`](../packages/dsh-rayrun-bots/README.md)
- [`12-status.md`](12-status.md)
