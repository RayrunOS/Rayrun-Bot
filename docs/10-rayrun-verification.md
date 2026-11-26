# 10 — 验证、测试与 Rayrun 缺口

> 状态：2026-11-26。本文是**验证/测试资源政策**和 **Rayrun 缺口登记册**。
> 所有需要计算资源的验证与测试都走 Rayrun（真实 token 页面例外见 §2.6）；Rayrun 不满足
> 的项记在这里，不静默改用本地或其他云，也不把未验证写成已实现。平台能力需求本身仍以
> [`08-integration.md`](08-integration.md) 为准。
> 测试证据和实现状态以 [`12-status.md`](12-status.md) 为准。

## 0. 与现有文档的关系

| 文档 | 负责什么 |
| --- | --- |
| [`08-integration.md`](08-integration.md) | 平台能力需求、优先级与 handoff |
| [`09-deployment.md`](09-deployment.md) | 安装、运行、配置与故障处理 |
| [`11-dsh-rayrun-computer-issues.md`](11-dsh-rayrun-computer-issues.md) | `dsh-rayrun-computer` 自身的问题登记；修复去上游 |
| [`design/desktop-distribution.md`](design/desktop-distribution.md) | D-S1a 清单与 2026-11-21 实测记录（§5.8） |
| [`plans/mvp-plan.md`](plans/mvp-plan.md) | v0.1 验收任务与测试证据要求（§2、§7） |
| [`12-status.md`](12-status.md) | 实现状态；本文不复制状态 |

---

## 1. 政策

1. **验证/测试的计算资源一律从 Rayrun 获取。** 使用用户自己的 Rayrun 账号上的沙箱
   （默认 `api.rayrunos.com`；用户指定其他 Rayrun 实例时从其指定）；不在本地虚拟机、
   其他云或项目方账号上跑集成验证。
2. **仓库单测和 CI 不是云计算资源。** `node test/*.mjs`、语法检查和 `git diff --check`
   仍按 [`../CLAUDE.md`](../CLAUDE.md) §8 在本地/CI 跑；需要真实机器、DSH 运行时、
   网络、GUI 或计费的验证才走 Rayrun。例外：需要真实 Rayrun token 的 setup/Open
   页面路径按 §2.6 在本机跑（token 不能进沙箱）；这是已记录的 workaround，其余页面
   与集成验证仍走 Rayrun。
3. **不静默替代。** Rayrun 缺什么，就在 §3 登记，并明确标为未验证/有 workaround；
   只有用户明确同意才改用其他环境。
4. **测试沙箱默认 stop，不 destroy。** 可以 pause/stop；销毁必须由人明确请求。
5. **密钥不进入沙箱。** Rayrun token 只在 host 侧读取；DeepSeek key 只经 Rayrun
   credential injection。测试脚本不得把 token 上传到 `/workspace` 或日志。例外：
   部署脚本会把 DSH 自己的 launch token URL 写入沙盒内
   `/workspace/dsh-web-url.txt`（mode 600）；这是 DSH web auth 凭据，不是 Rayrun
   token，必须按凭据处理、不打印、不入仓库/日志。
6. **每条缺口有日期、证据、workaround 和影响。** 新的验证受阻项从下一个编号追加；
   平台能力需求的详情、优先级和 handoff 只在
   [`08-integration.md`](08-integration.md) 登记；这里保留验证受阻状态、简短证据和
   链接，不复述需求清单。

---

## 2. 可用的 Rayrun 验证路径（2026-11-21）

- **API**：`https://api.rayrunos.com/v1`；认证 `Authorization: Bearer rayrun_…`。
- **镜像**：`deepseek-harness@1`（Ubuntu 24.04.4，Node v24.22.0，DSH `0.2.0-rc.2`，
  Xvfb + Chrome + noVNC；`[desktop] supported = true`）。
- **沙箱**：`POST /v1/sandboxes`，建议 2 vCPU / 4 GB、`max_lifetime_seconds` 有界、
  `idle_timeout_seconds` + `idle_action: stop`、`budget_cents` 提醒；不要自动 destroy。
- **文件**：`PUT /v1/sandboxes/{id}/files/{path}`（相对 workspace 根，父目录自动创建）；
  上传插件 tarball 后校验 SHA-256。
- **执行**：`POST /v1/sandboxes/{id}/exec`（`command` 或 `argv`，超时 ≤ 3600 s）。
- **远程 UI**：创建沙箱时 `remote_desktop: true` 会发布镜像声明的桌面端口；
  其他端口可用 `PUT /v1/sandboxes/{id}/ingress/{port}` 发布。
- **生命周期**：`stop` 保盘、`start` 恢复；停止后进程不存活，`/workspace` 和
  rootfs overlay 保留。**`destroy` 不可逆，测试中不使用。**
- **Egress**：验证 Bots setup 的 Rayrun 连接时，沙箱 egress 要包含
  `api.rayrunos.com`；否则云电脑插件显示 `fetch failed`，无法区分网络失败和 token
  被拒。

已跑通的验证路径：

1. 从 `deepseek-harness@1` 创建沙箱，`corepack prepare pnpm@10.20.0 --activate` +
   `corepack enable pnpm`；
2. 用 `npm pack` 打两个插件的 tarball，经 files API 上传，`dsh plugin --profile web add`
   安装；
3. 启动 `dsh web`，用沙箱内 Chrome + CDP 渲染 Bots/云电脑页面并调用 health；
4. 需要公开 UI 时发布 ingress（`public`），DSH 自己的 launch token/cookie 是唯一门禁；
5. 验证结束 `POST /stop`，不 destroy；vm-hours/费用以 Rayrun 账本为准，本文不复制
   每次读数；
6. 页面层成功路径：在本机 `npm install @deepseek-ai/dsh@0.2.2-rc.5`（npmmirror）+
   pnpm，把两个插件装进临时 profile，启动本机 `dsh --profile …`，用
   Firefox/geckodriver 驱动。真实 token 由页面输入经同源 RPC 写入本机 DSH vault；
   Bots 不持久化它，也不让它进入 Rayrun 沙箱、仓库或日志。这是页面层测试的
   workaround：带真实 token 的 setup/Open 页面路径在本机 host 上跑；无 token 的
   页面渲染可以在沙箱内验证（见 §3.1 的 ingress 条）。

具体命令和结果见
[`design/desktop-distribution.md`](design/desktop-distribution.md) §5.8。

---

## 3. Rayrun 缺口登记

> 这些是**验证/测试环境**的缺口，不是产品功能承诺。状态只表示“测试是否能做”，
> 不代表平台路线图。平台能力需求见 [`08-integration.md`](08-integration.md)。
> R-G008–R-G014 中多项由平台能力导致；本文保留**验证受阻状态和简短证据**，需求、
> 优先级和 handoff 以 08 为准，不复述需求清单。

