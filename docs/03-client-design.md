# 03 — 客户端设计

> 状态：2026-11-23。本文定义 DSH 客户端半区的表面、交互、RPC 分组与失败状态。
> 产品方向见 [`00-product-direction.md`](00-product-direction.md)；技术基线见
> [`01-system-architecture.md`](01-system-architecture.md)；视觉规范见
> [`design/ui-design.md`](design/ui-design.md)；交付计划见
> [`plans/client-plan.md`](plans/client-plan.md)。
> 实现状态以 [`12-status.md`](12-status.md) 为准。

## 0. 与现有文档的关系

| 文档 | 负责什么 |
| --- | --- |
| [`design/ui-design.md`](design/ui-design.md) | 视觉语言、布局、点击式 mockup |
| [`plans/client-plan.md`](plans/client-plan.md) | C-S1–C-S6 spike、交付波次、验收 |
| [`design/bot-persona.md`](design/bot-persona.md) | bot 名字、头像、语气与创建文案 |
| [`05-approvals.md`](05-approvals.md) | 审批语义、schema 与安全边界 |
| [`adr/architecture-decisions.md`](adr/architecture-decisions.md) | ADR-008（desktop）、ADR-010（RPC）、ADR-011（审批卡） |

---

## 1. 定位

客户端运行时是 **DSH 插件**；产品表面是 **Bots**（ADR-017）：

- 打开 DSH 后客户端自动激活 Bots；Bots 全屏覆盖 DSH 侧栏和底栏，Rayrun Bot 是品牌，
  DSH 是宿主。不 fork、不重写 DSH core。
- 复用 DSH 的壳、聊天、设置、locale 和插件机制；不重写聊天 UI。Bots 内不提供返回
  DSH 的入口；Plugins、云电脑、Workspaces 等流程需要由 Bots 接管（尚未实现）。
- 只通过同源 RPC 通信：host health 走我们的 host half；Rayrun 连接和云电脑打开走
  `dsh-rayrun-computer` 的同源 RPC。客户端不直接访问 Rayrun API，也不在自己的状态里
  保存 Rayrun token 或 DeepSeek key。
- 收集用户决定（批准/拒绝、创建/编辑 bot）并转发；服务端权威，客户端只做只读缓存。
- v0.1 只发 `dsh web`（浏览器或桌面壳）；独立桌面应用是 v1.0 的可选赌注。

---

## 2. 表面

| 表面 | 位置 | 用途 | v0.1 |
| --- | --- | --- | --- |
| 聊天列表 | 左栏 | 搜索、`+`、当前 bot、最近消息、时间、attention 点 | P0 |
| 对话 | 中栏 | markdown 消息、日期分隔、内联审批/收据卡、composer | P0 |
| Bot 详情 | 右栏 | 名字/职责、Activity / Library、receipts、routines、电脑摘要、用量 | P0 |
| 内联审批卡 | 对话内 | 动作、风险、来源、TTL；Deny / Allow once；列表 attention 点 | P0 |
| 首次设置向导 | 独立页 | 依赖检查 → Rayrun 连接（API token）→ DeepSeek key → 电脑 + 第一个 bot | P0 |
| 用量块 | 详情 + 列表底部 | 余额、机器小时、本周花费、idle-stop 策略、低余额提示 | P0 |
| 设置 | 独立页 | 默认模型、预算阈值、通知、语言 | P1 |
| 电脑视图 | 深链 | 打开独立云电脑插件的 desktop 页面；不重建 noVNC | P0（路径见 ADR-008） |
| Library | 详情 tab | 按日期分组的产物；host 拉取；v0.1 无编辑器 | P1 |

依赖已经渲染的页面（Rayrun 登录、token 处理、机器创建、noVNC）**只链接，不重建**；
深链路由契约在 C-S5 确认。

---

## 3. 复用 DSH 与 spike

客户端不能假设 DSH 暴露所有能力。Week 0 的 spike 决定形态：

