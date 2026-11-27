# 版本矩阵

> 状态：2026-11-28。本文记录 DSH、云电脑依赖 `dsh-rayrun-computer` 与 Rayrun Bot
> 包的兼容范围，以及**实际验证过**的组合。它不承诺未测试的组合；实现状态仍以
> [`12-status.md`](12-status.md) 为准。
> 依赖边界见 [`08-integration.md`](08-integration.md)；验证环境缺口见
> [`10-rayrun-verification.md`](10-rayrun-verification.md)。

## 1. 声明范围

| 组件 | 声明 | 来源 |
| --- | --- | --- |
| DeepSeek Harness | `>=0.2.0-rc.2 <0.3.0` | `packages/dsh-rayrun-bots/package.json` 的 `engines.dsh` |
| `dsh-rayrun-computer` | `>=1.0.0 <2.0.0` | `packages/dsh-rayrun-bots/lib/dependency.js` |
| Node | `>=24` | `engines.node` |
| Rayrun Bot | `0.1.1-alpha.1` | `package.json` |

DSH `0.2.2-rc.5` 会读取并强制执行 `engines.dsh`：超出范围的插件行在合成时被禁用；
旧运行时忽略该字段。`dsh-rayrun-computer` 的版本由 host 在启动时读取，缺失或不在
1.x 时分别返回 `E_DEP_MISSING` / `E_DEP_VERSION`。依赖 `1.0.x` 使用单轮
`rayrun_agent`；`1.1+` 使用 detached `dsh.start/status/result`；`1.2+` 另有
host-callable `runtime.*`。npm `latest` 现为 `1.3.1`（`49b69d9`）：`1.2.2`
首次返回 machine credential 绑定名，`1.3.0` 增加 `credentials.save`，`1.3.1` 修正
显式保存时保留默认凭据。`1.2.1`（`3604e33`）没有 machine.credentials，默认
cloudHost 会回退 detached；`1.2.0` 的 npm tarball 来自较旧的 `fe965c1`。

## 2. 已验证组合