| ID | 日期 | 需要什么 | Rayrun 现状 / 证据 | 状态与 workaround | 影响 / 下一步 |
| --- | --- | --- | --- | --- | --- |
| R-G001 | 2026-11-21 | 验证官方 DSH 桌面的 `profiles/desktop`、安装器、升级、卸载、再分发 | Linux 不是 DSH Desktop 的官方 release target；云镜像没有 Electron 桌面 App；CLI 对 `desktop` profile 返回 `managed exclusively by the Electron application`（DSH 0.2.0-rc.2 与 0.2.2-rc.5 一致） | **阻塞**。workaround：用 `web` profile 验证插件/UI；`profiles/desktop` 相关项保持未验证 | D-S1a 第 1、4、6、7 项无法在 Rayrun 完成；需要桌面能力或明确例外 |
| R-G002 | 2026-11-21 | 在官方镜像里安装 DSH 插件 | `deepseek-harness@1` 没有 pnpm；`dsh plugin` 报 `pnpm was not found` | **有 workaround**：corepack 激活 pnpm 10.20.0 | B1 bootstrap 必须自带/激活 pnpm |
| R-G003 | 2026-11-21 | 原始 `exec` 下可用的 HOME | `$HOME=/workspace/.rayrun/home` 初始不存在；`DSH_HOME` 已指向 `/workspace/.rayrun/dsh` | **有 workaround**：安装前 `mkdir -p $HOME` | 依赖 HOME 的工具会失败；镜像/worker 启动应创建 |
| R-G004 | 2026-11-21 | 远程访问 DSH web | `0.2.0-rc.2` 拒绝 `--host 0.0.0.0`；`0.2.2-rc.5` 允许具体 IP，但警告明文 HTTP；ingress 是 `public`，DSH launch token/cookie 是唯一门禁 | **有 workaround**：0.2.0-rc.2 用 loopback + TCP 代理；0.2.2-rc.5 绑具体 IP；`--trusted-host` 必须含 ingress 主机名 | 远程 UI 需要代理/具体 IP；public ingress 不能当产品面板 |
| R-G005 | 2026-11-21 | 完整安装 DSH 0.2.2-rc.5 的 subprocess/terminal 路径 | `npm install -g` 跳过 `dsh-subprocess-local`、`node-pty`、`koffi`、`protobufjs` 的 install scripts | **未验证**：Web UI 和 plugin manager 可用；terminal/子进程未测 | 需要在镜像里显式跑 allow-scripts 或换安装方式 |
| R-G006 | 2026-11-21 | 把预装好的 web profile 烘进自定义镜像 | `POST /v1/images` 保存的是 rootfs overlay；`/workspace/.rayrun/dsh` 在 workspace 盘，不在镜像里 | **有 workaround**：镜像带 tarball + bootstrap，首启写入 workspace | 不能直接做“打开即带 profile”的镜像；需要 bootstrap 或平台支持 workspace 快照 |
| R-G007 | 2026-11-21 | 与本地验证/桌面一致的 DSH 版本 | 官方镜像 pin `0.2.0-rc.2`；本机页面验证使用 `0.2.2-rc.5`；桌面 bundle `0.2.2-rc.5`（官方桌面未验证，见 R-G001） | **有 workaround**：镜像内可升级并验证；升级后 profile 保留；组合记录在 [`version-matrix.md`](version-matrix.md) | 镜像 pin 与本地/桌面仍不一致；镜像升级需要平台/构建支持 |
| R-G008 | 2026-11-22 | 长驻 bot runtime、session 续接、启动钩子、prompt 队列 | 平台答复（2026-11-22）：runtimes API 已实现并本机 dev 全量验收通过（`rayrun` 仓库 `rayrun-bot-gaps`，`4709ac0`），**生产已部署（2026-11-24，`5c2ff48`/build 493）**；契约含 `PUT/GET/POST/DELETE /v1/sandboxes/{id}/runtimes`、guestd 0.6.0、`autostart`/`restart=always`/`keep_alive`、boot 时 credential injection；session 不是平台对象，bot host 自己写 `/workspace`，workspace 跨 stop/start 保留；旧镜像 409 `guestd_outdated`。2026-11-22 本机 dev 全量验收通过，旧镜像 `ci@1` 负测通过（见 §3.1）。2026-11-24 生产 daemon 已部署到 `5c2ff48`（build 493，tag `prod-20261124-2`），包含 `rayrun-bot-gaps` 的 14 个提交（R-G008–R-G012、scopes/凭证所有权）；未认证 `GET /v1/sandboxes/{id}/runtimes` 返回 401（已注册），`/v1/health` 200；CI 代码已上生产但 `RAYRUN_GITHUB_CI_ENABLED` 未开。2026-11-24 hosted production 尝试：`rayrun-bot-test` start 成功，但 `runtime.put` 返回 409 `guestd_outdated`，session 以 `E_GUESTD_OUTDATED` 失败关闭；机器已 stop、无 runtime。只换新 sandbox 不够：生产镜像 `ubuntu@1`/`builder@1` 仍是 guestd 0.5.0，rootfs 2026-10-26，builder 构建也注入 0.5.0；必须先刷新生产镜像（含 builder@1）到 guestd 0.6.0。2026-11-24 已完成：builder@1 换 guestd 0.6.0（有备份），发布 `dsh-bot@1`（build `01a20dec…`，rootfs sha256 `937ebd7a…`，guestd 0.6.0，Node v24.22.0，DSH 0.2.0-rc.2，manifest `credential_slots=["DEEPSEEK_API_KEY"]`）；测试 sandbox `01a20df8…` 的 `runtime.put bot-host` 返回 200 applied/restarted，state running pid 651，heartbeat 更新；测试后 stop、未 destroy。`rayrun-bot-test` 仍是旧镜像、Stopped。2026-11-24 hosted 用户租户 cloudHost E2E 通过：新 sandbox `rayrun-bot-prod-e2e`（`01a20dfd…`，`dsh-bot@1`）从 Stopped 启动，bot-host runtime running pid 636，bot 回复 `PROD_OK`，约 12 秒；随后 runtime 删除、机器 Stopped、未 destroy。另做 routine E2E：本地 DSH 停机期间云 host 于 14:48:16Z 产出 `CLOUD_ROUTINE_PROD_OK`；重启后 `routines.sync` imported=1，history 合并 routine user/bot，测试后 runtime 删除、机器 Stopped | **平台实现本机 dev 全量验收通过；生产已部署（`5c2ff48`/build 493）；旧镜像 409 已验证；`dsh-bot@1` 已发布并完成 hosted cloudHost 聊天 E2E**；bot 侧本地 adapter 已进包预览并页面 E2E 通过（`HOST_E2E_OK`，2026-11-23）；host 资产已进包，projection 页面 E2E 已通过（2026-11-23）。审批隔离不在初步支持内（§3.3） | hosted 生产 routine E2E 已通过（2026-11-24）；“合上笔记本继续工作”的端到端验证仍待做 |
| R-G009 | 2026-11-11 | 零余额不丢盘、spend cap | 平台答复：线上仍可能 force-destroy；代码里的两步停/宽限未部署；无硬上限 | **风险接受**（见 [`08-integration.md`](08-integration.md) §3.2） | 不通过烧余额来验证；只做只读余额/告警检查 |
| R-G010 | 2026-11-11 | 带鉴权的入站访问 | ingress `token` 档恒 403；`public` 档无鉴权；无 per-instance 证书 | **有 workaround**：public ingress + 应用层 DSH launch token/cookie；不暴露产品面板 | 手机审批/远程 UI 的 Rayrun 路径受限 |
| R-G011 | 2026-11-21 | 只读、可撤销的测试 token | 生产 token 是账号身份，无 scope；当前测试 token 无过期时间 | **有 workaround**：专用账号/测试后撤销 | 测试 token 权限过大；不要放进沙箱 |
| R-G012 | 2026-11-11 | 按沙箱的时间序列用量 | `/v1/usage?sandbox_id=` 只有聚合；账本有 itemized；无时间序列 | **有 workaround**：聚合 + 交易分项 | 成本归因只能做区间聚合，不能画实时曲线 |
| R-G013 | 2026-11-21 | 用 Rayrun 镜像做 `FROM` 的自定义构建 | `POST /v1/builds` 不接受 `FROM <rayrun-ref>`（`unsupported_base`） | **有 workaround**：从公共 registry 构建；或从沙箱保存 | 自定义镜像需要从零构建，无法复用官方 rootfs |
| R-G014 | 2026-11-22 | 可用于 `dsh.start` 的 DSH oneshot 测试镜像 | `dsh-bot-devcheck@1`（由 `dsh-bot@1` 复制）的 manifest 是 `prompt_via='argv'`、`argv=['/bin/sh','-c']`；`dsh.start` 把 delegation prompt 当 shell 命令执行，没有 DSH worker，`.dsh/results/<task>/reply.md` 不会产生。直接 `dsh --profile headless` 正常；`deepseek-harness@1` 是 DSH stdin/ndjson。 | **有 workaround**：`dsh.start` 测试用 `deepseek-harness@1`；runtimes/host 测试用 `dsh-bot-devcheck@1`；同时测两者时构建 guestd 0.6.0 + DSH stdin/ndjson 的组合镜像 | devcheck 镜像不能验证 `dsh.start` 的 `reply.md` 契约；host 直接 DSH 路径不受影响 |
| R-G014 | 2026-11-21 | 在 Rayrun 内验证 Linux Electron 桌面开发版 | 无官方 Linux Desktop target；源码构建需要数 GB/较长时间，且仍不能验证官方安装器/更新器 | **未做/不建议**：不把源码开发版当成官方桌面验收 | 若必须做，先作为独立 spike 并记录成本；不替代 D-S1a |

### 3.1 已验证通过（含本机验证；待 Rayrun 复验项见 §4）

> 以下金额、机器数、密码长度是当时读数，会随时间变化，不构成当前状态。
>
> 2026-11-24 按用户明确授权销毁了 dev 测试机：devcheck 的 `rayrun-bot`、
> `rayrun-bot-idle`、`rayrun-bot-scoped`、`rayrun-bot-coldstart`，以及 botclean 的
> `rayrun-bot-clean`；dev 侧现无 bot 测试机。hosted 的 `rayrun-bot-test`、
> `rayrun-bot-fresh-mwu9kgwj`、`rayrun-bot-prod-e2e`（`dsh-bot@1` 生产 E2E）按用户
> 决定保留、未 destroy；`rayrun-bot-prod-e2e` 在 2026-11-25 聊天/时延测试后为
> Running，是否 stop 待用户决定。下文各条记录里的“stop / 未 destroy”描述的是
> 当次测试收尾动作；botclean 租户本身保留。
>
> 2026-11-25 新增并保留（Stopped、未 destroy）：`rayrun-bot-a1-20261125`
> （A1 沙盒）与 `rayrun-bot-a3-20261125`（A3 创建计时）。

- 两个插件的安装、bundle 合成、Bots/云电脑页面渲染、health、跨源 POST 拒绝
  （2026-11-21，Rayrun 沙箱；[`design/desktop-distribution.md`](design/desktop-distribution.md) §5.8）；
- `dsh-rayrun-computer` 检测与 `ok` / `missing` / `incompatible` 状态
  （`test/dependency.mjs`，非 Rayrun）；
- `engines.dsh` 被 DSH 0.2.2-rc.5 的兼容性检查强制执行
  （2026-11-21，本机/CI；desktop-distribution §5.8）；
- DSH `0.2.0-rc.2 → 0.2.2-rc.5` 后 profile 与插件保留
  （2026-11-21，Rayrun 沙箱；desktop-distribution §5.8）；
- 沙箱 stop → start 后 profile 与插件保留——**文件保留，进程不保留**
  （2026-11-21；desktop-distribution §5.8）；
- egress 关闭时用本地 tarball 安装；损坏 tarball 失败且不留半装
  （2026-11-21，Rayrun 沙箱；desktop-distribution §5.8）；
- 插件 remove/re-add 与 bundle 行同步
  （2026-11-21，Rayrun 沙箱；desktop-distribution §5.8）；
- Bots `Open` 负向路径（2026-11-21）：未配置 Rayrun 时云电脑插件的 `overview` 仍返回
  `ok: true` 和 `connection.configured: false`，客户端检查该字段后显示
  `先连接 Rayrun（设置 → 首次设置）`；合成点击触发弹窗拦截时显示
  `允许此页面弹窗，才能打开桌面`。两次都没有调用启动或密码动作，也没有把真实 token
  写进页面或沙箱。
- Bots setup 云电脑步骤负向路径（2026-11-21）：未连接 Rayrun 时进入云电脑步骤，
  `overview` 返回 `connection.configured: false`，界面显示先连接提示，创建按钮不出现，
  `继续` 禁用；没有创建机器，也没有写入任何凭据。
