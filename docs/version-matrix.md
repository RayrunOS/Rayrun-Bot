# 版本矩阵

> 状态：2026-11-22。本文记录 DSH、云电脑依赖 `dsh-rayrun-computer` 与 Rayrun Bot
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
| Rayrun Bot | `0.1.0-alpha.0` | `package.json` |

DSH `0.2.2-rc.5` 会读取并强制执行 `engines.dsh`：超出范围的插件行在合成时被禁用；
旧运行时忽略该字段。`dsh-rayrun-computer` 的版本由 host 在启动时读取，缺失或不在
1.x 时分别返回 `E_DEP_MISSING` / `E_DEP_VERSION`。依赖 `1.0.x` 使用单轮
`rayrun_agent`；`1.1+` 使用 detached `dsh.start/status/result`；`1.2+` 另有
host-callable `runtime.*`（main 已合并，尚未发布 npm）。

## 2. 已验证组合

| DSH | 依赖 | Rayrun Bot | Node | 验证内容 | 证据 |
| --- | --- | --- | --- | --- | --- |
| `0.2.0-rc.2`（Rayrun 镜像 `deepseek-harness@1`） | `1.0.0` | `0.1.0-alpha.0` | 24.22.0 | 两插件安装、bundle 合成、Bots/云电脑页面渲染、health、同源 POST 拒绝 | [`10-rayrun-verification.md`](10-rayrun-verification.md) §3.1 |
| `0.2.1-rc.5` | 未安装 | `0.1.0-alpha.0` | 24 | 只安装 Bots 包并合成配置；未启动 web、未调用云电脑插件 | `.github/workflows/checks.yml` 的 `dsh-plugin` job |
| `0.2.2-rc.5` | 未安装 | `0.1.0-alpha.0` | 24 / 26 | 只安装 Bots 包并合成配置 | 同上 |
| `0.2.2-rc.5` | 未安装 | `0.1.0-alpha.0` | 24 | 从 `npm pack` 的 tarball 安装并合成配置（当时 15 个文件；当前包 29 个文件由 `package-contents` 检查） | [`10-rayrun-verification.md`](10-rayrun-verification.md) §3.1（2026-11-22） |
| `0.2.2-rc.5` | `1.0.0` | `0.1.0-alpha.0` | 24 | 本机页面层 setup / Open / Stop / roster；依赖 RPC | [`10-rayrun-verification.md`](10-rayrun-verification.md) §3.1 |
| `0.2.2-rc.5` | `1.0.0` | `0.1.0-alpha.0` | 24 | 本机页面层真实一轮 session：已有 `rayrun-bot-test` 机器、bot 回复 `SMOKE_OK`、刷新后 transcript 仍在 | [`10-rayrun-verification.md`](10-rayrun-verification.md) §3.1（2026-11-22） |
| `0.2.2-rc.5` | `1.1.0`（main `720f30a`，未发布 npm） | `0.1.0-alpha.0` | 24 | Bots 页 detached `dsh.start/status/result`：task id 持久化，关闭页面并 kill 本地 DSH，重启后恢复 poll、收取 `reply.md`（`DETACHED_OK`），刷新后回复仍在 | [`10-rayrun-verification.md`](10-rayrun-verification.md) §3.1（2026-11-22） |
| `0.2.2-rc.5` | `1.1.0`（main `720f30a`，未发布 npm） | `0.1.0-alpha.0` | 24 | A8 续接：第一轮 `TURN1_OK` 后机器 stop、host 重启，第二轮由依赖自动唤醒机器并从 transcript 回答 `ALPHA`；刷新后两轮仍在 | [`10-rayrun-verification.md`](10-rayrun-verification.md) §3.1（2026-11-22） |
| `0.2.2-rc.5` | `1.2.0`（main `fe965c1`，未发布 npm） | `0.1.0-alpha.0` | 24 | Bots `runtime.*` client 经依赖 host RPC live：dev 机器 start 后 put/list/get/delete，测试后 stop | [`10-rayrun-verification.md`](10-rayrun-verification.md) §3.1（2026-11-22） |
| `0.2.0-rc.2`（镜像 `dsh-bot-devcheck@1`） | `1.2.0`（main `fe965c1`，未发布 npm） | `cloud-host/` assets | 24 | DSH headless 直接 `--session-id` 续接：`RUN1_OK` → `ALPHA`；host 两轮 `HOST1_OK` → `BETA` | [`10-rayrun-verification.md`](10-rayrun-verification.md) §3.1（2026-11-22） |
| `0.2.2-rc.5` | `1.2.0`（main `fe965c1`，未发布 npm） | `0.1.0-alpha.0`（`cloudHost` adapter）+ `cloud-host/` assets | 24 | Bots 页面 → adapter → `rayrun_files` → `cloud-host/` + DSH：`HOST_E2E_OK`；runtime 删除、机器 stop | [`10-rayrun-verification.md`](10-rayrun-verification.md) §3.1（2026-11-23） |
| `0.2.2-rc.5` | `1.2.0`（main `fe965c1`，未发布 npm） | `0.1.0-alpha.0`（自动 projection） | 24 | Bots 页面 → adapter 投影/校验 `cloud-host/` → host DSH：`HOST_E2E_OK`；runtime 删除、机器 stop | [`10-rayrun-verification.md`](10-rayrun-verification.md) §3.1（2026-11-23） |
| `0.2.2-rc.5` | `1.2.0`（main `fe965c1`，未发布 npm） | `0.1.0-alpha.0`（`cloudHost` adapter + `cloud-host/` assets） | 24 | scoped token + private `deepseek-flash`，两 bot 一个 `bot-host`：`MULTI_A_OK`/`MULTI_B_OK`，独立 session，queueDepth 0；runtime 删除、机器 stop | [`10-rayrun-verification.md`](10-rayrun-verification.md) §3.1（2026-11-23） |
| `0.2.2-rc.5` | `1.0.0` | `0.1.0-alpha.0` | 24 + Rayrun 沙盒 | 云端 ingress、`dsh web` 部署与 token URL | [`09-deployment.md`](09-deployment.md)、[`10-rayrun-verification.md`](10-rayrun-verification.md) §3.1 |

