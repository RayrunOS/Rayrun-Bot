# 09 — 部署与运行

> 状态：2026-11-21。本文说明依赖、安装、运行、配置、检查与故障处理。它是
> [`../README.md`](../README.md) 快速开始的展开版；实现状态以 README 的 **Status**
> 段为准。产品方向见 [`00-product-direction.md`](00-product-direction.md)；技术基线见
> [`01-system-architecture.md`](01-system-architecture.md)；平台 handoff 见
> [`08-integration.md`](08-integration.md)。

## 0. 与现有文档的关系

| 文档 | 负责什么 |
| --- | --- |
| [`../README.md`](../README.md) | 产品页与状态；三分钟路径 |
| [`08-integration.md`](08-integration.md) | 依赖契约、一次安装 S6、平台能力 |
| [`plans/roadmap.md`](plans/roadmap.md) | 阶段与发布退出标准 |
| [`plans/mvp-plan.md`](plans/mvp-plan.md) | A1–A12 验收与 release checklist |
| [`adr/architecture-decisions.md`](adr/architecture-decisions.md) | 未决架构决策 |

---

## 1. 前置条件

| 需要 | 为什么 | 状态 |
| --- | --- | --- |
| [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) | 运行时；桌面 App 或 `dsh web` | 云电脑包在 `0.2.1-rc.5` 验证；设计基线 `0.2.2-rc.1`，复验进行中 |
| [`dsh-rayrun-computer`](https://github.com/RayrunOS/dsh-rayrun-computer) | 云电脑层；独立项目，必需依赖 | 未上 npm；从 checkout 安装 |
| [Rayrun](https://rayrunos.com/) 账号 | 提供云电脑；按秒计费 | 必需；用户直接付 Rayrun |
| DeepSeek API key | 机器内 agent 的模型调用 | 必需；key 与模型账单属于用户 |
| Node / 构建工具 | 不需要：纯 ESM、无构建 | 无 |

没有项目方托管的账号、中继或控制面。

---

## 2. 今天能跑什么

Rayrun Bot 不 vendor 云电脑层；它是独立项目、必需依赖。今天两个插件要装进同一个 DSH
profile；一次安装路径是 S6，未验证。先装依赖：

```bash
git clone https://github.com/RayrunOS/dsh-rayrun-computer.git
cd dsh-rayrun-computer
dsh plugin --profile web add "$(pwd)"
# 重启 DSH：client half 只在页面启动时加载
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
设置。**这些是页内内存预览**：创建 bot 不会落到云电脑，Allow once 不会发给 worker。
bot 层（roster、session 映射、审批、routines、成本栏）尚未构建；状态以 README 为准。

**一次安装**：Rayrun Bot 的 bundle 拟声明 `dsh-rayrun-computer` 为依赖，让一次安装
带两个插件。这是 W0 spike S6，**未验证**；在那之前按上面的两装路径。

---

## 4. v0.1 目标三分钟路径（未构建）

1. 安装 `dsh-rayrun-bots`（npm 未发布；checkout 可用）；一次安装 S6 未验证，先装
   依赖。
2. 登录 Rayrun 一次；向导创建云电脑。
3. 创建 bot：名字、职责、指令、skills；它在电脑上有自己的 session。
4. 和它对话，或让 routine 在你离开时唤醒它。
5. 在面板里批准它的第一个受控动作。

第 2–5 步目前**不会真正到达 Rayrun**；客户端壳是预览。详见
[`plans/roadmap.md`](plans/roadmap.md) 与 [`plans/mvp-plan.md`](plans/mvp-plan.md)。

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

bot 级设置尚不存在；将来放在同一个 profile 文件。**永远不要把 Rayrun token 或模型
key 写进会提交的配置文件。**

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
```

CI（`.github/workflows/checks.yml`）在 push/PR 上、Node 24 和 26 上跑语法检查、
所有 `test/*.mjs`，以及 `tools/update-poc` 的更新内核测试；有可比较的提交时，
push/PR 的 diff 还要通过 `git diff --check`（尾随空白与冲突标记）。另有 DSH 兼容
矩阵：把 `dsh-rayrun-bots` 装进临时 profile，并在 DSH `0.2.1-rc.5` 和 `0.2.2-rc.5`
上跑 `--dump-config`，确认 bundle 行能合成。该包声明
`engines.dsh: >=0.2.0-rc.2 <0.3.0`；DSH `0.2.2-rc.5` 的兼容性检查会在安装时拒绝
不兼容的包并恢复 profile，组合预检也会禁用不兼容的 row。该矩阵不覆盖云电脑插件，也不发真实
Rayrun 调用；实时集成测试需要真实 Rayrun 凭据，绝不在 CI 运行。发布与发布自动化
尚不存在；release checklist 见 [`plans/mvp-plan.md`](plans/mvp-plan.md) §12。v1.0
桌面发行版采用 B1 预配置 DSH 发行包（bootstrap 安装器），B2 整包更新是升级路径；
见 [`design/desktop-distribution.md`](design/desktop-distribution.md)。

---

## 8. 读下一步

- [产品方向](00-product-direction.md)
- [系统架构](01-system-architecture.md)
- [安全](07-security.md) — 保护什么、不保护什么
- [FAQ](faq.md)
- [路线图](plans/roadmap.md)
- [README](../README.md) — 产品页与状态
