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
session/transcript，以及按轮次的 runtime（依赖 1.1+ 用 detached
`dsh.start/status/result`，1.0.x 用 `rayrun_agent`），但没有常驻云端 bot host
（supervisor/boot hook）、bot↔云端 session 映射、审批执行、会运行的 routines 和
发布路径。平台侧 R-G008 runtimes API 已实现并本机 dev 全量验收通过
（`rayrun-bot-gaps`，`4709ac0`，2026-11-22），但生产未部署；bot 侧 host/session
尚未进入核心包（`/tmp` 原型已通过 queue/autostart/SIGKILL）。

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
| Session 与 transcript | Host half 持久化每 bot 的 `session.json` + `transcript.jsonl`，提供 `session.send/history/status`；队列单飞、失败脱敏、host 重启后普通 running turn 标为 interrupted。依赖 1.1+ 时使用 detached `dsh.start/status/result`：每 turn 一个 task id、每 bot 一个本地 git checkout、`reply.md` 收取，task id 持久化，host 重启后恢复 poll；页面关闭 + 本地 DSH 重启后继续，以及机器 stop/start 后的第二轮续接（A8），已在本机 DSH + 已有 Rayrun 机器验证（2026-11-22）；1.0.x 回退单轮 `rayrun_agent`。没有常驻云端 bot host。单轮真实一轮已在本机 DSH + 已有 Rayrun 机器验证（2026-11-22）；示例 bot 仍是预览。 |
| setup | Rayrun 步骤经云电脑插件的同源 RPC 接收粘贴的 token；云电脑步骤采用已有机器或经同一 RPC 创建第一台机器。 |
| 电脑卡片 | Open / Take over 经同一 RPC 启动或恢复机器、等待 `Running`、修复桌面服务并打开 `desktop_url`；Stop 在确认后停止，永不 destroy。 |
| 用量 | 详情面板的电脑块和用量块，以及 Settings 的用量行，读取真实机器状态、余额与机时。 |
| 测试 | Host/client 名册接线、session/transcript、`rayrun_agent`/detached adapter、per-bot workspace 与审批协议由普通 Node 契约测试覆盖；客户端 session 失败路径、单轮真实一轮、页面关闭 + host 重启后的 detached 收取，以及机器 stop/start 后的第二轮续接另有本机页面 smoke。包清单、locale、RPC、客户端、名册、session、runtime、workspace、审批和 tarball 内容都有检查。 |
| 远程审批 | 协议后端（request/decision schema、canonical actionHash、TTL、幂等/重放/错 bot 负向测试、审计、`approvals.list/get/decide`）已实现；**执行仍暂停**，等待平台权限隔离与 host-only 审批端点（ADR-001，2026-11-21 定），`decide` 只返回 `execution.available: false`。客户端审批卡仍是预览；`rayrun_agent` adapter 不拦截外部动作，prompt 指引不是安全边界。 |
| 发布 | 没有可发布版本；npm 发布路径不存在。 |

### 3.1 验证记录

- 依赖层的连接、创建和桌面成功路径，以及页面层的 setup 和 Open 路径，已在
  2026-11-21 用本地测试 key 验证；key 没有进入沙盒。
- 页面层的云电脑创建按钮仍需在没有已有机器时补验。
- 页面层的新建/刷新名册路径已在 2026-11-21 的本机 DSH 页面验证。
- Session store 与 `session.*` RPC 已由 `test/session-runtime.mjs` 和
  `test/rpc-contract.mjs` 在 fake runtime 上覆盖；`rayrun_agent` adapter 由
  `test/rayrun-runtime.mjs` 用 fake tools/fetch 覆盖。第二轮跨 runner 重启的本地
  接续由 `test/session-runtime.mjs` 覆盖；Rayrun 实测同一 host 不重启的第二轮仍未验证。
- 审批协议由 `test/approvals.mjs` 和 `test/rpc-contract.mjs` 覆盖：schema、canonical
  actionHash、TTL、幂等/重放、错 bot、篡改、损坏文件、审计不含 action payload；
  执行仍按 ADR-001 关闭。
