# 桌面发行版设计（v1.0）

> 状态：2026-11-21。**设计提案，不是已实现功能。** 本文基于对 DeepSeek Harness
> `master` 的实际确认（`apps/desktop`、`packages/util/official-bundles`、
> `docs/capability-seams.md`），描述“打开即用”的分发方案、更新单元、签名与
> 版本矩阵。**2026-11-21 决策：v1.0 走 B1 预配置 DSH 发行包；B2 是升级路径，
> C 不做（ADR-014）。**
> **2026-11-21 实测（§5.8）：** 在 Rayrun 生产用 `web` profile 验证了插件安装/
> 合成/加载、Bots 与云电脑 UI、health 与 DSH 升级后的 profile 保留；B1 的
> `profiles/desktop`、安装器、回滚、应用卸载与再分发仍未验证，**B1 不算验收通过**。
> 产品方向见 [`../00-product-direction.md`](../00-product-direction.md)；技术基线见
> [`../01-system-architecture.md`](../01-system-architecture.md)；部署现状见
> [`../09-deployment.md`](../09-deployment.md)；决策登记见
> [`../adr/architecture-decisions.md`](../adr/architecture-decisions.md) ADR-014。
> v0.1 仍是“插件 + 用户自己的 DSH”；本文属于 v1.0。

## 0. 与现有文档的关系

| 文档 | 负责什么 |
| --- | --- |
| [`../00-product-direction.md`](../00-product-direction.md) | v1.0 桌面发行版的产品范围 |
| [`../01-system-architecture.md`](../01-system-architecture.md) | 薄客户端、插件半区、信任模型 |
| [`../09-deployment.md`](../09-deployment.md) | 今天的安装/运行方式与发布缺口 |
| [`../07-security.md`](../07-security.md) | 供应链、遥测与凭据边界 |
| [`../08-integration.md`](../08-integration.md) | 云端镜像/DSH 版本与平台能力 |
| [`../plans/roadmap.md`](../plans/roadmap.md) | v1.0 的 update story |
| [`../adr/architecture-decisions.md`](../adr/architecture-decisions.md) | ADR-014（桌面发行版与更新单元） |

---

## 1. 结论摘要

先给结论，细节在后：

1. **DSH 官方桌面已经存在**：Electron 壳，内置 dsh runtime，外部插件通过 profile /
   插件管理器加载；使用 `electron-updater`，壳 + 匹配的 dsh runtime + pnpm 是一个
   签名更新单元。
2. **官方更新单元不含我们的插件**：`dsh-rayrun-bots` 和 `dsh-rayrun-computer` 是
   external plugins，装在 `$DSH_HOME/profiles/desktop`，通过插件管理器/市场安装、
   更新；它们不在 DSH 的签名更新包里。
3. **官方安装器不预装第三方插件**：official bundle lists 编译在 DSH 安装里，profile
   不能扩展 optional/on-demand 列表。因此有三条路：首启安装插件（A）；用我们自己的
   安装器把插件写进 profile，同时保留官方 DSH 更新（B1）；或做自定义 DSH 桌面发行版，
   把插件纳入同一个签名更新单元（B2）。
4. **不需要改 DSH core**：`ctx.approval`、`ctx.permissionPresets`、
   `ctx.sessions`/`ctx.sessionPersistence`/`ctx.sessionController`、
   `ctx.clientModules` 等 seam 已存在，bot 层可以作为插件接入。
5. **v1.0 决策（2026-11-21）：B1 预配置 DSH 发行包。** 安装器装好官方 DSH 和两个
   插件，打开即用；DSH 保持官方 updater，插件由我们的签名 manifest/bootstrap 更新。
   - **B2（升级路径）**：自定义 DSH 桌面发行版，把 DSH + 两个插件作为整包签名更新。
   - **A（开发路径）**：官方 DSH 桌面 + 首启安装两个插件，保留给开发和早期试用。
   - **C（不做）**：自建薄壳；重复 DSH 桌面已有的 host/updater。

---

## 2. 已确认的 DSH 事实（2026-11-19）

