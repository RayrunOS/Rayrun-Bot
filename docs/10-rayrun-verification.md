# 10 — 验证、测试与 Rayrun 缺口

> 状态：2026-11-22。本文是**验证/测试资源政策**和 **Rayrun 缺口登记册**。
> 所有需要计算资源的验证与测试都走 Rayrun（真实 token 页面例外见 §2.6）；Rayrun 不满足
> 的项记在这里，不静默改用本地或其他云，也不把未验证写成已实现。平台能力需求本身仍以
> [`08-integration.md`](08-integration.md) 为准。
> 测试证据和实现状态以 [`../README.md`](../README.md) 的 **Status** 段为准。

## 0. 与现有文档的关系

| 文档 | 负责什么 |
| --- | --- |
| [`08-integration.md`](08-integration.md) | 平台能力需求、优先级与 handoff |
| [`09-deployment.md`](09-deployment.md) | 安装、运行、配置与故障处理 |
| [`11-dsh-rayrun-computer-issues.md`](11-dsh-rayrun-computer-issues.md) | `dsh-rayrun-computer` 自身的问题登记；修复去上游 |
| [`design/desktop-distribution.md`](design/desktop-distribution.md) | D-S1a 清单与 2026-11-21 实测记录（§5.8） |
| [`plans/mvp-plan.md`](plans/mvp-plan.md) | v0.1 验收任务与测试证据要求（§2、§7） |
| [`../README.md`](../README.md) | 产品状态；本文不复制状态 |

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
> R-G008–R-G013 中多项由平台能力导致；本文保留**验证受阻状态和简短证据**，需求、
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
| R-G008 | 2026-11-11 | 长驻 bot runtime、session 续接、启动钩子、prompt 队列 | 平台答复（2026-11-11）：均无；`409 sandbox_busy`；stop/start 不保进程；无 boot hook。2026-11-21 用户转述 Rayrun 正在评估，仍按阻塞处理 | **阻塞**（平台 P0，见 [`08-integration.md`](08-integration.md) §3.1） | “合上笔记本继续工作”的 Rayrun 验证暂不可做 |
| R-G009 | 2026-11-11 | 零余额不丢盘、spend cap | 平台答复：线上仍可能 force-destroy；代码里的两步停/宽限未部署；无硬上限 | **风险接受**（见 [`08-integration.md`](08-integration.md) §3.2） | 不通过烧余额来验证；只做只读余额/告警检查 |
| R-G010 | 2026-11-11 | 带鉴权的入站访问 | ingress `token` 档恒 403；`public` 档无鉴权；无 per-instance 证书 | **有 workaround**：public ingress + 应用层 DSH launch token/cookie；不暴露产品面板 | 手机审批/远程 UI 的 Rayrun 路径受限 |
| R-G011 | 2026-11-21 | 只读、可撤销的测试 token | 生产 token 是账号身份，无 scope；当前测试 token 无过期时间 | **有 workaround**：专用账号/测试后撤销 | 测试 token 权限过大；不要放进沙箱 |
| R-G012 | 2026-11-11 | 按沙箱的时间序列用量 | `/v1/usage?sandbox_id=` 只有聚合；账本有 itemized；无时间序列 | **有 workaround**：聚合 + 交易分项 | 成本归因只能做区间聚合，不能画实时曲线 |
| R-G013 | 2026-11-21 | 用 Rayrun 镜像做 `FROM` 的自定义构建 | `POST /v1/builds` 不接受 `FROM <rayrun-ref>`（`unsupported_base`） | **有 workaround**：从公共 registry 构建；或从沙箱保存 | 自定义镜像需要从零构建，无法复用官方 rootfs |
| R-G014 | 2026-11-21 | 在 Rayrun 内验证 Linux Electron 桌面开发版 | 无官方 Linux Desktop target；源码构建需要数 GB/较长时间，且仍不能验证官方安装器/更新器 | **未做/不建议**：不把源码开发版当成官方桌面验收 | 若必须做，先作为独立 spike 并记录成本；不替代 D-S1a |

### 3.1 已验证通过（含本机验证；待 Rayrun 复验项见 §4）

> 以下金额、机器数、密码长度是当时读数，会随时间变化，不构成当前状态。

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
> 创建按钮仍未验证（见 §4）。

---

## 4. 仍未验证的清单

- 官方 DSH 桌面安装器、更新器、卸载、再分发条款、analytics（R-G001）；
- `profiles/desktop` 的创建、插件写入和 Electron 启动；
- 在 Rayrun 云端沙箱内放真实 token 并直接操作云电脑（出于安全刻意不做；依赖库验证
  在本机进行，token 未进入沙箱）；
- Bots 页面内的云电脑**创建按钮**成功路径：依赖层的 `ensureModelCredential` +
  `machine.create` 已验证；页面层的已有机器采用和 `继续` 已验证，但创建按钮本身未在
  页面层点击（账号有多台已有机器，setup 会采用），需要在没有现有机器的账号上补验；
- 在 Rayrun 沙箱内复验 roster 页面路径（本机 DSH 已完成；roster 不需要真实 token，
  应可在沙箱内复现）；
- 核实 `$DSH_HOME/.credentials.yaml`（DSH web auth secret）在云端 workspace 上的文件
  权限和 agent 可读性；若 root agent 可读，记录残余风险并评估是否应移到 host-only
  位置；
- bot 会话、审批往返、远程审批、队列与恢复（会话/常驻 runtime 受 R-G008 阻塞）；
  审批执行等待平台权限隔离（ADR-001，[`08-integration.md`](08-integration.md) §3.3），
  在平台提供前不做往返验证；
- DeepSeek 模型调用（至今只创建了 model credential，没有发模型请求）；
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
- [`../README.md`](../README.md) Status
