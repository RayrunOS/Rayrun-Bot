# Grok Bot 对 Rayrun Bot 的启发

*状态：2026-11-12。我们向 Grok Bot 的产品框架借什么——一个常驻的个人 AI agent，在
共享云电脑上运行一队有名字的 bot——以及刻意不做什么。来源：2026-11-09 的文档快照
（`research/_sources/grokbot-docs/`）、本线程中的产品描述，以及我们自己的
[系统架构](../01-system-architecture.md)、[MVP 计划](../plans/mvp-plan.md) 和
[bot 人格](../design/bot-persona.md)。实现状态以
[../12-status.md](../12-status.md) 为准。*

## 1. 三根支柱，重述

1. **做事，不是聊天。** 用户派活——清理收件箱、策划一场活动——bot 在云端执行并回来
   汇报。不需要人盯着。
2. **一台电脑上的 bot 名册。** 几个有不同职责、有名字的 bot 共享一台云 Linux 机器，
   这样它们能使用用户已登录的 App 和站点（包括没有 API 的老系统），靠驱动浏览器或
   桌面完成。共享 workspace 和交接让工作能在它们之间流动。
3. **独立记忆。** 每个 bot 保留自己的对话和学到的上下文，所以它会越做越好。

Rayrun Bot 已经站在同样的三个想法上：有名字的 bot、每人一台由这些 bot 共享的电脑、
每 bot 的 session、记忆目录和文件。启发在*胶水*里——名册如何像一个团队那样行动，结果
如何回到用户手里。

## 2. 我们已经共享的部分

| Grok Bot 想法 | 我们已有的落点 |
| --- | --- |
| 有职责和轻人格的有名字 bot | [design/bot-persona.md](../design/bot-persona.md)；`bot.json` 的 name/label/instructions |
| 每个用户一台共享云电脑 | [01-system-architecture.md](../01-system-architecture.md) §3.2；Rayrun 每人一台机器 |
| 每 bot 对话与记忆 | `/workspace/.rayrun/bots/<id>/{memory,sessions}`，见 [plans/mvp-plan.md](../plans/mvp-plan.md) §4.2 |
| 笔记本合上后的自主运行 | 持久 bot runtime；本地 UI 关闭后运行继续 |
| 外部副作用的人在环 | 审批卡、deny/allow once、后台卡过期 |
| 关注状态与回报 | 名册里的 needs attention / unread / working |

缺的是团队层和浏览器持久化层。这也是启发真正改变我们计划的两个地方。

## 3. 借鉴清单（按优先级）

| 想法 | 时间 | 为什么 |
| --- | --- | --- |
| 角色标签与同事式命名（已完成） | v0.1 | 不加其他东西就能让名册像团队 |
| 任务 receipt：结果 + 产物 + 成本 + “需要你做什么” | v0.1 | “做事”的另一半是“回来汇报”；从 transcript 计算很便宜 |
| 立即停止 / 任务中改方向 | v0.1 | 同事必须能接受改变的指令；聊天已经有这个通道 |
| 每 bot 记忆目录 + 默认指令 | v0.1（schema），v0.2（行为） | 独立记忆的接缝，不用造一个记忆产品 |
| 通过共享 workspace 的 bot-to-bot 交接 | v0.2 | 在我们的平台上真正可实现的团队行为 |
| Primary bot 作为协调者 | v0.2 | 一个负责 check-in 和分发工作的 bot；Grok Bot 的模式 |
| 记忆审阅：纠正/遗忘、共享事实 | v0.2 | 无法检查的记忆是负债 |
| 持久浏览器 profile 与登录 | 阻塞于 Rayrun | 解锁老系统；平台必须承诺 |
| 多 bot 并行执行 | 阻塞于 Rayrun | 今天一台机器一个 agent 任务（`409 sandbox_busy`） |
| 共享 bot、团队与模板 | 以后 | 多租户功能；超出开源 BYO 范围 |
| 市场、移动端、语音、群聊 | 不做 | 不是我们要建的产品表面 |

## 4. 设计：团队层（v0.2 候选）

Grok Bot 的 bot 可以互相交接工作。对我们来说最便宜的版本使用机器已有的东西——共享
`/workspace` 和共享 DSH runtime：

- **交接文件。** 需要另一个角色的 bot 写
  `/workspace/.rayrun/handoffs/<from>-<to>-<id>.md`，包含 `task`、`context`、
  `artifacts`、`done_when` 和 `reply_to`。接收方在下一轮读取。没有新服务、没有网络、
  没有 bot-to-bot RPC。