| 事实 | 内容 | 来源 |
| --- | --- | --- |
| 桌面壳 | `apps/desktop` 是 Electron 壳；内置 dsh runtime，外部插件通过 profile 加载 | `apps/desktop/README.md` |
| 更新 | `electron-updater`；壳 + 匹配的 dsh runtime + pnpm 是一个签名更新单元；stable/nightly、强制更新策略、回滚/恢复 | 同上 “Key technical decisions / Updates” |
| 插件位置 | 外部插件装在 `$DSH_HOME/profiles/desktop`；`dsh plugin --profile desktop add <package>`；Plugins 页/plugin manager/market | 同上 “Bundled command runtime / Installation ownership” |
| 预装限制 | 官方安装器不预装第三方插件；official bundle lists 编译进 DSH 安装，profile 不能扩展 optional/on-demand | `packages/util/official-bundles/README.md` |
| 插件市场 | 索引 JSON；npm/Git 源；安装需确认；未见 external plugin 自动更新 | `docs/user/guide/plugin-market.md` |
| 审批 | `ctx.approval`、`ctx.permissionPresets` | `docs/capability-seams.md` |
| Session | `ctx.sessions`、`ctx.sessionPersistence`、`ctx.sessionController`；session format 有版本与迁移 | 同上；`docs/session-format-status.md` |
| Client | `ctx.clientModules`（client plugin graph host）；插件 client half 可加载 | 同上 |
| 遥测 | DSH desktop 自带 product analytics（DeepSeek 策略）；Web usage 排除 | `apps/desktop/README.md` |
| 更新源 | 官方更新 feed 是 DeepSeek 的（`download.deepseek.com`），第三方不能发布 | `apps/desktop/publishing/README.md` |
| 版本 | DSH 仓库的 Desktop 包为 `0.2.2-rc.5`；DSH 是 developer preview，会有 breaking changes | `apps/desktop/package.json`、README |

**注意**：以上是 DSH `master` 的事实，不是本仓库已实现的功能。确认时 DSH 仓库的
Desktop 包是 `0.2.2-rc.5`，本仓库的页面验证基线也是 `0.2.2-rc.5`，云端镜像为
`0.2.0-rc.2`；B1/B2 动工前仍需在官方桌面复验，组合见
[`../version-matrix.md`](../version-matrix.md) §2。

---

## 3. 分发方案

| | A. 官方 DSH + 首启装插件（开发路径） | B1. 预配置 DSH 发行包（已选） | B2. 自定义 DSH 发行版（升级路径） | C. 自建薄壳（不做） |
| --- | --- | --- | --- | --- |
| DSH 更新 | DSH 官方 updater | DSH 官方 updater | 我们自己的签名整包更新 | 我们自己的签名整包更新 |
| 插件更新 | 插件管理器/市场，手动确认 | 我们签名 manifest / bootstrap；不是单一更新单元 | 跟 DSH 一起整包更新 | 跟 DSH 一起整包更新 |
| 打开即用 | 首启装一次插件 | 安装器预装，打开即用 | 预装，打开即用 | 预装，打开即用 |
| 维护成本 | 低 | 中：安装器、profile、签名 manifest | 高：跟随 DSH 0.2.x、签名、更新源 | 高：重复 DSH desktop |
| 品牌/体验 | DSH 品牌 | 安装器可 Rayrun 品牌，App 仍是 DSH | 完整 Rayrun Bot 品牌 | 可做 Rayrun Bot 品牌 |
| 风险 | 插件与 DSH 版本可能错配 | 插件与 DSH 仍分开更新；DSH analytics 适用 | DSH 构建/签名/更新源全归我们 | 与 B2 类似，且多一层壳 |
| 推荐 | 开发/早期试用 | **v1.0 采用** | 硬需求时升级 | 不做 |

---

## 4. 方案 A：官方 DSH 桌面 + 首启安装插件（开发路径）

2026-11-21 起 A 不再是 v1.0 的产品发行路径；它仍是开发和早期试用的安装方式。

### 4.1 组成