| DSH | 依赖 | Rayrun Bot | Node | 验证内容 | 证据 |
| --- | --- | --- | --- | --- | --- |
| `0.2.0-rc.2`（Rayrun 镜像 `deepseek-harness@1`） | `1.0.0` | `0.1.0-alpha.0` | 24.22.0 | 两插件安装、bundle 合成、Bots/云电脑页面渲染、health、同源 POST 拒绝 | [`10-rayrun-verification.md`](10-rayrun-verification.md) §3.1 |
| `0.2.1-rc.5` | 未安装 | `0.1.0-alpha.0` | 24 | 只安装 Bots 包并合成配置；未启动 web、未调用云电脑插件 | `.github/workflows/checks.yml` 的 `dsh-plugin` job |
| `0.2.2-rc.5` | 未安装 | `0.1.0-alpha.0` | 24 / 26 | 只安装 Bots 包并合成配置 | 同上 |
| `0.2.2-rc.5` | 未安装 | `0.1.0-alpha.0` | 24 | 从 `npm pack` 的 tarball 安装并合成配置（当时 15 个文件；当前包 40 个文件由 `package-contents` 检查） | [`10-rayrun-verification.md`](10-rayrun-verification.md) §3.1（2026-11-22） |
| `0.2.2-rc.5` | `1.0.0` | `0.1.0-alpha.0` | 24 | 本机页面层 setup / Open / Stop / roster；依赖 RPC | [`10-rayrun-verification.md`](10-rayrun-verification.md) §3.1 |
| `0.2.2-rc.5` | `1.0.0` | `0.1.0-alpha.0` | 24 | 本机页面层真实一轮 session：已有 `rayrun-bot-test` 机器、bot 回复 `SMOKE_OK`、刷新后 transcript 仍在 | [`10-rayrun-verification.md`](10-rayrun-verification.md) §3.1（2026-11-22） |
| `0.2.2-rc.5` | `1.1.0`（main `720f30a`，未发布 npm） | `0.1.0-alpha.0` | 24 | Bots 页 detached `dsh.start/status/result`：task id 持久化，关闭页面并 kill 本地 DSH，重启后恢复 poll、收取 `reply.md`（`DETACHED_OK`），刷新后回复仍在 | [`10-rayrun-verification.md`](10-rayrun-verification.md) §3.1（2026-11-22） |
| `0.2.2-rc.5` | `1.1.0`（main `720f30a`，未发布 npm） | `0.1.0-alpha.0` | 24 | A8 续接：第一轮 `TURN1_OK` 后机器 stop、host 重启，第二轮由依赖自动唤醒机器并从 transcript 回答 `ALPHA`；刷新后两轮仍在 | [`10-rayrun-verification.md`](10-rayrun-verification.md) §3.1（2026-11-22） |
| `0.2.2-rc.5` | `1.2.0`（main `fe965c1`，未发布 npm） | `0.1.0-alpha.0` | 24 | Bots `runtime.*` client 经依赖 host RPC live：dev 机器 start 后 put/list/get/delete，测试后 stop | [`10-rayrun-verification.md`](10-rayrun-verification.md) §3.1（2026-11-22） |
| `0.2.0-rc.2`（镜像 `dsh-bot-devcheck@1`） | `1.2.0`（main `fe965c1`，未发布 npm） | `cloud-host/` assets | 24 | DSH headless 直接 `--session-id` 续接：`RUN1_OK` → `ALPHA`；host 两轮 `HOST1_OK` → `BETA` | [`10-rayrun-verification.md`](10-rayrun-verification.md) §3.1（2026-11-22） |
| `0.2.2-rc.5` | `1.2.0`（main `fe965c1`，未发布 npm） | `0.1.0-alpha.0`（`cloudHost` adapter）+ `cloud-host/` assets | 24 | Bots 页面 → adapter → `rayrun_files` → `cloud-host/` + DSH：`HOST_E2E_OK`；runtime 删除、机器 stop | [`10-rayrun-verification.md`](10-rayrun-verification.md) §3.1（2026-11-23） |
| `0.2.2-rc.5` | `1.2.0`（main `fe965c1`，未发布 npm） | `0.1.0-alpha.0`（自动 projection） | 24 | Bots 页面 → adapter 投影/校验 `cloud-host/` → host DSH：`HOST_E2E_OK`；runtime 删除、机器 stop | [`10-rayrun-verification.md`](10-rayrun-verification.md) §3.1（2026-11-23） |
| `0.2.2-rc.5` | `1.2.0`（main `fe965c1`，未发布 npm） | `0.1.0-alpha.0`（`cloudHost` adapter + `cloud-host/` assets） | 24 | scoped token + private `deepseek-flash`，两 bot 一个 `bot-host`：`MULTI_A_OK`/`MULTI_B_OK`，独立 session，queueDepth 0；runtime 删除、机器 stop | [`10-rayrun-verification.md`](10-rayrun-verification.md) §3.1（2026-11-23） |
| `0.2.2-rc.5` | `1.2.0`（main `fe965c1`，未发布 npm） | `0.1.0-alpha.0`（本地审批执行器 + cloud proposal bridge） | 24 | 真实 cloud proposal → 本地 sync → Allow → 真实 machine.stop → 停机 outbox → 重启补传；真实审批卡 Deny 无执行 | [`10-rayrun-verification.md`](10-rayrun-verification.md) §3.1（2026-11-23） |
| `0.2.2-rc.5`（本机）/ `0.2.0-rc.2`（镜像 `dsh-bot-devcheck@1`） | `1.2.0`（main `fe965c1`，未发布 npm） | `0.1.0-alpha.0`（本地审批执行器 + cloud proposal bridge） | 24 | 真实云 bot 结构化 proposal → 本地 sync → Allow → 真实 `machine.stop` → 停机 outbox → 重启补传；runtime 删除、机器 stop | [`10-rayrun-verification.md`](10-rayrun-verification.md) §3.1（2026-11-23） |
| `0.2.2-rc.5`（本机）/ `0.2.0-rc.2`（镜像 `dsh-bot-devcheck@1`） | `1.2.0`（main `fe965c1`，未发布 npm） | `0.1.0-alpha.0`（本地审批执行器 + cloud proposal bridge） | 24 | start 审批（幂等 done/Running）+ 下一轮 Recent approval outcomes context；runtime 删除、机器 stop | [`10-rayrun-verification.md`](10-rayrun-verification.md) §3.1（2026-11-23） |
| `0.2.2-rc.5`（本机）/ `0.2.0-rc.2`（镜像 `dsh-bot-devcheck@1`） | `1.2.0`（main `fe965c1`，未发布 npm） | `0.1.0-alpha.0`（本地审批执行器 + cloud proposal bridge） | 24 | denial：denied/not_executed、机器 Running；Continue bot 从结果 context 回答 denied | [`10-rayrun-verification.md`](10-rayrun-verification.md) §3.1（2026-11-23） |
| `0.2.2-rc.5`（本机）/ `0.2.0-rc.2`（镜像 `dsh-bot-devcheck@1`） | `1.2.0`（main `fe965c1`，未发布 npm） | `0.1.0-alpha.0`（本地审批执行器 + cloud proposal bridge） | 24 | pause：Paused + 停机 outbox → resume 后补传；resume 审批 done/Running；runtime 删除、机器 stop | [`10-rayrun-verification.md`](10-rayrun-verification.md) §3.1（2026-11-23） |
| `0.2.2-rc.5`（本机）/ `0.2.0-rc.2`（镜像 `dsh-bot-devcheck@1`） | `1.2.0`（main `fe965c1`，未发布 npm） | `0.1.0-alpha.0`（cloudHost runtime adapter） | 24 + Rayrun dev | 无 token → `E_TOKEN_REQUIRED`、无 bot 回复；保存 token → `RECOVERED_OK`；同一 host 连续两轮 pid/session 不变，`TURN1_OK` → `ALPHA`；删除 runtime + 重启本地 DSH → 新 pid、同 session，`RECOVERY_TURN` → `ALPHA`；runtime 删除、机器 stop | [`10-rayrun-verification.md`](10-rayrun-verification.md) §3.1（2026-11-24） |
| `0.2.2-rc.5`（本机）/ `0.2.0-rc.2`（镜像 `dsh-bot-devcheck@1`） | `1.2.0`（main `fe965c1`，未发布 npm） | `0.1.0-alpha.0`（cloudHost runtime adapter） | 24 + Rayrun dev | 本地 DSH 不重启；删除 `bot-host` 后下一轮自动重建（pid 636 → 668），同一 DSH session，`TURN1_OK` → `BETA`；runtime 删除、机器 stop | [`10-rayrun-verification.md`](10-rayrun-verification.md) §3.1（2026-11-24） |
| `0.2.2-rc.5`（本机）/ `0.2.0-rc.2`（镜像 `dsh-bot-devcheck@1`） | `1.2.0`（main `fe965c1`，未发布 npm） | `0.1.0-alpha.0`（cloudHost runtime adapter） | 24 + Rayrun dev | 三条消息入队后 SIGKILL 本地 DSH；本地停机期间云 host 完成 Q1；重启同一 `DSH_HOME` 后按序排空（`Q1_OK`/`Q2_OK`/`Q3_OK`），同一本地 session、host pid 635、云端 DSH session，无重复/丢失；runtime 删除、机器 stop | [`10-rayrun-verification.md`](10-rayrun-verification.md) §3.1（2026-11-24） |
| `0.2.2-rc.5`（本机） | `1.2.0`（main `fe965c1`，未发布 npm） | `0.1.0-alpha.0`（cloudHost runtime adapter） | 24 + Rayrun dev | host 挂载即恢复 detached task live：重启后不打开页面、不发 HTTP RPC，队列自动排空（`E1_OK`/`E2_OK`），同一 host pid 636 与云端 DSH session；`test/rpc-contract.mjs` 32/32；runtime 删除、机器 stop | [`10-rayrun-verification.md`](10-rayrun-verification.md) §3.1（2026-11-24） |
| `0.2.2-rc.5`（本机）/ `0.2.0-rc.2`（镜像 `dsh-bot-devcheck@1`） | `1.2.0`（main `fe965c1`，未发布 npm） | `0.1.0-alpha.0`（cloudHost routine scheduler） | 24 + Rayrun dev | 本地 DSH 在 due 前停止；云 host 自动 enqueue/执行 routine，reply `CLOUD_ROUTINE_OK`；重启后 sync 导入 history；runtime 删除、机器 stop | [`10-rayrun-verification.md`](10-rayrun-verification.md) §3.1（2026-11-24） |
| `0.2.2-rc.5`（本机） | `1.2.0`（main `fe965c1`，未发布 npm） | `0.1.0-alpha.0` | 24 + Rayrun dev | 干净 tenant（0 台机器）页面 setup 点击创建按钮 → `machine.create` 创建 `rayrun-bot-clean`（2C/2G、remote desktop），页面显示 `Created`；机器 stop，后按用户授权 destroy | [`10-rayrun-verification.md`](10-rayrun-verification.md) §3.1（2026-11-24） |
| `0.2.2-rc.5`（本机）/ `0.2.0-rc.2`（镜像 `dsh-bot@1`） | `1.2.0`（main `956d595`，未发布 npm） | `0.1.0-alpha.0`（cloudHost runtime adapter + `cloud-host/` assets） | 24.22 + Rayrun hosted prod | hosted prod 新 sandbox `rayrun-bot-prod-e2e`（guestd 0.6.0）冷启动 → `bot-host` runtime running pid 636 → bot 回复 `PROD_OK`（约 12 秒）；runtime 删除、机器 Stopped、未 destroy | [`10-rayrun-verification.md`](10-rayrun-verification.md) §3.1（2026-11-24） |
| `0.2.2-rc.5`（本机）/ `0.2.0-rc.2`（镜像 `dsh-bot@1`） | `1.2.0`（main `956d595`，未发布 npm） | `0.1.0-alpha.0`（cloudHost routine scheduler） | 24.22 + Rayrun hosted prod | 本地 DSH 在 due 前停止；云 host 于 14:48:16Z 产出 `CLOUD_ROUTINE_PROD_OK`；重启后 `routines.sync` imported=1，history 合并 routine user/bot；runtime 删除、机器 Stopped、未 destroy | [`10-rayrun-verification.md`](10-rayrun-verification.md) §3.1（2026-11-24） |
| `0.2.2-rc.5` | `1.0.0` | `0.1.0-alpha.0` | 24 + Rayrun 沙盒 | 云端 ingress、`dsh web` 部署与 token URL | [`09-deployment.md`](09-deployment.md)、[`10-rayrun-verification.md`](10-rayrun-verification.md) §3.1 |
| `0.2.2-rc.5`（本机）/ `0.2.0-rc.2`（镜像 `dsh-bot@1`） | `1.2.1`（npm） | `0.1.1-alpha.1`（npm，cloudHost adapter） | 24.22 + Rayrun hosted prod | 官方 registry 一条命令安装两包；临时 `DSH_HOME` health `version=0.1.1-alpha.1`；Stopped 机器 → `bot-host` pid 635 → `GOLDEN_OK`，约 10.0 秒；runtime 删除、机器 Stopped、未手动改包 | [`10-rayrun-verification.md`](10-rayrun-verification.md) §3.1（2026-11-25） |
| `0.2.2-rc.5`（本机）/ `0.2.0-rc.2`（镜像 `dsh-bot@1`） | `1.2.1`（npm） | `0.1.1-alpha.1`（npm，cloudHost adapter） | 24.22 + Rayrun hosted prod | 生产 `rayrun-bot-prod-e2e` 从 Stopped 启动，两个 bot 并发；一个 `bot-host` pid 636，分别回复 `MULTI_A_OK` / `MULTI_B_OK`，约 14.1 秒；runtime 删除、机器 Stopped、未 destroy | [`10-rayrun-verification.md`](10-rayrun-verification.md) §3.1（2026-11-25） |
| `0.2.2-rc.5`（本机）/ `0.2.0-rc.2`（镜像 `dsh-bot@1`） | `1.2.1`（npm） | `0.1.1-alpha.1`（npm，cloudHost adapter） | 24.22 + Rayrun hosted prod | headless Firefox：真实 Bots 页面创建 bot → `BROWSER_OK`；`rayrun.machine.pause` 审批 pending → Deny 不执行、机器 Running；Allow once 本地执行 pause、机器 Paused、execution done | [`10-rayrun-verification.md`](10-rayrun-verification.md) §3.1（2026-11-25） |
| `0.2.0-rc.2`（Rayrun 镜像 `deepseek-harness@1`） | `1.2.1`（npm） | `0.1.1-alpha.1`（npm） | 24.22.0 + Rayrun 在线沙盒 | A1：全新 `DSH_HOME` + 全新 pnpm store/cache，一条命令安装两包 7.38 秒；`dsh web` ready 2.56 秒；Bots + 云电脑两页 20.04 秒；只装 bots 时 health `E_DEP_MISSING` | [`10-rayrun-verification.md`](10-rayrun-verification.md) §3.1（2026-11-25） |
| `0.2.2-rc.5`（本机） | `1.2.1`（npm） | `0.1.1-alpha.1`（npm） | 24.15.0 | A2/A3：临时 profile + localhost 反向代理（`curl --interface wlp4s0`）；`connection.save` 写 vault、`overview` configured true、余额/机时/机器可见；`machine.create` 创建 `rayrun-bot-a3-20261125`（2 vCPU / 2048 MB / remote desktop true）到 Running 4.30 秒，stop 后 Stopped、未 destroy；`clearToken` 后 `configured:false` 且 `account` 返回 `token_required` | [`10-rayrun-verification.md`](10-rayrun-verification.md) §3.1（2026-11-25） |
| `0.2.2-rc.5`（本机）/ `0.2.0-rc.2`（镜像 `dsh-bot@1`） | `1.2.1`（npm） | `0.1.1-alpha.1`（npm，cloudHost）/ checkout（1s poll） | 24.15 / 24.22 + Rayrun hosted prod | A4：固定 `rayrun-bot-prod-e2e`、credential `dsh-model-sinnet`；`A4 Cloud Bot` 首轮约 16 秒回复 `A4_OK`；checkout 1s poll 后热轮 4.64 秒（npm alpha.1 仍 3s）；机器 `bots/a4-cloud-bot/` 含 transcript；runtime 删除、机器 Stopped、未 destroy | [`10-rayrun-verification.md`](10-rayrun-verification.md) §3.1（2026-11-25） |
| `0.2.2-rc.5`（本机）/ `0.2.0-rc.2`（镜像 `deepseek-harness@1`） | `1.2.1`（npm） | checkout（`computer.update`） | 24.15 + Rayrun hosted | `bot-update-smoke-20261126` 经 `computer.update` 换镜像：新机同名、带 `dsh-model-sinnet`，`/workspace/update-smoke.txt` 与 `.dsh` 保留；旧机改名 `...-pre-update-mwxk96k8` 并 Stopped，新机验证后 Stopped，二者未 destroy | [`10-rayrun-verification.md`](10-rayrun-verification.md) §3.1（2026-11-26） |
| `0.2.2-rc.5`（本机） | `1.2.1`（npm） | `0.1.1-alpha.1`（npm） | 24.15.0 + 全新 Rayrun 沙箱 | 全新 `DSH_HOME` 首次运行分段计时：安装 61.1/128.0s、web ready 5.3/6.1s、浏览器会话→bot 32.9s、首轮回复 15.9–16.2s；合计 1m55s–3m03s，未做单一连续签收；`dsh-model-sinnet` 失效，新 credential `dsh-model-firstrun-20261127`；机器 stop、未 destroy | [`10-rayrun-verification.md`](10-rayrun-verification.md) §3.1（2026-11-27） |
| `0.2.2-rc.5`（本机） | `1.2.1`（npm） | checkout（`0.1.1-alpha.1`） | 24.15 + `dsh-bot@1` | A6 cloudHost 真实 `rayrun.machine.pause` proposal：回合 idle→卡片 2.291s、proposal→卡片 0.464s、Allow→execution done 0.779s、机器 Paused 1.030s、Continue→working 21ms；机器 Stopped、runtime 删除、未 destroy | [`10-rayrun-verification.md`](10-rayrun-verification.md) §3.1（2026-11-27） |
| `0.2.2-rc.5`（本机） | `1.2.1`（npm） | checkout（`0.1.1-alpha.1`） | 24.15 + Rayrun dev | A5 detached 真实任务：本地 DSH 停止期间写出 `acceptance-dev-20261127.txt`（`REAL_TASK_OK` + UTC 时间），重开后 history 收到 `REAL_TASK_OK`；dev 机器 `rayrun-bot` / `deepseek-harness@1`；机器测试后按用户确认 destroy；cloudHost 预览路径未在 dev 复验（`dsh-bot@1` 无 credential slot、`deepseek-harness@1` guestd 409） | [`10-rayrun-verification.md`](10-rayrun-verification.md) §3.1（2026-11-27） |
| `0.2.2-rc.5`（本机） | `1.2.1`（npm） | `0.1.1-alpha.1`（npm） | 24.15 + Rayrun dev | 首次运行 dev 计时：安装 17.4s、web ready 5.8s、页面→首轮回复 35.8s、首轮回复 19.4s，合计约 59s；dev 本地 API、既有 credential、非空账号过滤；机器 destroy、token 撤销；非生产干净账号签收，三分钟门未关闭 | [`10-rayrun-verification.md`](10-rayrun-verification.md) §3.1（2026-11-27） |
| `0.2.2-rc.5`（本机） | `1.3.1`（npm） | main `d353eca` tarball（`0.1.1-alpha.1`，非 npm） | 24.15.0 + Rayrun hosted prod `sys520084` | 默认 cloudHost 生产签收：全新 `DSH_HOME` + 冷 pnpm store，安装 3.12s、web ready 3.84s、页面到首轮回复 10.9s（安装→首轮 29.1s）；`dsh-bot@1` 首轮 `SIGNOFF_FIRST_RUN_OK`；`session.send` 980ms 返回 attach 后 SIGKILL 本地 DSH，云端停机期间写出 `SIGNOFF_CLOUDHOST_OK`，重开同一 `DSH_HOME` 收取；机器记录后 destroy | [`10-rayrun-verification.md`](10-rayrun-verification.md) §3.1（2026-11-28） |

