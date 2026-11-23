# 12 — 实现状态

> 状态：2026-11-23。本文是 Rayrun Bot **实现状态的唯一事实源**。根 `README.md` 是
> 营销页，不承载状态，也不作为事实依据；其他文档提到“今天能做什么、验证到哪一步”
> 时以本文为准。验证证据见 [`10-rayrun-verification.md`](10-rayrun-verification.md)
> 与 [`version-matrix.md`](version-matrix.md)；计划与验收标准见
> [`plans/mvp-plan.md`](plans/mvp-plan.md) 和 [`plans/roadmap.md`](plans/roadmap.md)。

## 1. 一句话状态

Pre-alpha。没有可发布版本。本项目依赖的云电脑插件
[`RayrunOS/dsh-rayrun-computer`](https://github.com/RayrunOS/dsh-rayrun-computer)
是独立、可用的项目；本仓库的 bot 层已有可加载的插件壳、持久化本地名册、本地
session/transcript，以及按轮次的 runtime（依赖 1.1+ 用 detached
`dsh.start/status/result`，1.0.x 用 `rayrun_agent`）；常驻云端 bot host 与本地审批
执行都有预览实现（runtimes + projection + 每 bot session 映射；typed 机器
start/stop/pause/resume 在本地执行且均已 live；云端 proposal bridge 已接，
live E2E 通过）。最小本地 routines 与 cloudHost routine 调度已有预览实现：
本地 scheduler 在非 cloudHost 模式入队普通 turn；cloudHost 模式由云 host 读取
镜像定义调度，结果回导本地 history。支持创建、启停、删除和每 N 分钟重复；云端
调度仅 fake E2E，未 live。其他审批动作、cron/事件触发和发布路径仍未打通。
平台侧 R-G008 runtimes API 已实现并本机 dev 全量验收通过
（`rayrun-bot-gaps`，`4709ac0`，2026-11-22），但生产未部署；bot 侧常驻 host 的本地
transport adapter 已进包（预览）并通过页面 E2E（`HOST_E2E_OK`）；host 资产已随包
发布（`cloud-host/`），projection 页面 E2E 已通过，多 bot 单 host 页面 E2E 也已通过
（2026-11-23）；镜像与生产交付未做。

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
| 对话与审批 | 客户端对话对真实名册 bot 读取并发送 `session.send/history/status`；示例 bot 仍走页内预览。真实 bot 的审批卡已接 host：显示 typed 动作、目标、风险和执行结果；Deny / Allow once 只写本地决定，批准后由本地 executor 执行；决定后卡片提供 Continue bot，下一轮 prompt 带最近结果。示例 bot 卡片和设置仍是页内预览。 |
| 本地名册 | Host half 持久化已校验的 bot 名册到 `$DSH_HOME/state/rayrun-bot/`，原子写入；聊天列表有名册时读取真实名册，新建 bot 会写回 host。 |
| Session 与 transcript | Host half 持久化每 bot 的 `session.json` + `transcript.jsonl`，提供 `session.send/history/status`；队列单飞、失败脱敏、host 重启后普通 running turn 标为 interrupted。依赖 1.1+ 时使用 detached `dsh.start/status/result`：每 turn 一个 task id、每 bot 一个本地 git checkout、`reply.md` 收取，task id 持久化，host 重启后恢复 poll；页面关闭 + 本地 DSH 重启后继续，以及机器 stop/start 后的第二轮续接（A8），已在本机 DSH + 已有 Rayrun 机器验证（2026-11-22）；1.0.x 回退单轮 `rayrun_agent`。常驻 `cloudHost` host 是预览、默认关闭；2026-11-23 多 bot 单 host 页面 E2E 已通过，生产镜像/部署未交付。单轮真实一轮已在本机 DSH + 已有 Rayrun 机器验证（2026-11-22）；示例 bot 仍是预览。 |
| Routines | 每 bot 的 `routines.json` 由 host half 原子持久化；`routines.list/create/update/remove/sync` 校验标题、prompt、间隔、开关和上限。非 cloudHost 模式使用本地 `routine-scheduler`：每 30 秒检查到期项，入队普通 prompt；每 tick 每 bot 最多一条，busy 时跳过，runtime 不可用时保留 due，错过多个间隔只补一次；运行前先写 lastRunAt/nextAt claim，入队失败不重放。cloudHost 模式停用本地 scheduler，由云 host 读取镜像定义，在 `host/routines-state.json` claim nextAt 后入队 `origin: routine` task；结果写 `routine-results/`，本地 `routines.sync` 导入并被 `session.history` 合并。scheduler 在机器停止时不运行；机器停止期间改定义可能在上传前让旧定义先跑一次。结果文件有保留上限。cron 和事件触发未实现。客户端详情面板对真实 bot 可创建、启停、删除和显示 interval，示例 bot 仍用页内数据。 |
| setup | Rayrun 步骤经云电脑插件的同源 RPC 接收粘贴的 token；云电脑步骤采用已有机器或经同一 RPC 创建第一台机器。 |
| 电脑卡片 | Open / Take over 经同一 RPC 启动或恢复机器、等待 `Running`、修复桌面服务并打开 `desktop_url`；Stop 在确认后停止，永不 destroy。 |
| 用量 | 详情面板的电脑块和用量块，以及 Settings 的用量行，读取真实机器状态、余额与机时。 |
| 测试 | Host/client 名册接线、session/transcript、`rayrun_agent`/detached adapter、per-bot workspace 与审批协议由普通 Node 契约测试覆盖；客户端 session 失败路径、单轮真实一轮、页面关闭 + host 重启后的 detached 收取，以及机器 stop/start 后的第二轮续接另有本机页面 smoke。包清单、locale、RPC、客户端、名册、session、runtime、workspace、审批和 tarball 内容都有检查；cloud host 8 项、cloud host routines 7 项、DSH agent 5 项、host projection 5 项、runtime.* client 5 项、cloud host runtime adapter 11 项、cloud host proposal 5 项、approval executor 7 项、cloud approval bridge 6 项、routines 16 项、cloud routine bridge 6 项、cloud routine E2E 1 项、routine results 5 项纯 Node 检查，runtime.* client 与 cloud host 另有 dev live 联调，cloudHost adapter 另有页面 E2E（手动、自动 projection 与多 bot 单 host），审批卡另有拒绝/失败关闭与 Continue 按钮的页面 E2E。Routine 页面另做本地 DSH + Firefox smoke：真实表单创建、暂停、删除并写入 routines.json（2026-11-23，无 Rayrun token），截图 `/tmp/bot/routines-ui.png`（临时文件，不入库）；尚未等待一次 scheduler 自动触发。 |
| 审批执行 | 协议后端（request/decision schema、canonical actionHash、TTL、幂等/重放/错 bot 负向测试、审计、`approvals.list/get/decide/propose/sync`）已实现。ADR-019（2026-11-23）把本地 DSH host 定为本地 typed 动作的审批权威与执行方：`approvals.decide` 批准后由本地 executor 执行 `rayrun.machine.start/stop/pause/resume`，先写 `executing` claim，拒绝/过期/重放/崩溃 claim 失败关闭；客户端真实卡片已接。云端 proposal bridge 已接并 live 验证：云 bot 在回复末尾输出结构化 `rayrun-approval` block，cloud host 解析后写 proposal（`propose.mjs` 保留为可选 shell 路径），本地用 `rayrun_files` 导入并去重，结果写回 `approval-results/`；机器停机时结果先落本地 outbox，下次 Running 补传。start/stop/pause/resume、denial、Continue 均真机通过。下一轮 prompt 会带最近审批结果，bot 无工具直接回答 approved/done/Running 或 denied/not_executed。本地 routine 轮次会把 `origin: routine` 传到 cloud task，云端提案标为 background 并沿用 30 分钟 TTL。其他动作和云端凭据动作仍未完成；平台隔离仍用于云端凭据（ADR-001）。`rayrun_agent` adapter 不拦截外部动作，prompt 指引不是安全边界。 |
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
  actionHash、TTL、幂等/重放、错 bot、篡改、损坏文件、审计不含 action payload。
  ADR-019 的本地执行器由 `test/approval-executor.mjs`（7 项）覆盖 typed allowlist、
  start/stop/pause/resume、at-most-once claim、拒绝/过期不执行、未知动作、目标缺失、执行失败脱敏
  和崩溃 claim；cloud host runtime adapter 还覆盖下一次 prompt 带上最近审批结果
  （kind/target/state/execution/status，不含 payload）；`approvals.propose` 的 host-only
  门与执行失败关闭由 RPC 契约覆盖。
  云端 proposal bridge 由 `test/cloud-approval-bridge.mjs`（6 项）覆盖 CLI 写提案、
  `rayrun_files` 列表/下载、去重、非法/超限提案拒绝、待审批上限、停机不唤醒、结果
  脱敏、停机 result outbox 与恢复补传；`cloud-host-proposal` 4 项覆盖结构化 block
  解析/剥离、默认机器、非法 block 拒绝和非覆盖写。真实 cloud proposal live E2E 已
  通过；machine.start 审批和下一轮结果 context 也已 live；云端凭据动作仍未验证。
- 审批页面 E2E（2026-11-23，临时 DSH profile，无 Rayrun token）：本地创建两条真实
  proposal；页面卡片正确显示 `Start cloud computer “box”` / `Stop cloud computer
  “box”`、目标和风险；拒绝条目写本地 decision 且无 execution 记录；批准条目因无
  Rayrun 连接记录 `failed`，页面显示“已批准，但本地执行失败”，不假成功。截图在
  `/tmp/bot/approval-ui.png`（临时文件，不入库）。
- 真实 cloud proposal 闭环（2026-11-23，`rayrun-bot-scoped`，私有 `deepseek-flash`，
  依赖 main `fe965c1`）：真实云 bot 在回复末尾输出结构化 `rayrun-approval` block；
  cloud host 解析并写 proposal，本地 `approvals.sync` 导入；页面 Allow 后本地 executor
  真实执行 `rayrun.machine.stop`，机器到 Stopped；停机时结果落本地 outbox，机器 start
  后 `approvals.sync` 补传（`flushed=1`），云端 `approval-results/` 为
  approved/done（machine stop, Stopped）。测试后 runtime 删除、机器 stop，未 destroy；
  scoped token 已撤销。截图 `/tmp/bot/approval-live.png`（临时文件，不入库）。
  同轮修复：host 的 bot profile patch 模板带注释时未被识别，导致 DSH 仍用
  `workspace-write`；现在按有效行判断，已有测试覆盖。`propose.mjs` shell 路径未做
  live 验证，结构化 block 是主路径。
- 真实 denial + Continue（2026-11-23，同一 `rayrun-bot-scoped`）：真实云 bot 提案
  machine.stop；页面 Deny，机器保持 Running，无 exec claim；云端 result 为
  denied/not_executed。随后点击真实卡片的 Continue bot，触发下一轮；bot 从
  Recent approval outcomes 回答 denied / 未停止 / 仍 Running，未调用工具。测试后
  runtime 删除、机器 stop，未 destroy；scoped token 已撤销。截图
  `/tmp/bot/approval-denial-continue.png`（临时文件，不入库）。
- pause/resume live（2026-11-23，同一 `rayrun-bot-scoped`）：bot 提案 pause → Allow
  → 机器 Paused；结果落本地 outbox，手动 resume 后 sync 补传（flushed=1）→ 再提案
  resume → Allow → done/Running；云端两条结果均 approved/done。测试后 runtime 删除、
  机器 stop，未 destroy；scoped token 已撤销。截图
  `/tmp/bot/approval-pause-resume.png`（临时文件，不入库）。
- 本地 routines（2026-11-23）：`lib/routines.js` 持久化每 bot 的 `routines.json`，
  `lib/routine-scheduler.js` 负责到期入队；`routines.list/create/update/remove` 已接
  RPC，客户端详情面板可创建、启停和删除真实 routine。`test/routines.mjs`（16 项）
  覆盖 schema/上限、未知字段、间隔与启停重排、due 选择、missed interval 不 backfill、
  busy/runtime 不可用时保留 due、claim 后入队失败不重放、损坏文件失败关闭、单 bot 错误不阻塞其他
  bot、scheduler 入队后成为普通持久 session turn、`origin: routine` 进入 session
  和 cloud task 并被 proposal parser 映射为 `background`、timer unref。本地 DSH +
  Firefox 页面 smoke（2026-11-23，无 Rayrun token）已通过真实详情面板创建、暂停、
  删除一条 routine，并确认 `routines.json`；未等待一次本地 scheduler 自动触发
  （触发路径由 fake runtime 集成测试覆盖）。cron 和事件触发未实现。
- 云端 routines 预览（2026-11-23，fake file tool/agent，无 Rayrun token）：
  `cloud-host/lib/routines.mjs` 校验镜像定义，`enqueueDueRoutines` 先写
  `routines-state.json` claim 再写 inbox task；任务带 `origin: routine` 和
  `routineId`；执行前用镜像的 `bot.json` 组合完整 prompt（`lib/prompt.mjs`；
  DSH session 已带对话，不重放 transcript），不是只把 routine 文本交给 DSH；完成后写
  `routine-results/`（保留上限 200）。本地 `cloud-routine-bridge` 只在机器
  Running 时上传 `routines.json` + `bot.json`、下载/校验结果，结果写本地
  `routine-results/`（保留上限 400）；`session.history` 按时间合并本地 transcript
  和 routine 结果，不改 `session.json`。`test/cloud-host-routines.mjs`（7 项）、
  `test/cloud-routine-bridge.mjs`（6 项）、`test/cloud-routine-e2e.mjs`（1 项）和
  `test/routine-results.mjs`（5 项）覆盖调度、claim、busy、损坏文件、结果校验/
  去重、停机不唤醒、fake 端到端和 history 合并。该路径尚未在真实 cloudHost /
  机器上 live 验证；机器停止期间编辑定义的上传竞态未消除，属于已知限制。
- Detached runtime 由 `test/rayrun-detached-runtime.mjs`（5 项）和
  `test/session-runtime.mjs`（跨 runner 恢复、队列排空）覆盖；依赖 1.1.0
  （main `720f30a`，未发布 npm）的 `dsh.start/status/result` 页面路径
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
  cloud host 资产（`cloud-host/`，随包发布）也在同一环境通过
  queue/transcript/heartbeat、sandbox stop/start autostart、SIGKILL 重启。DSH agent
  已接入：镜像内 DSH 0.2.0-rc.2 直接 headless 第一轮 `RUN1_OK`，同 session id 第二轮
  回答 `ALPHA`；host 两轮 `HOST1_OK` → `BETA`，session id 持久化。`dsh.start`
  在 devcheck 镜像上的空 `reply.md` 是镜像 oneshot manifest 为 `/bin/sh -c` 导致
  （R-G014），不是依赖 bug。
- 本地 cloud host transport adapter（2026-11-23，`lib/cloud-host-runtime.js`，预览）：
  通过 `runtime.*` 确保机器/runtime，`rayrun_files` 上传 inbox/读取 outbox，映射到
  `session.*`；fake 测试 8/8（机器 start/resume、runtime 复用、projection、并发 bot 共享 setup、无机器/无文件工具失败
  关闭）。多 bot host 单进程/全局串行队列/每 bot session 的 fake 测试 7/7；此前页面
  E2E 用 per-bot runtime（`bot-host-cloud-host`）通过 `HOST_E2E_OK`；多 bot 单 host
  的 dev live 页面 E2E 已于 2026-11-23 通过：受 scoped token（仅见私有
  `deepseek-flash`，`/tokens` 403）显式创建的 `rayrun-bot-scoped` 上，两个 bot 共用
  唯一 `bot-host`（pid 636），分别回复 `MULTI_A_OK`/`MULTI_B_OK`，host state 中
  session id 不同、queueDepth 0。host
  资产已随包发布；projection 页面 E2E 已通过（2026-11-23）。
- 依赖 1.2.0 的 `runtime.*` host RPC 已合入 main（`fe965c1`，CI
  45041519563 在 Node 22/24 全绿；未发布 npm）：`runtime.put/list/get/start/stop/restart/delete`，sandbox 必须已存在，
  credentials 只传绑定名；依赖侧 fake-fetch 测试 12/12。Bots 侧 `lib/runtime-rpc.js`
  client 5/5，错误码映射已接；2026-11-22 在临时 DSH profile 里用 scoped dev token
  做了 live 联调：`rayrun-bot` 启动后 `put → running`、`get/list`、`delete → null`，
  测试后机器 stop。已接入 cloud host adapter（预览）；adapter 页面 E2E 已通过
  （2026-11-23，`HOST_E2E_OK`）。
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
- 常驻云端 bot runtime 的生产镜像与部署：平台 R-G008 runtimes API 已实现并本机 dev
  全量验收通过（`rayrun-bot-gaps`，`4709ac0`，2026-11-22：runtime 启动、凭证注入、
  sandbox stop/start autostart、SIGKILL 重启、删除；keep_alive 与 daemon 重启保留；
  旧镜像 `ci@1` 负测 409 `guestd_outdated`）；本地 transport adapter
  （`lib/cloud-host-runtime.js`）、随包 host 资产、自动 projection 与多 bot 单 host
  已在 dev 页面 E2E 通过（2026-11-23）；生产未部署，镜像/生产交付未做。依赖 1.2.0
  `runtime.*` client（`lib/runtime-rpc.js`）已过 fake 测试和 dev live 联调。生产部署
  需授权。
- 能拦住 worker 的远程审批执行：ADR-019 已让本地 host 对 typed 机器
  start/stop/pause/resume 做审批/执行，真实 cloud proposal、denial/Continue 和下一轮
  context live E2E 已通过；其他动作和云端凭据动作仍未完成；云端 agent 本身仍不受
  审批 containment（ADR-001 的平台隔离仍缺）。
- A7/A11 的完整审批验收：更多动作类型和云端凭据动作。
- 云端 routines 的 live 验证（fake E2E 已过）、机器停止期间编辑定义的强一致同步、
  routine 失败结果的本地展示、cron 表达式和事件触发器；本地与 cloudHost 预览已
  实现，见 §3。
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

- host/agent 权限隔离与 host-only 审批端点（ADR-001），用于云端凭据动作。平台答复
  （2026-11-22）：同沙箱内不可行；平台端点为非首版（设计 1 周 + 实现 2–4 周）。
  本地 typed 动作已按 ADR-019 在本地审批/执行；这不解决云端凭据动作，也不使云端
  agent 可信。
- R-G008 常驻 runtime：平台实现本机 dev 全量验收通过（`rayrun-bot-gaps`，`4709ac0`），
  旧镜像 409 已验证；待生产部署；bot 侧 host/session 已在 dev 预览实现并通过多 bot
  live E2E（2026-11-23），生产镜像未交付。
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
