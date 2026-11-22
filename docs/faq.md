# 常见问题

*状态：2026-11-22。Pre-alpha。两个独立项目：云电脑插件
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
项目。Rayrun Bot 把它当作外部依赖复用，不修改、不 fork、不 vendor。Rayrun Bot 的
bundle 计划把它声明为依赖，让一次安装带两个插件；但 DSH bundle 依赖是否会同时加载
host 和 client 两半，是 W0 spike S6，**未验证**。在那之前——以及两个包都上 npm 之前——
从各自的 checkout 把两个插件装进同一个 DSH profile，然后重启 DSH。

## 为什么这个仓库文档这么多？

因为这是一个从设计起步的项目，而且 bot 层仍在构建中。它不是云电脑插件的 monorepo：
那个包是独立项目，位于
[RayrunOS/dsh-rayrun-computer](https://github.com/RayrunOS/dsh-rayrun-computer)，
并保持独立。文档记录产品方向、架构、审批和验证证据；代码按 v0.1 计划逐步落地。

## 今天能做什么？

把独立的云电脑插件从 checkout 装进 DeepSeek Harness，使用它的七个工具：
create/stop/pause/destroy 机器、跑命令、搬文件、驱动桌面、委派任务、同步 workspace、
project worker 层。它是 Rayrun Bot 的依赖，不是本仓库的一部分。本仓库的
`dsh-rayrun-bots` 也能从 checkout 装进同一个 profile，打开 Bots 壳并持久化本地名册；
对话和审批仍是页内预览。[安装与运行](09-deployment.md)有确切命令和“还缺什么”表，
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

云端路径上还没有，而且在平台能隔离审批者之前不会有。设计契约是 fail-closed（超时或
未知 = 拒绝），DSH 内的审批卡是预览，但云端 worker profile 目前以 `approval: never`
运行，因为无人值守的机器上没有人可以问。agent 可写工作区里的文件邮箱可能被攻陷的 bot
读取并自批，所以 ADR-001（2026-11-21）决定等待 Rayrun 提供 host/agent 权限隔离和
host-only 审批端点。平台提供之前，审批执行不实现，预览不授权任何动作，云端 bot 是
无监督的。

## 能自托管吗？

我们这边没有可自托管的东西——没有服务器。你的 DSH 在本地运行。Rayrun 的 CLI 可以
指向自托管的 Rayrun 部署，但那是 Rayrun 的产品，不是本项目的，而且对本用例未验证
（TBD）。

## 上 npm 了吗？能作为插件安装吗？

两个包都不在 npm 上。bot 包——`dsh-rayrun-bots`，预期的安装名——还不可安装。独立的
`RayrunOS/dsh-rayrun-computer` 云电脑包也不在 npm 上；从 checkout 用
`dsh plugin --profile web add <absolute path>` 安装，然后重启 DSH。发布之前，两者都
保持 checkout 安装。

## 我的数据会被上传到什么地方吗？

不会传到我们这里：没有项目服务器。你的 workspace 被推到你自己的 Rayrun 云电脑，
prompt 从那台机器发往 DeepSeek，Rayrun 和 DeepSeek 的条款适用于到达它们的数据。
本仓库不发送遥测。

## 路线图是什么？

简短版：v0.1 是 bot 插件加云电脑依赖，跑在 `dsh web` 上，包含一台电脑、一份 bot
名册、fail-closed 审批和成本栏；v0.2 用你自己的 bot token 加 IM 通道；v1.0 可能加一层
轻量桌面壳。退出标准与“不做什么”清单见[路线图](plans/roadmap.md)。