2026-11-27 按用户明确清理授权 destroy 13 台旧测试机（CI deploy、A1/A3、
computer update、A6、首次运行计时）；仅保留 `rayrun-bot-prod-e2e`（Stopped、
未 destroy）。表中“机器 stop、未 destroy”是当次测试收尾；之后的清理不改变当次
验证证据。2026-11-27 起 `computer.update` 在迁移成功后 destroy 旧机
（`computer-update.mjs` 9/9）；表中 2026-11-26 的旧机 Stopped、未 destroy 是当次
行为，真实 Rayrun 的 destroy 路径未复验。同日依赖 1.2.2+ 默认切到 cloudHost，
Setup/电脑更新目标镜像随 runtime 变为 `dsh-bot@1`；上表 cloudHost 行仍是显式启用
时的历史组合。2026-11-27 稍后已在 dev 验证默认 cloudHost 合盖：health
`runtime=rayrun-cloud-host`；Rayrun 修复 dev 镜像（`deepseek-harness@1` guestd
0.6.0、`dsh-bot@1` 补 credential slot），dependency 本地补
`shapeSandbox.credentials`。机器 `rayrun-bot-cloudhost-accept-20261127` 上，
本地 DSH 被杀期间云端写出 `REAL_CLOUDHOST_OK` / `DEFAULT_CREDENTIAL_OK` 文件，
重开后 history 收到 `CLOUDHOST_DEFAULT_OK`；机器已按用户明确指令于
2026-11-27T14:54:17Z destroy（`api_delete`），runtime 删除、dev token 撤销。限制：
dev only；dependency 修复已在 `1.2.2`（`75e285d`）发布，当前 latest `1.3.1`，dev 镜像是手工修补；生产干净账号仍未
复验。2026-11-28 生产签收使用 main `d353eca` 的 tarball，而不是 npm `alpha.1`：
npm `0.1.1-alpha.1` 发布于 2026-11-25，不含 2026-11-26/27 的 UX trust pass、
默认 cloudHost、send acceptance 和 Issue #4/#6 修复；main 的 `package.json` 版本号
仍是 `0.1.1-alpha.1`。发布 v0.1 前需要 bump 版本并重新发布，再从 npm 复验。

