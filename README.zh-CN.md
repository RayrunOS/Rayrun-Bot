# Rayrun Bot

[English](README.md) | 简体中文

Rayrun Bot 给 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 里的 Bot 一个名字、一副身体和一个家。Bot 不是聊天会话：它有名字、指令、记忆和日程，住在你自己的 [Rayrun](https://rayrunos.com/) 云电脑上——一台你能看见、也能接管的 Linux 机器——并用你自己的 DeepSeek API key 思考。没有我们托管的东西：算力记在你自己 Rayrun 账号上，模型账单是你的，审批提示就是约定。本仓库就是把这个产品造出来的地方。

> **状态（2026 年 11 月）。** Pre-alpha。本项目赖以构建的云电脑插件是一个独立项目，在 [RayrunOS/dsh-rayrun-computer](https://github.com/RayrunOS/dsh-rayrun-computer) 单独维护；Rayrun Bot 在它之上加 Bot 层，本仓库造的就是这一层。这里暂时没有可安装的东西。

## 工作原理

以下是 v0.1 正在照此实现的设计；今天实际存在的东西见[状态](#状态)。

一个 Bot 由四部分组成，其中只有一部分需要一直在线。

- **桌面——你机器上的 DeepSeek Harness。** 你在这里和 Bot 对话、审批动作、改设置。同一个 DSH profile 里跑两个 bundle：独立的云电脑插件提供 `rayrun_*` 工具和同源 RPC 接口，Rayrun Bot 的 Host 半区在它之上加 Bot 层；Client 半区往 DSH Web UI 里加页面。Bot 层上线后，合上笔记本不会让 Bot 停下来：桌面是你回来的地方，不是它们住的地方。
- **身体——你的 Rayrun 云电脑。** 每人一台 Linux 机器，由这个人的所有 Bot 共享：独立的 vCPU 和内存、持久的 `/workspace`、`:99` 上的 X11 桌面，并且能跑命令、搬文件、开浏览器。按写作时（2026 年 11 月）的价格，2 vCPU / 2 GiB 常开约 ¥57.6/月；Rayrun 按秒计费，你付给 Rayrun，不是付给我们。
- **大脑——你的 DeepSeek key。** 机器里的 agent 进程用你存在 Rayrun credential 里的 API key 调 DeepSeek。key 注入的是那个进程，不是工作区：`exec` 起的 shell 读不到它，它不在本仓库里，也不会出现在聊天消息里。日志是否会带出 key 仍在验证——见 [docs/security.md](docs/security.md)。
- **记忆——机器上的 DSH 状态。** Bot 是持久的 DSH 对象：它的指令、技能、草稿本和会话都在一个 profile 目录里，重启后还在。Bot↔session 映射——从停下的地方继续，然后回来汇报——是本仓库要补的核心。

```
你 ── 聊天 / 审批 ──▶ DSH（你的桌面）                   浏览器标签页或桌面 App
                       │  plugin host 半区：工具 · 同源 RPC · 审批
                       ▼
                  Rayrun API · https://api.rayrunos.com/v1
                       ▼
     你的 Rayrun 云电脑   （每人一台，由你的多个 Bot 共享）
       ├─ 机器上的 DSH host：每个 Bot 一个 session
       ├─ /workspace · 浏览器 profile · X11 桌面
       └─ 模型调用 ──▶ DeepSeek API（你的 key，按进程注入）
```

由此引出几个设计取舍：

- **每人一台电脑，不是每个 Bot 一台。** 更便宜也更简单，Bot 像一个人的工具那样共享文件、浏览器会话和凭据。代价是：Bot 不是安全边界——不要把两个 Bot 当成彼此的沙箱。
- **自带账号。** 我们没有控制面持有你的 key，也不计量你的用量。Rayrun 是你的基础设施供应商，DeepSeek 是你的模型供应商，本仓库是胶水。
- **在保护你的地方 local-first。** workspace 同步用 git bundle 加 dirty patch，两端重新校验 SHA-256；pull 只落到 `.dsh/incoming/`，绝不会背着你自动应用。
- **审批 fail-closed。** 未知、超时、无人回答都算「不」。这条规则我们还在实现——见[审批](#审批)。
- **刻意无聊。** 纯 ESM，无运行时依赖，无构建步骤；你桌面上的 DSH 和云上的 DSH 是同一个 DSH。

## 快速开始

**环境要求**

- DeepSeek Harness——桌面 App 或 `dsh web`。云电脑插件在 `0.2.1-rc.5` 上验证过；针对 `0.2.2-rc.1` 的复测进行中。
- 独立的云电脑插件（`dsh-rayrun-computer`，MIT）——运行时必须；在它上 npm 之前用 checkout 安装。
- 一个 [rayrunos.com](https://rayrunos.com/) 的 Rayrun 账号。
- 一个 DeepSeek API key。

### 今天就能跑的部分

本项目依赖的云电脑插件是独立、可用的包。先装它；Bot 那一层还装不了。

```bash
git clone https://github.com/RayrunOS/dsh-rayrun-computer.git
cd dsh-rayrun-computer
dsh plugin --profile web add "$(pwd)"
# 重启 DSH——Client 半区只在页面启动时加载
```

Windows 上在 PowerShell 里跑同样三条命令，路径写成 `"$PWD"`。

1. 打开 **Cloud Computer → Connection settings**，用 Rayrun 账号登录，或粘贴 API token。token 会替你创建并保存在 Harness 凭证库里。
2. **New computer** → 选镜像、至少给 2 GB 内存、打开远程桌面 → **Create and open**。大约 15 秒。
3. 让 agent 列出你的机器——应该能看到你刚建的那台。负向检查值得做一次：登录之前，同样的请求必须回答 `token_required`，绝不能假装干完了。

v0.1 的目标路径见[状态](#状态)与 [docs/roadmap.md](docs/roadmap.md)。Rayrun Bot 计划把这个插件声明为依赖，让一次安装带上两个；这条路还只是 spike（S6），不是承诺。

## 机器人

现在还没有 Bot 发布；第一批会是普通的 DSH profile 目录，而不是代码。一个 Bot 拥有：

| 部分 | 是什么 |
| --- | --- |
| 名字与指令 | 一段简短的 markdown 说明：这个 Bot 做什么、怎么汇报、绝不能做什么。 |
| 技能 | Bot 能加载的 DSH skills，格式与 DSH 其他部分一致。 |
| 记忆 | 机器上按 Bot 分的目录，放笔记、产物和会话日志。 |
| 电脑 | 它运行的 Rayrun 云电脑——每人一台，由这个人的多个 Bot 共享。 |
| 会话 | 持久的 DSH session id，让 Bot 恢复而不是重来。 |
| Routines | 定时或事件触发的工作（计划中；见[状态](#状态)）。 |

定义格式尚未定稿。以上是设计方向，不是 schema。

## 配置

云电脑包从 DSH profile 的 `cordis.patch.yml` 里那行 bundle 读设置。目前存在的键：

| 键 | 默认值 | 含义 |
| --- | --- | --- |
| `sandboxName` | `dsh-workspace` | 按名字复用一台云电脑，而不是新建。 |
| `idle_stop_minutes` | `0` | 空闲 N 分钟后停止（绝不销毁）电脑；`0` 关闭。 |
| `egress_allow` | `[]` | 新机器可以访问的 host。为空表示没有出向网络。 |
| `credentials` | `[]` | 注入 agent 进程的模型凭据。 |
| `baseUrl` | `https://api.rayrunos.com/v1` | Rayrun API 端点。 |

Bot 级设置还不存在；将来会放在同一个 profile 文件里。永远不要把 Rayrun token 或模型 key 写进会被提交的配置文件。

## 审批

我们正在实现的约定：Bot 可以在自己的电脑里自由工作，但任何有外部副作用的动作都要等你。

- **需要你点头：** 超出预算的花费、以你的身份发消息或发布、销毁一台电脑、碰另一台机器或另一个凭据。
- **不需要你点头：** 读写自己的工作区、在自己的电脑里跑命令、调用模型。
- **默认拒绝。** 超时、未知回答、面板关着，都算「不」。审批永远不会自己替你作答。
- **撤销是即时的：** 停掉 Bot、停掉电脑，或在 Rayrun 控制台撤销 API token。

**云端路径上这还没有实现。** 今天机器上的 worker profile 以 `approval: never` 运行，因为无人值守的云电脑没有人可以问。这是本产品最大的缺口，也是 v0.1 要做的第一件事。在那之前，云端 Bot 是无监督的：只用你愿意承受损失的凭据去跑它。

## 仓库结构

```
Rayrun Bot/
├── README.md, README.zh-CN.md   # 本文件和英文原文
├── CLAUDE.md                    # 给在这个仓库里工作的编码 agent 的规则
├── LICENSE                      # MIT
├── SECURITY.md                  # 如何私下报告漏洞
├── CONTRIBUTING.md              # PR 规则（旁边还有 CODE_OF_CONDUCT.md）
├── .github/                     # issue 与 PR 模板
├── package.json                 # 私有 workspace 根
├── docs/                        # 设计文档、计划、平台需求
└── packages/                    # v0.1 时出现
    └── dsh-rayrun-bots/         # Bot：名册、常驻 host、审批、routines
```

云电脑插件（`dsh-rayrun-computer`）不在这个树里：它是**独立项目**，作为依赖被复用——同一个 DSH profile 里两个插件，一个产品。仓库和产品都叫 **Rayrun Bot**；插件包保留 `dsh-` 前缀，这是 DSH 插件生态的命名习惯。README 是产品页，细节在 `docs/`。深入阅读：[快速开始](docs/quickstart.md)、[架构](docs/architecture.md)、[安全](docs/security.md)、[FAQ](docs/faq.md)、[路线图](docs/roadmap.md)、[MVP 计划](docs/mvp-plan.md)、[客户端计划](docs/client-plan.md)、[本地文件设计](docs/local-file-design.md)、[平台需求](docs/platform-asks.md)。两份 README 必须在同一个 commit 里更新——英文版为准。

## 开发

无构建步骤、无运行时依赖：插件两半都是普通 ESM，Client 半区只加载 DSH 本身提供的模块。

```bash
# 把 checkout 里的包加载进一个 DSH profile
dsh plugin --profile web add /absolute/path/to/package
# 之后重启 DSH；页面启动时会加载新的 Client 半区
```

- JavaScript 检查：目前用 `node --check <file>`；每个包落地后自带 `node test/*.mjs` 测试。
- 实时集成测试需要真实 Rayrun 凭据，永远不在 CI 里跑。
- 改任何东西之前先读 [`CLAUDE.md`](CLAUDE.md) 和 [`CONTRIBUTING.md`](CONTRIBUTING.md)。提交信息用英文，前缀 `feat:`、`fix:`、`chore:`、`docs:`。

## 状态

*截至 2026-11-10。*

| | |
| --- | --- |
| **今天可用**（独立项目，我们的依赖） | 7 个 `rayrun_*` 工具、noVNC 桌面、按会话的云/本地路由、双端哈希校验的 workspace 同步、任务委托、worker 投影、可选空闲停机。已在 DeepSeek Harness `0.2.1-rc.5` 上验证。 |
| **本仓库** | 仓库本身：README、docs、issue/PR 模板、agent 规则，以及依赖边界。没有可发布的代码。 |
| **尚未构建** | Bot 名册与 Bot↔session 映射、机器上的常驻 DSH host、远程审批、routines 与触发器、成本条、IM 通道、两插件安装路径（依赖声明与版本检查）、npm 包与 CI。 |
| **平台缺口** | 安全入向网络（今天 token ingress 不可用，只有 `public` 能用）、空闲自动停、spend cap、session 续跑契约。完整清单在 [docs/architecture.md](docs/architecture.md)。 |

**v0.1 路径**——从 npm 安装 → 登录 → 创建一个 Bot → 批准它的第一个受限动作。验收标准在 [docs/roadmap.md](docs/roadmap.md)。

## 致谢

- [Rayrun](https://rayrunos.com/)：云电脑，以及本项目建在其上的独立插件 [dsh-rayrun-computer](https://github.com/RayrunOS/dsh-rayrun-computer)。
- [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)：本插件所接入的 agent 运行时。
- Grok Bot、dsh-superagent 与 OpenMausBot：它们展示了这个形态该长什么样，以及哪里会崩。

## 许可证

MIT。你的 Rayrun 账号、云电脑和 DeepSeek key 始终属于你；许可证只覆盖本仓库的代码。

---

本文为英文 README 的简体中文译本；若内容有出入，以 [README.md](README.md) 为准。