| Spike | 问题 | 决策门 |
| --- | --- | --- |
| C-S1 | 侧栏页、设置页、locale 注入在 DSH `0.2.2-rc.1` 上是否可用？ | 页面骨架可接受 |
| C-S2 | client half 能否创建/打开 DSH session 并发消息？ | 复用聊天，或 transcript + composer 回退 |
| C-S3 | 能否复用 DSH 的审批 seam？ | 可编程则复用，否则自建 inbox |
| C-S4 | SSE 还是轮询？ | 传输冻结 |
| C-S5 | 依赖的登录/desktop 深链路由是否稳定？ | 写出链接契约 |
| C-S6 | 审批卡数据能否跨 bot 防伪造？ | 威胁说明写入卡片 |

如果 C-S2/C-S3 都失败，MVP 收窄为 **roster + 审批 + 电脑链接**，对话走 DSH 自己的
聊天交接。详见 [`plans/client-plan.md`](plans/client-plan.md)。

---

## 4. RPC 契约

客户端通过同源 JSON 请求与 host half 通信；host adapter 持有 Rayrun token 与文件邮箱。
当前唯一接好的动作是 host 健康检查：`GET /plugins/rayrun-bots?action=health`，请求带
`credentials: same-origin`、`cache: no-store`，不携带 token；响应是扁平的
`{ ok, plugin, version, ready }`。其余动作仍是计划；接线前必须按 ADR-010 定一个统一的
路由/信封（文档曾写 `/plugins/<id>/rpc` + `{ action, payload }`）并同步代码、测试和文档。

动作分组（草案）：

| 组 | 动作 |
| --- | --- |
| health | `health`（已实现并被客户端调用）；`setup.status`、`dependency.health`（草案） |
| setup | `setup.rayrun.loginStatus`、`setup.key.status`、`setup.computer.ensure` |
| bots | `bots.list`、`bots.get`、`bots.create`、`bots.update`、`bots.delete`、`bots.start`、`bots.stop` |
| sessions | `session.history`、`session.send`、`session.subscribe` |
| approvals | `approvals.list`、`approvals.get`、`approvals.decide`、`approvals.history` |
| cost | `cost.summary`、`cost.byBot`（P1） |
| settings | `settings.get`、`settings.update` |

规则：

- 响应不携带 Rayrun token 或 DeepSeek key；错误带稳定 code + 一句人类可读文本。
- `approvals.decide` 按 approval id 幂等；拒绝过期、重放、错 bot、stale action。
- 流式：SSE 如果便宜就用，否则 1 秒轮询 transcript；由 C-S4 决定。
- 客户端只读缓存；只有“发消息”和“批准/拒绝”做乐观 UI，失败回滚。

---

## 5. 审批卡

卡片是产品最敏感的表面，规则见 [`05-approvals.md`](05-approvals.md) 和 ADR-011：

- 显示结构化字段：动作类型、目标、金额/收件人/URL、风险、来源（chat/background）、
  TTL；来源与目标用 chips，风险用一行短标签，元数据不再重复来源；不渲染机器提供的
  HTML 或 markdown。
- 两个动作：Deny、Allow once；没有“永远允许”或默认放行。
- 过期、已答、stale、错 bot 显示明确状态，并刷新列表。真实卡决定后提供 Continue bot，
  由用户决定是否发送下一轮。
- 列表上的 attention 点标记“等你”；不显示未读 bait。
- 本地侧对“实际显示的内容”重算 action hash；任何不匹配 = 拒绝。

ADR-019（2026-11-23）：本地 DSH host 对 typed 本地动作做审批与执行；真实 bot 的卡片
读取本地 approval store，批准后可执行 `rayrun.machine.start/stop/pause/resume`。云端凭据动作仍等待
平台隔离（ADR-001）；云端 proposal/决定/claim 不是授权边界。