“未安装”表示该 CI 矩阵只验证 Bots 包本身能安装和合成，不验证依赖或云端行为。
表中 `0.1.0-alpha.0` 与“未发布 npm”是当次验证时的状态；当前包版本是
`0.1.1-alpha.1`，已通过 `publish.yml` 发布到 npm 的 `alpha` tag。`latest` 仍是旧的
`0.1.0-alpha.0`，稳定版尚未发布。
表中“机器 stop”是当次测试收尾动作；devcheck 的 `rayrun-bot`、`rayrun-bot-idle`、
`rayrun-bot-scoped`、`rayrun-bot-coldstart` 与 botclean 的 `rayrun-bot-clean` 已于
2026-11-24 按用户明确授权 destroy；dev 侧现无 bot 测试机。botclean 租户保留。

依赖 main `956d595` 已移除 `worker_files_unavailable` 映射（来自依赖侧 live 测试
脚本的 fetch mock 误拦截 `.../node_modules/dsh-rayrun-computer/...`，不是平台
file API），CI Node 22/24 全绿；已包含在 npm `1.2.1`（`gitHead=3604e33`）；本仓库
未采用该码的特殊重试。
hosted `rayrun-bot-test` 在收窄 mock 后冷启动 8.8 秒成功（`REAL_FIX_OK`）；
dev `rayrun-bot-coldstart` 冷启动成功（`COLD_OK`），后按用户授权 destroy。
三台 hosted 测试机保留、保持 Stopped，清理待用户确认。2026-11-24 生产 daemon
部署到 `5c2ff48`（build 493，tag `prod-20261124-2`），包含 `rayrun-bot-gaps`；
`/v1/runtimes`、`/v1/ci/capabilities` 未认证返回 401；CI 代码已上生产但
`RAYRUN_GITHUB_CI_ENABLED` 未开。hosted `rayrun-bot-test` 首次 `runtime.put`
返回 409 `guestd_outdated`（`E_GUESTD_OUTDATED`）。2026-11-24 已发布
`dsh-bot@1`（guestd 0.6.0、DSH 0.2.0-rc.2、manifest `DEEPSEEK_API_KEY`），
平台测试 sandbox 的 `runtime.put` 返回 200；2026-11-24 hosted 用户租户
cloudHost 聊天 E2E 通过（`rayrun-bot-prod-e2e`，`PROD_OK`，约 12 秒，runtime
删除、机器 Stopped、未 destroy）；生产 routine E2E 已通过（`CLOUD_ROUTINE_PROD_OK`，2026-11-24）。
2026-11-24 对依赖 main `956d595` 跑本仓库全部 `test/*.mjs`，离线检查通过
（不含 live）。