- Bots 未连接状态的界面（2026-11-21）：详情电脑块显示 `未连接`（中性点），聊天底部
  不再显示 `电脑正在重连… 5 秒后重试`；Settings 的 Usage 行调 `overview` 并显示
  `连接 Rayrun 后显示用量。`，不显示样本余额。
- Rayrun 连接成功路径（2026-11-21，本机依赖库 + 测试 token）：`overview` 返回
  `configured: true`、余额 ¥27.44、231.0 机时、3 台非 Terminated 机器（创建测试前）；
  token 只在本机读取，没有进入任何 Rayrun 沙箱、仓库或日志。
- Open 成功路径（2026-11-21，本机依赖库 + `dsh-desktop-build`）：Stopped → Running，
  `machine.desktopRepair` 成功，`desktop_url` GET 返回 200 `text/html`，
  `machine.password` 返回非空 stdout（137 字符，未记录值）；测试后 `stop` 回 Stopped，
  未 destroy。
- 云电脑创建成功路径（2026-11-21，本机依赖库 + 测试 model key）：
  `ensureModelCredential` 成功，`machine.create` 创建 `rayrun-bot-test`（2 vCPU /
  2048 MB / remote desktop），返回 Running，desktop URL 200，password 非空；测试后
  `stop` 回 Stopped，未 destroy。
- Bots 页面层成功路径（2026-11-21，本机 DSH web `0.2.2-rc.5` + Firefox/geckodriver）：
  setup 的 Rayrun 步骤用真实 token 连接成功，显示 `已连接 · 余额 ¥27.44 ·
  4 台云电脑`（创建测试后）；云电脑步骤采用已有 `rayrun-bot-test`（未创建新机器）；
  点击 `打开` 后启动机器、打开 desktop 新窗口，并显示 `桌面密码` 提示条（136 字符，
  截图前已把密码替换为圆点）；测试后机器 `stop` 回 Stopped，未 destroy。DSH 首次运行的
  `Preview Notice` / `Get started` 弹窗需要先点掉，这是 DSH 自己的弹窗，不是 Bots 的。
- Bots 页面层创建按钮成功路径（2026-11-24，本机 DSH web `0.2.2-rc.5` + Firefox/
  geckodriver，Rayrun dev daemon，干净 tenant `botclean`，初始 0 台机器）：进入
  setup 云电脑步骤，点击 `Create cloud computer`（名称 `rayrun-bot-clean`，DeepSeek
  key 留空）→ 依赖 `machine.create` 创建 2C/2G、remote desktop 机器 → 页面显示
  `Created · rayrun-bot-clean` 并改为已有电脑；机器创建后为 Running，测试后 `stop`
  回 Stopped，随后于 2026-11-24 按用户明确授权 destroy。截图
  `/tmp/bot/create-computer.png`（临时文件，不入库）。scoped token 已撤销，临时
  token/base-url 文件和临时 DSH profile 已删除。
- 详情面板真实数据（2026-11-21，同一本机 DSH 页面）：连接后显示 `rayrun-bot-test` /
  `休眠`、`余额 ¥27.42 · 231.3 机时`、底部 `Rayrun 已连接 · ¥27.42`；在 setup 里连接
  后关闭向导，详情无需刷新即更新。登出 Rayrun 后显示 `—` / `未连接`、
  `连接 Rayrun 后显示用量。`、底部 `未连接`。
- Stop 页面层路径（2026-11-21，同一本机 DSH 页面）：Open 后机器 Running、状态 `在线`，
  详情出现 `停止`；确认后 `machine.action stop` → 轮询到 Stopped（界面 `休眠`），
  flash `云电脑已停止。`；测试后机器 Stopped，未 destroy。
- Bots 双语与 DSH locale 联动（2026-11-21，本机 DSH web `0.2.2-rc.5` + Firefox/
  geckodriver）：Bots Settings 选简体中文后 `locale.preference: zh` 写入 profile
  patch，刷新与重启 DSH 后保持；切到 English 后 Bots 文案与 DSH 壳一起变英文，切回
  中文后仍为中文。修复 client half 两处：声明 `inject: ['slots', 'locale']`，并从
  `getLocale().active` 读取活动语言（DSH 快照没有 `.id` 字段）。云电脑插件自己的页面
  仍固定中文，已登记 RC-015。
- Rayrun 公网 ingress 页面（2026-11-21，复用 `dsh-desktop-build`，未新建机器）：沙箱内
  安装 DSH `0.2.2-rc.5` + 两个插件的当前工作树 tarball，`dsh web --host 10.42.0.142
  --port 6080 --trusted-host <ingress-host> --public-url https://<ingress-host>`；
  停掉 `rayrun-desktop` 腾出 6080。带 token 访问 `https://6080-<sandbox-id>.rayrunos.com`
  返回 303 换 cookie，再得到 200 DSH shell，Firefox 渲染 Bots 中文界面。沙箱内不保存
  Rayrun token，因此 Bots 显示“未连接”；验证后只 stop，不 destroy。该入口是 public、
  RCE 级，仅临时使用。
- CI 部署脚本本机实测（2026-11-21，同一沙盒）：运行 `.github/scripts/deploy-rayrun.mjs`
  用真实 Rayrun token 完成 upload → `dsh plugin add` → 重启 `dsh web`；新
  `/workspace/dsh-web-url.txt` mode 600，公网 token URL 303→200。Rayrun API token
  未打印、未进入沙盒；DSH 自己的 launch token 只写入该文件，按凭据处理、不打印。
  首次失败暴露了 `pgrep` 清理模式误杀执行 shell（exit 143）；改为按 6080 监听者
  和精确 `node ... dsh web` 命令行清理后通过。
- DSH launch token 与 cookie（2026-11-21，同一沙盒）：部署前的签名 cookie 对部署后的
  `dsh web` 进程仍返回 200。源码 `dsh-client-connection/src/browser-auth.ts` 确认
  launch token 每个进程随机生成；cookie 签名 secret 存在
  `$DSH_HOME/.credentials.yaml`，默认 30 天、绑定 host:port。因此 token URL 每次
  部署都会变，但同一浏览器不需要重新取 token URL；新浏览器/设备才需要。该 cookie
  签名 secret 位于 `$DSH_HOME/.credentials.yaml`；云端 `DSH_HOME=/workspace/.rayrun/dsh`
  （R-G003），所以它在 workspace 卷上。它是 DSH web auth secret，不是 Rayrun API
  token；仍需按凭据处理，并核实文件权限和 agent 可读性。
- Bots 页面层 roster（2026-11-21，本机 DSH web `0.2.2-rc.5` + Firefox/geckodriver）：
  在样例名册之上新建 `Roster Test` 后，聊天列表切换为真实名册；页面同源 `bots.list`
  返回 `roster-test`；刷新页面后名册仍在、样例未回来；随后用同源 `bots.delete` 清理。
  roster 路径不读 Rayrun token；该测试 profile 里已有连接，页面同时显示余额，但
  roster 操作未做机器调用。这次在本机 DSH 验证；按政策仍应在 Rayrun 沙箱复验（见
  §4）。
- Bots 页面层 session 失败路径（2026-11-22，本机 DSH web `0.2.2-rc.5` +
  Firefox/geckodriver，临时 profile，未安装云电脑依赖）：真实名册 bot 替换预览列表；
  空对话显示真实文案；页面同源 `session.history` 返回 `session: null`；发送后显示
  用户消息与 `E_RUNTIME_UNAVAILABLE` 错误行，working 行消失、composer 恢复可用，失败
  前没有写 session。
- Bots 页面层真实一轮（2026-11-22，本机 DSH web `0.2.2-rc.5` + Firefox/geckodriver，
  独立临时 DSH_HOME，Rayrun token 只经共享 Harness vault，从不打印；两个插件从
  checkout 安装）：health 报 dependency `ok`、runtime `available`；overview 有已有
  机器 `rayrun-bot-test`（开始时 `Stopped`，没有新建机器）；从 Bots 页发送
  `Run the smoke.`，bot 回复 `SMOKE_OK`；`session.history` 为 `idle`，transcript 有
  user+bot；刷新页面后回复仍在。机时读数从 0.1878 增至 0.1914（约 13 秒，读数不是
  承诺）；机器随后由依赖的 idle stop 回到 sleeping。审批未参与。
- Detached 页面关闭 + host 重启（2026-11-22，本机 DSH web `0.2.2-rc.5` +
  Firefox/geckodriver，独立临时 DSH_HOME，两个插件从 checkout 安装，依赖
  `1.1.0` main `720f30a`（未发布 npm）；Rayrun token 只经共享
  Harness vault，从不打印）：health 报
  dependency `ok`、runtime `rayrun-detached`；overview 有已有机器 `rayrun-bot-test`
  （Running，未新建机器）。在 Bots 页创建 `Live Detached` 并发送
  `Run the detached smoke.`；`session.status` 在 `dsh.start` 返回后出现持久化的
  `detached.taskId`，session 为 `running`，本地每 bot git workspace 已建立。随后关闭
  浏览器页面，并在 task 运行期间用 SIGKILL 停掉本地 DSH；用同一 `DSH_HOME` 重启后，
  新 host 从 `session.json` 恢复 poll，收取 `.dsh/results/<taskId>/reply.md`
  （内容 `DETACHED_OK`），session 回到 `idle`，transcript 有 user+bot，刷新页面后
  回复仍在。机时读数从 0.8114 增至 0.8244（约 47 秒，读数不是承诺）。审批未参与。
  同一 host 不重启的连续两轮已在 2026-11-24 的 v0.1 live 验收中另行验证。