- **交接卡。** Transcript 渲染一张小卡：“Weekly Watch 把 *draft review* 交给 Docs
  Refresh”，带完成标准和产物链接。点击打开接收方 bot。
- **Receipt。** 工作返回时，原 bot 发一张 receipt：结果、产物、耗时、花费，以及需要
  用户做什么。这是用户真正会读的“回来汇报”表面。
- **协调者。** 一个 bot 上的 `primary` 标志（v0.2）让它检查其他 bot 并总结团队的一天。
  这是便利，不是必需。
- **循环护栏。** 交接携带跳数和截止时间；超过 3 跳或错过截止时间就结束链条并询问
  用户。不做无限 bot 闲聊。

不在 v0.1：名册保持单任务。机器一次只跑一个 agent 任务，所以两个 bot“并行”最终也会
串行；承诺我们交付不了的团队协作会破坏诚实规则。

## 5. 设计：共享电脑作为老系统桥

共享电脑的意义不只是文件：bot 可以使用和一个人相同的已登录浏览器与桌面。这才让
“清理我的收件箱”或“从那个老门户拉报表”在没有 API 的情况下成为可能。我们的 v0.1
已经有机器、桌面和截图；它还没有持久登录。

- **v0.1**：bot 可以在 session 内驱动浏览器/桌面；用户可以接管 SSO、CAPTCHA 或银行
  步骤。不持久的登录要写成限制，不能藏起来。
- **v0.2（阻塞于 Rayrun）**：跨 session 和重启的持久浏览器 profile 与登录状态。
  [08-integration.md](../08-integration.md) 已经在要安全入向网络；把浏览器 profile
  持久化加进同一个对话。
- **安全**：凭据绝不经过聊天。登录要么是 Rayrun credential 槽，要么是在电脑上的手工
  步骤；审批保护任何离开机器的动作。

## 6. 设计：独立记忆，不造记忆产品

“每个 bot 越用越好”很吸引人，也很容易过度建设。我们的 v0.1 保持很小：

- 每个 bot 有 `/workspace/.rayrun/bots/<id>/memory/` 和一份 session transcript。
  指令可以要求它在那里记笔记；不会自动总结任何东西。
- **记忆不是真相源。** 正如 Grok Bot 自己的文档所说，记忆是上下文，不是证据。对带
  日期的事实采取行动前，bot 必须重读 workspace 或真相源。
- **v0.2**：每晚总结到 `memory/summary.md`，一个“这个 bot 记得什么”面板带纠正/遗忘，
  以及一小组所有 bot 都能看到的共享事实（名字、时区）。
- 记忆写入绝不绕过审批；遗忘是即时且本地的。

## 7. 设计：回报就是产品

“跑了一个工具的聊天”和“做完了工作的同事”之间的差别是 receipt。v0.1 已经产出
receipt 需要的一切：

| Receipt 字段 | 来源 |
| --- | --- |
| 结果 | 最终消息 + 退出的任务状态 |
| 产物 | bot workspace/Library 里创建的文件 |
| 成本 | 机时和该 bot 的花费份额 |
| 需要你做什么 | 待处理审批或问题 |
| 时间 | 队列日志的时间戳 |

UI 把它显示为对话的最后一块，以及名册上的未读标记；没有单独 dashboard。

## 8. 我们刻意不复制的东西

- **订阅/席位模式。** 用户直接付给 Rayrun 和 DeepSeek。
- **托管控制面和多租户组织。** 本仓库是 BYO 开源。
- **市场、模板、共享 bot。** 以后再说，如果有的话；它们需要账号系统和审核，我们没有。
- **并行 bot 的宣称。** 在平台支持一台机器多个 agent 任务之前，产品说的是队列，不是
  并行团队。
- **群聊和 bot-to-bot 闲聊。** 交接是带完成标准的文件，不是社交信息流。

## 9. 路线图位置

| 里程碑 | 团队层工作 |
| --- | --- |
| v0.1 | 角色标签、receipt、停止/改方向、每 bot 记忆目录、单任务队列 |
| v0.2 | 交接文件 + 交接卡、primary bot check-in、记忆审阅、Rayrun 发布后的浏览器持久化 |
| v1.0 | 只有出现账号模型时才做共享 bot/团队；否则保持单用户 |

MVP 计划的 out-of-scope 清单保持不变：v0.1 不做团队协调。
