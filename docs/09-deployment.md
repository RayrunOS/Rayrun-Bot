# 09 — 部署与运行

> 状态：2026-11-24。本文说明依赖、安装、运行、配置、检查与故障处理，是安装与运行的
> 操作页；实现状态以 [`12-status.md`](12-status.md) 为准。产品方向见
> [`00-product-direction.md`](00-product-direction.md)；技术基线见
> [`01-system-architecture.md`](01-system-architecture.md)；平台 handoff 见
> [`08-integration.md`](08-integration.md)。

## 0. 与现有文档的关系

| 文档 | 负责什么 |
| --- | --- |
| [`12-status.md`](12-status.md) | 实现状态；三分钟路径当前可达哪一步 |
| [`08-integration.md`](08-integration.md) | 依赖契约、一次安装 S6、平台能力 |
| [`plans/roadmap.md`](plans/roadmap.md) | 阶段与发布退出标准 |
| [`plans/mvp-plan.md`](plans/mvp-plan.md) | A1–A12 验收与 release checklist |
| [`adr/architecture-decisions.md`](adr/architecture-decisions.md) | 未决架构决策 |

---

## 1. 前置条件

| 需要 | 为什么 | 状态 |
| --- | --- | --- |
| [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) | 运行时；桌面 App 或 `dsh web` | `0.2.0-rc.2` / `0.2.2-rc.5` 已验证；组合见[版本矩阵](version-matrix.md) |
| [`dsh-rayrun-computer`](https://github.com/RayrunOS/dsh-rayrun-computer) | 云电脑层；独立项目，必需依赖 | 未上 npm；从 checkout 安装 |
| [Rayrun](https://rayrunos.com/) 账号 | 提供云电脑；按秒计费 | 必需；用户直接付 Rayrun |
| DeepSeek API key | 机器内 agent 的模型调用 | 必需；key 与模型账单属于用户 |
| Node / 构建工具 | 不需要：纯 ESM、无构建 | 无 |

没有项目方托管的账号、中继或控制面。

---

## 2. 今天能跑什么

Rayrun Bot 不 vendor 云电脑层；它是独立项目、必需依赖。今天两个插件要装进同一个 DSH
profile。S6 已验证（2026-11-24，本地 tarball）：**一条命令安装两个包**会同时选中
两个 bundle；只安装 `dsh-rayrun-bots` 即使它声明依赖，也只会安装依赖包、
不会自动启用依赖的 bundle。两个包都已发布到 npm：`dsh-rayrun-bots@0.1.1-alpha.1`
（`alpha` tag；`latest` 仍是旧的 `0.1.0-alpha.0`）和 `dsh-rayrun-computer@1.2.1`
（latest，含 prompt-root/mock 修复；`1.2.0` 的 tarball 来自较旧的 `fe965c1`，
不要再用）。本机 npmmirror 可能滞后，安装时可用官方 registry：

```bash
npm_config_registry=https://registry.npmjs.org \
  dsh plugin --profile web add \
  dsh-rayrun-computer@1.2.1 dsh-rayrun-bots@0.1.1-alpha.1
# 重启 DSH：client half 只在页面启动时加载
```

或从 checkout 安装依赖（开发/离线）：

```bash
git clone https://github.com/RayrunOS/dsh-rayrun-computer.git
cd dsh-rayrun-computer
dsh plugin --profile web add "$(pwd)"
```

Windows 用 PowerShell，路径写 `"$PWD"`。

然后在 DSH 页面：

1. 打开 **Cloud Computer → Connection settings**，用 Rayrun 账号登录，或粘贴 API
   token；token 存进 Harness vault。
2. **New computer** → 选镜像、至少 2 GB 内存、打开 remote desktop → **Create and
   open**。约 15 秒。
3. 让 agent 列出机器；应该返回刚创建的那台。负向检查值得做一次：登录前同一请求必须
   返回 `token_required`，不能假装成功。

这个包今天提供（来自独立项目，不是本仓库）：

| 可用 | 说明 |
| --- | --- |
| 七个 `rayrun_*` tools | 机器生命周期、exec、desktop、files、agent 委派、worker layer、workspace sync |
| noVNC desktop | 创建时打开 remote desktop 的机器会发布桌面端口 |
| 按 session 的 cloud/local 路由 | cloud 模式下 host 拒绝本地写/执行工具 |
| 校验过的 workspace sync | git bundle + dirty patch，两侧 SHA-256；pull 落 `.dsh/incoming/`，不自动应用 |
| 任务委派 | 目标 + 验收标准，多轮，`start`/`result` 可跨轮 |
| 可选 idle stop | `idle_stop_minutes`；只停，不 destroy |
| 登录与 vault | 密码/微信/API token；token 留在 host 侧 |

以上来自 `dsh-rayrun-computer`，在 DSH `0.2.1-rc.5` 验证。

---

## 3. 安装 bot 包（checkout）

```bash
# 在仓库根目录
dsh plugin --profile web add "<packages/dsh-rayrun-bots 的绝对路径>"
# 重启 DSH；client half 在页面启动时加载
```

安装后打开 **Bots** 会看到 v0.1 客户端壳：聊天列表、对话、详情、新建 bot、设置向导、
设置。对话 UI 对真实名册 bot 读取并发送 `session.*`；示例 bot 仍走页内预览。真实
bot 的审批卡已接 host；示例 bot 卡片和设置仍是页内预览。本地 roster 和每 bot 的
`session.json` / `transcript.jsonl` 已持久化，host half 提供 `session.send/history/status`；
依赖 1.1+ 时，adapter 用 detached `dsh.start/status/result` 把一轮 turn 发给已有的
云电脑（没有机器时拒绝自动创建）；1.0.x 回退单轮 `rayrun_agent`；两者都不可用时
`session.send` 返回 `E_RUNTIME_UNAVAILABLE`。依赖 1.2+ 另有 host-side `runtime.*`
client（`lib/runtime-rpc.js`），cloudHost 预览用它在机器上注册常驻 `bot-host`；
默认关闭，启用后 `session.*` 走该 adapter（多 bot 单 host 已 dev E2E 通过），未启用
时仍走 detached/agent。发送一轮会让依赖启动已停止/暂停的机器，
可能产生机时费用。真实一轮（单轮 adapter）、detached 的页面关闭 + 本地 DSH 重启后
继续，以及机器 stop/start 后的第二轮续接（A8），已在本机页面 + 已有 Rayrun 机器验证
（2026-11-22）。host half 还提供
`approvals.list/get/decide/propose/sync`。ADR-019（2026-11-23）起，本地 DSH host 对
typed `rayrun.machine.start/stop/pause/resume` 做审批与执行：批准后写 `exec-<id>.json` claim，再用
本地 Rayrun token 执行；拒绝/过期/重放/崩溃 claim 失败关闭。云端 proposal bridge
已接：cloud host 解析结构化 `rayrun-approval` block 写提案（`propose.mjs` 可选），
本地 `rayrun_files` 导入并去重，结果写回
`approval-results/`（停机时先落本地 outbox）。真实 cloud proposal → Allow → 真实 stop
→ 停机 outbox → 重启补传，以及 start、denial/Continue 和下一轮结果 context 已 live
通过（2026-11-23）；其他动作和云端凭据动作仍未完成（后者仍等
平台隔离，ADR-001）；示例 bot 卡片和设置仍是
页内预览。setup 的 Rayrun/电脑步骤，以及详情和 Settings 的用量读取，会真正
调用云电脑插件。常驻 host 的 bot↔云端 session 映射已有 dev 预览（多 bot 单 host
E2E 通过），但生产镜像/部署未交付；routines 默认由本地 DSH host 调度，
cloudHost 模式改由云 host 调度并回导结果（dev/test live E2E 已通过，生产待
R-G008 部署）；独立成本栏尚未构建；`rayrun_agent` adapter 不拦截外部动作，
prompt 里的“先询问”只是指引。
状态以 [`12-status.md`](12-status.md) 为准。

**从 tarball 安装**（发布产物的内容）：

```bash
npm pack ./packages/dsh-rayrun-bots --pack-destination /tmp
dsh plugin --profile web add /tmp/dsh-rayrun-bots-0.1.1-alpha.1.tgz
```

`node packages/dsh-rayrun-bots/test/package-contents.mjs` 用
`npm pack --dry-run` 校验 tarball 只包含 host half、client half、locale、bundle
patch、`lib/*.js`、图标、README 和 LICENSE；CI 会把打出的 tarball 装进第二个 profile
并合成配置。兼容组合见[版本矩阵](version-matrix.md)。

**一次安装（S6，已验证 2026-11-24）**：用一条 `dsh plugin add` 命令安装两个包：

```bash
dsh plugin --profile web add <dsh-rayrun-computer 路径或 tarball> <dsh-rayrun-bots 路径或 tarball>
```

本地 tarball 验证结果：

- 两个包都进入 profile 的 `dependencies`
- `dsh.profile.bundles` 同时包含 `dsh-rayrun-bots` 和 `dsh-rayrun-computer`
- `dsh web` 启动后两个插件都加载，Bots health 报依赖 `ok`，云电脑 RPC 正常

如果只安装 `dsh-rayrun-bots` 并在它的 `package.json` 里声明
`dependencies.dsh-rayrun-computer`：依赖包会进 `node_modules`，但 profile 的
`bundles` 仍只有 `dsh-rayrun-bots`，依赖 bundle **不会自动启用**。因此不要把它
写成“单包安装”；真正的单包安装需要 DSH 支持传递 bundle 激活，或新增 meta-package。

npm 归属与发布账号仍未定（[`plans/mvp-plan.md`](plans/mvp-plan.md) §11 第 5 项），
所以现在没有发布 job。

---

## 4. v0.1 目标三分钟路径（未构建）

1. 用一条命令安装两个包（S6 已验证；npm alpha/latest 可用）。
2. 登录 Rayrun 一次；向导创建云电脑。
3. 创建 bot：名字、职责、指令、skills；它在电脑上有自己的 session。
4. 和它对话，或创建一个 routine 让 bot 按间隔运行（本地 DSH host 需保持运行）。
5. 在面板里批准它的第一个受控动作。

第 2 步的 Rayrun 登录和云电脑创建经云电脑插件的同源 RPC 真正到达 Rayrun；本地
routine 已能在 host 存活时入队普通 turn，详情面板的创建/暂停/删除已在本地 DSH
页面验证，但本地 mode 尚未等待一次自动触发；cloudHost 模式的云端 routine 调度
已在 dev/test 环境 live E2E 通过（2026-11-24），生产 R-G008 已部署且 hosted
routine E2E 已通过（`CLOUD_ROUTINE_PROD_OK`，2026-11-24）。云 bot 自主
审批提案和更多受控动作已部分打通。
host 的 `session.*` 已可执行一轮；真实 bot 的审批卡和本地 typed
start/stop/pause/resume 执行已接，示例 bot 与设置仍是页内预览。
详见 [`plans/roadmap.md`](plans/roadmap.md)、[`plans/mvp-plan.md`](plans/mvp-plan.md)
和 [`12-status.md`](12-status.md)。

---

## 5. 配置

云电脑包的设置来自 DSH profile 的 `cordis.patch.yml` bundle row：

| 键 | 默认 | 含义 |
| --- | --- | --- |
| `sandboxName` | `dsh-workspace` | 按名字复用云电脑，而不是新建 |
| `idle_stop_minutes` | `0` | 空闲 N 分钟后 stop（永不 destroy）；0 关闭 |
| `egress_allow` | `[]` | 新机器可访问的 host；空 = 无出网 |
| `credentials` | `[]` | 注入 agent 进程的模型 credential |
| `baseUrl` | `https://api.rayrunos.com/v1` | Rayrun API 端点 |

### 5.1 Bots cloud host（预览）

常驻 bot host 的 runtime adapter 是**预览**，默认关闭。启用时在同一个 profile 的
`cordis.patch.yml` 里覆盖 **rayrun-bots** 行（不是云电脑行）：

```yaml
- id: rayrun-bots
  name: 'dsh-rayrun-bots'
  config:
    cloudHost:
      enabled: true
      credentials: ['deepseek-flash']
      profile: bot
```

| 键 | 默认 | 含义 |
| --- | --- | --- |
| `enabled` | 未启用 | 启用后使用常驻 host adapter；`false` 回退 per-turn detached/agent |
| `hostScript` | 无（自动 projection） | 覆盖投影后的 host 入口；正常不需要设置 |
| `credentials` | `[]` | 传给 runtime spec 的沙箱凭证**名**，不是值 |
| `profile` | `bot` | host 内 DSH 使用的 profile，由 host 从 headless 模板创建 |
| `machine` | 自动选择 | 固定机器名/id；仍要求机器已存在 |

要求依赖 1.2+（`runtime.*`）和 `rayrun_files` 工具。host 资产随本包发布在
`cloud-host/`；adapter 启动前用 `lib/host-projection.js` 上传到
`/workspace/.rayrun/host/<package version>/`，校验 SHA-256 manifest，再注册 runtime。
adapter 先解析已有机器，机器不存在时拒绝；由于 `rayrun_files` 会按依赖的
`autoCreate` 处理缺失机器，Bots 用 profile 建议把云电脑行设为 `autoCreate: false`。
一台机器一个 `bot-host` runtime，内部是全局串行队列，每个 bot 独立 transcript/session；2026-11-23 手动机器路径的页面 E2E 已通过
（`HOST_E2E_OK`）；自动 projection 页面 E2E 也已通过；多 bot 单 host 的页面 E2E 已通过
（`MULTI_A_OK`/`MULTI_B_OK`，两个独立 session）；生产镜像未做。cloudHost 的 prompt
会让 bot 在回复末尾输出结构化 `rayrun-approval` block，cloud host 解析后写 proposal
（`propose.mjs` 是可选 shell 路径）；本地 approval bridge 通过 `rayrun_files` 导入并
去重，结果写回 `approval-results/`（机器停机时先落本地 outbox）。真实 cloud proposal
→ start/stop/pause/resume、denial/Continue 与下一轮 context 已 live 通过；
`propose.mjs` shell 路径未 live。
状态以 [`12-status.md`](12-status.md) 为准。

**永远不要把 Rayrun token 或模型 key 写进会提交的配置文件。**

---

## 6. 故障处理

- **`token_required`**：没有 Rayrun token。打开 **Cloud Computer → Connection
  settings**；页面不会假装成功。
- **机器没有出网，allowlist 创建时固定**：创建时设置 `egress_allow`。运行期修改未
  验证：2026-11-01 测试中文档化的 runtime 端点不可用。
- **`destroy` 不可逆**：机器与 workspace 一起删除。用 stop/pause 保留磁盘；停止的
  机器仍占存储，镜像包含额度内免费，超出计费。
- **后台工作要花钱且不会自愈**：Rayrun 按秒计费，没有平台 idle auto-stop；
  `max_lifetime_seconds` 只停不重启。余额耗尽可能 force-destroy 组织内机器与磁盘。
  关注余额；需要时设 `idle_stop_minutes`（只停，不 destroy）。
- **第二个任务 `409 sandbox_busy`**：一台电脑一次只跑一个 agent 任务，不排队；
  等待或换机器。
- **`dsh-rayrun-computer` 未安装**：今天需要两个插件；把云电脑插件从 checkout 装进
  同一个 profile 并重启 DSH。缺少它，bot 层依赖的云工具不存在。
- **`npm i dsh-rayrun-bots` 失败**：预期；两个包都未上 npm。

每个错误应该给一句可执行提示，不给假成功；审批相关失败一律拒绝。

---

## 7. 检查与 CI

无构建步骤、无运行时依赖：

```bash
git diff --check
node --check packages/dsh-rayrun-bots/index.js
node --check packages/dsh-rayrun-bots/client.js
node packages/dsh-rayrun-bots/test/manifest-check.mjs
node packages/dsh-rayrun-bots/test/locale-audit.mjs
node packages/dsh-rayrun-bots/test/rpc-contract.mjs
node packages/dsh-rayrun-bots/test/client-contract.mjs
node tools/rayrun-deploy/test/contract.mjs
```

CI（`.github/workflows/checks.yml`）在 push/PR 上、Node 24 和 26 上跑语法检查、
所有 `test/*.mjs`，以及 `tools/update-poc` 和 `tools/rayrun-deploy/test/contract.mjs`
的契约测试；有可比较的提交时，push/PR 的 diff 还要通过 `git diff --check`（尾随空白
与冲突标记）。另有 DSH 兼容矩阵：把 `dsh-rayrun-bots` 装进临时 profile，并在 DSH
`0.2.1-rc.5` 和 `0.2.2-rc.5` 上跑 `--dump-config`，确认 bundle 行能合成。该包声明
`engines.dsh: >=0.2.0-rc.2 <0.3.0`；DSH `0.2.2-rc.5` 的兼容性检查会在安装时拒绝
不兼容的包并恢复 profile，组合预检也会禁用不兼容的 row。该矩阵不覆盖云电脑插件，也不发真实
Rayrun 调用。实时集成测试仍需要真实 Rayrun 凭据，不在 CI 运行；唯一的例外是下面
可选、main-only 的部署 job。发布与发布自动化尚不存在；release checklist 见
[`plans/mvp-plan.md`](plans/mvp-plan.md) §12。v1.0 桌面发行版采用 B1 预配置 DSH
发行包（bootstrap 安装器），B2 整包更新是升级路径；见
[`design/desktop-distribution.md`](design/desktop-distribution.md)。

### 7.1 自动部署到 Rayrun 沙盒（可选）

`.github/workflows/checks.yml` 的 `deploy` job 在 push 到 main（且
`packages/dsh-rayrun-bots/**` 有变更）或手动 `workflow_dispatch` 时运行，必须等
`checks` 和 `dsh-plugin` 两个矩阵通过。它：

1. `npm pack` 当前插件；
2. 用 Rayrun API 确保目标沙盒 Running（Stopped 会 start，计费开始）；
3. 上传 tarball 到 `/workspace/pkgs/`；
4. `dsh plugin --profile web add` 安装，停 `rayrun-desktop`，重启 `dsh web`
   （绑定沙盒 IP:6080，`--trusted-host` / `--public-url` 用公网 6080 ingress）；
5. 把带 token 的 DSH URL 写入 `/workspace/dsh-web-url.txt`（mode 600），并从
   runner 验证公网 URL 返回 303。**URL 和 Rayrun token 都不打印。**

配置（GitHub → Settings → Secrets and variables → Actions）：

| 名称 | 类型 | 值 |
| --- | --- | --- |
| `RAYRUN_TOKEN` | secret | Rayrun API token；优先用专用、可吊销的账号/token |
| `RAYRUN_SANDBOX_ID` | variable | 目标沙盒 id；必须已有 public 6080 ingress（`remote_desktop: true`） |

没有配置时 job 自动跳过，workflow 保持绿色；PR/fork 不运行该 job。部署会重启公网
DSH，所以每次部署的 launch token URL 都会变。但首次用 token 交换后，浏览器会拿到
30 天、绑定 host:port 的签名 cookie；签名 secret 存在沙盒 DSH 的 credential store
（`$DSH_HOME/.credentials.yaml`），跨 DSH 重启/部署仍然有效（2026-11-21 实测：
部署前的 cookie 在部署后仍返回 200）。同一浏览器可以继续用不带 token 的公网 URL；
只有新浏览器/新设备、清 cookie、30 天到期，或 DSH home / ingress host 改变时才
需要新的 token URL。取新链接（不要贴到公开渠道）：

```bash
RAYRUN_TOKEN="$(cat <path-to-rayrun-token>)" \
RAYRUN_SANDBOX_ID=<sandbox-id> \
node tools/rayrun-deploy/fetch-url.mjs
```

该 URL 含 DSH 进程 token，等同该沙盒的 RCE 入口；不用时 stop 沙盒。CI 使用真实
Rayrun token 是维护者例外，不是产品运行时路径；安全边界见
[`07-security.md`](07-security.md) §4.7。

---

## 8. 读下一步

- [产品方向](00-product-direction.md)
- [系统架构](01-system-architecture.md)
- [安全](07-security.md) — 保护什么、不保护什么
- [FAQ](faq.md)
- [路线图](plans/roadmap.md)
- [实现状态](12-status.md) — 今天能做什么、还缺什么
