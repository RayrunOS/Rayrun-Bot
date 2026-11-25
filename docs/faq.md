# 常见问题

*状态：2026-11-25。Pre-alpha。两个独立项目：云电脑插件
[RayrunOS/dsh-rayrun-computer](https://github.com/RayrunOS/dsh-rayrun-computer)
独立可用；本仓库的 bot 层在它之上构建，并把它作为外部依赖复用。实现状态以
[12-status.md](12-status.md) 为准；本文只给短答，细节见[系统架构](01-system-architecture.md)、
[安全](07-security.md) 和[路线图](plans/roadmap.md)。*

## 这是 SaaS 吗？

不是。它是 DeepSeek Harness 的开源插件，MIT 许可。没有项目方托管的服务、账号、中继
或控制面：你带自己的 Rayrun 账号和 DeepSeek API key。代码跑在你的机器和你的云电脑上。

## 软件免费，我付钱给谁？

云电脑付给 Rayrun，token 付给 DeepSeek。Rayrun 按秒给云电脑计费（写作时 2 vCPU /
2 GiB 常开约 ¥57.6/月）；模型用量记在你的 DeepSeek 账号上。本项目不收款，也不转售
算力或 token。

## 用哪个模型？

DeepSeek，用你自己的 DeepSeek API key。key 存在 Rayrun credential 里，注入你云电脑
内的 agent 进程；模型调用来自那台机器，不来自本项目。

## 能用其他模型供应商吗？

未设计、未测试。本产品只接通 DeepSeek 凭据路径。DSH 本身可以接其他模型供应商，但
那条路径超出 v0.1，必须先验证才能声称支持。

## 能指向 E2B 之类的其他云后端吗？

不能。集成是 Rayrun 专用的：工具直接调用 Rayrun API。供应商抽象是一个未决决策，v0.1
没有计划；以后要加，是对插件云层的重新设计，不是一个配置开关。

## 我的 Rayrun token 安全吗？

设计上应该安全：token 留在 host 侧的 DeepSeek Harness 凭证库里，页面永远拿不到；
page→host 调用是同源、origin 校验的 RPC。密码只存在内存里。残余风险——host 被攻陷、
同一 profile 里的恶意插件——见 [07-security.md](07-security.md)。

## 我的 DeepSeek key 安全吗？

key 存在 Rayrun credential 里，只注入 agent 进程；机器里的 `exec` shell 读不到它，
插件也不读它。“永不进日志”仍是待验证的设计声明——见
[12-status.md](12-status.md) 和 [07-security.md](07-security.md)。云供应商本身能否读到
存储的 credential **未验证**；不要假设它读不到。

## 需要装两个插件吗？

今天需要：Rayrun Bot，以及独立的
[RayrunOS/dsh-rayrun-computer](https://github.com/RayrunOS/dsh-rayrun-computer)
项目。Rayrun Bot 把它当作外部依赖复用，不修改、不 fork、不 vendor。两个包都已发布
到 npm；用**一条** `dsh plugin add` 命令装进同一个 DSH profile，会同时启用两个
bundle（S6 已验证，2026-11-24）。只安装 Rayrun Bot 并在 `package.json` 声明依赖，
只会安装依赖包，不会自动启用依赖 bundle。

## 为什么这个仓库文档这么多？

因为这是一个从设计起步的项目，而且 bot 层仍在构建中。它不是云电脑插件的 monorepo：
那个包是独立项目，位于
[RayrunOS/dsh-rayrun-computer](https://github.com/RayrunOS/dsh-rayrun-computer)，
并保持独立。文档记录产品方向、架构、审批和验证证据；代码按 v0.1 计划逐步落地。

## 今天能做什么？

从 npm 用一条 `dsh plugin add` 把两个包装进同一个 DeepSeek Harness profile。独立的
云电脑插件提供七个工具：create/stop/pause/destroy 机器、跑命令、搬文件、驱动桌面、
委派任务、同步 workspace、project worker 层。它是 Rayrun Bot 的依赖，不是本仓库的
一部分。本仓库的 `dsh-rayrun-bots` 一并装进同一个 profile，打开 Bots 壳并持久化名册；
真实 bot 的对话和审批卡已接 host，示例 bot 与设置仍是页内预览。[安装与运行](09-deployment.md)有确切命令和“还缺什么”表，
实现状态见 [12-status.md](12-status.md)。

## 和 Grok Bot 有什么不同？

Grok Bot 是托管产品：xAI/Cursor 运行机器，模型包含在订阅里，客户端是他们分发的专用
App。本项目与托管相反——开放代码、你的 Rayrun 账号、你的 DeepSeek key、DSH 作为
客户端。它借鉴产品形态（有名字的 bot 共享一台持久电脑，bot 需要你时出现审批），但
不是克隆，也没有市场、移动 App 或托管 onboarding。

## 和 dsh-superagent 或 OpenMausBot 有什么不同？

`dsh-superagent` 是 DeepSeek 针对单个 GitHub 仓库的研究原型：本地运行，没有云电脑，
明确仅供参考。OpenMausBot 是更广的 Apache-2.0 自托管产品，云桌面是外部服务；它是有用
的 UX 参考，但不是 Rayrun/BYO 集成。本项目的赌注更窄：DSH 是大脑，Rayrun 是电脑，
凭据是用户本来就拥有的。致谢名单见[灵感调研](research/inspiration.md)。

## 如果我忘了停电脑会怎样？

你会按秒继续付费。Rayrun 今天没有平台侧 idle auto-stop；云电脑包有可选的
`idle_stop_minutes`，会 stop（不 destroy）空闲机器，但计时器在 host 内存里，重启就丢。
`max_lifetime_seconds` 会停机且不重启。余额耗尽时，平台可能 force-destroy 你组织内
的机器和磁盘——所以要把余额当作数据丢失风险，而不只是成本。

## 审批在工作吗？

本地 typed 动作已能审批并执行（ADR-019，2026-11-23）：提案由本地 DSH host 重新
校验，用户决定只写本地，批准后本地 executor 用你的 Rayrun token 执行
`rayrun.machine.start/stop/pause/resume`；拒绝/过期/重放/崩溃 claim 都不执行。云端 proposal
bridge 已 live：bot 输出结构化 block，cloud host 写提案，本地 `rayrun_files` 导入，
Allow 后真实 stop，停机时结果落本地 outbox、重启后补传；start、denial/Continue 和
下一轮结果 context 也已真机通过。pause/resume 也已 live；其他动作和云端凭据动作仍未
验证。云端 worker 仍是 `approval: never`，
agent 在自己的 workspace 内不受审批约束。云端凭据动作仍需 Rayrun 提供 host/agent
隔离或 host-only 端点（ADR-001）。云端 bot 仍应只跑在你准备失去的凭据和机器上。

## 能自托管吗？

我们这边没有可自托管的东西——没有服务器。你的 DSH 在本地运行。Rayrun 的 CLI 可以
指向自托管的 Rayrun 部署，但那是 Rayrun 的产品，不是本项目的，而且对本用例未验证
（TBD）。

## 上 npm 了吗？能作为插件安装吗？

两个包都已发布到 npm：`dsh-rayrun-bots@0.1.1-alpha.1`（`alpha` tag；`latest` 仍是
旧的 `0.1.0-alpha.0`）和独立的 `dsh-rayrun-computer@1.2.1`（latest）。用一条
`dsh plugin --profile web add` 命令安装两个包，然后重启 DSH；只安装 bot 包即使声明
依赖，也不会启用依赖的 bundle。安装步骤见 [09-deployment.md](09-deployment.md)。

## 我的数据会被上传到什么地方吗？

不会传到我们这里：没有项目服务器。你的 workspace 被推到你自己的 Rayrun 云电脑，
prompt 从那台机器发往 DeepSeek，Rayrun 和 DeepSeek 的条款适用于到达它们的数据。
本仓库不发送遥测。

## 路线图是什么？

简短版：v0.1 是 bot 插件加云电脑依赖，跑在 `dsh web` 上，包含一台电脑、一份 bot
名册、fail-closed 审批和成本栏；v0.2 用你自己的 bot token 加 IM 通道；v1.0 可能加一层
轻量桌面壳。退出标准与“不做什么”清单见[路线图](plans/roadmap.md)。