- A8 续接（2026-11-22，同一本机 DSH 环境，独立临时 DSH_HOME，依赖 `1.1.0` 的
  main `720f30a`，未发布 npm；Rayrun token 只经共享 Harness vault，
  从不打印）：第一轮发送
  `Remember the word ALPHA. Reply with exactly TURN1_OK.`，bot 回复 `TURN1_OK`，
  session `idle`；随后把 `rayrun-bot-test` 从 Running stop 到 Stopped，关闭页面并
  SIGKILL 本地 DSH；用同一 `DSH_HOME` 重启后，页面仍显示第一轮。发送
  `What word did I ask you to remember? Reply with exactly that word.` 时依赖自动把
  机器从 Stopped 唤醒，bot 回复 `ALPHA`，证明 transcript 上下文跨 host 重启和机器
  stop/start 仍在；`session.history` 为 user,bot,user,bot，session `idle`，刷新后
  两轮仍在。测试后机器 stop 回 Stopped，未 destroy、未新建机器；机时读数从 0.9008
  增至 0.9106（约 35 秒，读数不是承诺）。审批未参与。
- R-G008 runtimes 本机 dev 全量验收（2026-11-22，本地 dev daemon HEAD `648f6c5`，
  `devcheck` 租户，测试机 `rayrun-bot`，镜像 `dsh-bot-devcheck@1`/guestd 0.6.0，
  2 vCPU/2048 MB）：`PUT /v1/sandboxes/{id}/runtimes/bot-runtime-smoke` 后 runtime
  `running`（pid 647）；runtime 内 `DEEPSEEK_API_KEY` 存在，heartbeat 写
  `credential=set`（不打印值）；sandbox stop→start 后 `autostart` 拉起（pid 632，
  restarts=0）；`kill -9` 后新 pid 638、restarts=1；`DELETE` 后 runtimes=0。测试后
  机器 stop，未 destroy。旧镜像负测：`rayrun-bot-old`（`ci@1`，guestd 0.5.0）`GET
  /runtimes` → 200 `{"runtimes":[]}`，`PUT /runtimes/bot-runtime-old-probe` → 409
  `{"error":"guestd_outdated"}`。keep_alive：`rayrun-bot-idle`
  （`idle_timeout_seconds=60`）上 `/bin/sleep 300` runtime（keep_alive=true）等
  150s 后机器仍 Running、runtime running；DELETE 后约 240s 机器自动 Stopped。
  daemon 重启：`rayrun-bot` 上 `daemon-restart-probe`（`/bin/sleep 600`）在 dev
  daemon 2026-11-22 23:28:36 +08:00 重启后仍 running（pid 634、restarts=0），随后
  删除 runtime、stop 机器。测试 token 已撤销、临时 token 文件已清理；两台机器保持
  stop，未 destroy。生产后于 2026-11-24 部署到 `5c2ff48`（build 493）；host 资产已
  进包，projection 页面 E2E 已通过（2026-11-23）。
- 最小 cloud bot host 原型（2026-11-22；E2E 用 `/tmp` 原型，随后固化为随包的 `cloud-host/` 资产；该次 E2E 未走 projection；devcheck + runtimes）：
  Node host 注册为 `bot-host-e2e`，fake agent 依次处理 t1/t2/t3；sandbox stop→start
  后 autostart 新 pid 635；SIGKILL 后新 pid 646、restarts=1；transcript 为
  user,bot,user,bot,user,bot；state heartbeat/`hasCredential=true`；outbox 与日志
  正常；测试后删除 runtime、stop 机器。随后 DSH agent 接入（见下）；host 资产已随包发布。
- 依赖 1.2.0 `runtime.*` + Bots client live 联调（2026-11-22，临时 DSH profile
  `0.2.2-rc.5`，依赖 main `fe965c1`，devcheck scoped token）：
  `rayrun-bot` 从 Stopped 启动；`runtime.list` 空；`runtime.put rpc-live` →
  `applied=true`、running（pid 635）；`runtime.get/list` 正常；`runtime.delete` →
  `deleted=true`、get 为 null；测试后机器 stop，未 destroy；测试 token 已撤销，
  临时 token 文件已删除。说明：依赖的 `settings.baseUrl` 优先于 `RAYRUN_API_URL`，
  临时 profile 覆盖了 `rayrun-cloud.baseUrl` 指向 dev。
- DSH session spike（2026-11-22，dev 机器 `rayrun-bot`，镜像 `dsh-bot-devcheck@1`，
  镜像内 DSH 0.2.0-rc.2；runtime 注入 `deepseek-flash`）：直接
  `dsh --profile headless --json 'Remember the word ALPHA. Reply with exactly RUN1_OK...'`
  返回 `RUN1_OK`，事件 `sessionId=session-25792403-…`；带同一 `--session-id` 的第二个
  headless 进程回答 `ALPHA`。`DEEPSEEK_API_KEY` 在 runtime 内为 set；profile 由
  worker projection 创建在 `/workspace/.rayrun/dsh/profiles/headless`。
- Cloud host + DSH agent（2026-11-22，同一 dev 机器）：host 从 headless 模板创建
  `bot` profile，runtime 内运行 `dsh --profile bot --json`；任务 1 回复 `HOST1_OK`，
  任务 2 用持久化的 session id 回复 `BETA`；transcript/outbox/state 正常，session id
  写入 `host/session-id`。测试后删除 runtime、stop 机器；host 资产已随包发布。
- `dsh.start` 空结果（2026-11-22，devcheck 镜像）：任务完成但 `dsh.result` 返回
  `files: []`，`.dsh/results/<task>/reply.md` 不存在；同 profile 直接 DSH 正常。
  根因是 devcheck 镜像的 oneshot manifest 为 `/bin/sh -c`，不是 DSH；见 R-G014。
- Cloud host adapter 页面 E2E（2026-11-23，本机 DSH 0.2.2-rc.5，依赖 main
  `fe965c1`，Bots `rayrun-cloud-host` adapter + 机器镜像 `dsh-bot-devcheck@1` 的
  `cloud-host/` + DSH）：页面创建 bot 并发送；adapter 启动 `rayrun-bot`、确保
  `bot-host-cloud-host` running（pid 635）、用 `rayrun_files` 投递 inbox；host 内
  DSH 回复 `HOST_E2E_OK`；页面 session `idle`，transcript user+bot。测试后删除
  runtime、stop 机器，未 destroy。该次 E2E 使用手动上传的等价 host 代码。
- 自动 projection 页面 E2E（2026-11-23，同一环境）：adapter 从包内 `cloud-host/`
  上传到 `/workspace/.rayrun/host/0.1.0-alpha.0/`，校验 SHA-256 manifest 后注册
  `bot-host-cloud-host-proj`（running，pid 634）；DSH 回复 `HOST_E2E_OK`；session
  `idle`。测试后 runtime 删除、机器 stop，未 destroy；dev token 已撤销。
- 多 bot 单 host + scoped token/private credential 页面 E2E（2026-11-23，本机 DSH
  `0.2.2-rc.5`，依赖 main `fe965c1`，Bots `0.1.0-alpha.0` 自动 projection，dev）：
  用 scoped token（`/credentials` 只返回私有 `deepseek-flash`，`/tokens` 返回 403
  `insufficient_scope`）显式创建并固定 `rayrun-bot-scoped`
  （`01a20410-12f3-7004-9e7d-5cf7e6563e5b`，`dsh-bot-devcheck@1`，绑定
  `deepseek-flash`）；未让 bot adapter 自动创建机器。页面创建 `multi-a`/`multi-b`
  并同时发送；adapter 只注册一个 `bot-host`（running，pid 636），host 全局串行、
  每 bot 独立 DSH session；回复 `MULTI_A_OK`/`MULTI_B_OK`，host state 中两个
  session id 不同（`session-5a9f7837-…`/`session-5eb77773-…`），queueDepth 0、
  processed 2。测试后 runtime 删除、机器 stop（Stopped，runtimes 空）；scoped token
  已撤销（旧 token 401），临时 token 文件已清理。`rayrun-bot-scoped` 后于
  2026-11-24 按用户明确授权 destroy。
- 本地审批执行页面 E2E（2026-11-23，本机 DSH `0.2.2-rc.5`，依赖 main `fe965c1`，
  Bots `0.1.0-alpha.0`，临时 DSH profile，**无 Rayrun token**）：本地 store 创建两条
  真实 proposal（机器 `box` 的 stop/start）；页面从 `approvals.list` 显示动作、目标
  （`box`）和风险（stop: outside；start: outside+cost）。点击 Deny 后本地 decision 为
  denied，且没有 `exec` 记录；点击 Allow start 后本地 executor 写 `exec-<id>.json`
  claim 并尝试本地 Rayrun RPC，因没有可用连接/机器记录 `failed`（`E_MACHINE_STOPPED`
  路径），页面显示“已批准，但本地执行失败”，不假成功；决定后的真实卡片显示
  Continue bot。截图 `/tmp/bot/approval-ui.png`（临时文件，不入库）。该次未验证真实
  Rayrun 动作、真实
  云端 bot 提案或云端凭据动作；`approvals.propose` 的 host-only 门由
  `test/rpc-contract.mjs` 覆盖，云端 proposal bridge 由
  `test/cloud-approval-bridge.mjs` 用 fake file tool/machine 覆盖（CLI、去重、非法/超限
  提案、停机不唤醒、结果 outbox/补传）。
