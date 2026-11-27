<div align="center">

<img src="packages/dsh-rayrun-bots/icon.svg" width="76" alt="Rayrun Bot 图标">

# Rayrun Bot

**给 Bot 一个名字、一副身体和一个家。**

Rayrun Bot 是 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的
bot 层。每个 bot 有名字、职责说明、记忆和日程，住在你自己的
[Rayrun](https://rayrunos.com/) 云电脑上：一台你能看见、也能接管的 Linux 机器。
它用你的 DeepSeek key 思考。云电脑记在你的 Rayrun 账号上，模型账单也是你的。

没有项目方账号、中继或控制面。把本仓库装进 DeepSeek Harness。

[English](README.md) | 简体中文

</div>

> **Pre-alpha。** v0.1 还没有交付，三分钟首次运行路径还没有做端到端计时，bot 层
> 也不是生产可用的产品，不面向普通用户。今天能做什么、还缺什么、哪些组合真正
> 验证过，以 [docs/12-status.md](docs/12-status.md) 为准。本页和该文档不一致时，
> 以状态文档为准。下面的短述截至 2026-11-25。

<p align="center">
  <img src="docs/mockups/conversation.png" width="920" alt="Bots 对话的设计预览">
</p>
<p align="center"><sub>设计预览，不是今天这个构建的截图。实际接通了什么见 <a href="docs/12-status.md">docs/12-status.md</a>。</sub></p>

## 适合谁

已经在用 DeepSeek Harness、希望有一个有名字的 bot 跑在自己付费的 Rayrun 云电脑上、
使用自己的 DeepSeek key，并在启动、停止、暂停和恢复这台电脑之前停下来等审批的人。

它适合愿意读状态文档、也能接受缺口的人。它不是托管助手、bot 市场，也不是多租户平台。

## 安装

先安装 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)。
本包声明 `engines.dsh` 为 `>=0.2.0-rc.2 <0.3.0`。下面这条命令在 DSH `0.2.2-rc.5`
上验证过。实际验证过的组合见 [docs/version-matrix.md](docs/version-matrix.md)。

从官方 npm registry 一次安装两个插件，并写上版本：

```bash
npm_config_registry=https://registry.npmjs.org \
  dsh plugin --profile web add \
  dsh-rayrun-computer@1.3.1 dsh-rayrun-bots@0.1.1-alpha.1
```

装完后重启 DSH。Bots 页面在页面启动时加载。

然后在 Bots 里：

1. 连接 Rayrun。token 留在 host 侧的 Harness vault 里，页面拿不到它。
2. 采用一台已有的云电脑，或新建一台。新建会计入 Rayrun 账单。页面可以停止机器；只有明确的电脑更新确认、且新电脑就绪后，才会销毁旧电脑。
3. 如果这台电脑还没有 DeepSeek credential，设置步骤可以把你的 key 存成 Rayrun credential。key 注入 agent 进程，不进入工作区，也不进入聊天。
4. 创建一个 bot 并发送一条消息。默认名册是空的；只有显式 `?preview=1` 的页面会显示示例 bot，它们只是页内演示，不会在云电脑上运行。

`dsh-rayrun-bots@0.1.1-alpha.1` 在 npm 的 `alpha` dist-tag 上。`latest` 仍是
`0.1.0-alpha.0`。没有稳定版。不带版本的 `npm install dsh-rayrun-bots`，或不带这些
版本的 `dsh plugin add`，不会装到 `0.1.1-alpha.1`。只安装 bots 包也不会启用云电脑
插件：两个包必须出现在同一条 `dsh plugin add` 里。云电脑插件钉在
`dsh-rayrun-computer@1.3.1`。`1.2.2` 起才返回机器凭据绑定名，`1.2.1` 及更早没有；
`1.3.0` 增加 `credentials.save`，`1.3.1` 是当前 `latest`。镜像站可能落后于官方
registry，所以这条命令指定了 registry。

2026-11-25 用官方 registry 核对过安装路径，但当时钉的是 `1.2.1`：两个插件都加载，
并向一台已经处于 Stopped 的 hosted 机器发了一轮，收到了回复。当前 `1.3.1` 的钉法和
`1.2.2+` 默认路径还没有重新做端到端复验。那次核对使用了机内 host，用的是维护者的
机器；那台机器不是安装要求，这次核对也不保证每个账号或每张镜像都能同样跑通。