S6（2026-11-24，本地 tarball）：`dsh plugin add` 一条命令安装两个包会同时选中
两个 bundle；只安装 bots 包即使声明依赖，也只会安装依赖包、不启用依赖 bundle。
因此文档写“一条命令装两个包”，不写“单包安装”。

## 3. 安装与打包检查

`dsh-rayrun-bots@0.1.1-alpha.1` 已通过 `publish.yml` 发布到 npm（2026-11-25，`alpha` tag）；依赖
`dsh-rayrun-computer@1.3.1` 也已发布（latest，`49b69d9`；`1.2.2` 起有
machine.credentials，`1.3.0` 起有 credentials.save）。`1.2.1` 及更早没有
machine.credentials，默认 cloudHost 会回退 detached。本机默认 registry 是 npmmirror，
可能滞后；安装验证用 `--registry=https://registry.npmjs.org` 或等待镜像。

一条命令安装两个包（已用官方 registry 验证两个插件都加载、health `ok`）：

```bash
npm_config_registry=https://registry.npmjs.org \
  dsh plugin --profile web add \
  dsh-rayrun-computer@1.3.1 dsh-rayrun-bots@0.1.1-alpha.1
```

从 checkout/tarball 安装（开发/离线）：

```bash
# checkout
dsh plugin --profile web add /absolute/path/to/packages/dsh-rayrun-bots

# tarball（发布产物的内容）
npm pack ./packages/dsh-rayrun-bots --pack-destination /tmp
dsh plugin --profile web add /tmp/dsh-rayrun-bots-0.1.1-alpha.1.tgz
```