- 用户安装 DSH 官方桌面（或未来官方提供的企业/自定义分发入口）。
- 首次启动后，通过以下任一方式安装两个插件：
  - DSH 的 plugin manager / Plugins 页；
  - `dsh plugin --profile desktop add <package>`（应用退出后执行，再打开）；
  - 我们提供的 plugin index（`docs/user/guide/plugin-market.md` 的格式），让用户在
    Discover 里一次安装两个插件。
- 插件来源优先 npm（发布后）或 Git 仓库；本地路径安装需再验证。

### 4.2 更新

- DSH 自身：用官方 updater；壳 + dsh runtime + pnpm 一起更新。
- 我们的插件：由 plugin manager/market 显示“Update available”，用户确认后安装；
  **没有看到 external plugin 自动更新的机制**。
- 因此“打开即用 + DSH 自动更新”成立；“插件也自动更新”不成立，除非我们另做更新器。

### 4.3 版本兼容

- 我们的 `package.json` 需要声明 `engines.dsh` / peer 依赖；plugin manager 会检查。
- DSH 升级后可能破坏插件；首启/每次 DSH 更新后跑一次兼容检查，失败时提示回退或
  pin 插件版本。
- 本地 DSH 与云端镜像 DSH 的版本矩阵仍然存在（§8）。

### 4.4 遥测与信任

- 用户用的是 DSH 官方 App，DSH 的 product analytics 适用；我们的插件不增加遥测。
- 插件市场索引是第三方内容；我们应发布签名/provenance 清楚的包，并在文档里给出
  校验方式。
- 不需要我们维护 DSH 签名和更新源；但插件安装仍需要用户确认。

### 4.5 适用条件

- 能接受“首启装一次插件”和“插件单独更新”；
- 不需要 Rayrun Bot 品牌桌面；
- 希望最低维护成本。

---

## 5. 方案 B1：预配置 DSH 发行包（已选）

### 5.1 组成

- 一个 Rayrun 品牌的安装器/启动器，负责检测或安装官方 DSH 桌面。
- 随包携带或从固定源获取两个插件的**已发布 tarball**：`dsh-rayrun-bots` 和
  `dsh-rayrun-computer`；不把 `dsh-rayrun-computer` 的源码复制进本仓库、不修改、
  不 fork。
- 安装器在首次运行前把两个包装进 `$DSH_HOME/profiles/desktop`，并写入一个很小的
  bootstrap manifest（版本、哈希、安装时间）；不覆盖用户已有的 profile、session、
  token 或 workspace。
- 打开 DSH 后，Bots 入口和客户端半区已经就绪；首次设置仍要求用户自己的 Rayrun
  登录和 DeepSeek key。

### 5.2 安装流程

1. 校验安装器自身签名和包内 manifest。
2. 检测 DSH：已安装且版本在支持矩阵内 → 复用；未安装 → 安装官方包。
3. 校验两个插件 tarball 的签名/哈希。
4. 以幂等方式安装插件；任一失败 → 回滚本次安装，保留旧 profile，给出可执行提示。
5. 启动 DSH，进入 Bots Setup；不把任何 token/key 写入安装包或日志。

### 5.3 更新

- DSH：官方 updater，壳 + dsh runtime + pnpm 一起更新。
- 插件：我们的签名 manifest 检查新版本；下载、验签、暂存、原子切换，复用
  [`tools/update-poc`](../../tools/update-poc/README.md) 的内核；失败回滚。
- DSH 升级后如果 profile 没有保留插件，安装器/启动器重跑幂等 bootstrap。
- 不承诺单一签名更新单元；这是 B1 与 B2 的核心差别。

### 5.4 版本兼容

- manifest 固定 DSH desktop 版本范围、两个插件版本和云端镜像 DSH 版本。
- 不兼容时阻止插件更新或提示切换镜像；不给假成功。
- DSH 是 developer preview，跟随 `0.2.x` 的 breaking changes。

### 5.5 遥测与信任

- App 仍是官方 DSH，DSH 的 product analytics 适用；安装器/插件不增加遥测。
- 若必须默认无遥测，B1 需要确认 DSH 是否提供可关闭 analytics 的配置；否则升级到
  B2，在自定义构建里关闭/替换。
