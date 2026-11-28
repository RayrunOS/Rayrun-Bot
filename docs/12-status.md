# 12 — 实现状态

> 状态：2026-11-28。本文是 Rayrun Bot **实现状态的唯一事实源**。根 `README.md` 是
> 营销页，不承载状态，也不作为事实依据；其他文档提到“今天能做什么、验证到哪一步”
> 时以本文为准。验证证据见 [`10-rayrun-verification.md`](10-rayrun-verification.md)
> 与 [`version-matrix.md`](version-matrix.md)；计划与验收标准见
> [`plans/mvp-plan.md`](plans/mvp-plan.md) 和 [`plans/roadmap.md`](plans/roadmap.md)。

## 1. 一句话状态

Pre-alpha。`dsh-rayrun-bots@0.1.1-alpha.2` 已通过 `publish.yml` 发布到 npm，`alpha`
dist-tag 指向它；`latest` 仍是手动发布的 `0.1.0-alpha.0`，没有稳定版。本项目依赖的
云电脑插件
[`RayrunOS/dsh-rayrun-computer`](https://github.com/RayrunOS/dsh-rayrun-computer)
是独立、可用的项目；本仓库的 bot 层已有可加载的插件壳、持久化本地名册、本地
session/transcript，以及运行时选择（依赖 1.2.2+ 默认常驻 cloudHost，1.1 用 detached
`dsh.start/status/result`，1.0.x 用 `rayrun_agent`；`cloudHost:false` 保留 detached）；
常驻云端 bot host 与本地审批执行已实现（runtimes + projection + 每 bot session
映射；typed 机器 start/stop/pause/resume 在本地执行且均已 live；云端 proposal
bridge 已接，live E2E 通过）。最小本地 routines 与 cloudHost routine 调度已实现：本地 scheduler
在非 cloudHost 模式入队普通 turn；cloudHost 模式由云 host 读取镜像定义调度，结果
回导本地 history。支持创建、启停、删除和每 N 分钟重复。cloudHost routine 已在
Rayrun dev/test 环境完成 live E2E（本地 DSH 停止期间由云 host 调度，2026-11-24）。
2026-11-25 clean alpha.1 安装已通过真实浏览器 golden、审批 Deny/Allow，并在生产
完成两 bot 单 host。
平台侧 R-G008 runtimes API 已实现并本机 dev 全量验收通过
（`rayrun-bot-gaps`，`4709ac0`，2026-11-22），并于 2026-11-24 部署到生产
`5c2ff48`（build 493，tag `prod-20261124-2`）；生产 `/v1/runtimes` 已注册
（未认证返回 401）。hosted production 首次尝试在 `runtime.put` 返回 409
`guestd_outdated`（`E_GUESTD_OUTDATED`）。2026-11-24 已发布 `dsh-bot@1`
（guestd 0.6.0，Node 24.22.0，DSH 0.2.0-rc.2，manifest
`credential_slots=["DEEPSEEK_API_KEY"]`），测试 sandbox 的 `runtime.put bot-host`
返回 200 applied/restarted，heartbeat 正常；测试后 stop、未 destroy。2026-11-24
hosted 用户租户 cloudHost 聊天 E2E 通过：`rayrun-bot-prod-e2e`（`dsh-bot@1`）从
Stopped 启动，bot-host runtime running pid 636，bot 回复 `PROD_OK`，约 12 秒；
runtime 删除、机器 Stopped、未 destroy。生产 routine E2E 已通过（`CLOUD_ROUTINE_PROD_OK`，2026-11-24）。其他审批动作和
cron/事件触发仍未打通；发布路径已通过 `publish.yml` 发布 alpha.1。CI 代码已上生产但 `RAYRUN_GITHUB_CI_ENABLED` 未开。bot 侧常驻 host 的本地
transport adapter 已进包并通过页面 E2E（`HOST_E2E_OK`）；host 资产已随包发布
（`cloud-host/`），projection 页面 E2E 已通过，多 bot 单 host 页面 E2E 已通过
（dev 2026-11-23；生产 2026-11-25）；生产镜像 `dsh-bot@1` 与 R-G008 部署已完成。
2026-11-27 起依赖 1.2.2+ 默认走 cloudHost；默认路径已在 dev 通过合盖验收。2026-11-28 在
生产 `sys520084` 完成两次签收：先以 main `d353eca` tarball + npm 依赖 `1.3.1` 验证默认
cloudHost 首轮与合盖（`session.send` 980ms 返回 attach 后 SIGKILL 本地 DSH，云端停机期间
写出 `SIGNOFF_CLOUDHOST_OK`，重开收取；单一连续计时 **29.1s**，但机器预建、账号非空）。
随后按用户明确授权 destroy `rayrun-bot-prod-e2e`，账号变为零机器，用本地
`0.1.1-alpha.2` tarball + 依赖 `1.3.1` 复跑：页面 `Create cloud computer` 真实建机
`rayrun-bot`（`dsh-bot@1`，4.55s），首轮 `SIGNOFF_ZERO_OK`，从安装到首轮回复 **30.8s**；
同一机器再验证合盖（send 921ms 返回 attach 后 kill，云端 outbox 23:47:06Z，重启后
23:49:20Z 收取 `SIGNOFF_ZERO_CLOUDHOST_OK`）。零机器 + 页面建机的时间门已满足。
随后 `0.1.1-alpha.2` 通过 `publish.yml` 发布（npm `alpha` tag；`latest` 仍为
0.1.0-alpha.0），并从 npm 干净安装复验同一路径：安装 5.10s、页面真实建机 4.56s、
首轮 `SIGNOFF_NPM_OK`、安装到首轮回复 **34.8s**；合盖 send 943ms attach 后 kill，
云端写出 `SIGNOFF_NPM_CLOUDHOST_OK`，重启后收取。剩余偏差只有 localhost 代理和
WebDriver；三分钟门与 npm 产物复验均已完成。

2026-11-27 首次运行分段计时约 **1m55s–3m03s**（插件安装 61–128s 是主要变量）；
2026-11-28 零机器账号 + 页面建机的单一连续计时为 **30.8s**，npm 产物
`0.1.1-alpha.2` 发布后同一路径复验 **34.8s**，三分钟门已关闭，见 §3.1。同日 A6
批准延迟已计时：真实 cloudHost
proposal 的卡片 **2.291s**、执行 **0.779s**、Continue→working **21ms**；A6 的
10 秒计时缺口已补齐，见 §3.1。同日 A5 的“合上笔记本”真实任务在 Rayrun dev 通过：
本地 DSH 停止期间 detached worker 写出真实文件，重开后 history 收到
`REAL_TASK_OK`；见 §3.1。同日默认 cloudHost 的同一场景也在 dev 通过：本地 DSH
被杀期间云端写出文件并完成，重开后 history 收到 `CLOUDHOST_DEFAULT_OK`；见 §3.1。
生产干净账号与 dependency 发版仍待补。

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
| Bots 表面 | Client half 打开即进入 Bots，渲染 v0.1 壳：聊天列表、对话、详情、新建 bot、设置向导、设置页；中英双语，以中文为主并跟随 DSH 语言。左侧顶栏的返回按钮回到 DSH Conversation（`layout.selectPanel(null)`，ADR-022），不改变 Session、不卸载 Bots。账户 primary bot 置顶、默认选中并显示 `Primary` 徽标；Setup 编辑 primary（`bots.update`），New Bot 创建 worker。New Bot 可选择 DSH workspace；详情显示绑定 workspace 的 title/path，stale 时警告，可解绑。 |
| 对话与审批 | 客户端对话对真实名册 bot 读取并发送 `session.send/history/status`；示例 bot 仍走页内预览。真实 bot 的审批卡已接 host：显示 typed 动作、目标、风险和执行结果；Deny / Allow once 只写本地决定，批准后由本地 executor 执行；决定并执行结束后卡片提供 Continue bot，下一轮 prompt 带最近结果。示例 bot 卡片和设置仍是页内预览。 |
| 本地名册 | Host half 持久化已校验的 bot 名册到 `$DSH_HOME/state/rayrun-bot/`，原子写入；聊天列表有名册时读取真实名册，新建 bot 会写回 host。`superagent.json` 记录每账户一个 primary bot；启动与 `bots.list` 前幂等 ensure，`bots.list` 返回 `primaryBotId`；删除 primary 返回 `E_PRIMARY_BOT_PROTECTED`。`bot.json.workspace` 只由 host 从客户端 `workspaceId` 解析写入（客户端不传 path）；`bots.list/get` 返回派生的 `stale`，不持久化。 |
| Session 与 transcript | Host half 持久化每 bot 的 `session.json` + `transcript.jsonl`，提供 `session.send/history/status`；队列单飞、失败脱敏、host 重启后普通 running turn 标为 interrupted。依赖 1.2.2+ 默认使用常驻 `cloudHost`：本地 host 在用户的 Rayrun 机器上注册并复用 `bot-host`，每个 turn 上传一条 task，云 host 执行后从 outbox 收取；`cloudHost:false` 保留 detached 回退。依赖 1.1 使用 detached `dsh.start/status/result`：每 turn 一个 task id、每 bot 一个本地 git checkout、`reply.md` 收取，task id 持久化，host 重启后恢复 poll；页面关闭 + 本地 DSH 重启后继续，以及机器 stop/start 后的第二轮续接（A8），已在本机 DSH + 已有 Rayrun 机器验证（2026-11-22）；1.0.x 回退单轮 `rayrun_agent`。cloudHost 的 dev、hosted 单 bot 聊天和 routine E2E 已通过；旧镜像以 `E_GUESTD_OUTDATED` 失败并提示更新电脑。`session.send` 在 bot 空闲且 detached 时等云端 task attach 后才返回；收到响应后 kill 本地 DSH 的 dev 验收已通过（见 §3.1）。队列中排在运行回合后面的消息仍只在本机排队，不等待云端接受。单轮真实一轮已在本机 DSH + 已有 Rayrun 机器验证（2026-11-22）；示例 bot 仍是预览。 |
| Routines | 每 bot 的 `routines.json` 由 host half 原子持久化；`routines.list/create/update/remove/sync` 校验标题、prompt、间隔、开关和上限。非 cloudHost 模式使用本地 `routine-scheduler`：每 30 秒检查到期项，入队普通 prompt；每 tick 每 bot 最多一条，busy 时跳过，runtime 不可用时保留 due，错过多个间隔只补一次；运行前先写 lastRunAt/nextAt claim，入队失败不重放。cloudHost 模式停用本地 scheduler，由云 host 读取镜像定义，在 `host/routines-state.json` claim nextAt 后入队 `origin: routine` task；结果写 `routine-results/`，本地 `routines.sync` 导入并被 `session.history` 合并；失败任务显示为 `E_ROUTINE_FAILED` system error。dev/test 环境的 cloudHost live E2E 已通过（2026-11-24，本地 DSH 关闭后云端执行）；生产 R-G008 已部署，hosted routine E2E 已通过（`CLOUD_ROUTINE_PROD_OK`，2026-11-24）。同一 bot 的定义 sync 串行执行，较慢的旧上传不会覆盖新定义；scheduler 在机器停止时不运行，机器停止期间改定义仍可能在上传前让旧定义先跑一次（MVP 不承诺该场景强一致）。结果文件有保留上限。cron 和事件触发未实现。客户端详情面板对真实 bot 可创建、启停、删除和显示 interval，示例 bot 仍用页内数据。 |
| setup | Rayrun 步骤经云电脑插件的同源 RPC 接收粘贴的 token；云电脑步骤采用已有机器或经同一 RPC 创建第一台机器。cloudHost 默认时新机器使用 `dsh-bot@1`；detached 模式使用 `deepseek-harness@1`，并避开已知 shell oneshot。 |
| 电脑卡片 | Open 经同一 RPC 启动或恢复机器、等待 `Running`、修复桌面服务并打开 `desktop_url`；弹窗被拦截时密码提示条里的真实链接（只接受 http/https）可打开桌面；Stop 在确认后停止，永不 destroy；运行中显示当前机时费率和累计机时。 |
| 用量 | 详情面板的电脑块和用量块，以及 Settings 的用量行，读取真实机器状态、余额与机时。 |
| 更新提示 | Settings → 更新 通过同源 RPC `update.check` 读取官方 npm dist-tags；显示当前/最新版本与可复制命令，不下载、不安装、不改 profile、不发送 token。只读，用户点击触发，没有自动检查或遥测。 |
| 电脑更新 | Settings → Bot 的电脑 显示共用电脑与当前镜像；确认后通过 host `computer.update` 换镜像：旧机改名、新机用原名称/cloudHost 时 `dsh-bot@1`（否则 `deepseek-harness@1`）/自动选中的 DeepSeek credential 创建，复制 workspace 和登录配置路径；迁移成功后销毁旧机（用户确认更新即明确请求），失败回滚；最后销毁失败时保留新机、停止旧机并报告。每次更新创建计费机器，必须显式确认。 |
| 测试 | Host/client 名册接线、session/transcript、`rayrun_agent`/detached adapter、per-bot workspace 与审批协议由普通 Node 契约测试覆盖；客户端 session 失败路径、单轮真实一轮、页面关闭 + host 重启后的 detached 收取，以及机器 stop/start 后的第二轮续接另有本机页面 smoke。包清单、locale、RPC、客户端、名册、session、runtime、workspace、审批和 tarball 内容都有检查；cloud host 8 项、cloud host routines 8 项、DSH agent 5 项、host projection 5 项、runtime.* client 5 项、detached runtime 17 项、cloud host runtime adapter 17 项、session 23 项、dependency 14 项、computer update 9 项、RPC 契约 38 项、cloud host proposal 5 项、approval executor 7 项、cloud approval bridge 6 项、routines 16 项、cloud routine bridge 7 项、cloud routine E2E 1 项、routine results 6 项纯 Node 检查，runtime.* client 与 cloud host 另有 dev live 联调，cloudHost adapter 另有页面 E2E（手动、自动 projection 与多 bot 单 host），审批卡另有拒绝/失败关闭与 Continue 按钮的页面 E2E。Routine 页面另做本地 DSH + Firefox smoke：真实表单创建、暂停、删除并写入 routines.json（2026-11-23，无 Rayrun token），截图 `/tmp/bot/routines-ui.png`（临时文件，不入库）；本地 mode 尚未等待一次 scheduler 自动触发；cloudHost mode 的 dev live E2E 已通过（2026-11-24，见 §3.1）。2026-11-25 clean alpha.1 安装另做生产两 bot 单 host 与 headless Firefox golden/审批 Deny/Allow E2E（见 §3.1）。 |
| 审批执行 | 协议后端（request/decision schema、canonical actionHash、TTL、幂等/重放/错 bot 负向测试、审计、`approvals.list/get/decide/propose/sync`）已实现。ADR-019（2026-11-23）把本地 DSH host 定为本地 typed 动作的审批权威与执行方：`approvals.decide` 批准后由本地 executor 执行 `rayrun.machine.start/stop/pause/resume`，先写 `executing` claim，拒绝/过期/重放/崩溃 claim 失败关闭；客户端真实卡片已接。云端 proposal bridge 已接并 live 验证：云 bot 在回复末尾输出结构化 `rayrun-approval` block，cloud host 解析后写 proposal（`propose.mjs` 保留为可选 shell 路径），本地用 `rayrun_files` 导入并去重，结果写回 `approval-results/`；机器停机时结果先落本地 outbox，下次 Running 补传。start/stop/pause/resume、denial、Continue 均真机通过。下一轮 prompt 会带最近审批结果，bot 无工具直接回答 approved/done/Running 或 denied/not_executed。本地 routine 轮次会把 `origin: routine` 传到 cloud task，云端提案标为 background 并沿用 30 分钟 TTL。其他动作和云端凭据动作仍未完成；平台隔离仍用于云端凭据（ADR-001）。云端 agent 在容器内 `danger-full-access` 是设计（ADR-020），审批不是 containment。`rayrun_agent` adapter 不拦截外部动作，prompt 指引不是安全边界。 |
| 发布 | `dsh-rayrun-bots@0.1.1-alpha.2` 已通过 `publish.yml` 从 `v0.1.1-alpha.2` GitHub Prerelease 发布（OIDC，run `46085724676`，`_npmUser=GitHub Actions`）；npm `alpha` tag 指向 0.1.1-alpha.2，`latest` 仍是手动发布的 0.1.0-alpha.0（prerelease 不移动 latest，符合 workflow 契约）。`0.1.1-alpha.1` 是 2026-11-25 的上一版，不含 2026-11-26/27 的 UX 修复、默认 cloudHost、send acceptance 和 Issue #4/#6 修复。依赖 `dsh-rayrun-computer` 最新为 `1.3.1`（`1.2.2` 起返回 machine.credentials，`1.3.0` 起有 credentials.save；`1.2.1` 不含 RC-017）。一条 `dsh plugin add` 安装两个包的路径已用官方 registry 验证：两个 bundle 都被选中、两个插件都加载、health `ok`。只安装 bots 包即使声明依赖也不会启用依赖 bundle。2026-11-28 用官方 registry 从 alpha.2 干净安装、零机器页面建机和合盖签收通过（见 §3.1）。 |

### 3.1 验证记录

> 2026-11-24 按用户明确授权销毁 dev 测试机：devcheck 的 `rayrun-bot`、
> `rayrun-bot-idle`、`rayrun-bot-scoped`、`rayrun-bot-coldstart` 与 botclean 的
> `rayrun-bot-clean`；dev 侧现无 bot 测试机。hosted 的 `rayrun-bot-test`、
> `rayrun-bot-fresh-mwu9kgwj`、`rayrun-bot-prod-e2e`（`dsh-bot@1` 生产 E2E）保留、
> 未 destroy；`rayrun-bot-prod-e2e` 在 2026-11-25 聊天/时延测试后为 Running，
> 是否 stop 待用户决定。下文“stop / 未 destroy”是当次测试收尾动作；botclean
> 租户本身保留。
>
> 2026-11-25 新增并保留（Stopped、未 destroy）：`rayrun-bot-a1-20261125`
> （A1 沙盒）与 `rayrun-bot-a3-20261125`（A3 创建计时）。
>
> 2026-11-27 按用户明确清理授权 destroy 13 台旧测试机：`dsh-ci-deploy`、
> `dsh-ci-deploy-2`、`rayrun-bot-a1-20261125`、`rayrun-bot-a3-20261125`、
> `rayrun-bot-a3-20261125-pre-update-mwxmdt31`、`bot-update-smoke-20261126`、
> `bot-update-smoke-20261126-pre-update-mwxk96k8`、`rayrun-bot-a6`、
> `rayrun-bot-a3-20261125-failed-update-mwxmhbnf`、`...-mwxmiti2`、
> `rayrun-bot-invalid-credential-20261127`、`rayrun-bot-timing-20261127`、
> `rayrun-bot`。仅保留 `rayrun-bot-prod-e2e`（Stopped、未 destroy），其
> prior test bots 和 `prod-routine` 仍在；destroy 待确认。下文 2026-11-24/25 的
> “保留/未 destroy”是当次记录，清理后以本段为准。
> 2026-11-26 电脑更新实测新增并保留（Stopped、未 destroy）：
> `bot-update-smoke-20261126`（新机）与
> `bot-update-smoke-20261126-pre-update-mwxk96k8`（旧机）。

- 依赖层的连接、创建和桌面成功路径，以及页面层的 setup 和 Open 路径，已在
  2026-11-21 用本地测试 key 验证；key 没有进入沙盒。
- 页面层云电脑创建按钮已在干净 dev tenant（初始 0 台机器）验证（2026-11-24）：
  setup 云电脑步骤点击 `Create cloud computer`，名称 `rayrun-bot-clean`、DeepSeek
  key 留空，页面显示 `Created · rayrun-bot-clean`；机器创建后 Running，测试后 stop
  回 Stopped，随后于 2026-11-24 按用户明确授权 destroy。截图
  `/tmp/bot/create-computer.png`（临时文件，不入库）。scoped token 已撤销，临时
  token/base-url 文件和临时 DSH profile 已删除。
- 页面层的新建/刷新名册路径已在 2026-11-21 的本机 DSH 页面验证。
- Session store 与 `session.*` RPC 已由 `test/session-runtime.mjs` 和
  `test/rpc-contract.mjs` 在 fake runtime 上覆盖；`rayrun_agent` adapter 由
  `test/rayrun-runtime.mjs` 用 fake tools/fetch 覆盖。第二轮跨 runner 重启的本地
  接续由 `test/session-runtime.mjs` 覆盖；Rayrun 实测同一 host 连续两轮已在
  2026-11-24 的 v0.1 live 验收中通过（见 §3.1）。三条消息排队 + 本地 DSH SIGKILL
  后的按序排空也在同次 live 验收中通过。host 挂载时会主动恢复持久化的 detached
  task（不依赖页面 RPC；需要 `rayrun_files` 工具已注册）；`test/rpc-contract.mjs`
  覆盖无页面 RPC 的恢复，另有 dev live：重启后不发任何页面/HTTP 请求，队列自动
  排空（`E1_OK`/`E2_OK`）；无 token 本地冒烟也在 6 秒内以
  `E_TOKEN_REQUIRED` 失败关闭。
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
- 云端 routines 实现与 fake 覆盖（2026-11-23）：`cloud-host/lib/routines.mjs`
  校验镜像定义，`enqueueDueRoutines` 先写 `routines-state.json` claim 再写
  inbox task；任务带 `origin: routine` 和 `routineId`；执行前用镜像的 `bot.json`
  组合完整 prompt（`lib/prompt.mjs`；DSH session 已带对话，不重放 transcript），
  不是只把 routine 文本交给 DSH；完成后写 `routine-results/`（保留上限 200）。
  本地 `cloud-routine-bridge` 只在机器 Running 时上传 `routines.json` +
  `bot.json`、下载/校验结果，结果写本地 `routine-results/`（保留上限 400）；
  同一 bot 的 sync 按调用顺序串行执行，防止较慢的旧上传覆盖较新的定义；机器
  停止期间的强一致同步仍不在范围内。失败任务写 `state: failed` + `error`，本地
  history 作为 `E_ROUTINE_FAILED` system error 显示。`session.history` 按时间合并
  本地 transcript 和 routine 结果，不改 `session.json`。
  `test/cloud-host-routines.mjs`（8 项）、
  `test/cloud-routine-bridge.mjs`（7 项）、`test/cloud-routine-e2e.mjs`（1 项）和
  `test/routine-results.mjs`（6 项）覆盖调度、claim、busy、损坏文件、结果校验/
  去重、停机不唤醒、fake 端到端和 history 合并。2026-11-24 在生产 API 尝试
  live 验证时，机器可启动但 `runtime.list` 返回 404
  `E_RUNTIMES_UNAVAILABLE`（当时 R-G008 尚未部署），因此在创建 bot/routine 前
  中止；机器已 stop，本次未创建 runtime，临时 DSH profile（含 vault token）已删除；
  保留的本地 token 文件未打印、未改动。R-G008 后于 2026-11-24 部署到
  `5c2ff48`/build 493，生产 live 仍待执行。
- 云端 routine dev live E2E（2026-11-24，Rayrun dev daemon
  `http://192.168.3.75:8080/v1`，本机 DSH `0.2.2-rc.5`，依赖 `1.2.0`，
  Bots `0.1.0-alpha.0`，机器 `rayrun-bot-scoped` / `dsh-bot-devcheck@1`，
  credential `deepseek-flash`，scoped token）：先启动机器并完成一轮 `BOOT_OK`，
  确认 `bot-host`（pid 636）running；创建 1 分钟 routine 并镜像
  `routines.json` + `bot.json`。在 due 前（23:51:26Z）停止本地 DSH；云 host 于
  23:52:20.428Z `routine-enqueued`、23:52:22.353Z `task-done`，`routine-results`
  中 reply=`CLOUD_ROUTINE_OK`，`routines-state.json` 的 lastRunAt/nextAt 前进。
  重启本地 DSH 后 `routines.sync` 导入（页面初始已导入，sync duplicate=1），
  `session.history` 为 boot user/bot + routine user/bot，页面显示
  `CLOUD_ROUTINE_OK`。截图 `/tmp/bot/cloud-routine-live.png`（临时文件，不入库）。
  测试后删除 runtime（runtimes=[]）、机器 stop（Stopped，未 destroy）；scoped
  token 已撤销，临时 token/base-url 文件和临时 DSH profile 已删除。机器停止期间
  编辑定义的上传竞态未消除，属于已知限制。
- Detached runtime 由 `test/rayrun-detached-runtime.mjs`（5 项）和
  `test/session-runtime.mjs`（跨 runner 恢复、队列排空）覆盖；依赖 1.1.0
  （main `720f30a`，未发布 npm）的 `dsh.start/status/result` 页面路径
  已在本机验证：Bots 页发送
  后 task id 落入 `session.json`，关闭页面并 kill 本地 DSH，等待后重启同一
  `DSH_HOME`，新 host 恢复 poll、收取 `reply.md`（`DETACHED_OK`），session 回到
  `idle`，刷新后回复仍在。冷启动 dev live（2026-11-24）：`rayrun-bot-coldstart`
  Stopped → 首轮 `dsh.start` → `COLD_OK`，约 13 秒；用户授权后于 10:17:17Z
  destroy（HTTP 204）。依赖侧曾在 hosted 报
  `worker_files_unavailable`，后确认是其 live 测试脚本的 fetch mock 误拦截
  `.../node_modules/dsh-rayrun-computer/...` file PUT，请求未到 nginx；修正已合入
  依赖 main `956d595`（CI Node 22/24 全绿），该码已移除。npm `1.2.1` 已于
  2026-11-24 发布（latest，`gitHead=3604e33`，含 mock 修复）；`1.2.0` 的 npm
  tarball 来自较旧的 `fe965c1`，不要再用。生产 E2E 用的是 checkout `956d595`。
  收窄
  mock 后 hosted `rayrun-bot-test` 冷启动 8.8 秒成功（`REAL_FIX_OK`）。adapter
  和平台正常，不需要 cold-start retry。生产 daemon `92a77d0` 早于 R-G008，
  `/runtimes`、`/host` 404 是独立的未部署差异。三台 hosted 测试机当次保留为
  Stopped；2026-11-27 清理后仅 `rayrun-bot-prod-e2e` 保留（Stopped、未 destroy），
  其余已终止/清理。
- A8 续接已在 2026-11-22 用本机 DSH 页面 + 已有 `rayrun-bot-test` 验证：第一轮
  `TURN1_OK` 后把机器 stop 到 Stopped，关闭页面并 kill 本地 DSH；重启同一
  `DSH_HOME` 后发第二轮，依赖自动唤醒机器，bot 从持久化 transcript 回答 `ALPHA`；
  transcript 为 user,bot,user,bot，session `idle`，刷新后两轮仍在；未新建机器，
  测试后机器回到 Stopped。
- v0.1 失败/续接/恢复 live（2026-11-24，Rayrun dev daemon，本机 DSH
  `0.2.2-rc.5`，依赖 `1.2.0`，机器 `rayrun-bot-scoped`，scoped token）：
  - 无 token 发送：session `failed`，`E_TOKEN_REQUIRED`，无 bot 回复；保存 token 后
    下一轮恢复 `RECOVERED_OK`。同轮修复 `cloud-host-runtime.ensureMachine` 先检查
    `connection.configured`，不再把缺 token 误报为 `E_MACHINE_STOPPED`；fake 测试
    15/15（含文件工具 token 错误映射）。
  - 同一 host 连续两轮：`bot-host` pid 635、DSH session
    `session-5aa1302e-…` 不变，`TURN1_OK` → `ALPHA`。
  - 删除 `bot-host` 并重启本地 DSH：新 host pid 704，DSH session 仍为
    `session-5aa1302e-…`，`RECOVERY_TURN` → `ALPHA`；本地 history 共 10 条
    （含前面的无 token 错误）。
  - 本地 DSH **不重启**、只删除机器上的 `bot-host`：下一轮 adapter 自动重建 host
    （pid 636 → 668），DSH session `session-ea68cea7-…` 不变，`TURN1_OK` → `BETA`。
  - 三条消息快速入队（第一条 detached 运行、pending 2）后 SIGKILL 本地 DSH；
    本地停机期间云 host 完成 Q1（outbox `Q1_OK`，云端 DSH session
    `session-fb87719f-…`）。重启同一 `DSH_HOME` 后由首次页面 RPC 触发恢复，
    按序排空队列：本地 session id `f4cee1c7-…` 不变、`bot-host` pid 635 不变、
    云端 DSH session 不变，最终 `idle`、pending 0、history 6 条，bot 回复依次
    `Q1_OK`/`Q2_OK`/`Q3_OK`，无重复、无丢失。同轮修复：host 挂载时主动恢复
    detached task，不再依赖页面 RPC；本地 DSH 启动后未打开页面的无 token 冒烟
    确认 6 秒内 session 以 `E_TOKEN_REQUIRED` 失败关闭。
  - Host 挂载即恢复 live（scoped token `7b8fb8bd…`）：直连 host RPC 连发两条
    消息，第一条 detached 运行、pending 1 后 SIGKILL 本地 DSH；停机期间云 host
    完成 Q1（`E1_OK`，云端 DSH session `session-e716fe55-…`）。重启同一
    `DSH_HOME` 后不打开页面、不发任何 HTTP RPC，只轮询本地文件：session 自动
    排空到 `idle`，transcript 4 条（`E1_OK`/`E2_OK`），`bot-host` pid 636 与
    云端 DSH session 均不变。
  - 截图 `/tmp/bot/cloud-v01-no-token.png`、`cloud-v01-continuity.png`、
    `cloud-v01-recovery.png`、`cloud-v01-heal.png`、`cloud-v01-queue.png`
    （临时文件，不入库）。测试后
    runtime 删除、runtimes=[]、机器 Stopped；`rayrun-bot-scoped` 后于 2026-11-24
    按用户明确授权 destroy。scoped token 已撤销，临时 token/base-url 文件和临时
    DSH profile 已删除。
- R-G008 平台验收已在 2026-11-22 的 dev daemon 上完成：runtimes 正测、`keep_alive`
  （60s idle 机等 150s 仍 Running，删除 runtime 后约 240s 自动 Stopped）、daemon
  重启（runtime pid 不变）、旧镜像 `ci@1` 409 `guestd_outdated` 均通过。生产
  2026-11-24 部署到 `5c2ff48`（build 493，tag `prod-20261124-2`），包含
  `rayrun-bot-gaps`，`/v1/runtimes` 未认证返回 401（已注册）。hosted production
  尝试在 `rayrun-bot-test` 上 `runtime.put` 返回 409 `guestd_outdated`，session
  以 `E_GUESTD_OUTDATED` 失败关闭；机器已 stop、无 runtime。生产镜像
  `ubuntu@1`/`builder@1` 仍 guestd 0.5.0，rootfs 2026-10-26，换新 sandbox 也仍是
  0.5.0；需先刷新生产镜像（含 builder@1）到 0.6.0。2026-11-24 已发布 `dsh-bot@1`
  （guestd 0.6.0，Node 24.22.0，DSH 0.2.0-rc.2，manifest
  `credential_slots=["DEEPSEEK_API_KEY"]`）；测试 sandbox 的 `runtime.put bot-host`
  返回 200 applied/restarted，state running、heartbeat 更新，测试后 stop、未 destroy。
  `rayrun-bot-test` 仍是旧镜像、Stopped。2026-11-24 hosted 用户租户 cloudHost
  聊天 E2E 通过：`rayrun-bot-prod-e2e`（`dsh-bot@1`）从 Stopped 启动，
  bot-host runtime running pid 636，bot 回复 `PROD_OK`，约 12 秒；runtime 删除、
  机器 Stopped、未 destroy。生产 routine E2E 已通过：本地 DSH 停机期间云 host
  于 14:48:16Z 产出 `CLOUD_ROUTINE_PROD_OK`；重启后 `routines.sync` imported=1，
  history 合并 routine user/bot。cloud host 资产
  （`cloud-host/`，随包发布）也在 dev 环境通过
  queue/transcript/heartbeat、sandbox stop/start autostart、SIGKILL 重启。DSH agent
  已接入：镜像内 DSH 0.2.0-rc.2 直接 headless 第一轮 `RUN1_OK`，同 session id 第二轮
  回答 `ALPHA`；host 两轮 `HOST1_OK` → `BETA`，session id 持久化。`dsh.start`
  在 devcheck 镜像上的空 `reply.md` 是镜像 oneshot manifest 为 `/bin/sh -c` 导致
  （R-G014），不是依赖 bug。
- Issue #4 镜像 oneshot（2026-11-26）：detached adapter 在 `dsh.start` 前检查
  `machine.agent`，已知 `dsh-bot@1` / `dsh-bot-devcheck@1` 直接返回
  `E_IMAGE_UNSUPPORTED`，不创建 task；其他镜像继续，结束后缺 `reply.md` 返回
  `E_WORKER_NO_REPLY`，不收集旧回复。session poll 对这两个码不重试。Setup 对已有
  这类镜像显示警告，创建机器时若依赖默认是已知 oneshot 则改用
  `deepseek-harness@1`。`rayrun-detached-runtime` 7/7；全量测试 28/28。另用
  fake Rayrun API 的 `agent: dsh-bot@1` 机器做 host 级验证：第一次轮询即
  `failed`/`E_IMAGE_UNSUPPORTED`，没有发出 `dsh.start` 或 sandbox 动作。未在用户
  Windows 环境复现，按同一 `machine.agent`/`reply.md` 路径修复。
- Issue #4 复验（2026-11-26）：上一版只在 `machine.agent` 命中已知 oneshot 时
  拦截，空的 `agent` 仍会 `dsh.start`，本机 `session.json` 也不记镜像，所以
  `rayrun-bot-a3-20261125` 上的复验仍创建了 task 并以 `E_WORKER_NO_REPLY` 失败。
  现在 overview 没有镜像时再读 `machine.get`；两边都读不到、且 session 没有这台
  电脑已记录的镜像时，返回 `E_IMAGE_UNSUPPORTED` 且不创建 task。已知镜像（包括
  预检拒绝的 oneshot）写入 session 的 `image` 和 `computer`，下一轮空白读取会
  用它拒绝同一台电脑上的 oneshot。未知但读得到的镜像仍然放行。不自动更换已有
  机器的镜像。详情和 Setup 会显示镜像名，读不到时显示警告。未在用户 Windows
  环境复验。
- Issue #6 缺失凭据（2026-11-26，只读线上证据）：`rayrun-bot-a3-20261125`
  `status=Running`、`agent_state=exited/failure`、`credentials=[]`；worker DSH
  session 记录 `MISSING_CREDENTIAL`（provider `deepseek-official`）。这不是沙盒
  休眠，`dsh.start` 已调用 `ray.wake`。`E_WORKER_NO_REPLY` 文案改为检查 worker
  session 并提示添加 DeepSeek 凭据/重建电脑；Setup 明确新机器需要凭据。不自动
  唤醒或创建任务；真实凭据补齐仍需用户操作或重建机器。
- 电脑更新（2026-11-26，代码/fake/UI）：`computer.update` 需要显式确认，固定使用
  `deepseek-harness@1`；credential 优先沿用当前电脑已绑定的名称，否则选择账号里名称
  匹配 DeepSeek/model 的凭据，找不到就失败关闭。fake 编排覆盖创建/重命名/打包/下载/
  上传/解包、缺确认/缺镜像/缺凭据失败关闭，以及解包/创建失败时恢复旧名称并停止
  新机。Settings 页面显示共用电脑、当前镜像、固定镜像/自动凭据和计费文案，不提供
  镜像或凭据选项；一键更新确认区用注入的 fake overview 在
  headless Firefox smoke，确认区固定 `deepseek-harness@1`、没有 select，截图
  `/tmp/bot/oneclick-confirm.png`（临时文件）；本机 Rayrun API 不可达，真实 overview
  未复验，也未执行更新。**2026-11-27 起成功迁移后销毁旧机**：`computer-update.mjs`
  8/8 覆盖 destroy、destroy 失败保留新机并停止旧机、解包/创建失败不 destroy；UI
  文案改为更新成功后旧电脑及其 workspace 销毁，并提供 `computerUpdatedKept` 报告
  destroy 失败。真实 Rayrun 的 destroy 路径未单独复验。真实 Rayrun 基础迁移通过：
  `bot-update-smoke-20261126` 的文件与 `/workspace/.dsh` 复制到同名新机，新机带
  `dsh-model-sinnet`；旧机改名为 `...-pre-update-mwxk96k8`，两机均 Stopped、未
  destroy。自动凭据选择只有 fake 证据；大 workspace、登录数据实际内容和 egress
  复制仍未验收。
- 电脑更新镜像固定（2026-11-26）：选择 `dsh-bot@1` 时新机没有 `/workspace/.dsh`，
  tar 解包失败并留下 stopped `...-failed-update-*`。现在 Settings 不再提供镜像
  选项，host 固定使用 `deepseek-harness@1`，旧客户端传来的镜像/凭据字段被忽略；
  上传前在新机 `mkdir -p /workspace/.dsh`，上传后 `test -s` 校验。用户当前
  `rayrun-bot-a3-20261125` 已是同名 `deepseek-harness@1` 新机；旧机与失败新机均
  Stopped、未 destroy。
- 干净 npm 安装 golden path（2026-11-25，本机 DSH `0.2.2-rc.5`，官方 registry）：
  临时 `DSH_HOME` 加 web-app 后一条 `dsh plugin add dsh-rayrun-computer@1.2.1
  dsh-rayrun-bots@0.1.1-alpha.1` 完成安装，两个 bundle 都被选中；health 报
  `version=0.1.1-alpha.1`、依赖 `1.2.1` ok、runtime available。对 Stopped 的
  `rayrun-bot-prod-e2e` 发送一轮，session `running → idle`，约 10.0 秒，transcript
  为 user `GOLDEN…` + bot `GOLDEN_OK`，host runtime running pid 635；测试后 runtime
  删除、runtimes=[]、机器 Stopped、未 destroy。安装包来自 npm tarball，未手工修改。
  此前同一路径的 `0.1.1-alpha` 会因上一轮 host 留下的 stale `stopped` 状态在约
  3 秒内以 `E_RUNTIME_UNAVAILABLE` 失败；alpha.1 是该缺陷的补丁发布。
  `0.1.1-alpha` 仍留在 npm registry 上，显式 pin 该版本会命中缺陷；`alpha` tag
  已移开。未配置长期 npm token，因此没有从 CI 执行 deprecate。
- 生产多 bot 单 host（2026-11-25，同一 clean alpha.1 安装，生产
  `rayrun-bot-prod-e2e`）：机器从 Stopped 启动，两个 bot 并发发送；session 均为
  `running → idle`，回复分别为 `MULTI_A_OK` / `MULTI_B_OK`，约 14.1 秒；runtime
  列表只有一个 `bot-host`（running，pid 636），无第二个 host。测试后 bot 删除、
  runtime 删除、机器 Stopped、未 destroy。
- 干净 npm 安装的浏览器与审批（2026-11-25，同一 clean alpha.1 安装，本机 Firefox +
  geckodriver，headless）：在真实 Bots 页面通过 New bot 表单创建 `Browser Golden`，
  发送后页面与 transcript 都得到 `BROWSER_OK`，session `idle`。随后云 bot 提出
  `rayrun.machine.pause`：审批卡 pending，Deny 后卡片显示 `Denied. Nothing was
  executed.`，机器保持 Running；另一次提案点击 Allow once，卡片显示
  `Approved and executed on your local side.`，本地 executor 执行 `pause`，机器变为
  Paused、execution `done`。测试后机器 resume → Stopped、runtime 删除、bot 删除；
  截图 `/tmp/bot/browser-golden.png`、`browser-approval-pending.png`、
  `browser-approval-denied.png`、`browser-approval-allow-pending.png`、
  `browser-approval-allowed.png`（临时文件，不入库）。
- A1 沙盒干净安装（2026-11-25，Rayrun 在线 sandbox `rayrun-bot-a1-20261125`
  （`01a21329…`），镜像 `deepseek-harness@1`，2 vCPU / 4 GB）：在线 API 直连；
  通过 `PUT /v1/sandboxes/{id}/egress` 放行 `registry.npmjs.org`。沙盒内
  Node 24.22.0、DSH 0.2.0-rc.2，corepack 准备 pnpm 10.20.0。全新 `DSH_HOME` +
  全新 pnpm store/cache，一条
  `dsh plugin --profile web add dsh-rayrun-computer@1.2.1 dsh-rayrun-bots@0.1.1-alpha.1`
  安装 7.38 秒；`dsh web` 启动到 URL ready 2.56 秒；从安装开始到 Bots 与云电脑
  两页都渲染 20.04 秒。Bots 根节点 `#rayrun-bots-root`、云电脑 `.rr-root` 均出现；
  截图 `/tmp/bot/a1-sandbox-bots.png`、`a1-sandbox-cloud.png`（临时文件，不入库）。
  只安装 bots 包时 health 返回 `ready:false`、`dependency.status:"missing"`、
  `code:"E_DEP_MISSING"`、`runtime.available:false`。测试后 stop sandbox、未
  destroy；沙盒内 DSH launch-token 日志/URL/cookie 已删除。
- A2 无 token 与 vault 存储（2026-11-25，A1 沙盒 + 本机临时 profile）：沙盒无
  token 时 `connection.status` 为 `configured:false`、`account` 为
  `token_required`（HTTP 400）；本机同源 RPC `connection.save` 把在线 token 存入
  Harness vault 后 `configured:true`、`tokenSource:"credentials"`，`clearToken`
  后回到 `configured:false` 且 `account` 再返回 `token_required`。token 未打印、
  未进沙盒/仓库；临时 profile 已删除。DeepSeek key 的 credential 正向路径沿用
  2026-11-21 的 setup 验证，本次未新建 credential。
- A3 连接、用量与创建（2026-11-25，本机临时 profile + localhost 反向代理）：
  代理用 `curl --interface wlp4s0` 访问在线 API，token 只在本机 DSH vault；
  `overview` 返回 configured true、4 台机器、余额 CNY 22.35、机时 256.16（读数
  不是承诺）、默认 2 vCPU / 2048 MB / remote_desktop true；`account` 返回
  owner。同一 RPC `machine.create` 创建 `rayrun-bot-a3-20261125`（2 vCPU /
  2048 MB / remote desktop true，无 credentials），请求到 Running **4.30 秒**；
  stop 后 Stopped、未 destroy，机器保留为 Stopped。`clearToken` 后恢复 configured
  false。代理是临时 harness，未入库。
- A4 创建 bot 与对话（2026-11-25，本机临时 profile + cloudHost，固定
  `rayrun-bot-prod-e2e`，credential `dsh-model-sinnet`）：`A4 Cloud Bot` 出现在
  聊天列表；`session.send` 后 `queued → running → idle`，机器 `Stopped → Running`，
  约 16 秒回复 `A4_OK`；机器 `/workspace/.rayrun/bots/a4-cloud-bot/` 含
  `host/session-id`、inbox/processing/done/outbox、`transcript.jsonl`（含完整
  instructions 与 `A4_OK`），`rayrun_files` 证据通过。截图
  `/tmp/bot/a4-bot-chat.png`（临时文件，不入库）；未逐 token 验证流式呈现。
  测试后删除 `bot-host` runtime、移除机器测试目录、机器 stop、未 destroy；
  本地 proxy/DSH/geckodriver 停止，临时 profile 与 token/baseUrl 清除。
- 聊天热轮次时延（2026-11-25，同一 `rayrun-bot-prod-e2e` + cloudHost）：3 秒
  outbox 轮询时热轮次 7.32 秒；checkout working tree 把默认 `detachedPollMs`
  改为 1000ms（npm `0.1.1-alpha.1` 仍是 3 秒）后同一热机器下一轮 4.64 秒。
  host 侧约 1.9 秒取任务 + 2.2 秒模型 + 约 1 秒本地收取；
  首轮含 host 冷启动（约 3.8 秒）和遗留 `prod-routine` 抢先（约 3.4 秒），
  约 13.8 秒。`session-runtime.mjs` 18/18；机器上其他测试 bot 未删除，
  `latency-bot` 已删除。
- UX trust pass Phase 1（2026-11-26，本机 DSH + Firefox）：默认空名册渲染真实
  `No bots yet` + `Set up Rayrun Bot`，不显示 Nora/Eli/June；`?preview=1` 才显示
  Demo 横幅、`Demo` 徽标和逐条 `Sample` 标签，示例的审批/金额/日程已移除；`notice.cloud`、
  `user.you`、`setup.open` 生效；`setup.botBody`、`settings.pluginHint` 版本和页脚
  用户名修正。页面 smoke 通过。机器真相已在 Phase 2 修复；审批卡健壮性已在
  Phase 3 修复；死控件清理已在 Phase 4 修复。
- UX trust pass Phase 2 机器真相（2026-11-26，本机 DSH + Firefox）：session 持久化
  实际机器名（`computer`），host `bots.list` 返回 `computers[botId]`；客户端按该
  名字在云电脑 overview 中查找机器，并随选中 bot 切换。找不到对应机器时显示
  host 管理/未连接状态并禁用打开，不再猜测机器列表第一台。`session-runtime`、
  `rpc-contract`、`client-contract` 覆盖该契约；两个 bot 分别 seed
  `alpha-box`/`beta-box` 的页面 smoke 显示详情随选择从 `alpha-box` 切到
  `beta-box`，未连接时打开按钮为 disabled（截图
  `/tmp/bot/machine-truth.png`，临时文件）。A4 的详情面板错机问题
  （`dsh-ci-deploy-2` vs `rayrun-bot-prod-e2e`）已修复。
- UX trust pass Phase 3 审批卡（2026-11-26，本机 DSH + Firefox）：真实机器审批卡的
  风险行按动作给出 stop/pause/start/resume 文案，不再统一“离开你的电脑”；页面
  seed 的四种 approval 显示对应中文文案。云端 `rayrun-approval` block 解析失败时
  host 移除 block 并追加 `rayrun-approval-parse-error` 标记，客户端显示本地化
  “bot 的审批请求无法解析，未执行任何动作”；parser 6/6，页面 smoke 未出现 raw
  marker 或英文 fallback。真实卡决定并完成本地执行后才显示 Continue bot；页面
  Deny 后只剩 Continue，状态为 denied。截图 `/tmp/bot/approval-phase3.png`、
  `/tmp/bot/approval-risk-copy.png`（临时文件）。真实模型自然语言验收：临时 profile
  启用 cloudHost（pin `rayrun-bot-prod-e2e`、credential `dsh-model-sinnet`），发送
  “Please stop the cloud computer to save machine time.”；bot 回复“requires your
  approval”，`approvals.sync` imported=1，pending proposal 为
  `rayrun.machine.stop` on `rayrun-bot-prod-e2e`。Deny 后 state=denied、
  execution=not_executed，机器仍 Running；本地 bot 与机器测试目录已删除。
- UX trust pass Phase 4 死控件与状态（2026-11-26，本机 DSH + Firefox）：真实 bot
  详情只显示已接通的 Activity 区块，隐藏未接通的 Recent 与 Library 标签；删除
  `Take over`，Open 是唯一桌面入口。错误行改为先给人话、再以小字显示原始 code；
  `E_MACHINE_STOPPED` 不再误映射为“还没有云电脑”，客户端轮询超时使用
  `E_TURN_POLL_TIMEOUT` 并说明云端回合可能仍在运行。设置隐藏未持久化的 idle stop
  与通知开关，用量行不再声称 idle stop 生效。电脑卡片在 Running 且有 `pricing`
  时显示当前费率与累计机时；Rayrun API 不提供 running since，因此未显示该字段。
  后台审批过期且机器仍在 Running 时，卡片提示并给出带确认的 Stop。页面 smoke：
  真实详情无“接管”/“资料库”/“最近”，错误行文案在 code 前，设置导航只剩
  账号/用量/外观；截图 `/tmp/bot/phase4-cleanup.png`（临时文件）。第二个隔离
  profile 用本地 fake Rayrun API 返回 Running machine（`pricing`/`usage`）和过期
  background approval：详情显示“正在运行 · ¥0.08/小时 · 累计 12.3 机时”，过期卡
  提示机器可能仍在运行并给出带确认的 Stop；未确认执行。截图
  `/tmp/bot/phase4-running.png`（临时文件）。
- UX trust pass Phase 5 golden path（2026-11-26，本机 DSH + Firefox，临时 profile +
  cloudHost pin `rayrun-bot-prod-e2e`）：干净名册显示空态 → `Set up Rayrun Bot` →
  dependency 步骤 → Rayrun 步骤（connection 已由 RPC 预配置，页面点 Skip，未在页面
  粘贴 token）→ 云电脑步骤 → 第一个 bot `Golden Path Bot` → 自然语言
  “Please stop the cloud computer to save machine time.” → bot 回复等待审批 →
  pending `rayrun.machine.stop` 卡 → Deny → `denied` + Continue bot；机器保持
  Running，本地 bot 与机器 `.rayrun/bots/golden-path-bot/` 已删除。截图
  `/tmp/bot/phase5-golden.png`（临时文件）。同时修 Setup 默认机器选择：`pickMachine`
  现在优先 Running（有 `desktop_url` 再优先），避免默认选中 Stopped 的 A3 机器；
  `client-contract` 覆盖。与完整手工 golden path 的差异：token 步骤用 RPC 预配置，
  未在页面输入；首次回复/审批卡/Deny/Continue 均通过页面验证。
- 更新提示（2026-11-26）：Settings → 更新 调用 host `update.check`，固定官方 npm
  registry 的 dist-tags，返回当前/最新版本与可复制命令；不下载、不安装、不改
  profile、不发送 token。`update-check.mjs` 6/6（alpha/latest 通道、semver 预发布
  排序、缺失 tag、HTTP/JSON/超大响应失败关闭、命令生成）；`rpc-contract` 33/33
  覆盖同源门与无 Authorization；全量 28/28。真实 npm 查询当前 `alpha` 为
  `0.1.1-alpha.1`，显示已是最新；页面 smoke 用 mock 响应验证“有新版本 +
  显示命令”状态，截图 `/tmp/bot/update-check.png`（临时文件）。自动安装、插件市场
  索引和云端 host runtime 自动刷新仍未做。
- 本地 cloud host transport adapter（2026-11-23，`lib/cloud-host-runtime.js`，预览）：
  通过 `runtime.*` 确保机器/runtime，`rayrun_files` 上传 inbox/读取 outbox，映射到
  `session.*`；fake 测试 15/15（机器 start/resume、runtime 复用、projection、并发 bot 共享 setup、无 token/无机器/无文件工具失败
  关闭、文件工具 token 错误映射）。多 bot host 单进程/全局串行队列/每 bot session 的 fake 测试 7/7；此前页面
  E2E 用 per-bot runtime（`bot-host-cloud-host`）通过 `HOST_E2E_OK`；多 bot 单 host
  的 dev live 页面 E2E 已于 2026-11-23 通过：受 scoped token（仅见私有
  `deepseek-flash`，`/tokens` 403）显式创建的 `rayrun-bot-scoped` 上，两个 bot 共用
  唯一 `bot-host`（pid 636），分别回复 `MULTI_A_OK`/`MULTI_B_OK`，host state 中
  session id 不同、queueDepth 0。host
  资产已随包发布；projection 页面 E2E 已通过（2026-11-23）。
- 依赖 1.2.x 的 `runtime.*` host RPC 已合入 main（`fe965c1`，CI
  45041519563 在 Node 22/24 全绿；`1.2.1` 已发布 npm，latest）：`runtime.put/list/get/start/stop/restart/delete`，sandbox 必须已存在，
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
- 桌面弹窗兜底（2026-11-26，本机临时 DSH_HOME + DSH web + Firefox/geckodriver，
  fake Rayrun RPC）：seed 的 bot 绑定 `fake-machine`，用 `window.open` 返回 null
  模拟弹窗被拦截；点击 Open 后流程继续 `overview` → `machine.desktopRepair` →
  `machine.password`，密码提示条显示 `弹窗被拦截了。用下面的链接打开桌面。`、
  `打开桌面` 链接（`https://desktop.example/popup-smoke`，`target=_blank`、
  `rel=noopener noreferrer`）和密码，未调用 `machine.action`。允许弹窗时仍导航同一
  URL，提示条不显示拦截文案。contract 增加 `computer.openDesktop`、链接属性和
  http/https 校验断言。截图 `/tmp/bot/popup-blocked-fallback.png`、
  `/tmp/bot/popup-allowed.png`（临时文件，不入库）。
- 首次运行分段计时（2026-11-27，本机 DSH `0.2.2-rc.5` + Firefox/geckodriver，
  两次全新 `DSH_HOME` + 全新 Rayrun 沙箱，npm alpha.1）：插件安装 **61.1s /
  128.0s**（pnpm 自身 3.7–4s），`dsh web` ready **5.3–6.1s**，浏览器会话到 bot
  创建约 **32.9s**，首轮回复 **15.9–16.2s**（`FIRST_RUN_OK`）；分段合计约
  **1m55s–3m03s**。没有做单一连续计时，三分钟签收仍未关闭。第一次测试的既有
  `dsh-model-sinnet` 已失效（worker Authentication Fails、无 `reply.md`，session
  记录 `E_INTERNAL`）；用本地测试 key 新建 `dsh-model-firstrun-20261127` 后新沙箱
  首轮成功。测试机 `rayrun-bot`、`rayrun-bot-timing-20261127`、
  `rayrun-bot-invalid-credential-20261127` 均 Stopped、未 destroy。偏差：localhost
  代理、既有 credential、非空账号下过滤 overview 以触发 Create、WebDriver 驱动；
  详见 [`10-rayrun-verification.md`](10-rayrun-verification.md) §3.1。
- 首次运行 dev 计时（2026-11-27，Rayrun dev daemon + 本机 DSH `0.2.2-rc.5`，
  npm alpha.1 + 依赖 `1.2.1`，全新 `DSH_HOME`，既有 dev credential）：安装 **17.4s**、
  `dsh web` ready **5.8s**、浏览器导航→首轮回复 **35.8s**（首轮回复 19.4s），
  组件合计约 **59s**，回复 `FIRST_RUN_DEV_OK`。这是 dev 本地 API、既有 credential
  和非空账号（`budget-int-test` 被过滤）workaround，不是生产干净账号或单一连续
  秒表签收；三分钟门仍未关闭。dev 机器 `rayrun-bot` 已按用户确认 destroy；dev API
  token 已撤销；截图 `/tmp/bot/dev-firstrun-reply.png`（临时文件，不入库）。
- A6 批准延迟（2026-11-27，本机 DSH `0.2.2-rc.5` + Firefox/geckodriver，Bots 本地
  checkout + 依赖 `1.2.1` npm，cloudHost 启用，`rayrun-bot-a6` / `dsh-bot@1`）：
  真实 DeepSeek 回合 5.81s 后写出 `rayrun.machine.pause` proposal；回合 idle→审批卡
  **2.291s**（proposal `createdAt`→卡片 **0.464s**），pending 时机器仍 Running；
  `Allow once`→本地执行完成 **0.779s**、机器 Paused **1.030s**，副作用只在决定之后；
  `Continue bot` 点击→working **21ms**（UI 需要用户点 Continue，不自动续跑）。测试机
  Stopped、`bot-host` runtime 删除、未 destroy；截图 `/tmp/bot/a6-pending.png`、
  `/tmp/bot/a6-allowed.png`、`/tmp/bot/a6-continue.png`（临时文件，不入库）。
- 合上笔记本真实任务（2026-11-27，Rayrun dev daemon + 本机 DSH `0.2.2-rc.5`，
  Bots 本地 checkout + 依赖 `1.2.1` npm，非 cloudHost/detached）：dev 机器
  `rayrun-bot`（`deepseek-harness@1`，credential `dsh-model-acceptance-20261127`）。
  用户消息 00:12:52.452Z；detached task 00:12:56.463Z 开始；随后停止本地 DSH。
  云端 worker 在本地 DSH 停止期间写出真实文件 `/workspace/acceptance-dev-20261127.txt`
  （`REAL_TASK_OK 2026-11-27T00:13:04Z`）；重启同一 `DSH_HOME` 后 history 收到 bot
  回复 `REAL_TASK_OK`（00:13:18.185Z），页面显示结果，截图
  `/tmp/bot/dev-acceptance-reopen.png`（临时文件，不入库）。dev `dsh-bot@1` 无
  credential slot，`deepseek-harness@1` 的 `runtime.put` 返回 409
  `guestd_outdated`，故本轮是 detached runtime，不是 cloudHost 预览；生产 cloudHost
  routine 仍按 2026-11-24 证据。dev 机器测试后按用户确认 destroy；dev API token
  已撤销。
- 依赖版本基线（2026-11-27，代码/测试）：默认 cloudHost 只在依赖 1.2.2+ 启用；
  1.2.0/1.2.1 自动回退 detached（显式配置 `cloudHost` 仍可启用，但需自己给
  credentials）。`1.2.2` 发布 `machine.credentials`，`1.3.0` 增加
  `credentials.save`，`1.3.1` 为当前 latest。`dependency` 14/14、`rpc-contract`
  38/38；未用 npm 1.3.1 做 clean install / live 复验。
- cloudHost 默认（2026-11-27，代码/契约 + dev live 合盖通过）：依赖 1.2.2+ 且没有
  显式配置时选择常驻 `cloudHost`；`cloudHost:false` 保留 detached，1.1 仍走
  detached。Setup 在 cloudHost 模式创建 `dsh-bot@1`；电脑更新目标随 runtime 切换
  （cloudHost `dsh-bot@1`，detached `deepseek-harness@1`）。云 host 的 runtime spec
  未显式配置 credential 时沿用机器已绑定凭据。旧镜像的 `E_GUESTD_OUTDATED` 在聊天里
  显示“更新电脑后重试”。`rpc-contract` 38/38（默认 cloudHost、`cloudHost:false`
  detached、send 等 attach）、`cloud-host-runtime` 17/17（机器凭据沿用）、`computer-update` 9/9
  （显式镜像）、`client-contract`。live：本机 DSH + dependency checkout + 空
  `cloudHost` 配置的真实 health 返回 `runtime.name=rayrun-cloud-host`、
  `available=true`。首次 dev 失败于镜像（`deepseek-harness@1` guestd 0.5.0；
  `dsh-bot@1` 无 credential slot），Rayrun 修复 dev 镜像（guestd 0.6.0、补 slot）；
  dependency 的 `shapeSandbox` 本地修复为保留 `machine.credentials`。
  - 显式 credential 回合：消息 04:19:11.443Z，task start 04:19:18.932Z，
    04:19:20Z kill 本地 DSH；云端 04:19:21Z 写出
    `REAL_CLOUDHOST_OK` 文件，04:19:22.066Z task done；重启后 04:19:52.149Z
    history 收到 `CLOUDHOST_DEFAULT_OK`。
  - 默认无配置回合（dependency 修复后）：消息 04:21:11.067Z，task start
    04:21:18.382Z，04:21:20Z kill 本地 DSH；云端 04:21:21Z 写出
    `DEFAULT_CREDENTIAL_OK` 文件，04:21:22.054Z task done，host log
    `hasCredential:true`；重启后 04:21:51.720Z history 收到
    `CLOUDHOST_DEFAULT_OK`。
  机器已按用户明确指令于 2026-11-27T14:54:17Z destroy（`api_delete`），runtime
  删除、dev token 撤销、临时 DSH/proxy/凭证文件删除。限制：dev 环境；dependency
  修复已在 `1.2.2`（`75e285d`）发布，当前 latest `1.3.1`；dev 镜像是手工修补的，不是生产构建。生产干净账号合盖仍未
  签收。
- 发送接受语义（2026-11-27，dev live）：bot 空闲且 runtime 为 detached/cloudHost 时，
  `session.send` 等到 `runtime.start` 返回、task id 写入 `session.json` 后才返回；
  start 失败则拒绝发送，不返回假成功。运行中的 bot 后续消息仍只在本机排队，不等待。
  `session-runtime` 23/23（新增 attach 等待、start 失败拒绝）、`rpc-contract` 38/38
  （HTTP session.send 等 attach）。live：dev 机器 `rayrun-bot-cloudhost-accept-20261127`
  上 `session.send` 11.8 秒后返回 `state=running`、`taskId=task-158133aa-…`；收到响应
  后 **1ms** kill 本地 DSH；云端 14:44:36Z 写出 `IMMEDIATE_CLOSE_OK` 文件，
  14:44:38.090Z task done；重启同一 `DSH_HOME` 后 history 收到
  `CLOUDHOST_DEFAULT_OK`（本地时间 14:45:49.084Z）。机器已按用户明确指令于
  2026-11-27T14:54:17Z destroy（`api_delete`），runtime 删除、dev token 撤销、
  临时文件删除。边界：响应返回前、或消息排在运行回合后面时，仍不保证；本地 host
  未收到请求就合盖仍是物理窗口。
- UI/诊断修正（2026-11-27，契约测试，无真实失效凭据复验）：(1) shell-oneshot
  警告按 runtime 区分。client 先保留 health 里的 `runtime`，cloudHost 模式下详情和 Setup 不再把 `dsh-bot@1` /
  `dsh-bot-devcheck@1` 标成不会启动 worker，Setup 创建使用 `dsh-bot@1`；
  detached 模式保留警告和 `deepseek-harness@1` 回退。`client-contract` 覆盖
  `cloudHost` 判定与三个调用点。(2) 失效模型 credential 的诊断。detached 缺失
  `reply.md` 时用 `rayrun_exec` 读取 worker session 的 provider 错误，脱敏后附在
  `E_WORKER_NO_REPLY` 文案后；cloudHost 失败回合把脱敏错误写进 outbox，adapter
  collect 返回 worker-no-reply；客户端在错误行显示 `rb-error-detail`。测试：
  `rayrun-detached-runtime` 17/17（含 provider 错误与脱敏）、`cloud-host` 8/8
  （错误 outbox 脱敏）、`cloud-host-runtime` 17/17（错误 outbox → worker-no-reply、机器凭据沿用）、
  `client-contract`。未再用失效 credential 做端到端复验。
- 生产 v0.1 签收（2026-11-28，Rayrun 在线 `api.rayrunos.com`，账号 `sys520084`，
  本机 DSH `0.2.2-rc.5`，Node 24.15.0，bots 为 main `d353eca` 的 tarball
  `0.1.1-alpha.1`（非 npm 发布产物），依赖 npm `1.3.1`，机器
  `rayrun-bot-signoff-20261128`（`dsh-bot@1`，credential
  `dsh-model-firstrun-20261127`）：
  - 全新 `DSH_HOME` + 全新 pnpm store：一条命令安装两包 **3.12s**；`dsh web`
    ready **3.84s**；页面导航到首轮回复 **10.9s**；安装开始到首轮回复
    **29.1s**（T0 `1795821542871` → T11 `1795821572018`）。页面连接显示
    `Connected · balance ¥17.07 · 1 machines`；health 依赖 `1.3.1` ok、
    runtime `rayrun-cloud-host` available；首轮 `SIGNOFF_FIRST_RUN_OK` 约 5 秒。
  - 合盖：`session.send` 980ms 返回 `state=running`、
    `taskId=task-853619fc-…`，同一毫秒 SIGKILL 本地 DSH；云端停机期间写出
    `/workspace/cloudhost-signoff-20261128.txt`（`SIGNOFF_CLOUDHOST_OK`），
    outbox 为同一回复；重启同一 `DSH_HOME` 后 transcript 收到 bot 回复
    （23:16:36.210Z），页面显示完整历史。
  - 偏差：账号非零机器（历史 Terminated；`rayrun-bot-prod-e2e` 为 Running
    `deepseek-harness@1`，未动）；机器用 host RPC 预建；setup 采用已有机器，
    没有走页面建机。页面级 fetch patch 不能改变这一点：插件在初始化时持有原
    `fetch` 引用，覆盖 `window.fetch` 不影响其 `overview` 调用；`createComputer`
    在点击时重新读取 `overview`，只要列表里有机器（`pickMachine`）就复用并
    返回，不调用 `machine.create`。零机器账号的页面建机仍未覆盖；本机到
    生产 API 走 localhost 反向代理（`curl --interface wlp4s0`，token 不进日志）；
    页面由 WebDriver 驱动；npm `alpha.1` 是 2026-11-25 产物，不含 2026-11-26/27
    的 UX 修复与默认 cloudHost。测试机记录后于 2026-11-28 destroy（HTTP 204）；
    截图 `/tmp/bot/signoff-*.png`（临时文件，不入库）。
- 生产零机器页面建机签收（2026-11-28，同一 `sys520084` 账号）：按用户明确授权
  destroy `rayrun-bot-prod-e2e`（`01a21a48…`，HTTP 204）后账号 live machines=0；
  用本地 `0.1.1-alpha.2` tarball（本任务 bump，未发布）+ npm 依赖 `1.3.1`，全新
  `DSH_HOME` + 冷 pnpm store。
  - 安装 3.46s；`dsh web` ready 3.58s；页面导航到首轮回复 **30.8s**
    （T0 `1795823172595` → T13 `1795823203362`）。
  - Computer 步骤无既有机器，点击 `Create cloud computer` 真实调用
    `machine.create`：4.55s 后页面显示 `Created · rayrun-bot`，机器 `rayrun-bot`
    （`dsh-bot@1`，Running，credential `dsh-model-firstrun-20261127`）。
  - first bot `Signoff Zero`，首轮 `SIGNOFF_ZERO_OK` 约 9.6s。
  - 合盖：`session.send` 921ms 返回 attach（`task-6776b27e-…`）后 SIGKILL 本地
    DSH；云端 outbox 于 23:47:06.564Z 写入 `SIGNOFF_ZERO_CLOUDHOST_OK`（本地停机
    期间），重启同一 `DSH_HOME` 后 transcript 于 23:49:20.200Z 收取，session
    idle。bot instructions 为 “Do not use tools”，本轮没有写文件副作用；证据是
    云端 outbox 与本地收取。
  - 偏差：localhost 反向代理、WebDriver、alpha.2 为本地 tarball（未发布 npm）。
    测试机 `rayrun-bot`（`01a21f67…`）记录后 destroy（HTTP 204）；账号回到
    live machines=0。截图 `/tmp/bot/signoff-zero-created.png`、
    `signoff-zero-first-run.png`、`signoff-zero-cloudhost-reopen.png`。
- 生产 npm 产物签收（2026-11-28，同一 `sys520084` 零机器账号，`0.1.1-alpha.2`
  由 `publish.yml` 发布到 npm `alpha` tag，run `46085724676`；`latest` 仍为
  `0.1.0-alpha.0`）：全新 `DSH_HOME` + 冷 pnpm store，一条命令从官方 registry
  安装 `dsh-rayrun-computer@1.3.1` + `dsh-rayrun-bots@0.1.1-alpha.2`。
  - 安装 5.10s；`dsh web` ready 3.59s；页面导航到首轮回复 **34.8s**
    （T0 `1795824327927` → T13 `1795824362688`）。
  - Computer 步骤零机器，`Create cloud computer` 真实 `machine.create` 4.56s →
    `Created · rayrun-bot`（`dsh-bot@1`）；first bot `Signoff Npm`，首轮
    `SIGNOFF_NPM_OK` 约 9.6s。
  - 合盖：`session.send` 943ms 返回 attach（`task-ef1eab99-…`）后 SIGKILL 本地
    DSH；云端在停机期间写出 `/workspace/cloudhost-npm-20261128.txt`
    （`SIGNOFF_NPM_CLOUDHOST_OK`），重启同一 `DSH_HOME` 后 transcript 于
    00:06:28.484Z 收取，session idle。
  - 偏差仅 localhost 反向代理与 WebDriver。测试机 `rayrun-bot`（`01a21f78…`）
    记录后 destroy（HTTP 204）；账号 live machines=0。截图
    `/tmp/bot/signoff-npm-created.png`、`signoff-npm-first-run.png`、
    `signoff-npm-cloudhost-reopen.png`。
- 每账户 primary bot（2026-11-28，代码/测试 + 页面 smoke）：新增
  `lib/superagent.js` 与 `$DSH_HOME/state/rayrun-bot/superagent.json`；启动和
  `bots.list` 前幂等 ensure，默认 id `superagent`、冲突加后缀；记录指向已删除
  bot 时重建，`bot.json` 损坏时失败关闭；`bots.delete` 返回
  `E_PRIMARY_BOT_PROTECTED`（409）。客户端把 primary 置顶/默认选中并显示
  `Primary` 徽标；Setup 编辑 primary（`bots.update`），不创建 worker。
  `test/superagent.mjs` 9/9；`rpc-contract` 42/42；`client-contract`、
  `locale-audit` 通过；临时 profile 页面 smoke：primary 置顶、删除 409、Setup
  改名后 bot.json revision 2 且没有新增 worker。截图 `/tmp/bot/primary-bot.png`、
  `/tmp/bot/primary-setup.png`（临时文件，不入库）。
- DSH workspace 绑定（2026-11-28，代码/测试 + 页面 smoke）：`bot.json` 新增可选
  `workspace: {id,path,title}`（schema 1；host-only，客户端只传 `workspaceId`，
  host 经 `ctx.workspaceRegistry` 解析）；`bots.list/get` 派生 `stale`（记录缺失、
  path 变化或 `missing-dir`），不持久化；运行中改绑/解绑返回
  `E_WORKSPACE_BUSY`；本地 detached runtime 在每次任务前把源目录镜像到
  `bots/<id>/workspace`（源为准，忽略 `.git/.env/secrets/node_modules/symlink`，
  保留 `.dsh`，2,000 files/32 MiB 上限，提交后供依赖 push），源目录不被写。
  `test/workspace-bind.mjs` 7/7、`test/bot-workspace.mjs` 9/9、
  `test/rayrun-detached-runtime.mjs` 18/18、`rpc-contract` 42/42、
  `client-contract`、`locale-audit` 通过；临时 profile 页面 smoke：New Bot 选择
  默认 workspace → 创建 → 详情显示 title/path → 解绑；无浏览器错误。截图
  `/tmp/bot/workspace-newbot.png`、`workspace-bound.png`、`workspace-unbound.png`
  （临时文件，不入库）。
- 具体组合、环境和缺口以 [`10-rayrun-verification.md`](10-rayrun-verification.md)
  和 [`version-matrix.md`](version-matrix.md) 为准；未测试的组合不作承诺。

## 4. 尚未构建或验证

- 发送响应前的合盖窗口：`session.send` 只在 bot 空闲的 detached/cloudHost 回合等到
  task attach；请求尚未到达本地 host、HTTP 响应尚未返回，或消息排在运行回合后面时，
  合盖仍可能丢这一轮。产品保证边界是“收到发送成功响应之后”。
- workspace 绑定第一版限制：1 bot : 1 workspace；cloudHost 不上传本地项目；每次
  detached turn 前镜像源目录（副本内修改不保留）；运行中不解绑/不改绑；
  `workspace.previous-*` 不自动清理；无手动 re-sync RPC；workspace 行入口和历史
  session 导入未实现。
- Rayrun 账号存储配额：2026-11-27 查询已用 504/512 GiB，创建新沙箱返回 409
  `resource_exhausted`；A6 改用已有的 `dsh-bot@1` 测试机。同日按用户明确清理授权
  destroy 13 台旧测试机。2026-11-28 又按用户授权 destroy `rayrun-bot-prod-e2e`；
  账号 live machines=0，期间两次创建 `dsh-bot@1` 测试机均成功（未再报 409），
  但配额读数仍未重新查询。
- 本地 routine scheduler 的真实自动触发：fake 集成测试覆盖了到期入队，但尚未等待
  一次真实本地 scheduler 自动触发；页面创建/启停/删除已 smoke。
- 能拦住 worker 的远程审批执行：ADR-019 已让本地 host 对 typed 机器
  start/stop/pause/resume 做审批/执行，真实 cloud proposal、denial/Continue 和下一轮
  context live E2E 已通过；其他动作和云端凭据动作仍未完成。云端 agent 在云电脑容器
  内按 ADR-020 使用 `danger-full-access`，这是设计；审批不是 agent containment，只
  覆盖 typed 的离开容器动作；云端凭据动作仍等平台隔离（ADR-001）。
- A7/A11 的完整审批验收：更多动作类型和云端凭据动作。
- 机器停止期间编辑定义的强一致同步、cron 表达式和事件触发器；本地与 cloudHost
  实现见 §3。
- 按 bot 的花费归因。
- A11 工作区扫描（2026-11-22）：`tmp/` 下有未跟踪的本地 key 文件
  `dp-code.key`（35 B，`sk-` 前缀）和 `rayrun-dev.key`（87 B）。两者被
  `.gitignore` 忽略，且从未进入 git 历史或 npm 包，但仍留在工作区；需轮换并
  移出/删除后才能声称 A11 通过。扫描未打印任何值。
- IM 通道。
- 稳定版发布：`0.1.1-alpha.2` 在 npm `alpha` tag（`latest` 仍是
  `0.1.0-alpha.0`）；稳定版需要单独决策和一次完整验收。
- CI deploy job **暂时停用**（`if: false`）：2026-11-25 两次真实运行
  （`45626382460`、`45628656084`）已证明 token、创建/复用 sandbox、启动、上传和
  stop 生效。第一次创建 `dsh-ci-deploy` 后因镜像 PATH 没有 pnpm 失败；第二次创建
  带 `egress_allow: ['registry.npmjs.org']` 的 `dsh-ci-deploy-2`，pnpm 下载仍
  `ENOTFOUND`。根因是 `egress_allow` 不在 Rayrun 创建 schema 中，被忽略；2026-11-25
  已在在线沙盒用 `PUT /v1/sandboxes/{id}/egress` 验证运行期放行有效，deploy 脚本
  已改为 `egress: { allow: ['registry.npmjs.org'] }`，契约测试拒绝 `egress_allow`。
  deploy job 仍需一次完整真实运行后再恢复；第一次 sandbox 已 Stopped，
  `dsh-ci-deploy-2` 在 2026-11-25 查询时为 Running，2026-11-26 查询为 Stopped、
  未 destroy。停用后的 checks
  run `45629800138` 全绿，deploy job 显示 skipped；npm 发布、普通测试和 checks
  不受影响。
## 5. 平台缺口

以下能力依赖 Rayrun 平台，不是本仓库能单独补上的：

- host/agent 权限隔离与 host-only 审批端点（ADR-001），用于云端凭据动作。平台答复
  （2026-11-22）：同沙箱内不可行；平台端点为非首版（设计 1 周 + 实现 2–4 周）。
  本地 typed 动作已按 ADR-019 在本地审批/执行；这不解决云端凭据动作，也不使云端
  agent 可信。云电脑是 agent 的安全容器，容器内 `danger-full-access` 是设计
  （ADR-020）；平台隔离缺口不是要求 agent 在容器内变成受限沙箱。
- R-G008 常驻 runtime：平台实现本机 dev 全量验收通过（`rayrun-bot-gaps`，`4709ac0`），
  旧镜像 409 已验证；生产 2026-11-24 部署到 `5c2ff48`（build 493），包含 gaps，
  `/v1/runtimes` 未认证返回 401。bot 侧 host/session 已随包交付，依赖 1.2.2+ 默认，
  并通过多 bot live E2E（2026-11-23）；默认路径的合盖验收仍待补；hosted 生产首次
  `runtime.put` 被 409 `guestd_outdated`
  拒绝。2026-11-24 已发布 `dsh-bot@1`（guestd 0.6.0、DSH 0.2.0-rc.2，manifest
  `DEEPSEEK_API_KEY`），平台测试 sandbox 的 `runtime.put` 返回 200；2026-11-24
  hosted 用户租户 cloudHost 聊天 E2E 通过（`PROD_OK`，runtime 删除、机器 Stopped、
  未 destroy）；生产 routine E2E 已通过（`CLOUD_ROUTINE_PROD_OK`，2026-11-24）。
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
- 不把计划写成已实现；不把 `danger-full-access` 描述成沙箱保证或 agent 级隔离；
  云电脑是 agent 的安全容器（ADR-020）；不承诺未测试的版本组合。
