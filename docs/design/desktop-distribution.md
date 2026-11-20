# 桌面发行版设计（v1.0）

> 状态：2026-11-20。**设计提案，不是已实现功能。** 本文基于对 DeepSeek Harness
> `master` 的实际确认（`apps/desktop`、`packages/util/official-bundles`、
> `docs/capability-seams.md`），描述“打开即用”的三种分发方案、更新单元、签名与
> 版本矩阵。
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
   不能扩展 optional/on-demand 列表。要预装或把插件纳入同一个更新单元，必须做
   **自定义 DSH 桌面发行版**（构建/打包层的定制），或首启安装插件。
4. **不需要改 DSH core**：`ctx.approval`、`ctx.permissionPresets`、
   `ctx.sessions`/`ctx.sessionPersistence`/`ctx.sessionController`、
   `ctx.clientModules` 等 seam 已存在，bot 层可以作为插件接入。
5. 因此 v1.0 是 **A/B/C 三选一**：
   - **A（默认）**：官方 DSH 桌面 + 首启安装两个插件；DSH 自动更新，插件单独更新。
   - **B（单一更新单元）**：自定义 DSH 桌面发行版，把 DSH + 两个插件作为整包签名更新。
   - **C（fallback）**：自建薄壳；重复 DSH 桌面已有的 host/updater，除非有硬需求，
     否则不推荐。

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
Desktop 包是 `0.2.2-rc.5`，而本仓库记录的本地基线是 `0.2.2-rc.1`，云端镜像为
`0.2.0-rc.2`；选 A/B 前需要复验，版本矩阵见 §7。

---

## 3. 三种分发方案

| | A. 官方 DSH 桌面 + 首启安装插件 | B. 自定义 DSH 桌面发行版 | C. 自建薄壳 |
| --- | --- | --- | --- |
| DSH 更新 | DSH 官方 updater | 我们自己的签名整包更新 | 我们自己的签名整包更新 |
| 插件更新 | 插件管理器/市场，单独确认 | 跟 DSH 一起整包更新 | 跟 DSH 一起整包更新 |
| 打开即用 | 首启装一次插件 | 预装，打开即用 | 预装，打开即用 |
| 维护成本 | 低 | 高：跟随 DSH 0.2.x、签名、更新源 | 高：重复 DSH desktop 的 host/updater |
| 品牌/体验 | DSH 品牌 | 可做 Rayrun Bot 品牌 | 可做 Rayrun Bot 品牌 |
| 风险 | 插件与 DSH 版本可能错配 | DSH 构建/签名/更新源全归我们 | 与 B 类似，且多一层壳 |
| 推荐 | **默认** | 只有“必须单一签名更新单元”时才做 | fallback |

---

## 4. 方案 A：官方 DSH 桌面 + 首启安装插件（默认）

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
- 本地 DSH 与云端镜像 DSH 的版本矩阵仍然存在（§7）。

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

## 5. 方案 B：自定义 DSH 桌面发行版（单一更新单元）

### 5.1 组成

- 从 DSH 的 MIT 源码构建桌面发行版，保留 Electron + dsh runtime + 插件模型；
- 定制 product identity、品牌、安装器、签名/notarization、更新 feed；
- 把 `dsh-rayrun-bots` 和 `dsh-rayrun-computer` 加入 official bundle list，或在
  桌面 profile 模板中预置；
- 更新单元 = 壳 + 固定 DSH + 两个插件 + locale；整包签名、原子更新、回滚。

### 5.2 需要自己承担的

- 跟随 DSH `0.2.x` 的 breaking changes，定期 rebase/重建；
- Windows Authenticode、macOS notarization、Linux 签名；
- 更新 feed、manifest、公钥、回滚槽、灰度/强制更新策略；
- DSH 的 product analytics：必须关闭/替换或明确声明，否则违反本项目的“默认无遥测”；
- DSH 的许可证/notices；MIT 允许分发，但要保留版权与第三方声明；
- 本地 DSH 与云端镜像 DSH 的版本矩阵。

### 5.3 更新流程

1. 检查 manifest（HTTPS，只带版本/平台/channel）。
2. 验签 + SHA-256 + 版本矩阵；失败即停。
3. 下载到临时目录；解压到 `versions/<version>/`；再次校验。
4. 切换指针；保留上一版本；更新前备份 profile。
5. 提示重启；用户确认后安装；迁移失败回滚。
6. 健康检查 DSH、两个插件、云端镜像兼容性；失败回滚。

### 5.4 适用条件

- 产品要求“打开即用、无插件安装步骤”；
- 产品要求 DSH + 插件在一个签名更新单元里；
- 团队愿意承担 DSH 桌面构建、签名、更新源和 breaking changes 的维护。

---

## 6. 方案 C：自建薄壳（fallback）