- 安装器只从固定源拉取包，校验签名/哈希；不把 Rayrun token 或 DeepSeek key 放进
  安装包、日志或更新 manifest。

### 5.6 适用条件

- 产品要求“下载 → 打开 → 插件已就绪”，但可以接受插件与 DSH 分开更新；
- 能接受安装器维护和再分发条款确认；
- 不需要完整 Rayrun Bot 品牌或单一签名更新单元。

### 5.7 D-S1a 验证清单

在干净机器/容器上：

1. 无 DSH → 运行安装器 → 官方 DSH 安装完成，两个插件出现在 `profiles/desktop`。
2. 启动 DSH → Bots 入口、客户端半区、health 状态正常；没有手动插件步骤。
3. DSH 从 N 升级到 N+1 → 插件和 profile 是否保留；不保留时 bootstrap 是否幂等修复。
4. 插件从 N 升级到 N+1 → 签名/哈希失败时停止并保留旧版本；中途断电/磁盘满可回滚。
5. 断网/离线安装 → 失败即停，不留半装状态。
6. 卸载 → profile、token、workspace 的处置符合文档；不留下孤儿。
7. 记录 DSH analytics 能否声明/关闭；确认安装器再分发条款与商标使用。
8. 版本矩阵：DSH desktop、两个插件、云端镜像 DSH 三者组合至少覆盖当前支持范围。

验收：以上 1–6 全通过，7 有明确结论，8 有表；否则 B1 不算可发布。

### 5.8 D-S1a 实测记录（2026-11-21，Rayrun web profile）

> 本节是一次生产实测记录，**不是 B1 的验收通过**。`profiles/desktop`、安装器、
> 升级/回滚、应用卸载、analytics 与再分发条款仍未验证。

**环境**

- Rayrun 生产 `api.rayrunos.com`，`deepseek-harness@1` 镜像，2 vCPU / 4 GB；
  Ubuntu 24.04.4，Node v24.22.0，预装 DSH `0.2.0-rc.2`；
- `DSH_HOME=/workspace/.rayrun/dsh`；`$HOME=/workspace/.rayrun/home` 初始不存在；
- 镜像未预装 pnpm；`corepack prepare pnpm@10.20.0 --activate` 与
  `corepack enable pnpm` 后可用；
- 两个插件用 `npm pack` 打包，经 Rayrun files API 上传后安装；Rayrun token
  没有进入沙箱。

**结果**

| 检查 | 结果 |
| --- | --- |
| `dsh plugin --profile web add` 安装两个插件 | 通过 |
| `dsh --profile web --dump-config` 合成 bundle 行 | 通过（`rayrun-cloud`、`rayrun-bots`） |
| 启动 `dsh web`，Bots / 云电脑入口渲染 | 通过（沙箱内 Chrome + CDP 截图） |
| `GET/POST /plugins/rayrun-bots?action=health` | 200，`{"ok":true,"ready":false}` |
| 跨源 POST / 同源 POST / 无 Origin POST | 403 / 200 / 200 |
| 插件移除 / 重装（`remove` + `add`） | 通过；bundle 行随装/卸出现或消失 |
| 断网（egress 关闭）安装本地 tarball | 通过；pnpm store 已预热，未访问 registry |
| 损坏 tarball 安装 | 失败（`ERR_PNPM_Z_BUF_ERROR`）；profile 依赖为空，无半装 |
| DSH `0.2.0-rc.2 → 0.2.2-rc.5` 后插件与 profile | 保留，仍可加载 |
| 沙箱 stop → start 后 profile 与插件 | 保留；进程不存活（符合平台契约） |
| 云电脑实际连接、bot 会话、审批 | 未测（没有把 Rayrun token 放进沙箱） |

**与 D-S1a 清单的对应**

- 第 2 项：web profile 通过；`desktop` profile 未验证。
- 第 3 项：web profile 通过（DSH 升级后 profile 与插件保留）；`desktop` 未验证。
- 第 1、4、7 项：未验证；安装器、签名/回滚、analytics 与再分发属于桌面壳层，
  web profile 不能替代。