“未安装”表示该 CI 矩阵只验证 Bots 包本身能安装和合成，不验证依赖或云端行为。

## 3. 安装与打包检查

包尚未发布到 npm；今天从 checkout 或本地 tarball 安装：

```bash
# checkout
dsh plugin --profile web add /absolute/path/to/packages/dsh-rayrun-bots

# tarball（发布产物的内容）
npm pack ./packages/dsh-rayrun-bots --pack-destination /tmp
dsh plugin --profile web add /tmp/dsh-rayrun-bots-0.1.0-alpha.0.tgz
```

`node packages/dsh-rayrun-bots/test/package-contents.mjs` 用
`npm pack --dry-run --json` 校验 tarball 内容：host half、client half、locale、
`cordis.patch.yml`、`lib/*.js`、`icon.svg`、README 和 LICENSE 必须在；`test/`、
`docs/`、`tools/`、`node_modules/`、`.env` 和 `.tgz` 不得进入。

发布前仍需决定 npm 归属与发布账号（[`plans/mvp-plan.md`](plans/mvp-plan.md) §11
第 5 项），并配置 OIDC trusted publishing。在这之前不要创建会发布的 CI job。

## 4. 未验证

- 官方 DSH 桌面（Electron）的创建、安装器、更新、卸载与再分发（R-G001）；
- 依赖 1.1.0 发布到 npm 后安装（今天从 main `720f30a` checkout 验证）；同一
  host 不重启的连续两轮 detached；
- 依赖 1.2.0 `runtime.*` 发布到 npm 后安装（今天从 main `fe965c1` checkout 验证）；
- `dsh-rayrun-computer` 上 npm 与“一次安装带两个包”的依赖路径（S6）；
- DSH `0.2.2-rc.5` 的 subprocess/terminal 完整安装路径（R-G005）；
- 镜像 DSH `0.2.0-rc.2` 与本机/桌面 `0.2.2-rc.5` 的功能一致性（R-G007）；
- 从 npm 安装 Rayrun Bot（包尚未发布）。

新增验证后更新本表；不要把未测试的组合写成已支持。
