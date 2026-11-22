# 客户端计划 — v0.1

*状态：2026-11-22。客户端是 Rayrun Bot 插件的 client half——用户在 DSH Web UI
（`dsh web` 或 DSH 桌面壳）里触碰的页面。本计划只覆盖客户端；bot runtime、审批桥和
云端调用见 [mvp-plan.md](mvp-plan.md)。布局是
[ui-design.md](../design/ui-design.md) 的三栏壳：聊天列表、对话、每 bot 详情。按调研
假设，v0.1 以 DSH 插件 + `dsh web` 交付，没有独立桌面 App。视觉规范、文案表和可点击
mockup：[ui-design.md](../design/ui-design.md)。Bot 身份、名字、头像和语气：
[bot-persona.md](../design/bot-persona.md)。实现状态以
[../12-status.md](../12-status.md) 为准。*

## 客户端负责什么

- 渲染产品表面，并通过同源 RPC 与**我们的 host half** 通信。它绝不直接访问 Rayrun
  API，也绝不持有 token。
- 收集用户决定（批准/拒绝、创建/编辑 bot）并转发；它不是权威。状态来自 host，不是
  客户端缓存。
- 复用 DSH 的壳、聊天、设置、locale 和插件处理；不重新实现它们。
- 以纯 ESM 交付，**无运行时依赖**；只使用 DSH 提供的模块（`react` 等）。页面启动时
  加载。

## 表面

| 表面 | 位置 | 用途 | v0.1 |
| --- | --- | --- | --- |
| 聊天列表 | 左栏 | 搜索、`+`、当前 bot、带最新摘要/时间/关注点的 bot 行 | P0 |
| 对话 | 中栏 | markdown 消息、日期分隔、内联审批/草稿卡、composer | P0 |
| Bot 详情面板 | 右栏 | 资料、Activity/Library 标签页、receipt、routines、紧凑电脑行、用量 | P0 |
| 内联审批卡 | 对话 | 动作、警告、来源与 TTL；Deny / Allow once；聊天列表关注点 | P0 |
| Onboarding 向导 | 独立页面 | 依赖检查 → Rayrun 登录 → DeepSeek key → 电脑 + 第一个 bot | P0 |
| 用量块 | 详情面板 + 列表页脚 | 余额、机时、本周花费、idle-stop 策略、低余额提示 | P0 |
| 设置 | 独立页面 | 默认模型、预算警告阈值、通知、语言 | P1 |
| 电脑视图 | 深链 | 打开独立云电脑插件的桌面页；我们不重建 noVNC | P0 |
| Library 标签页 | 详情面板 | 按日期分组的产物，由 host 拉取；v0.1 没有编辑器 | P1 |

依赖已经渲染的一切——Rayrun 登录、token 处理、机器创建、noVNC 桌面——都是**链接过去，
不是重建**。客户端计划把这些页面当作外部 UI，路由契约在 spike C-S5 确认。

## 与 host 的 RPC 契约

客户端与 `/plugins/<bundle-id>/rpc` 通信（同源、origin 校验、大小限制、JSON）。host
adapter 拥有 Rayrun token 和文件邮箱。

今天已实现：`GET /plugins/rayrun-bots?action=health`、`bots.*`，以及 host half 的
`session.send/history/status`（依赖的 `rayrun_agent` tool 存在时执行真实一轮，否则
`session.send` 返回 `E_RUNTIME_UNAVAILABLE`）。客户端对话对真实名册 bot 已调用这些
动作；示例 bot 仍走预览。下表是其余动作的草案。

| 分组 | 动作（草案） |
| --- | --- |
| health | `health`（已实现）；`setup.status`、`dependency.health`（已安装版本、是否兼容） |
| setup | `setup.rayrun.loginStatus`、`setup.key.status`、`setup.computer.ensure` |
| bots | `bots.list`、`bots.get`、`bots.create`、`bots.update`、`bots.delete`、`bots.start`、`bots.stop` |
| sessions | `session.history`、`session.send`、`session.status`（已实现）；`session.subscribe`（stream，草案） |
| approvals | `approvals.list`、`approvals.get`、`approvals.decide`、`approvals.history` |
| cost | `cost.summary`、`cost.byBot`（P1） |
| settings | `settings.get`、`settings.update` |

规则：响应绝不携带 Rayrun token 或 DeepSeek key；错误带稳定 code 和一句人话；
`approvals.decide` 按 approval id 幂等，拒绝过期、重放或错 bot 的决定。流式：host 的
SSE 如果足够便宜就用，否则 1 秒轮询 transcript——由 spike C-S4 决定。

## DSH 集成

- 用与云电脑插件相同的方式注入客户端 UI 模块：侧边栏、对话、设置、locale、API remotes。
- 保持一个 `client.js` 入口，纯 ESM；当单文件放不下时把页面拆成模块，但仍随包的
  `client.js` 导出一起交付。
- Locale 走自己的 `locale/en.json` 和 `locale/zh.json`，使用与依赖相同的 key 对齐
  审计测试。
- 尽可能复用 DSH 聊天。如果客户端无法以编程方式打开 session（spike C-S2），退回
  transcript 视图加 composer，通过 `session.send` 发送。

## Week 0 — 客户端 spike（C0）

