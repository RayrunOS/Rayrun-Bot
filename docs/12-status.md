# 12 — 实现状态

> 状态：2026-11-22。本文是 Rayrun Bot **实现状态的唯一事实源**。根 `README.md` 是
> 营销页，不承载状态，也不作为事实依据；其他文档提到“今天能做什么、验证到哪一步”
> 时以本文为准。验证证据见 [`10-rayrun-verification.md`](10-rayrun-verification.md)
> 与 [`version-matrix.md`](version-matrix.md)；计划与验收标准见
> [`plans/mvp-plan.md`](plans/mvp-plan.md) 和 [`plans/roadmap.md`](plans/roadmap.md)。

## 1. 一句话状态

Pre-alpha。没有可发布版本。本项目依赖的云电脑插件
[`RayrunOS/dsh-rayrun-computer`](https://github.com/RayrunOS/dsh-rayrun-computer)
是独立、可用的项目；本仓库的 bot 层已有可加载的插件壳、持久化本地名册、本地
session/transcript 和一个按轮次的 `rayrun_agent` adapter，但没有常驻云端 bot
runtime、bot↔云端 session 映射、远程审批执行、会运行的 routines 和发布路径。

## 2. 依赖项目今天可用

以下能力来自 `dsh-rayrun-computer`，不是本仓库的代码：

- 七个 `rayrun_*` tools：机器生命周期、`exec`、desktop、files、agent 委派、worker
  projection、workspace sync。
- noVNC 桌面；按 session 的云/本地路由；两侧 SHA-256 校验的 workspace sync；任务
  委派；worker projection；可选 idle stop（只 stop，不 destroy）。
- 已在 DeepSeek Harness `0.2.1-rc.5` 上验证；其他实际验证过的组合见
  [`version-matrix.md`](version-matrix.md)。

安装与运行步骤见 [`09-deployment.md`](09-deployment.md) §2。

## 3. 本仓库今天有什么

| 区域 | 状态 |
| --- | --- |
| 插件加载 | `packages/dsh-rayrun-bots` 作为 DSH bundle 加载；host half 提供同源 health 动作、`bots.*` 和 `session.*` RPC；health 报告 runtime 名称与可用性。 |
| Bots 表面 | Client half 打开即进入 Bots，渲染 v0.1 壳：聊天列表、对话、详情、新建 bot、设置向导、设置页；中英双语，以中文为主并跟随 DSH 语言。 |
| 对话与审批 | 客户端对话对真实名册 bot 读取并发送 `session.send/history/status`；示例 bot 仍走页内预览。审批卡和设置仍是**页内内存预览**，Deny / Allow once 不会发给 worker。 |
| 本地名册 | Host half 持久化已校验的 bot 名册到 `$DSH_HOME/state/rayrun-bot/`，原子写入；聊天列表有名册时读取真实名册，新建 bot 会写回 host。 |
| Session 与 transcript | Host half 持久化每 bot 的 `session.json` + `transcript.jsonl`，提供 `session.send/history/status`；队列单飞、失败脱敏、host 重启后把运行中的 turn 标为 interrupted。依赖的 `rayrun_agent` tool 存在时，adapter 选择已有云电脑并把一轮 turn 发给机器 agent；没有机器时拒绝自动创建，已停止/暂停的机器会按依赖的 wake 语义启动（计费）。真实一轮已在本机 DSH + 已有 Rayrun 机器验证（2026-11-22）；页面关闭后继续未验证；示例 bot 仍是预览。 |
| setup | Rayrun 步骤经云电脑插件的同源 RPC 接收粘贴的 token；云电脑步骤采用已有机器或经同一 RPC 创建第一台机器。 |
| 电脑卡片 | Open / Take over 经同一 RPC 启动或恢复机器、等待 `Running`、修复桌面服务并打开 `desktop_url`；Stop 在确认后停止，永不 destroy。 |
| 用量 | 详情面板的电脑块和用量块，以及 Settings 的用量行，读取真实机器状态、余额与机时。 |
| 测试 | Host/client 名册接线、session/transcript 与 `rayrun_agent` adapter 由普通 Node 契约测试覆盖；客户端 session 失败路径与真实一轮另有本机页面 smoke。包清单、locale、RPC、客户端、名册、session、runtime 和 tarball 内容都有检查。 |
| 远程审批 | 暂停，等待平台权限隔离与 host-only 审批端点（ADR-001，2026-11-21 定）；审批执行未实现。`rayrun_agent` adapter 不拦截 bot 的外部动作；prompt 里的“先询问”只是指引，不是安全边界。 |
| 发布 | 没有可发布版本；npm 发布路径不存在。 |

### 3.1 验证记录

- 依赖层的连接、创建和桌面成功路径，以及页面层的 setup 和 Open 路径，已在
  2026-11-21 用本地测试 key 验证；key 没有进入沙盒。
- 页面层的云电脑创建按钮仍需在没有已有机器时补验。
- 页面层的新建/刷新名册路径已在 2026-11-21 的本机 DSH 页面验证。
- Session store 与 `session.*` RPC 已由 `test/session-runtime.mjs` 和
  `test/rpc-contract.mjs` 在 fake runtime 上覆盖；`rayrun_agent` adapter 由
  `test/rayrun-runtime.mjs` 用 fake tools/fetch 覆盖。没有真实 Rayrun 对话证据；
  真实一轮会消耗用户额度，需单独授权。
- Bots 页面层 session 接线已在 2026-11-22 用本机 DSH web + Firefox/geckodriver
  （临时 profile，未安装云电脑依赖）验证：真实名册 bot 替换预览列表；空对话显示
  真实文案；`session.history` 返回 `session: null`；发送后显示用户消息与
  `E_RUNTIME_UNAVAILABLE` 错误行，composer 恢复可用，失败前不写 session。
- Bots 页面层真实一轮已在 2026-11-22 用本机 DSH web + 已有 Rayrun 机器
  `rayrun-bot-test` 验证（独立临时 DSH_HOME，token 只经共享 Harness vault，未新建
  机器）：bot 回复 `SMOKE_OK`；session 为 `idle`，transcript 有 user+bot；刷新后回复
  仍在。机时读数增加约 0.0036 小时（读数不是承诺）；审批未参与。
- 具体组合、环境和缺口以 [`10-rayrun-verification.md`](10-rayrun-verification.md)
  和 [`version-matrix.md`](version-matrix.md) 为准；未测试的组合不作承诺。

## 4. 尚未构建或验证

- 页面层云电脑创建按钮的补验。
- 页面关闭后继续、真实失败与恢复的 Rayrun 验证（失败路径已有本机 smoke）。
- 常驻云端 bot runtime 与 bot↔云端 session 映射：从停下的地方继续，然后回来汇报。
- 机器上常驻的 DSH host。
- 能拦住 worker 的远程审批（阻塞于 Rayrun host/agent 权限隔离；ADR-001）。
- 真正会运行的 routines 与触发器。
- 按 bot 的花费归因。
- IM 通道。
- 两插件一次安装路径（依赖声明与版本检查；W0 spike S6）。
- npm 包与发布/发布 CI 路径。

## 5. 平台缺口

以下能力依赖 Rayrun 平台，不是本仓库能单独补上的：

- host/agent 权限隔离与 host-only 审批端点（ADR-001）。
- 安全入向网络（今天 token ingress 不可用，只有 `public` 可用）。
- 空闲自动停机、spend cap、动态调整资源、session 续跑契约。

完整清单和优先级见 [`08-integration.md`](08-integration.md) §3，以及
[`01-system-architecture.md`](01-system-architecture.md)。

## 6. 已验证组合

[`version-matrix.md`](version-matrix.md) 记录 DSH × `dsh-rayrun-computer` × Rayrun Bot
实际验证过的组合与验证内容。本文不重复版本号；新增验证后更新版本矩阵，再回来更新
本节日期和结论。

## 7. v0.1 路径

从 npm 安装 → 登录 Rayrun → 创建第一个 bot → 批准它的第一个受限动作。退出标准见
[`plans/roadmap.md`](plans/roadmap.md)。这条路径尚未打通；当前可运行的部分见
[`09-deployment.md`](09-deployment.md)。

## 8. 维护规则

- 状态陈述必须带日期，并以代码、测试或验证记录为证据；没有证据就写“未验证”。
- 更新状态时改本文，不改 README。README 只保留营销叙事和指向本文的入口。
- 不把计划写成已实现；不把 `danger-full-access` 描述成沙箱；不承诺未测试的版本组合。