- Detached runtime 由 `test/rayrun-detached-runtime.mjs`（5 项）和
  `test/session-runtime.mjs`（跨 runner 恢复、队列排空）覆盖；依赖 1.1.0
  （`feat/host-dsh-rpc`，已推送，未合并/发布）的 `dsh.start/status/result` 页面路径
  已在本机验证：Bots 页发送
  后 task id 落入 `session.json`，关闭页面并 kill 本地 DSH，等待后重启同一
  `DSH_HOME`，新 host 恢复 poll、收取 `reply.md`（`DETACHED_OK`），session 回到
  `idle`，刷新页面后回复仍在。
- A8 续接已在 2026-11-22 用本机 DSH 页面 + 已有 `rayrun-bot-test` 验证：第一轮
  `TURN1_OK` 后把机器 stop 到 Stopped，关闭页面并 kill 本地 DSH；重启同一
  `DSH_HOME` 后发第二轮，依赖自动唤醒机器，bot 从持久化 transcript 回答 `ALPHA`；
  transcript 为 user,bot,user,bot，session `idle`，刷新后两轮仍在；未新建机器，
  测试后机器回到 Stopped。同一 host 不重启的连续两轮未单独测试。
- R-G008 平台验收已在 2026-11-22 的 dev daemon 上完成：runtimes 正测、`keep_alive`
  （60s idle 机等 150s 仍 Running，删除 runtime 后约 240s 自动 Stopped）、daemon
  重启（runtime pid 不变）、旧镜像 `ci@1` 409 `guestd_outdated` 均通过；生产未部署。
  最小 cloud bot host 原型（`/tmp`，未入核心包）也在同一环境通过 queue/transcript/
  heartbeat、sandbox stop/start autostart、SIGKILL 重启；尚未接 DSH agent。
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
- 真实失败与恢复的 Rayrun 验证（失败路径已有本机 smoke）；同一 host 不重启的连续
  两轮未单独测试。
- 常驻云端 bot runtime 与 bot↔云端 session 映射：平台 R-G008 runtimes API 已实现并
  本机 dev 全量验收通过（`rayrun-bot-gaps`，`4709ac0`，2026-11-22：runtime 启动、凭证
  注入、sandbox stop/start autostart、SIGKILL 重启、删除；keep_alive 与 daemon 重启
  保留；旧镜像 `ci@1` 负测 409 `guestd_outdated`）；生产未部署；bot 侧
  supervisor/session 尚未进入核心包（`/tmp` 原型已通过 queue/autostart/SIGKILL）。
  生产部署需授权。
- 机器上常驻的 DSH host。
- 能拦住 worker 的远程审批执行（协议后端已有；执行阻塞于 Rayrun host/agent
  权限隔离；ADR-001）。
- 真正会运行的 routines 与触发器。
- 按 bot 的花费归因。
- A11 工作区扫描（2026-11-22）：`tmp/` 下有未跟踪的本地 key 文件
  `dp-code.key`（35 B，`sk-` 前缀）和 `rayrun-dev.key`（87 B）。两者被
  `.gitignore` 忽略，且从未进入 git 历史或 npm 包，但仍留在工作区；需轮换并
  移出/删除后才能声称 A11 通过。扫描未打印任何值。
- IM 通道。
- 两插件一次安装路径（依赖声明与版本检查；W0 spike S6）。
- npm 包与发布/发布 CI 路径。

## 5. 平台缺口

以下能力依赖 Rayrun 平台，不是本仓库能单独补上的：

- host/agent 权限隔离与 host-only 审批端点（ADR-001）。平台答复（2026-11-22）：同
  沙箱内不可行；平台端点为非首版（设计 1 周 + 实现 2–4 周）。可选的 host/agent 分域
  路径需要本项目新 ADR；在那之前审批执行保持关闭。
- R-G008 常驻 runtime：平台实现本机 dev 全量验收通过（`rayrun-bot-gaps`，`4709ac0`），
  旧镜像 409 已验证；待生产部署；bot 侧 host/session 未实现。
- 安全入向网络（今天 token ingress 不可用，只有 `public` 可用）。
- 空闲自动停机、spend cap、动态调整资源、运行期 egress 更新。

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