`node packages/dsh-rayrun-bots/test/package-contents.mjs` 用
`npm pack --dry-run --json` 校验 tarball 内容：host half、client half、locale、
`cordis.patch.yml`、`lib/*.js`、`icon.svg`、README 和 LICENSE 必须在；`test/`、
`docs/`、`tools/`、`node_modules/`、`.env` 和 `.tgz` 不得进入。

npm 归属与 OIDC trusted publishing 已配置；发布只走 `.github/workflows/publish.yml`
的 Release 事件，`NPM_TOKEN` / `NODE_AUTH_TOKEN` 必须保持 absent。

## 4. 未验证

- 官方 DSH 桌面（Electron）的创建、安装器、更新、卸载与再分发（R-G001）；
- 依赖 1.1.0 发布到 npm 后安装（今天从 main `720f30a` checkout 验证）；同一
  host 不重启的连续两轮 detached；
- 依赖 1.2.0 `runtime.*` 发布到 npm 后安装（今天从 main `fe965c1` checkout 验证）；
- DSH `0.2.2-rc.5` 的 subprocess/terminal 完整安装路径（R-G005）；
- 镜像 DSH `0.2.0-rc.2` 与本机/桌面 `0.2.2-rc.5` 的功能一致性（R-G007）；
- 含 2026-11-26/27 main 改动（默认 cloudHost、UX 修复、send acceptance）的新
  prerelease 的 npm 干净安装签收；
- 稳定版发布：`0.1.1-alpha.1` 已通过 `publish.yml` 从 `v0.1.1-alpha.1` Release 发布
  （npm `alpha` tag）；`latest` 仍是旧的 `0.1.0-alpha.0`，稳定版尚未发布。

新增验证后更新本表；不要把未测试的组合写成已支持。
