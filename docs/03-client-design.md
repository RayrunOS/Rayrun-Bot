# 03 — 客户端设计

> 状态：2026-11-18。本文定义 DSH 客户端半区的表面、交互、RPC 分组与失败状态。
> 产品方向见 [`00-product-direction.md`](00-product-direction.md)；技术基线见
> [`01-system-architecture.md`](01-system-architecture.md)；视觉规范见
> [`design/ui-design.md`](design/ui-design.md)；交付计划见
> [`plans/client-plan.md`](plans/client-plan.md)。
> 实现状态以 [`../README.md`](../README.md) 的 **Status** 段为准。

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

客户端是 **DSH 插件**，不是独立应用：

- 复用 DSH 的壳、聊天、设置、locale 和插件机制；不重写聊天 UI。
- 只通过同源 RPC 与我们的 host half 通信；不直接访问 Rayrun API，不持有 Rayrun
  token 或 DeepSeek key。
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
| 首次设置向导 | 独立页 | 依赖检查 → Rayrun 登录 → DeepSeek key → 电脑 + 第一个 bot | P0 |
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

客户端调用 `/plugins/<bundle-id>/rpc` 的同源、origin 校验、大小限制的 JSON 接口；
host adapter 持有 Rayrun token 与文件邮箱。**当前代码与计划的路由/信封尚未统一**：
已实现的是 `/plugins/rayrun-bots` + `GET ?action=health` 或 POST `{ action }`，文档曾写
`/plugins/<id>/rpc` + `{ action, payload }`。接线前必须按 ADR-010 定一个契约并同步
代码、测试和文档。

动作分组（草案）：

| 组 | 动作 |
| --- | --- |
| health | `setup.status`、`dependency.health` |
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
  TTL；不渲染机器提供的 HTML 或 markdown。
- 两个动作：Deny、Allow once；没有“永远允许”或默认放行。
- 过期、已答、stale、错 bot 显示明确状态，并刷新列表。
- 列表上的 attention 点标记“等你”；不显示未读 bait。
- 本地侧对“实际显示的内容”重算 action hash；任何不匹配 = 拒绝。

当前文件邮箱的信任边界见 ADR-001：在它定稿前，卡片是“用户同意/审计”，不是对被控
bot 的安全边界。

---

## 6. 首次设置与失败状态

**向导四步**：依赖检查 → Rayrun 登录 → DeepSeek key → 电脑 + 第一个 bot。每一步显示
内联状态和“去修复”的链接；全部就绪时可跳过。依赖缺失或版本不匹配要给一句可执行的
安装提示，不崩溃。

**失败状态**（每个一句提示 + 一个下一步）：

- 依赖缺失/过旧（`E_DEP_MISSING` / `E_DEP_VERSION`）
- 没有 Rayrun token（`E_TOKEN_REQUIRED`）
- 没有 DeepSeek key（`E_KEY_REQUIRED`）
- 电脑停止/忙碌（`E_MACHINE_STOPPED` / `E_MACHINE_BUSY`）
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
| 审批卡的信任边界 | 卡片安全 | ADR-001、ADR-011 |
| SSE vs 轮询 | 传输复杂度 | C-S4 |

---

## 10. 相关文档

- 产品范围：[`00-product-direction.md`](00-product-direction.md)
- 技术基线：[`01-system-architecture.md`](01-system-architecture.md)
- Bot 定义与创建文案：[`02-bot-model.md`](02-bot-model.md)、[`design/bot-persona.md`](design/bot-persona.md)
- 审批：[`05-approvals.md`](05-approvals.md)
- 视觉规范与 mockup：[`design/ui-design.md`](design/ui-design.md)、[`mockups/index.html`](mockups/index.html)
- 交付计划：[`plans/client-plan.md`](plans/client-plan.md)