真实 bot：对话和审批卡走 host。示例 bot 仍是页内预览：发送消息后先显示 working row，
约 1.2 秒后出现模拟回复和 pending 审批卡，不调用 host，也不发送任何东西。对话在发送、
回复和切换 bot 时滚动到最新一条。

带 `expiresMin` 的后台审批每分钟递减一次；归零后转为 expired、去掉动作，并同步列表的
attention、snippet 与时间。chat 来源没有 TTL，显示 `waits for you`。预览里的后台审批从
1 分钟开始，便于看到过期。

---

## 6. 首次设置与失败状态

**向导四步**：依赖检查 → Rayrun 连接（API token）→ 云电脑 → 第一个 bot。
依赖步骤显示 host 检测到的插件版本；Rayrun 步骤把粘贴的 token 交给云电脑插件的
`connection.save`，再用 `overview` 显示真实余额/机器数；失败显示一句可执行错误。用户
密码/微信登录仍在云电脑插件里，尚未在 Bots 内暴露。

**云电脑步骤**：先用 `overview` 查找已有机器；有则直接采用并显示名称，Bots 不修改它的
设置或模型凭据。没有机器时，用户填写名称和可选的 DeepSeek key，点“创建云电脑”调用
`machine.create`，规格取插件的 `defaults`（默认 `deepseek-harness@1`、2 vCPU、至少 2 GB、
远程桌面）。key 只作为 `modelKey` 交给云电脑插件存成机器凭据，不进入 Bots 的 host 状态，
成功后清空输入。按钮文案明确说明这是 Rayrun 账号上的计费机器，且 Bots 永不销毁它；
未连接时按钮不可用，失败显示一句可执行错误。多台机器时 setup 和重复创建检查优先选
`rayrun-bot`，其次选有 `desktop_url` 的机器，最后才用第一台；Open/Take over 不用这个
猜测：host 从 bot 的 session 提供实际机器名（`bots.list.computers`），客户端只查
这个名字；找不到时按钮不可用并显示 host 管理/未连接状态。依赖层
创建成功路径已在本机用真实 token 和 model key 验证（token 未进入沙箱）；Bots 页面内的
已有机器采用和 Continue 已在本机 DSH 页面验证，创建按钮本身因账号已有机器尚未点击，
仍需补验，见 [`10-rayrun-verification.md`](10-rayrun-verification.md) §4。

每一步显示内联状态和“去修复”的链接；全部就绪时可跳过；依赖缺失或版本不匹配要给一句
可执行的安装提示，不崩溃。

**打开云电脑**：详情面板的 `Open` / `Take over` 调云电脑插件的 `overview`、
`machine.action`（start/resume）、`machine.get` 轮询、`machine.desktopRepair` 和
`machine.password`。连接未配置时
提示先连接（`computer.connectFirst`）；没有机器、弹窗被拦截、启动超时、没有 desktop
时各自一句可执行提示。成功时在新标签打开 `desktop_url`，密码只保存在页面状态里，用
可关闭的提示条显示。两个按钮当前调用同一路径，`Take over` 的共享控制语义尚未实现。
依赖层和 Bots 页面内的 Open 成功路径都已在本机 DSH web 页面用真实 token 和真实机器
验证（启动、desktop 新窗口、密码提示条；token 未进入沙箱），见
[`10-rayrun-verification.md`](10-rayrun-verification.md) §3.1。

机器 Running 时详情块显示 `Stop`。点击后先显示“停止云电脑？正在运行的工作会暂停。”，
确认后调用 `machine.action`（`verb: "stop"`），轮询 `machine.get` 到 Stopped，显示
“云电脑已停止。”；超时或失败各一句可执行提示。Bots 永不调用 `destroy`。页面层
Open → live → Stop → sleeping 已在同一本机 DSH 页面验证。