- 第 5 项：web profile 部分通过（egress 关闭 + 本地 tarball 可安装；损坏包失败且
  不留半装）；安装器级离线安装与回滚未验证。
- 第 6 项：插件级 `remove` 通过；应用卸载、profile/token/workspace 处置未验证。
- 第 8 项：部分覆盖（云端镜像的 DSH `0.2.0-rc.2` 与升级后 `0.2.2-rc.5` 都能加载
  两个插件）；官方 desktop 版本未覆盖。

**对 B1 安装器/bootstrap 的约束**

1. **`desktop` profile 由 Electron 应用独占。** DSH `0.2.0-rc.2` 和 `0.2.2-rc.5`
   的 CLI 都拒绝 `dsh plugin --profile desktop ...`，报
   `profile "desktop" is managed exclusively by the Electron application`
   （DSH 源码 `apps/cli/src/args.ts`）。安装器不能依赖 CLI 写 `profiles/desktop`。
2. **官方桌面只有 Windows/macOS。** DSH 的
   [打包文档](https://github.com/deepseek-ai/deepseek-harness/blob/master/apps/desktop/packaging/README.md)
   明确写 Linux 不是支持的 Desktop release target；Rayrun 的 Linux 镜像无法安装
   官方桌面 App，D-S1a 的桌面部分必须在 Windows/macOS 上跑。
3. **云镜像没有 pnpm。** `dsh plugin` 首次报 `pnpm was not found`；B1 安装器/
   bootstrap 必须自带或激活 pnpm，或直接写 profile。
4. **`$HOME` 可能不存在。** 原始 `exec` 下 `/workspace/.rayrun/home` 未创建；
   依赖 HOME 的安装步骤要先建目录。
5. **DSH web 不能绑 `0.0.0.0`。** `0.2.0-rc.2` 拒绝；`0.2.2-rc.5` 要求具体 IP，
   并警告明文 HTTP。远程 UI 需要具体 IP 或 loopback 代理，且 `--trusted-host`
   必须包含 ingress 主机名；ingress 是 public，DSH 自己的 token 是唯一门禁。
6. **npm 全局安装会跳过 install scripts。** 安装 `0.2.2-rc.5` 时 npm 未运行
   `dsh-subprocess-local`、`node-pty`、`koffi`、`protobufjs` 的脚本；Web UI 与
   plugin manager 可用，但 terminal/子进程路径未验证。
7. **版本契约。** `dsh-rayrun-bots` 已声明 `engines.dsh: >=0.2.0-rc.2 <0.3.0`，
   DSH `0.2.2-rc.5` 的兼容性检查（安装时拒绝 + 组合预检）会强制执行；
   `dsh-rayrun-computer` 的 `package.json` 仍未声明 `engines.dsh`，仓库 CI 的
   DSH 矩阵也只覆盖 `dsh-rayrun-bots`。

**复现要点**

- 沙箱：`deepseek-harness@1`，2 vCPU / 4 GB，1 小时连续运行上限，空闲 stop
  （不是 destroy）；
- `corepack prepare pnpm@10.20.0 --activate`、`corepack enable pnpm`；
- `dsh plugin --profile web add /workspace/plugins/<tarball>`；
- `dsh web --host 127.0.0.1 --port 8766 --trusted-host <ingress-host>`；
  `0.2.0-rc.2` 拒绝 `0.0.0.0`，我们绑 loopback 并用 TCP 代理把 ingress 端口
  转发到它；`0.2.2-rc.5` 可以直接绑沙箱的具体 IP。

---

## 6. 方案 B2：自定义 DSH 桌面发行版（升级路径）

### 6.1 组成

- 从 DSH 的 MIT 源码构建桌面发行版，保留 Electron + dsh runtime + 插件模型；
- 定制 product identity、品牌、安装器、签名/notarization、更新 feed；
- 把 `dsh-rayrun-bots` 和 `dsh-rayrun-computer` 加入 official bundle list，或在
  桌面 profile 模板中预置；
- 更新单元 = 壳 + 固定 DSH + 两个插件 + locale；整包签名、原子更新、回滚。

### 6.2 需要自己承担的

- 跟随 DSH `0.2.x` 的 breaking changes，定期 rebase/重建；
- Windows Authenticode、macOS notarization、Linux 签名；
- 更新 feed、manifest、公钥、回滚槽、灰度/强制更新策略；
- DSH 的 product analytics：必须关闭/替换或明确声明，否则违反本项目的“默认无遥测”；
- DSH 的许可证/notices；MIT 允许分发，但要保留版权与第三方声明；
- 本地 DSH 与云端镜像 DSH 的版本矩阵。

### 6.3 更新流程

1. 检查 manifest（HTTPS，只带版本/平台/channel）。
2. 验签 + SHA-256 + 版本矩阵；失败即停。
3. 下载到临时目录；解压到 `versions/<version>/`；再次校验。
4. 切换指针；保留上一版本；更新前备份 profile。
5. 提示重启；用户确认后安装；迁移失败回滚。
6. 健康检查 DSH、两个插件、云端镜像兼容性；失败回滚。

**更新内核原型。** [`tools/update-poc`](../../tools/update-poc/README.md) 已实现签名
manifest、Ed25519 验签、SHA-256、版本矩阵、暂存、原子切换和回滚的本地 fixture 测试。
它不进入插件运行时，也不下载/解包安装器；后续接入 B1 的插件更新或 B2 的整包更新。

### 6.4 适用条件

- 产品要求“打开即用、无插件安装步骤”；
- 产品要求 DSH + 插件在一个签名更新单元里；
- 团队愿意承担 DSH 桌面构建、签名、更新源和 breaking changes 的维护。

---

## 7. 方案 C：自建薄壳（不做）

- 自己写 Electron/Tauri 壳，内置 DSH sidecar + 两个插件，自己做 updater。
- 现在看是重复 DSH desktop 已有的 host/updater/签名/恢复能力。
- 只在 DSH 桌面无法满足硬需求（窗口/进程模型/品牌/OS 集成）时考虑。
- 若选 C，更新设计沿用 §6.3，但 DSH 仍是未修改的 sidecar；不要把 C 和 B2 同时做。

---

## 8. 数据与版本矩阵

### 8.1 数据位置

- DSH profile：`$DSH_HOME/profiles/desktop`（DSH desktop 独占）。
- 我们的本地状态：`$DSH_HOME/state/rayrun-bot/`（见 [`../06-local-state.md`](../06-local-state.md)）。
- vault：Harness vault / OS keychain；更新不触碰。
- 云端：`/workspace/.rayrun/` 与 bot session；更新不触碰。
- 安装目录不可变；用户数据外置；更新前备份 profile。

### 8.2 版本矩阵

至少包含：

- DSH desktop 版本；
- 本地 dsh runtime 版本（DSH desktop 要求与壳完全一致）；
- `dsh-rayrun-computer` 版本；
- `dsh-rayrun-bots` 版本；
- 云端镜像里的 DSH 版本。

不兼容时：

- 阻止更新，保留旧包；
- 或阻止“合上笔记本继续工作”，提示切换兼容镜像；
- 给一句可执行提示，不给假成功。

---

## 9. 安全与合规

- **签名**：Windows Authenticode、macOS notarization、Linux 校验和；manifest 与
  安装包都签名，公钥固定在 App。
- **更新源**：A/B1 的 DSH 用官方 feed；B1 的插件和 B2/C 用我们自己的静态清单/
  GitHub Releases，不新增项目方控制面。
- **不静默更新**：默认“提示 + 用户确认”，自动安装 opt-in；这个 App 持有 Rayrun
  token 与云电脑访问权。
- **遥测**：A/B1 使用 DSH 官方 App，其 analytics 适用并需明确声明；B2/C 必须
  关闭/替换或明确声明，本项目的插件不增加遥测。
- **供应链**：DSH、`dsh-rayrun-computer`、本仓库的版本与哈希都要可追溯；插件市场
  索引是第三方内容，只加可信源。
- **许可证**：DSH 与两个插件按各自许可证分发；保留 notices。

---

## 10. 首启体验

**A（开发路径）**

1. 安装 DSH 官方桌面，打开。
2. 通过 plugin index 或 CLI 安装 `dsh-rayrun-bots` + `dsh-rayrun-computer`（一次确认）。
3. 打开 Bots 页 → Rayrun 登录 → DeepSeek key → 创建/选择云电脑 → 第一个 bot。

**B1（v1.0 默认）**

1. 下载并运行 Rayrun Bot 安装器。
2. 安装器装好官方 DSH 和两个插件；打开 DSH。
3. 打开 Bots 页 → Rayrun 登录 → DeepSeek key → 创建/选择云电脑 → 第一个 bot。

**B2（升级路径）**

1. 安装 Rayrun Bot Desktop，打开。
2. 插件已预置；直接 Rayrun 登录 → DeepSeek key → 云电脑 → 第一个 bot。

三种都需要用户自己的 Rayrun 账号和 DeepSeek key；“打开即用”指没有手动安装 DSH/插件
的步骤，不是没有账号。

---

## 11. 验收标准

### A（开发路径）

- 干净机器安装 DSH 官方桌面；按首启引导一次装好两个插件；创建第一个 bot。
- DSH 自动更新后，插件兼容检查通过或给出明确回退提示。
- 插件更新经 plugin manager 确认；无自动插件更新时不伪装成已更新。
- 卸载 DSH 后，用户数据与 Rayrun token 的处置符合 DSH 的卸载规则。

### B1（v1.0 默认）

- 干净机器运行安装器；官方 DSH 和两个插件装好；打开后 Bots 就绪，没有手动插件步骤。
- DSH 从 N 升级到 N+1：profile 和插件保留，或 bootstrap 幂等修复；版本矩阵检查通过。
- 插件从 N 更新到 N+1：签名/哈希/版本任一失败 → 不更新，旧版本可用。
- 离线/中途失败/磁盘满：安装或更新回滚，不留半装状态，用户数据不损坏。
- DSH analytics 已声明或可关闭；安装包、日志、manifest 不含 Rayrun token 或 DeepSeek key。
- 卸载后 token、workspace 和 profile 的处置符合文档，无孤儿。

### B2（升级路径）

- 干净机器安装 Rayrun Bot Desktop；打开即进入登录/建 bot，无需装插件。
- 从 N-1 更新到 N：DSH、两个插件、用户数据、vault 全部保留。
- 签名/哈希/版本矩阵任一失败：不更新，旧版本可用。
- 本地 DSH 与云端镜像不兼容：阻止“合上笔记本”或提示切镜像。
- 更新中断/磁盘满：回滚，用户数据不损坏。
- 遥测关闭/声明符合本项目不变量。
- 卸载干净；Rayrun token 由用户在 vault 吊销。

---

## 12. 未决项

| 问题 | 影响 | 决策 |
| --- | --- | --- |
| DSH 升级后 profile/插件是否保留 | B1 的“打开即用” | D-S1a |
| 安装器再分发条款与 DSH 商标 | 能否发行 | D-S1a；需许可/法务确认 |
| 无人值守/离线安装与回滚 | B1 安装器 | D-S1a |
| DSH analytics 能否声明/关闭 | 无遥测承诺 | D-S1a；否则升级 B2 |
| 本地 DSH 与云端镜像不一致时阻断什么 | 产品承诺 | 版本矩阵与 feature gate |
| B2 的产品身份、签名、更新源 | 升级路径 | 需 DSH 桌面构建确认 |
| external plugin 是否能自动更新 | B1 的更新故事 | 不依赖；用我们的签名 manifest |

---

## 13. 相关文档

- [`../00-product-direction.md`](../00-product-direction.md) v1.0
- [`../01-system-architecture.md`](../01-system-architecture.md)
- [`../09-deployment.md`](../09-deployment.md)
- [`../07-security.md`](../07-security.md)
- [`../08-integration.md`](../08-integration.md)
- [`../adr/architecture-decisions.md`](../adr/architecture-decisions.md) ADR-014
- [`../plans/roadmap.md`](../plans/roadmap.md) v1.0
