# Rayrun Bot

[English](README.md) | 简体中文

**给 Bot 一个名字、一副身体和一个家。**

Rayrun Bot 是 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的
bot 层。这个产品给每个 bot 一个名字、一份指令、一段记忆和一个日程——还有一个住的地方：
你自己的 [Rayrun](https://rayrunos.com/) 云电脑，一台你能看见、也能接管的 Linux
机器。Bot 被设计为用你自己的 DeepSeek API key 思考。没有我们托管的东西：算力跑在
你自己的 Rayrun 账号上，模型账单是你的，审批提示就是约定。

> Rayrun Bot 处于 pre-alpha。今天能做什么、还不能做什么，以及实际验证过的组合，
> 都在 [docs/12-status.md](docs/12-status.md)。本页是产品叙事，不是事实来源。

## 为什么是 Bot，不是聊天

标签页一关，聊天会话就结束了。Bot 会留下它的名字、职责说明、记忆和工作区。你派活、
合上笔记本，回来时面对的是一位同事：它汇报做了什么、需要什么，以及哪些事情它刻意
没有做。

产品由四部分组成，其中只有一部分需要一直在线。

- **桌面——你机器上的 DeepSeek Harness。** 你在这里和 bot 对话、审批动作、改设置。
  设计上，合上笔记本不会让工作停下来；桌面是你回来的地方，不是 bot 住的地方。
- **身体——你的 Rayrun 云电脑。** 每人一台 Linux 机器，由这个人的所有 bot 共享：独立
  的 vCPU 和内存、持久的 `/workspace`、X11 桌面，并且能跑命令、搬文件、开浏览器。
  你按秒直接付给 Rayrun。
- **大脑——你的 DeepSeek key。** 设计上，你存在 Rayrun credential 里的 API key 会被
  注入机器里的 agent 进程，模型调用从那一侧发出。key 不进入工作区，也不进入聊天消息。
- **记忆——机器上的 DSH 状态。** Bot 被设计为持久的 DSH 对象：它的指令、技能、草稿本
  和会话都在一个 profile 目录里，重启后还在。Bot↔session 映射让它从停下的地方继续，
  而不是重来。

```
你 ── 聊天 / 审批 ──▶ DSH（你的桌面）                   浏览器标签页或桌面 App
                       │  bot 层：工具 · 同源 RPC · 审批
                       ▼
                  Rayrun API · https://api.rayrunos.com/v1
                       ▼
     你的 Rayrun 云电脑   （每人一台，由你的多个 Bot 共享）
       ├─ 机器上的 DSH host：每个 Bot 一个 session
       ├─ /workspace · 浏览器 profile · X11 桌面
       └─ 模型调用 ──▶ DeepSeek API（你的 key，按进程注入）
```

## 正在构建的产品表面

Bots 表面被设计为 DSH 里的三栏：左边是名册，中间是 markdown 对话，右边是当前 bot
的详情。审批请求被设计为出现在动作停下的地方，而不是另一个收件箱。设置流程被设计为
四步：依赖、Rayrun、云电脑和第一个 bot。

![Bots 对话的设计稿](docs/mockups/conversation.png)

*设计预览。视觉设计与可点击 mockup 见 [docs/design/ui-design.md](docs/design/ui-design.md)
和 [docs/mockups/index.html](docs/mockups/index.html)；实际接通了什么，以
[状态页](docs/12-status.md)为准。*

## 设计取舍

- **每人一台电脑，不是每个 bot 一台。** 更便宜也更简单，bot 像一个人的工具那样共享
  文件、浏览器会话和凭据。代价是：bot 不是安全边界——不要把两个 bot 当成彼此的沙箱。
- **自带账号。** 我们没有控制面持有你的 key，也不计量你的用量。Rayrun 是你的基础设施
  供应商，DeepSeek 是你的模型供应商，本仓库是胶水。
- **在保护你的地方 local-first。** 工作区、profile 和凭据留在你这一侧；执行可以离开
  机器，决策和密钥不行。
- **审批 fail-closed。** 未知、超时、无人回答都算「不」。Bot 可以在自己的电脑里自由
  工作，但任何有外部副作用的动作都要等你。
- **刻意无聊。** 纯 ESM，无运行时依赖，无构建步骤；你桌面上的 DSH 和云上的 DSH 是
  同一个 DSH。

## 适合谁

Rayrun Bot 适合这样的人：想要一位真正干活的个人 AI 同事，在由自己控制的真实电脑上
工作——清理收件箱、盯一个频道、从老系统里拉一份报表——而不必把账号交给托管服务。

它不是托管 SaaS、bot 市场或多租户平台。没有项目方账号、中继或控制面：你的 Rayrun
账号支付电脑，你的 DeepSeek key 支付模型，审批提示就是约定。

## 接着读

| | |
| --- | --- |
| [状态](docs/12-status.md) | 今天能做什么、还缺什么，以及已验证的组合。 |
| [运行今天已有的部分](docs/09-deployment.md) | 安装依赖、从 checkout 加载插件、配置。 |
| [产品方向](docs/00-product-direction.md) | 为谁而做、v0.1 范围与产品决策。 |
| [系统架构](docs/01-system-architecture.md) | 分层、边界与信任模型。 |
| [审批](docs/05-approvals.md) | 什么需要点头、由谁在本机执行，以及哪些云端动作仍在等平台。 |
| [安全](docs/07-security.md) | 保护什么、不保护什么，以及如何私下报告漏洞。 |
| [FAQ](docs/faq.md) | 价格、凭据、模型、自托管与诚实边界。 |
| [贡献](CONTRIBUTING.md) | 如何提议变更与本地检查。 |
| [文档索引](docs/README.md) | 完整文档地图与 ADR 登记册。 |

## 致谢

- [Rayrun](https://rayrunos.com/)：云电脑，以及本项目建在其上的独立插件 [dsh-rayrun-computer](https://github.com/RayrunOS/dsh-rayrun-computer)。
- [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)：本插件所接入的 agent 运行时。
- Grok Bot、dsh-superagent 与 OpenMausBot：它们展示了这个形态该长什么样，以及哪里会崩。

## 许可证

MIT。你的 Rayrun 账号、云电脑和 DeepSeek key 始终属于你；许可证只覆盖本仓库的代码。