| # | Spike | 问题 | 决策门 |
| --- | --- | --- | --- |
| C-S1 | 壳集成 | 侧边栏页面、设置页和 locale 注入在 DSH `0.2.2-rc.1` 上是否可用？ | 页面骨架获批 |
| C-S2 | 聊天复用 | Client half 能否创建/打开 DSH session 并发送消息？ | 复用聊天，或 transcript + composer 回退 |
| C-S3 | 审批 | 能否使用 DSH 的审批 seam UI，还是必须渲染自己的 inbox？ | 除非 seam 可编程，否则自己做 inbox |
| C-S4 | 流式 | host SSE 与轮询：延迟、成本、复杂度 | 传输方式冻结 |
| C-S5 | 深链 | 依赖的登录页和桌面页的稳定路由 id；嵌入规则 | 链接契约写下来 |
| C-S6 | 审批卡安全 | 卡片数据不能跨 bot 伪造；决定绑定 bot id 和 action hash | 卡片的威胁笔记补齐 |

如果 C-S2 和 C-S3 都失败，MVP 收窄为 **名册 + 审批 + 电脑链接**，对话通过 DSH 自己的
聊天交接处理。这是调研里的“客户端 API 无法表达产品”门。

## 交付波次

| 波次 | 目标 | 交付 |
| --- | --- | --- |
| C1（W1） | 三栏壳 | 聊天列表、对话和详情骨架、locale、空/错误状态、stub RPC |
| C2（W2） | 聊天列表与对话 | 带关注点的行、新建 bot 表单、markdown 对话、历史 |
| C3（W3） | 审批与 receipt | 带 TTL 的内联卡、关注点、receipt 卡、过期/失效状态 |
| C4（W3–4） | Onboarding 与成本 | 带依赖健康和深链的向导、成本栏、低余额警告 |
| C5（W4） | 电脑与韧性 | 桌面深链、恢复横幅（host 重启中）、恢复 UX、产物列表 |
| C6（W5） | 打磨与门禁 | 完整 i18n、键盘/焦点检查、首屏检查、手工验收 |

## UX 流程与失败状态

1. **首次运行。** 向导显示四个步骤，每步有内联状态和指向修复页面的链接（登录、key、
   电脑）。全部就绪时可以跳过。
2. **日常。** 打开 → 聊天列表 → 有注意力点的 bot → 回答内联卡 → 批准或拒绝。从侧边栏
   出发，两次点击内都能到达。
3. **笔记本合上。** 重新打开时，工作中的 bot 显示“工作中”，完成的工作显示为未读，
   仍在 inbox 里的审批继续可见。
4. **失败。** 依赖缺失或太旧；没有 Rayrun token；没有 DeepSeek key；电脑已停或休眠；
   bot runtime 恢复中；审批过期；余额低；网络离线。每个状态给一句话和一个下一步——
   绝不走进死胡同，也绝不假成功。

## 客户端状态

服务端权威；客户端只保留只读缓存。

- `Bot { id, name, instructions, status, computerId, lastSeenAt, cost? }`
- `Approval { id, botId, action, risk, createdAt, expiresAt, state }`
- `Machine { status, balance, hours, idleMinutes }`
- `Setup { dependency, rayrunLogin, deepseekKey, computer, firstBot }`

只有编辑消息和按下批准/拒绝时做乐观 UI，且任何 RPC 错误都回滚。

## 测试

- 纯逻辑（状态 reducer、selector、formatter）用普通 Node 测试
  （`node test/client-*.mjs`）；v0.1 不引入浏览器测试框架，除非回归需要。
- Locale 对齐审计（en/zh key），风格与依赖一致。
- RPC 契约测试在 host 侧；客户端从 W1 起对着 stub 构建。
- 手工 golden path 对应 mvp-plan 的验收任务 A1–A12，用截图作为证据。
- 上面“失败”里的每条错误路径都要手工检查。

## 风险

| 风险 | 信号 | 缓解 |
| --- | --- | --- |
| DSH 客户端 API 无法表达产品 | C-S2/C-S3 失败 | 收窄为名册 + 审批 + 电脑链接；独立壳留作后续选项 |
| 复用 DSH 聊天不可编程 | C-S2 失败 | transcript 视图 + 经 host 的 composer |
| 两插件 UI seam 断裂 | 跨版本深链 404 | 依赖健康检查、版本契约、一句回退文案 |
| 审批卡过期 | 服务端拒绝决定 | 拒绝时刷新，显示“已过期或已处理” |
| i18n 漂移 | zh/en key 分叉 | 同 commit 规则加审计测试 |
| 客户端长出依赖 | bundle 引入库 | 无运行时依赖不变量；只用纯 ESM |

## 客户端完成定义（v0.1）

- 每个面向客户端的验收任务（A1–A12）都在干净 profile 上演示过。
- Locale 对齐审计通过；审批和 key 文案没有玩笑。
- 没有 RPC 响应携带 Rayrun token 或 DeepSeek key；客户端绝不直接读配置文件。
- 正常笔记本上页面首屏一秒内；没有新运行时依赖；client 模块能在 `0.2.2-rc.1` 加载。
- 上面的失败状态在发布前实现并手工检查。

## 不在 v0.1

独立桌面 App、移动 App、推送通知、消息编辑器重写、链接之外的产物预览、自定义主题，
以及按 bot 的花费图表。