- 云端 routine scheduler live 尝试（2026-11-24，生产 `api.rayrunos.com` 账号 token，
  本机临时 DSH profile，依赖 checkout `1.2.0`，cloudHost 固定 `rayrun-bot-test`）：
  插件 health 正常（dependency `1.2.0`、runtime `rayrun-cloud-host`、available），
  机器 `Stopped → Running`；但页面 `runtime.list` 返回
  `E_RUNTIMES_UNAVAILABLE` / HTTP 404
  “This Rayrun deployment does not expose the runtimes API”。测试在创建 bot/routine
  前中止；机器已 stop，本次未创建 runtime，token 未打印，临时 DSH profile（含
  vault token）已删除；保留的本地 token 文件未打印、未改动。该结果与当时 R-G008
  的生产部署状态一致：生产环境尚未暴露 runtimes API，cloudHost routine live 验证
  暂时被平台阻塞；后续生产部署和 `dsh-bot@1` 已解阻，见 R-G008 与下文的生产 E2E。
- 云端 routine dev live E2E（2026-11-24，Rayrun dev daemon
  `http://192.168.3.75:8080/v1`，本机 DSH `0.2.2-rc.5`，依赖 checkout `1.2.0`，
  Bots `0.1.0-alpha.0`，机器 `rayrun-bot-scoped`
  （`01a20410-12f3-7004-9e7d-5cf7e6563e5b`，`dsh-bot-devcheck@1`，credential
  `deepseek-flash`），scoped token）：页面连接 dev daemon，启动机器并完成
  `BOOT_OK`；自动 projection 注册 `bot-host`（pid 636，running）。创建每 1 分钟
  routine，镜像 `routines.json` + `bot.json` 到
  `/workspace/.rayrun/bots/cloud-routine-live/`。在 due 前
  `2026-11-23T23:51:26Z` 停止本地 DSH；机器上 host 于
  `2026-11-23T23:52:20.428Z` `routine-enqueued`、`23:52:22.353Z` `task-done`，
  `routine-results/` 中 reply=`CLOUD_ROUTINE_OK`，`routines-state.json` 的
  lastRunAt/nextAt 前进。重启本地 DSH 后 `routines.sync` 导入（页面初始已导入，
  sync duplicate=1），`session.history` 为 boot user/bot + routine user/bot，页面
  显示 `CLOUD_ROUTINE_OK`。截图 `/tmp/bot/cloud-routine-live.png`（临时文件，不入库）。
  测试后 runtime 删除、runtimes=[]、机器 stop（Stopped，未 destroy）；scoped token
  已撤销（token_id `321a872f…`），临时 token/base-url 文件和临时 DSH profile 已
  删除；保留的本地 token 文件未打印、未改动。
- 云端 routine 生产 E2E（2026-11-24，hosted 生产 sandbox，镜像 `dsh-bot@1`）：
  本地 DSH 在 due 前停机；机器上的云 host 于 14:48:16Z 产出
  `CLOUD_ROUTINE_PROD_OK`；重启本地 DSH 后 `routines.sync` imported=1，
  `session.history` 合并 routine user/bot。测试后 runtime 删除、机器 Stopped、
  未 destroy。详见 [`12-status.md`](12-status.md) §3.1。
- hosted 生产 bot host 的模型凭据 slot（2026-11-24）：`dsh-bot@1` 的 manifest
  声明 `DEEPSEEK_API_KEY`，现有 hosted `dsh-model-sinnet`（provider=deepseek）
  映射到该槽位；不需要新建 credential。旧 `rayrun-bot-test` 仍是旧镜像，未用于
  该验证。
- 本地 routines 页面 smoke（2026-11-23，本机 DSH + Firefox，无 Rayrun token）：
  在真实详情面板创建、暂停、删除一条 routine，并确认写入 `routines.json`；未等待
  一次本地 scheduler 自动触发（触发路径由 fake runtime 集成测试覆盖）。截图
  `/tmp/bot/routines-ui.png`（临时文件，不入库）。详见
  [`12-status.md`](12-status.md) §3.1。
- v0.1 失败/续接/恢复 live（2026-11-24，同一 dev daemon / 机器 / scoped token，
  token_id `cd0f5810…`）：无 token 发送时 session `failed`、`E_TOKEN_REQUIRED`，
  无 bot 回复；保存 token 后下一轮 `RECOVERED_OK`。同轮修复
  `cloud-host-runtime.ensureMachine` 先检查 `connection.configured`，避免把缺
  token 误报成 `E_MACHINE_STOPPED`；`test/cloud-host-runtime.mjs` 15/15。随后同一
  host 连续两轮：`bot-host` pid 635、DSH session `session-5aa1302e-…` 不变，
  `TURN1_OK` → `ALPHA`。删除 `bot-host` 并重启本地 DSH 后，下一轮自动重建 host
  （pid 704），DSH session 仍为 `session-5aa1302e-…`，`RECOVERY_TURN` → `ALPHA`；
  本地 history 共 10 条。截图 `/tmp/bot/cloud-v01-no-token.png`、
  `cloud-v01-continuity.png`、`cloud-v01-recovery.png`（临时文件，不入库）。测试后
  runtime 删除、runtimes=[]、机器 Stopped、未 destroy；scoped token 已撤销，
  临时 token/base-url 文件和临时 DSH profile 已删除。
- Host runtime self-heal live（2026-11-24，同一 dev daemon / 机器，scoped token
  `cf781230…`）：本地 DSH **不重启**，删除机器上的 `bot-host` runtime；下一轮
  `cloudHostRuntime.start` 重新执行 ensureMachine/ensureHost，自动重建 host
  （pid 636 → 668），DSH session `session-ea68cea7-…` 不变，`TURN1_OK` → `BETA`；
  本地 history 4 条。截图 `/tmp/bot/cloud-v01-heal.png`（临时文件，不入库）。测试后
  runtime 删除、runtimes=[]、机器 Stopped、未 destroy；token 已撤销，临时文件和
  DSH profile 已删除。
- v0.1 队列 + 本地 DSH 崩溃恢复 live（2026-11-24，同一 dev daemon / 机器 / scoped
  token `8b7d8648…`）：一次连发三条消息，session `queued`、第一条 detached
  `task-1c40a327-…` 运行、pending 2；随后 SIGKILL 本地 DSH（约 00:14:52Z）。
  本地停机期间云 host 于 00:14:52.626Z 写出 Q1 outbox（`Q1_OK`），云端 DSH
  session `session-fb87719f-…` 已建立。重启同一 `DSH_HOME` 后恢复 poll 按序
  排空（当次由页面 RPC 触发；同轮修复为 host 挂载即恢复）：本地 session id
  `f4cee1c7-…` 不变、`bot-host` pid 635 不变、云端 DSH session 不变；最终
  `idle`、pending 0、history 6 条（3 user + 3 bot，bot 回复依次
  `Q1_OK`/`Q2_OK`/`Q3_OK`），无重复、无丢失。截图
  `/tmp/bot/cloud-v01-queue.png`（临时文件，不入库）。测试后 runtime 删除、
  runtimes=[]、机器 Stopped、未 destroy；scoped token 已撤销，临时 token/
  base-url 文件、临时 DSH profile 和脚本已删除。
- Host 挂载即恢复 detached task live（2026-11-24，Rayrun dev daemon，依赖
  `1.2.0`，机器 `rayrun-bot-scoped`，scoped token `7b8fb8bd…`）：直连 host RPC
  （不经页面）创建 bot 并连发两条消息，第一条 detached `task-53a45eeb-…` 运行、
  pending 1；随后 SIGKILL 本地 DSH（约 00:26:12Z）。本地停机期间云 host 于
  00:26:14.170Z 写出 Q1 outbox（`E1_OK`），云端 DSH session
  `session-e716fe55-…` 已建立。重启同一 `DSH_HOME` 后**不打开页面、不发任何
  HTTP RPC**，只轮询本地状态文件：session 自动从 `queued` 排空到 `idle`，
  transcript 4 条（2 user + `E1_OK`/`E2_OK`），`bot-host` pid 636 与云端 DSH
  session 均不变。`test/rpc-contract.mjs` 新增 fake detached runtime 的同类用例
  （无页面 RPC 恢复并收取），32/32。另做无 token 本地冒烟：启动宿主 6 秒内
  session 以 `E_TOKEN_REQUIRED` 失败关闭（修复前为 `E_INTERNAL`）。测试后
  runtime 删除、runtimes=[]、机器 Stopped、
  未 destroy；临时 DSH profile 和脚本已删除；scoped token 已撤销，临时 token
  文件已删除。
- Detached 冷启动 dev live（2026-11-24，Rayrun dev daemon，依赖 main `5259782`，
  机器 `rayrun-bot-coldstart` / `deepseek-harness@1`，credential `deepseek-flash`，
  dev token `02e0a54e…`）：机器先 stop 到 Stopped；直连 host RPC 创建 bot 并发送
  `COLDSTART`；首轮 `dsh.start` 唤醒机器并成功，session `running` → `idle`，
  bot 回复 `COLD_OK`，约 13 秒完成。测试后机器 stop；用户授权后于 2026-11-24
  10:17:17Z destroy（HTTP 204）。临时 DSH profile 和脚本已删除；token 已撤销，
  临时 token 文件已删除。依赖侧随后确认：
  hosted 上的 `worker_files_unavailable` 是其 live 测试脚本的 fetch mock 误拦截
  `.../node_modules/dsh-rayrun-computer/...` file PUT；请求未到 nginx。修正已合入
  依赖 main `956d595`（CI Node 22/24 全绿），`worker_files_unavailable` 已移除；
  修复已随 npm `1.2.1` 发布。收窄 mock 后 hosted `rayrun-bot-test` 冷启动 8.8 秒成功
  （`REAL_FIX_OK`）。adapter 和平台正常，不需要 cold-start retry。