机内 host 是 `dsh-rayrun-computer` 1.2.2+ 的默认执行路径。它需要一张新到足以跑
Rayrun runtime 的镜像（`dsh-bot@1`）；旧机器可以用电脑更新按钮迁移。运行说明在
[docs/09-deployment.md](docs/09-deployment.md)。

## 今天能做什么

仍然是 pre-alpha。这是短述；证据在 [docs/12-status.md](docs/12-status.md)。

- 装上两个插件并打开 Bots 页：名册、对话、详情、新建 bot、设置向导和设置，中英双语。
- 留下你创建的 bot：名字、指令、session 和 transcript 在刷新页面后还在。
- 向一台已有的 Rayrun 云电脑发一轮。停止或暂停的机器可能会为这一轮被启动，并产生机时费用。关掉页面不一定丢掉这一轮。
- 打开云电脑桌面，以及停止机器。停止不会销毁机器；只有明确的电脑更新确认、且新电脑就绪后，才会销毁旧电脑。
- 批准或拒绝 start、stop、pause、resume。Allow once 从本地 host 执行该动作。拒绝、过期或未知结果都不会执行。
- 创建、暂停和删除按间隔重复的 routine。routine 就是普通的一轮。打开它之后，后续运行可能唤醒机器并花钱。cron 和事件触发还没有。
- 在云电脑上跑一个常驻 host，你的 bot 共用一个进程。依赖 1.2+ 时它是默认路径，因此本地 DSH 停着时 routine 仍可以跑。hosted 核对用的是新到足以跑 Rayrun runtime 的镜像（`dsh-bot@1`）。更旧的官方镜像可能以 `guestd_outdated` 拒绝 runtime，需要先更新电脑。

## 今天不能做什么

- 没有交付 v0.1，三分钟首次运行路径还没有做端到端计时。干净安装的浏览器一轮和 start/stop/pause/resume 审批卡已在维护者机器上核对；这不等于对所有账号的承诺。
- 没有稳定版。`latest` 仍是更早的 alpha。
- 不替你托管 bot，不计你的用量，也不保管你的账号。中间没有项目方中继。
- 审批不覆盖机器 start、stop、pause、resume 以外的动作。云电脑上的凭据动作不在范围内。云电脑是 agent 的安全容器，容器内 agent 按设计拥有完整权限（ADR-020）。它不是审批沙箱；bot 也不是安全边界：你的 bot 共用一台电脑。
- 没有 IM 通道，没有按 bot 的花费报表，也没有 cron 和事件触发。

## 它怎么组合起来

```
你 ── 聊天 / 审批 ──▶ DSH（你的桌面）
                       │  bot 层
                       ▼
                  Rayrun API
                       ▼
     你的 Rayrun 云电脑   （每人一台，由你的 bot 共享）
       ├─ workspace、浏览器、桌面
       └─ 模型调用 ──▶ DeepSeek（你的 key，注入 agent 进程）
```

云电脑付给 Rayrun，模型付给 DeepSeek。本项目不站在这两笔账单中间。代码许可是 MIT。

设计是每人一台电脑：更便宜，bot 也像一个人的工具那样共享文件。代价就是上面那一条。
Bot 可以在这台电脑里工作；已经做出来的机器动作会停下来等审批，超时就是拒绝。

## 接着读

| | |
| --- | --- |
| [状态](docs/12-status.md) | 今天能做什么、还缺什么，以及验证过的组合。本页以它为准。 |
| [安装与运行](docs/09-deployment.md) | 运行说明，包括机内 host。 |
| [版本矩阵](docs/version-matrix.md) | 实际核对过的 DSH、云电脑插件和 bot 包组合。 |
| [安全](docs/07-security.md) | 什么受保护，什么不受保护。 |
| [FAQ](docs/faq.md) | 定价、凭据、模型和限制。 |
| [产品方向](docs/00-product-direction.md) | 面向谁，以及 v0.1 的范围。v0.1 还没有交付。 |
| [贡献](CONTRIBUTING.md) | 如何提出改动。 |
| [文档索引](docs/README.md) | 其余文档。 |

## 许可证

MIT。你的 Rayrun 账号、云电脑和 DeepSeek key 属于你。许可证覆盖本仓库的代码。