**详情面板的真实数据**：Rayrun 连接成功后，电脑块显示云电脑插件 `overview` 里的真实
机器名与状态（Running → live，Starting/Stopping → reconnecting，Stopped/Paused →
sleeping），用量块显示真实余额与机时；未连接时显示 `—` / `Not connected` 和
`Connect Rayrun to see usage.`，不再显示样本数字。`?computer=` 预览仍可覆盖状态；
receipts、library、示例 bot 的 routines 和消息仍是页内样本；真实 bot 的 routines
已接 host，可创建、启停和删除，轮询时 `routines.sync` 会把云端结果导入并在对话中
显示，Preview 药丸继续标注页内样本。

**空 roster**：列表和中心区显示 `No bots yet` + `Create bot`；新建 bot 后进入空对话
欢迎态并聚焦 composer，details 面板的 Recent / Upcoming / Library 显示空态和一句内容
出现时机的提示，不放没有行为的按钮。可用 `?first-run=1` 预览（仅页内预览，不会连 host）；
`?computer=live|reconnecting|sleeping|unreachable` 预览电脑状态，`?low-balance=1`
预览低余额提示。

**失败状态**（每个一句提示 + 一个下一步）：

- 依赖缺失/过旧（`E_DEP_MISSING` / `E_DEP_VERSION`）
- 没有 Rayrun token（`E_TOKEN_REQUIRED`）
- Rayrun 拒绝 token（401；setup 显示“检查 token 后重试”）
- 没有 DeepSeek key（`E_KEY_REQUIRED`）
- 电脑停止/忙碌（`E_MACHINE_STOPPED` / `E_MACHINE_BUSY`）
- 云电脑创建失败或超时（显示 Rayrun 返回的原因）
- bot runtime 恢复中（`E_HOST_DOWN`）
- 审批过期/重放/未知（`E_APPROVAL_*`）
- 余额低（`E_BALANCE_LOW`）
- 网络离线
- 依赖/契约版本不匹配

任何状态都不能给假成功；审批相关失败一律拒绝。

---

## 7. 交付波次

| 波次 | 目标 | 交付 |
| --- | --- | --- |
| C1 | 三栏壳 | 聊天列表、对话、详情骨架、locale、空/错误状态、stub RPC |
| C2 | 列表与对话 | 带 attention 点的行、新建 bot 表单、markdown、历史 |
| C3 | 审批与收据 | 内联卡、TTL、attention、receipt、过期/stale 状态 |
| C4 | 首次设置与成本 | 向导、依赖健康、深链、成本栏、低余额提示 |
| C5 | 电脑与韧性 | desktop 深链、恢复横幅、续接 UX、产物列表 |
| C6 | 打磨与门禁 | i18n、键盘/焦点、首屏、手工验收 |

完整验收与估时见 [`plans/client-plan.md`](plans/client-plan.md)。

---

## 8. v0.1 不做

独立桌面 App、移动 App、推送通知、消息编辑器重写、artifact 预览（链接之外）、自定义
主题、per-bot 花费图表。IM 审批是 v0.2。

---

## 9. 未决项

| 问题 | 影响 | 决策 |
| --- | --- | --- |
| RPC 路由与信封 | 客户端接线 | ADR-010 |
| desktop 访问路径 | Computer view P0 | ADR-008 |
| C-S2/C-S3 能否复用 DSH chat/审批 | MVP 形态 | Week 0 spike |
| 审批卡的信任边界 | 卡片安全 | ADR-019（本地审批/执行）、ADR-001（云端凭据）、ADR-011 |
| SSE vs 轮询 | 传输复杂度 | C-S4 |

---

## 10. 相关文档

- 产品范围：[`00-product-direction.md`](00-product-direction.md)
- 技术基线：[`01-system-architecture.md`](01-system-architecture.md)
- Bot 定义与创建文案：[`02-bot-model.md`](02-bot-model.md)、[`design/bot-persona.md`](design/bot-persona.md)
- 审批：[`05-approvals.md`](05-approvals.md)
- 视觉规范与 mockup：[`design/ui-design.md`](design/ui-design.md)、[`mockups/index.html`](mockups/index.html)
- 交付计划：[`plans/client-plan.md`](plans/client-plan.md)