- 真实 cloud proposal 闭环（2026-11-23，本机 DSH `0.2.2-rc.5`，依赖 main
  `fe965c1`，Bots `0.1.0-alpha.0`，`rayrun-bot-scoped`，私有 `deepseek-flash`）：
  真实云 bot 在回复末尾输出结构化 `rayrun-approval` block；cloud host 解析并写
  `bots/live-approval-4/proposals/prop-c21d33f4-….json`；本地 `approvals.sync`
  通过 `rayrun_files` 导入，页面 Allow 后本地 executor 真实执行
  `rayrun.machine.stop`，机器到 Stopped；停机时结果落本地 `approval-results/` outbox；
  机器 start 后再次 sync，`flushed=1`，云端
  `bots/live-approval-4/approval-results/prop-c21d33f4-….json` 为
  approved/done（machine stop, status Stopped）。测试后 runtime 删除、机器 stop
  （Stopped，runtimes 空），未 destroy；scoped token 已撤销、临时 token 文件已清理；
  截图 `/tmp/bot/approval-live.png`（临时文件，不入库）。同轮修复：host 的 bot
  profile patch 模板含注释时旧逻辑不写入，DSH 仍用 `workspace-write`；现在按有效行
  判断，`test/cloud-host-dsh-agent.mjs` 覆盖带注释模板。`propose.mjs` shell 路径
  未做 live 验证；结构化 block 是主路径。
- start 审批 + 下一轮结果 context（2026-11-23，同一 `rayrun-bot-scoped`）：真实云 bot
  输出 `rayrun.machine.start` 的结构化 block；本地 sync 导入，页面 Allow 后本地
  executor 真实执行 start（幂等，结果 done/Running），云端 `approval-results/` 为
  approved/done（machine start, status Running）。随后一条普通用户消息触发下一轮，
  prompt 自动带 `Recent approval outcomes: rayrun.machine.start on rayrun-bot-scoped:
  approved; execution done (Running)`；bot 未调用工具，直接回答 approved / execution
  completed / Running。测试后 runtime 删除、机器 stop，未 destroy；scoped token 已
  撤销。截图 `/tmp/bot/approval-start-context.png`（临时文件，不入库）。
- denial + Continue（2026-11-23，同一 `rayrun-bot-scoped`）：真实云 bot 提案
  `rayrun.machine.stop`；页面 Deny，机器保持 Running，无 exec claim，云端
  `approval-results/` 为 denied/not_executed。点击真实卡片的 Continue bot 后，下一轮
  bot 从 `Recent approval outcomes` 回答 denied / 未停止 / 仍 Running，未调用工具。
  测试后 runtime 删除、机器 stop，未 destroy；scoped token 已撤销。截图
  `/tmp/bot/approval-denial-continue.png`（临时文件，不入库）。
- pause/resume（2026-11-23，同一 `rayrun-bot-scoped`）：bot 提案 machine.pause →
  本地 Allow → 机器 Paused；结果先落本地 outbox；手动 resume 后 sync 补传
  （flushed=1），云端 pause 结果为 approved/done（Paused）。随后 bot 再提案
  machine.resume → Allow → done/Running，云端结果 approved/done。测试后 runtime
  删除、机器 stop，未 destroy；scoped token 已撤销。截图
  `/tmp/bot/approval-pause-resume.png`（临时文件，不入库）。
- 干净 npm 安装 golden path（2026-11-25，本机 DSH `0.2.2-rc.5`，官方 registry）：
  新建临时 `DSH_HOME`，先加 web-app，再用一条
  `dsh plugin add dsh-rayrun-computer@1.2.1 dsh-rayrun-bots@0.1.1-alpha.1` 安装；
  `package.json` 中两个 bundle 都被选中，安装版本为 `0.1.1-alpha.1`，安装文件含
  `HOST_READY_ATTEMPTS`，未手工替换。health 返回 `version=0.1.1-alpha.1`、依赖
  `1.2.1` status ok、runtime available。对 Stopped 的 `rayrun-bot-prod-e2e`
  （`01a20dfd…`，`dsh-bot@1`）发送 `GOLDEN…`：session `running → idle`，约 10.0
  秒，transcript 为 user + bot `GOLDEN_OK`，`bot-host` runtime running pid 635。
  测试后 runtime 删除、runtimes=[]、机器 Stopped、未 destroy；临时 profile 和
  token 文件删除，路由恢复走 VPN。此前同路径用 alpha.1 之前的 `0.1.1-alpha`
  tarball 复现了 stale `stopped` 冷启动失败（约 3 秒 `E_RUNTIME_UNAVAILABLE`），
  手工替换 `lib/cloud-host-runtime.js` 后才通过；alpha.1 是修复后的正式发布产物。
- 生产多 bot 单 host（2026-11-25，同一 clean alpha.1 安装）：`rayrun-bot-prod-e2e`
  从 Stopped 启动，两个 bot 并发发送；session 均为 `running → idle`，约 14.1 秒，
  transcript 分别为 user + bot `MULTI_A_OK` / `MULTI_B_OK`；`runtime.list` 只有一个
  `bot-host`（running，pid 636）。测试后 bot 删除、runtime 删除、机器 Stopped、
  未 destroy。
- 干净 npm 安装的浏览器与审批（2026-11-25，同一 clean alpha.1 安装，本机 Firefox
  + geckodriver 0.37.1，headless）：在真实 Bots 页面通过 New bot 表单创建
  `Browser Golden`，发送后页面和 transcript 都得到 `BROWSER_OK`，session `idle`。
  云 bot 提出 `rayrun.machine.pause`：审批卡 pending；Deny 后卡片显示
  `Denied. Nothing was executed.`，机器保持 Running；另一次提案点击 Allow once，
  卡片显示 `Approved and executed on your local side.`，本地 executor 执行 pause，
  机器 Paused、execution `done`。测试后机器 resume → Stopped、runtime 删除、bot
  删除；截图 `/tmp/bot/browser-golden.png`、`browser-approval-pending.png`、
  `browser-approval-denied.png`、`browser-approval-allow-pending.png`、
  `browser-approval-allowed.png`（临时文件，不入库）。
- A1 沙盒干净安装（2026-11-25，Rayrun 在线 sandbox `rayrun-bot-a1-20261125`
  （`01a21329…`），镜像 `deepseek-harness@1`，2 vCPU / 4 GB）：在线 API 直连；
  通过 `PUT /v1/sandboxes/{id}/egress` 放行 `registry.npmjs.org`。沙盒内 Node
  24.22.0、DSH 0.2.0-rc.2，corepack 准备 pnpm 10.20.0。全新 `DSH_HOME` + 全新
  pnpm store/cache，一条
  `dsh plugin --profile web add dsh-rayrun-computer@1.2.1 dsh-rayrun-bots@0.1.1-alpha.1`
  安装 7.38 秒；`dsh web` 启动到 URL ready 2.56 秒；从安装开始到 Bots 与云电脑
  两页都渲染 20.04 秒。Bots 根节点 `#rayrun-bots-root`、云电脑 `.rr-root` 均出现；
  截图 `/tmp/bot/a1-sandbox-bots.png`、`a1-sandbox-cloud.png`（临时文件，不入库）。
  只安装 bots 包时 health 返回 `ready:false`、`dependency.status:"missing"`、
  `code:"E_DEP_MISSING"`、`runtime.available:false`。测试后 stop sandbox、未
  destroy；沙盒内 DSH launch-token 日志/URL/cookie 已删除。
- A2 无 token 与 vault 存储（2026-11-25）：在 A1 沙盒（无 Rayrun token）里，
  云电脑插件 `connection.status` 返回 `configured:false`、`tokenSource:null`，
  `account` 返回 `token_required`（HTTP 400），`overview` 仍为 `ok:true` 但
  `connection.configured:false`。本机临时 DSH profile 通过同源 RPC
  `connection.save` 把在线 token 存入 Harness vault：返回 `configured:true`、
  `tokenSource:"credentials"`；`connection.save { clearToken:true }` 后
  `configured:false`，`account` 再返回 `token_required`。token 未打印、未进沙盒、
  未进仓库；临时 profile 已删除。DeepSeek key 作为 Rayrun credential 的正向路径
  沿用 2026-11-21 的 setup 验证，本次未新建 credential。
- A3 连接、用量与创建（2026-11-25）：本机临时 DSH profile 通过一个仅监听
  localhost 的反向代理访问在线 API；代理用 `curl --interface wlp4s0` 绕过 VPN
  路由，Rayrun token 只存在本机 DSH vault，未进沙盒/仓库/日志。`connection.save`
  后 `overview` 返回 `configured:true`、4 台机器（含 Stopped 的
  `rayrun-bot-prod-e2e` 与 A1 沙盒）、余额 CNY 22.35、机时 256.16、默认 2 vCPU /
  2048 MB / remote_desktop true；`account` 返回 owner 角色和同一余额/用量。
  随后通过同一 RPC `machine.create`（页面创建按钮走同一路径）创建
  `rayrun-bot-a3-20261125`（2 vCPU / 2048 MB / remote desktop true，无
  credentials），从请求开始到 `Running` 为 **4.30 秒**（≤15 秒）；`machine.action
  stop` 后 `Stopped`、未 destroy。机器保留为 Stopped。`clearToken` 后恢复
  `configured:false`。读数不是承诺。代理是临时测试 harness，不在仓库中。