- 自己写 Electron/Tauri 壳，内置 DSH sidecar + 两个插件，自己做 updater。
- 现在看是重复 DSH desktop 已有的 host/updater/签名/恢复能力。
- 只在 DSH 桌面无法满足硬需求（窗口/进程模型/品牌/OS 集成）时考虑。
- 若选 C，更新设计沿用 §5.3，但 DSH 仍是未修改的 sidecar；不要把 C 和 B 同时做。

---

## 7. 数据与版本矩阵

### 7.1 数据位置

- DSH profile：`$DSH_HOME/profiles/desktop`（DSH desktop 独占）。
- 我们的本地状态：`$DSH_HOME/state/rayrun-bot/`（见 [`../06-local-state.md`](../06-local-state.md)）。
- vault：Harness vault / OS keychain；更新不触碰。
- 云端：`/workspace/.rayrun/` 与 bot session；更新不触碰。
- 安装目录不可变；用户数据外置；更新前备份 profile。

### 7.2 版本矩阵

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

## 8. 安全与合规

- **签名**：Windows Authenticode、macOS notarization、Linux 校验和；manifest 与
  安装包都签名，公钥固定在 App。
- **更新源**：A 用 DSH 官方 feed；B/C 用我们自己的静态清单/GitHub Releases，不新增
  项目方控制面。
- **不静默更新**：默认“提示 + 用户确认”，自动安装 opt-in；这个 App 持有 Rayrun
  token 与云电脑访问权。
- **遥测**：A 使用 DSH 官方 App，其 analytics 适用；B/C 必须关闭/替换或明确声明，
  本项目的插件不增加遥测。
- **供应链**：DSH、`dsh-rayrun-computer`、本仓库的版本与哈希都要可追溯；插件市场
  索引是第三方内容，只加可信源。
- **许可证**：DSH 与两个插件按各自许可证分发；保留 notices。

---

## 9. 首启体验

**A（默认）**

1. 安装 DSH 官方桌面，打开。
2. 通过 plugin index 或 CLI 安装 `dsh-rayrun-bots` + `dsh-rayrun-computer`（一次确认）。
3. 打开 Bots 页 → Rayrun 登录 → DeepSeek key → 创建/选择云电脑 → 第一个 bot。

**B（自定义发行版）**

1. 安装 Rayrun Bot Desktop，打开。
2. 插件已预置；直接 Rayrun 登录 → DeepSeek key → 云电脑 → 第一个 bot。

两种都需要用户自己的 Rayrun 账号和 DeepSeek key；“打开即用”指没有手动安装 DSH/插件
的步骤，不是没有账号。

---

## 10. 验收标准

### A

- 干净机器安装 DSH 官方桌面；按首启引导一次装好两个插件；创建第一个 bot。
- DSH 自动更新后，插件兼容检查通过或给出明确回退提示。
- 插件更新经 plugin manager 确认；无自动插件更新时不伪装成已更新。
- 卸载 DSH 后，用户数据与 Rayrun token 的处置符合 DSH 的卸载规则。

### B

- 干净机器安装 Rayrun Bot Desktop；打开即进入登录/建 bot，无需装插件。
- 从 N-1 更新到 N：DSH、两个插件、用户数据、vault 全部保留。
- 签名/哈希/版本矩阵任一失败：不更新，旧版本可用。
- 本地 DSH 与云端镜像不兼容：阻止“合上笔记本”或提示切镜像。
- 更新中断/磁盘满：回滚，用户数据不损坏。
- 遥测关闭/声明符合本项目不变量。
- 卸载干净；Rayrun token 由用户在 vault 吊销。

---

## 11. 未决项

| 问题 | 影响 | 决策 |
| --- | --- | --- |
| A 还是 B | 维护成本、品牌、更新单元 | ADR-014 |
| A 的首启安装方式（plugin index / CLI / 安装器） | 用户第一步 | 需验证本地路径与 plugin index |
| B 的产品身份、签名、更新源 | 能否发行 | 需 DSH 桌面配置/构建确认 |
| B 的 analytics 关闭方式 | 无遥测承诺 | 需确认 DSH 配置 |
| 本地 DSH 与云端镜像不一致时阻断什么 | 产品承诺 | 版本矩阵与 feature gate |
| external plugin 是否能自动更新 | “打开即用”的完整度 | 目前未见机制，需 DSH 确认 |

---

## 12. 相关文档

- [`../00-product-direction.md`](../00-product-direction.md) v1.0
- [`../01-system-architecture.md`](../01-system-architecture.md)
- [`../09-deployment.md`](../09-deployment.md)
- [`../07-security.md`](../07-security.md)
- [`../08-integration.md`](../08-integration.md)
- [`../adr/architecture-decisions.md`](../adr/architecture-decisions.md) ADR-014
- [`../plans/roadmap.md`](../plans/roadmap.md) v1.0