- A4 创建 bot 与对话（2026-11-25）：本机临时 profile 启用 `cloudHost`（固定
  `rayrun-bot-prod-e2e`，credentials `['dsh-model-sinnet']`）并通过 localhost
  反向代理访问在线 API。`bots.create` 创建 `A4 Cloud Bot`（id `a4-cloud-bot`，
  label `verification bot`，instructions “Reply with exactly A4_OK. Do not use
  tools.”）；`session.send` 后 session `queued → running → idle`，机器
  `Stopped → Running`，约 16 秒收到 `A4_OK`，transcript 为 user + bot。Bots 页面
  聊天列表显示该 bot，最终回复可见；截图 `/tmp/bot/a4-bot-chat.png`（临时文件，
  不入库）；未逐 token 验证流式呈现。机器上
  `/workspace/.rayrun/bots/a4-cloud-bot/` 存在，含 `host/session-id`、`inbox/`、
  `processing/`、`done/task-*.json`、`outbox/task-*.json`、`transcript.jsonl`
  （内容含 bot 名称/instructions 和 `A4_OK`），作为 `rayrun_files` 证据。观察到
  详情面板电脑块显示 `dsh-ci-deploy-2`，而 runtime spec 的 `DSH_BOT_MACHINE` 为
  `rayrun-bot-prod-e2e`；执行使用的是后者（该显示问题已于 2026-11-26 修复，见
  Phase 2 机器真相）。测试后删除 `bot-host` runtime（204）、
  移除机器上的测试目录、机器 stop、未 destroy；本地 proxy/DSH/geckodriver 停止，
  临时 profile 删除，token 和 baseUrl 清除。
- 聊天热轮次时延（2026-11-25）：同一 `rayrun-bot-prod-e2e` + cloudHost 的
  连续 `PING` 测试，3 秒 outbox 轮询时热轮次 **7.32 秒**；在 checkout working
  tree 中把默认 `detachedPollMs` 改为 1000ms（npm `0.1.1-alpha.1` 仍是 3 秒）
  后，同一热机器下一轮 **4.64 秒**。host 日志
  分解：本地发送→host 取任务约 1.9 秒，模型约 2.2 秒，本地收取约 1 秒；首轮
  还包含 host 冷启动（约 3.8 秒）和机器上遗留 `prod-routine` 抢先执行（约
  3.4 秒），合计约 **13.8 秒**。`session-runtime.mjs` 18/18。机器上其他测试
  bot 未删除；`latency-bot` 已删除。
- UX trust pass Phase 1（2026-11-26，本机 DSH + Firefox）：默认空名册渲染
  `No bots yet` 与 `Set up Rayrun Bot`，不显示 Nora/Eli/June；`?preview=1` 显示
  Demo 横幅、`Demo` 徽标和逐条 `Sample` 标签，示例的审批/金额/日程已移除；
  `notice.cloud`、`user.you`、`setup.open` 生效；`setup.botBody`、
  `settings.pluginHint` 版本和页脚用户名修正。页面 smoke 通过；机器真相已在
  Phase 2 修复；审批卡健壮性已在 Phase 3 修复；死控件清理已在 Phase 4 修复。
- UX trust pass Phase 2 机器真相（2026-11-26，本机 DSH + Firefox）：session
  `session.json` 持久化实际机器名 `computer`，host `bots.list` 返回
  `computers[botId]`；客户端按名字在云电脑 overview 中查找机器。页面 smoke 用
  隔离 `DSH_HOME` 和当前 checkout 启动 `dsh web`，seed 两个 bot 的 session 分别
  带 `computer: alpha-box` / `beta-box`，但没有 Rayrun 连接（overview 不可用）。
  选择 Alpha 时详情显示 `alpha-box`，选择 Beta 后切到 `beta-box`；两次打开/接管
  均为 disabled，页面未再显示列表第一台机器。截图
  `/tmp/bot/machine-truth.png`（临时文件）。`session-runtime`、`rpc-contract`
  （`bots.list.computers[botId] === 'box'`）、`client-contract`（`machineFor`、
  `body.computers`、`disabled: !available`）覆盖数据契约；A4 的
  `dsh-ci-deploy-2` 错机显示由此修复。
- UX trust pass Phase 3 审批卡（2026-11-26，本机 DSH + Firefox）：隔离
  `DSH_HOME` 启动当前 checkout，seed 一个真实 bot 的 `approvals/req-*.json`（kind
  `rayrun.machine.stop/start/resume/pause`，machine `smoke-box`）和另一个 bot 的
  session/transcript（含 `[[rayrun-approval-parse-error]]`）。页面显示四种动作级
  风险文案：stop“停止你的电脑；正在运行的工作会停止。”、pause“暂停你的电脑；
  正在运行的工作会暂停。”、start/resume“启动/恢复你的电脑；运行期间消耗机时。”；
  pending 卡有 Deny/Allow once。点击 Deny 后卡片 `data-state=denied`，只保留
  “让 bot 继续”，没有其他 CTA。解析失败 bot 的线程显示“I can stop it. bot 的
  审批请求无法解析，未执行任何动作。”，raw marker 与英文 fallback 均未出现。
  parser 测试 6/6（含自然语言包裹的无效 block）；截图
  `/tmp/bot/approval-phase3.png`、`/tmp/bot/approval-risk-copy.png`（临时文件）。
  真实模型自然语言验收（2026-11-26，临时 profile + cloudHost，pin
  `rayrun-bot-prod-e2e`，credential `dsh-model-sinnet`，localhost 代理且 token 只在
  本机 DSH vault）：发送自然语言 “Please stop the cloud computer to save machine
  time.”，bot 回复 “Stopping the cloud computer requires your approval, so this
  request is now waiting for approval.”，`approvals.sync` imported=1，pending
  proposal 为 `rayrun.machine.stop` on `rayrun-bot-prod-e2e`；Deny 后
  `state=denied`、`execution=not_executed`，机器仍 Running。测试后删除本地 bot 和
  机器 `.rayrun/bots/nl-approval-bot/`，未 stop/destroy 机器；临时 profile、代理、
  DSH 和 cookie 已清理。
- UX trust pass Phase 4 死控件与状态（2026-11-26，本机 DSH + Firefox）：隔离
  `DSH_HOME` 启动当前 checkout，seed 一个真实 bot 详情和一个带
  `E_MACHINE_STOPPED` system message 的 session。真实 bot 详情只有 Activity
  区块，`Take over`、Library 标签、Recent 区块均不出现；错误行先显示“云电脑已停止
  或不可用…”再以小字显示 `E_MACHINE_STOPPED`；设置导航只剩账号/用量/外观，页面
  不含未持久化的 idle stop 与通知开关。截图 `/tmp/bot/phase4-cleanup.png`
  （临时文件）。`client-contract` 覆盖 `showLibrary/showRecent`、错误文案映射、
  `E_TURN_POLL_TIMEOUT`、费率字段和已删除控件；全量测试 27/27。另一个隔离 profile
  用本地 fake Rayrun API 返回 Running machine（`pricing.vm_cents_per_hour: 8`、
  `usage.vm_hours: 12.3`）和过期 background approval；页面显示“正在运行 ·
  ¥0.08/小时 · 累计 12.3 机时”，过期卡提示机器可能仍在运行并给出“停止电脑”，
  点击后出现“停止云电脑？正在运行的工作会停止。”及停止/取消，未确认执行；截图
  `/tmp/bot/phase4-running.png`（临时文件）。fake API 只在本机，token 是占位值。
  Rayrun API 不提供 running since，未实现该字段。
- UX trust pass Phase 5 golden path（2026-11-26，本机 DSH + Firefox，临时 profile +
  cloudHost pin `rayrun-bot-prod-e2e`，localhost 代理且真实 token 只在本机 DSH
  vault）：干净名册 → `Set up Rayrun Bot` → dependency 步骤 → Rayrun 步骤（connection
  已由 RPC 预配置，页面点 Skip；未在页面粘贴 token）→ 云电脑步骤（默认选中
  Running 的 `rayrun-bot-prod-e2e`）→ 创建第一个 bot `Golden Path Bot` → 自然语言
  请求 → bot 回复等待审批 → pending stop 卡 → 页面 Deny → `denied` + `Continue bot`。
  机器保持 Running；随后删除本地 bot 和机器 `.rayrun/bots/golden-path-bot/`，临时
  profile、代理、DSH、cookie 已清理。截图 `/tmp/bot/phase5-golden.png`（临时文件）。
  与完整手工路径的差异是 token 步骤未在页面输入；另修 `pickMachine` 优先 Running
  机器（避免默认选 Stopped 的 A3 机器），`client-contract` 覆盖。全量测试 27/27。
- 更新提示（2026-11-26，本机 DSH + Firefox）：Settings → 更新 是用户点击触发的只读
  检查；host `update.check` 固定读取
  `https://registry.npmjs.org/-/package/dsh-rayrun-bots/dist-tags`，不携带
  Authorization，校验 HTTP、JSON、响应大小和 semver 后返回当前/最新版本与可复制
  命令。`update-check.mjs` 6/6；`rpc-contract` 33/33（含同源门、无 Authorization、
  command）；全量 28/28；真实 npm 查询 `alpha=0.1.1-alpha.1` 显示已是最新。页面 smoke 用 mock
  响应显示“有新版本 0.1.1-alpha.2”和命令，截图 `/tmp/bot/update-check.png`
  （临时文件）。未下载、未安装、未改 profile；自动安装和云端 host runtime 自动
  刷新仍未做。
- Issue #4 镜像 oneshot（2026-11-26，代码/测试）：detached adapter 在 `dsh.start`
  前检查 `machine.agent`；`dsh-bot@1` / `dsh-bot-devcheck@1` 返回
  `E_IMAGE_UNSUPPORTED` 且不发出 `dsh.start`；未知镜像继续；结束后缺 `reply.md`
  返回 `E_WORKER_NO_REPLY`，不再混成 `E_INTERNAL`。`rayrun-detached-runtime` 7/7
  覆盖预检、未知镜像放行和缺失回复；`client-contract` 覆盖客户端错误映射与 Setup
  默认镜像；`session` poll 对两个码不重试。另用本机 fake Rayrun API 返回
  `agent: dsh-bot@1` 的 Running machine：发送后第一次轮询即 `failed`，system
  message code `E_IMAGE_UNSUPPORTED`；fake API 只收到 overview 的
  `/v1/sandboxes`、`/v1/agents`、余额和用量查询，没有 `dsh.start` 或 sandbox
  动作。未在用户 Windows 环境复现（同一 `machine.agent`/`reply.md` 路径已覆盖），
  真实机器验证仍需用户环境。
- Issue #4 复验缺口（2026-11-26，代码/测试）：本机把 bots 链到 `b346e7cd` 后，
  同一台 `rayrun-bot-a3-20261125` 仍创建了 task，并以 `E_WORKER_NO_REPLY` 失败；
  `bot.json` 和 task manifest 没有镜像字段，预检看不到空的 `machine.agent`。
  补上的行为：overview 的 `agent` 为空时调用只读 `machine.get`；仍然为空且
  session 没有这台电脑的已记录镜像时，`E_IMAGE_UNSUPPORTED` 且不调用
  `dsh.start`。已知镜像写入 `session.json` 的 `image`。`rayrun-detached-runtime`
  覆盖 oneshot、空白读取、`machine.get` 补全、记住的 oneshot 拒绝，以及不同
  电脑的记住镜像不能放行；`session-runtime` 覆盖 image 在回复后保留，以及拒绝
  后的 image/computer 会交给下一轮 precheck。不 stop、不 destroy、不自动换镜像。
  未在用户 Windows 环境复验。
- Issue #6 缺失凭据（2026-11-26，只读线上证据）：`rayrun-bot-a3-20261125`
  `status=Running`、`agent_state=exited/failure`、`credentials=[]`；worker 的
  DSH session（`session-91b462fa…`）记录
  `MISSING_CREDENTIAL: no API key for provider route "deepseek-official"`。任务不是
  沙盒休眠；`dsh.start` 已调用 `ray.wake`。已把 `E_WORKER_NO_REPLY` 文案改为检查
  worker session 的 provider 错误并提示添加 DeepSeek 凭据/重建电脑，Setup 明确新
  机器需要凭据；不新增自动唤醒。`rayrun-detached-runtime` 和 `client-contract`
  覆盖新文案。真实凭据补齐仍需用户操作或重建机器。
- 电脑更新（2026-11-26，fake/UI）：`computer-update.mjs` 6/6 覆盖成功编排、
  缺确认/缺镜像/缺凭据失败关闭、解包失败和创建失败的回滚；`rpc-contract` 34/34 覆盖
  `computer.update` 必须显式确认。Settings 页面 smoke 显示共用电脑、当前镜像、
  镜像/凭据选择、计费/保留路径/不 destroy 文案，截图
  `/tmp/bot/computer-update-ui.png`（临时文件）。真实 Rayrun 基础迁移已通过
  （2026-11-26）：`bot-update-smoke-20261126`（`deepseek-harness@1`，无 credential，
  `/workspace/update-smoke.txt` 内容 `UPDATE_SMOKE_OK`）经 host `computer.update`
  换机，新机仍用原名、镜像 `deepseek-harness@1`、credential `dsh-model-sinnet`，
  文件与 `/workspace/.dsh` 均存在；旧机改名为
  `bot-update-smoke-20261126-pre-update-mwxk96k8` 并 Stopped，新机验证后也
  Stopped，两者都未 destroy。大 workspace、登录配置实际内容（本次旧机没有浏览器
  登录数据）和其他 egress 规则仍未验收；新机显式放行 `api.deepseek.com`，旧机的
  其他 egress 规则不复制，更新后需确认其他网络依赖。
- CI deploy egress 根因（2026-11-25）：`.github/scripts/deploy-rayrun.mjs` 创建
  沙盒时用了不在 Rayrun 创建 schema 中的 `egress_allow`；该字段被忽略，导致
  pnpm 下载 `ENOTFOUND`。在线沙盒验证 `PUT /v1/sandboxes/{id}/egress` 后同一
  沙盒内 `registry.npmjs.org` 可解析、pnpm 可安装；脚本已改为
  `egress: { allow: ['registry.npmjs.org'] }`，契约测试改为拒绝 `egress_allow`。
  deploy job 仍为 `if: false`，待完整 deploy 跑通后再恢复；`dsh-ci-deploy-2`
  在 2026-11-25 查询时为 Running，2026-11-26 查询为 Stopped、未 destroy。
- CI deploy sandbox 尝试（2026-11-25，GitHub Actions）：run `45626382460` 创建
  `dsh-ci-deploy`，startup/upload/stop 成功，但镜像无 pnpm；run `45628656084`
  创建带 `egress_allow: ['registry.npmjs.org']` 的 `dsh-ci-deploy-2`，pnpm 下载仍
  `ENOTFOUND`。两次 sandbox 均 Stopped、未 destroy。deploy job 随后改为
  `if: false` 暂时停用；run `45629800138` 的 checks 全绿、deploy skipped。
- 打包产物安装（2026-11-22，本机 DSH `0.2.2-rc.5`；本地打包检查）：`npm pack` 生成
  15 个文件的 tarball（host/client、locale、`lib/*.js`、bundle patch、icon、README、
  LICENSE；54.6 kB），`test/`、`docs/`、`tools/` 未进入；`dsh plugin --profile
  ci-pack add <tgz>` 成功，`--dump-config` 合成 `- id: rayrun-bots` / `name:
  dsh-rayrun-bots`。

> Rayrun 连接、Open、云电脑创建三条依赖层路径是通过本机 Node 直接 import
> `dsh-rayrun-computer@1.0.0` 的 `lib/rayrun.js` 验证的，调用的是插件页面使用的同一组
> 函数；Bots 页面层 setup/Open 与 roster 是在本机 DSH web 页面里用
> Firefox/geckodriver 验证的。复现：从 1.0.0 tarball 解包，`createRayrun({ token })`，
> 按 `overview` → `machineAction` → `machine` → `repairDesktop` → `desktopPassword`
> 调用；创建用 `ensureModelCredential` → `createMachine`。页面层用
> `@deepseek-ai/dsh@0.2.2-rc.5`（npmmirror）+ 两个插件安装到临时 profile，token 只经
> 同源 RPC 写入本机 DSH vault。所有 key 只在本机读取，不打印，不上传沙箱。页面层的
> 创建按钮另在干净 dev tenant 上验证（2026-11-24，见 §3.1）。

---

## 4. 仍未验证的清单

- 官方 DSH 桌面安装器、更新器、卸载、再分发条款、analytics（R-G001）；
- `profiles/desktop` 的创建、插件写入和 Electron 启动；
- 在 Rayrun 云端沙箱内放真实 token 并直接操作云电脑（出于安全刻意不做；依赖库验证
  在本机进行，token 未进入沙箱）；
- 在 Rayrun 沙箱内复验 roster 页面路径（本机 DSH 已完成；roster 不需要真实 token，
  应可在沙箱内复现）；
- 核实 `$DSH_HOME/.credentials.yaml`（DSH web auth secret）在云端 workspace 上的文件
  权限和 agent 可读性；若 root agent 可读，记录残余风险并评估是否应移到 host-only
  位置；
- A11 本地 workspace 扫描发现 `tmp/` 下有未跟踪的本地 key 文件（`dp-code.key`、
  `rayrun-dev.key`）。它们被 `.gitignore` 忽略，且未进入 git 历史或 npm 包，但仍
  留在工作区；需轮换并移出/删除后才能声称 A11 通过。扫描未打印值；
- bot 会话、审批往返、远程审批、队列与恢复：R-G008 已部署生产，hosted cloudHost
  聊天 E2E 已通过（`PROD_OK`，2026-11-24）；生产 routine E2E 已通过（`CLOUD_ROUTINE_PROD_OK`，2026-11-24）。bot 侧常驻
  host 已有 dev 预览（多 bot 单 host E2E 通过）；本地 typed 审批执行已通过拒绝/
  失败关闭的页面 E2E、真实 cloud proposal + start/stop/pause/resume、denial/Continue
  和下一轮结果 context 已 live；云端凭据动作仍未验证，仍等待平台隔离（ADR-001，
  [`08-integration.md`](08-integration.md) §3.3）。
  本地 session store、`session.*` RPC、`rayrun_agent`/detached adapter 已有 fake
  测试；页面层真实一轮、detached 的页面关闭 + host 重启收取、同一 host 连续两轮、
  无 token 失败恢复、runtime 重建，以及三条消息排队 + 本地 DSH 崩溃恢复已在
  Rayrun dev/test 验证（§3.1）；host 挂载即恢复 detached task 已有 fake 测试，并
  在无页面的 live 验证中自动排空队列（§3.1）；
- 零余额宽限/force-destroy 行为（R-G009，不做破坏性验证）；
- 在 Rayrun 上构建自定义 Dockerfile 镜像（R-G013）。

---

## 5. 记录规则

- 新缺口用下一个 `R-Gxxx` 编号；写日期、需要什么、Rayrun 现状/证据、workaround、
  影响和下一步。
- 只记录**验证/测试环境**的缺口；平台能力需求只在
  [`08-integration.md`](08-integration.md) 登记。这里可以用 R-G 记录验证受阻状态、
  简短证据和链接，但不要复述需求或优先级。
- 缺口解决后把状态改为 `已满足` 并保留日期；不要删除历史行。
- 任何“已通过”的结论必须有证据（命令输出、截图、health 响应、测试结果），
  不能只写“应该可以”。

---

## 6. 相关文档

- [`08-integration.md`](08-integration.md)
- [`09-deployment.md`](09-deployment.md)
- [`11-dsh-rayrun-computer-issues.md`](11-dsh-rayrun-computer-issues.md)
- [`version-matrix.md`](version-matrix.md)
- [`05-approvals.md`](05-approvals.md) 与 [ADR-001](adr/architecture-decisions.md#adr-001)
- [`design/desktop-distribution.md`](design/desktop-distribution.md) §5.8
- [`plans/mvp-plan.md`](plans/mvp-plan.md) §7
- [`12-status.md`](12-status.md)
