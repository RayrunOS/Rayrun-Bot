# Super-agent 启示：从 Session 到任务系统

> 状态：2026-11-27。研究/设计笔记，不是实现状态事实源。实现状态以
> [`../12-status.md`](../12-status.md) 为准；产品方向以
> [`../00-product-direction.md`](../00-product-direction.md) 为准。
>
> 来源：[`dsh-superagent-prototype`](https://github.com/deepseek-ai/dsh-superagent-prototype)
> 的 README 与 `docs/000`–`007`，以及阿里云开发者社区的分析
> [《DeepSeek Super-agent 架构解析》](https://developer.aliyun.com/article/1779111)。
> 原型 README 明确说明它是 research prototype，不是生产产品；文章中的部分设计也未在
> 原型实现。本文只把可验证的机制映射到 Rayrun Bot，不把原型当成现成方案。

## 1. 一句话

最值得借鉴的不是“多 agent”，而是：**把 Agent 从 Session 里的聊天回合，变成有
Trigger、Ticket、Mandate、Assignment、Report 的长期任务系统；并把人的注意力当成
最贵的资源。** 这正好补上 Rayrun Bot 从“能完成一轮”到“能持续完成一件事”的中间层。

## 2. 原型在解决什么

传统 Agent 以 Session 为运行单位：用户给目标，模型选工具、执行、返回。任务一多，
问题变成：

- 多个任务的上下文混在一个 Session 里；
- 长工具阻塞后续输入；
- 人要在多个 Session 之间切换、追踪和协调；
- 进程重启后，任务状态和“谁在等谁”丢失。

原型把用户交互、全局任务协调、具体执行拆开，围绕四个目标：Continuous、Productive、
Proactive、Persistent。它的主流程是：

```text
Source → Trigger → Thread → Eval → Ticket → Assignment → Report
```

关键点：

- **Ticket 独立于 Session**：Ticket 有自己的状态、Mandate、Channels 和 Inputs；
  Executor 只是当前的执行者。Session 结束不等于 Ticket 结束。
- **Router / Worker 分离**：主 Session 只做评估、分派、对外沟通；Worker 有独立
  Session 和目录，执行具体工作。
- **事件驱动 + 规则准入**：Fast Path 用确定性规则过滤来源、成员、是否点名；
  只有语义不确定的候选才进入模型 Eval。
- **Thread Subscription**：Worker 接手一个 Thread 后，后续消息直接进入该 Worker，
  不再每次经过 Router。
- **Report 是结构化事实**：progress / waiting / ready / blocked / failed / dropped，
  不是从自由文本猜“是否在等人”。

## 3. 值得借鉴的七个机制

### 3.1 任务对象，而不是只存聊天记录

原型把“工作”从对话里抽出来：一个 Ticket 可以被多次 Assignment 执行、暂停、恢复、
结束；它可以关联多个 Thread；人可以 stop，但 Policy 变化只通知、不撤销 Mandate。

Rayrun Bot 现在持久化的是 bot 的 `session.json` / `transcript.jsonl`，后台任务就是
一轮 turn。缺的是：

- 任务 id、状态、来源、目标；
- 任务与 session/transcript 的关联；
- 任务级报告和“需要人做什么”；
- 任务结束后仍可被后续消息恢复。

**建议：先加最小 Ticket/Report，不急着加新 UI。** 任务状态可以作为 session 旁边
的一层索引；客户端仍只在“需要你”时显示。

### 3.2 Router / Worker 分离，但别先承诺并发

主 Session 不执行长工具，Worker 才执行；这能避免一个长任务阻塞所有新输入。
原型用多个 Worker 并发，但文章的实验也指出代价：多 Session 的缓存/Token 成本上升，
且没有证明代码质量更高。

Rayrun Bot 的现实约束是：一台机器一次只能跑一个 agent 任务（队列串行）。所以：

- 先做**逻辑分离**：一个轻量 dispatcher 判断“新任务 / 跟进 / 忽略”；
- Worker 继续用现有 cloudHost；
- 不把“多 Worker 并发”写进产品承诺，直到平台支持；
- 等平台支持后，再决定是否真的要独立 Session/目录。

### 3.3 Fast Path / Slow Path：规则先进，模型后进

原型先用代码 gate（来源、allowed list、成员、是否点名、admission table）过滤，
只有候选事件才调用模型。它的主动模式是 `off / observe / auto`，默认 `observe`：
只记录“本来会做什么”，不真正接单；`auto` 也必须命中团队写的规则。

这比“让模型自己决定要不要主动”更可控。对 Rayrun Bot 的 routines/事件触发器：

- 先做规则准入，不先做 cron；
- 默认 observe，记录候选但不执行；
- 开启 auto 需要显式规则和范围；
- 规则由代码执行，prompt 不是安全边界。

### 3.4 Thread Subscription：跟进直接回到任务

原型给 Ticket 一个 Subscription 关系：Thread 上的后续 Trigger 直接 fan-out 给
Ticket，不再重新 Eval；人 stop 后不再接收。

Rayrun Bot 目前每条消息都是新的一轮，靠 history 延续上下文。可以加：

- `taskId` / `threadId` 到 session 的映射；
- 后续消息命中已有任务时，直接交付给该任务的 worker；
- 只有真正的新目标才进入分诊；
- 任务结束后的跟进要么恢复任务，要么明确开新任务。

这比“把所有历史塞进 prompt”更便宜，也比每次重新判断更稳定。

### 3.5 Context 是缓存：Inline & Spill + Chain of Recall

原型的做法：

- Inline：当前任务摘要、相关 Thread、近期反馈；
- Spill：完整历史/低频信息放外部存储，只在 Context 里留摘要和引用；
- Chain of Recall：用 Trigger/Thread/Ticket/Session 的关联按需恢复历史。

Rayrun Bot 现在把 history 窗口直接交给 worker。长任务会越来越贵，也更容易丢关键
上下文。建议：

- 任务摘要、产物、失败原因写进 workspace；
- prompt 只带摘要和引用；
- 需要时按 task/thread 读取完整记录；
- 记忆不是证据：带日期的事实要回读 workspace。

### 3.6 持久副作用与幂等

原型用单写者 Engine + SQLite + Outbox/Effects：命令在事务里写状态并 enqueue 副作用，
提交后执行；失败重试/退避；Trigger 去重；Receipt 记录消息状态。

Rayrun Bot 已有 session 队列、审批 claim、审批 result outbox，但还没有通用的“外发
消息/动作 outbox”。一旦有 routines、handoff、后台重试，重复副作用是现实风险。

**建议：给回复和 typed 动作加幂等键与持久 outbox。** 这比再加一个重试循环更可靠。

### 3.7 Watchdog：进程活着不等于任务在进展

原型不仅看进程健康，还看 Worker 是否取得实质进展；卡住就恢复或找人。Rayrun Bot
现在能恢复 host 进程、detached poll 和排队任务，但没有“任务是否在原地打转”的判断。

长期任务需要：

- progress heartbeat；
- 无进展/循环检测；
- 超时转 `blocked` 或 `waiting for person`；
- 恢复动作要可审计，不能静默重放副作用。

## 4. 对 Rayrun Bot 的映射

| 原型概念 | Rayrun Bot 的对应 | 现状 | 建议 |
| --- | --- | --- | --- |
| Source / Trigger | 聊天消息、routines、未来的事件 | 聊天/routine 已有，事件源没有 | 先做规则准入，不先做事件市场 |
| Thread | 一个对话/任务线 | 只有 session/transcript | 加 task/thread 关联 |
| Ticket | 一次被授权的工作 | 没有独立对象 | 最小 Ticket 层 |
| Assignment | cloudHost/detached task | 已有 | 把 task id 与 Ticket 关联 |
| Report | bot 回复/错误 | 自由文本 + error code | 结构化 status/attention |
| Channel | transcript/UI/IM | 浏览器已有，IM 是 v0.2 | 统一 receipt |
| Policy / Mandate | 审批 + 规则 | 每动作审批，缺任务级授权 | 增加 off/observe/auto |
| Executor | DSH worker | 已有 | 保持串行，别宣称并行 |
| Outbox | session queue/approval outbox | 局部有 | 通用副作用 outbox |

## 5. 落地顺序（建议）

### P0：最小 Ticket + Report + Receipt

- 给每轮后台任务一个持久 `taskId`、状态和来源；
- Report 用结构化字段：`progress / waiting / ready / blocked / failed / dropped`；
- `attention` 是一个明确字段，不从回复文本猜；
- 客户端先只显示“需要你”的条目和结果，不新增 dashboard；
- 验证：后台任务结束后重开能看到结果、状态和“是否需要人”。

### P1：Thread Subscription

- 后续消息命中已有 task 时，直接回到该 task 的 worker；
- 只有新目标才进入分诊；
- 人 stop 后不再接收；
- 验证：一条任务线多次跟进不重复建任务、不丢上下文。

### P1：Admission + Mandate + observe

- routines/未来的事件触发先走规则 gate；
- 默认 observe，记录候选，不执行；
- 开启 auto 需要显式规则和范围；
- 验证：无关事件不触发；observe 只记录；auto 只执行规则允许的。

### P2：Outbox + Watchdog

- 回复/typed 动作加幂等键和持久 outbox；
- 任务 progress heartbeat / 无进展检测；
- 验证：重试不重复副作用；卡住的任务转 blocked/attention。

### P2+：Router / Worker 分离

- 等平台允许一台机器多个 agent 任务后再做；
- 之前只做逻辑分诊 + 串行队列；
- 不把“多 agent 并发”写进承诺。

## 6. 不该照搬的

- **多 Worker 并发**：收益是调度/长尾，代价是 token/缓存；原型实验没有证明代码质量
  更高，也没有证明真实生产环境同样收益。
- **团队/企业协作**：Team Bots、群聊、RBAC、审计导出不在本项目范围。
- **“Session/目录隔离等于安全隔离”**：原型 Worker 以 OS 用户身份、`danger-full-access`
  运行；这和我们的 ADR-020 一致——云电脑是容器边界，bot 不是安全边界。
- **复杂 Panel**：我们的产品方向是“用户无感知”；只保留“需要你”的入口，不复制
  原型的 Source/Trigger/Eval/Execution 全套面板。
- **把原型当生产依赖**：README 明确说它是研究代码，不是生产产品。

## 7. 开放问题

1. Ticket 和 bot session 的关系：一个 bot 一个 session，还是一任务一个 session？
2. 任务结束后，后续消息是恢复原 Ticket 还是开新 Ticket？
3. Mandate 的粒度：按任务、按动作类型，还是按来源/联系人？
4. routines 的 observe 记录保存多久、在哪里审阅？
5. 通用 outbox 与现有 approval executor 的边界怎么划？
6. 平台支持多任务后，才决定是否拆 Router/Worker 进程。

## 8. 来源

- [dsh-superagent-prototype](https://github.com/deepseek-ai/dsh-superagent-prototype)
  - [000 Philosophy](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/main/docs/000-philosophy.md)
  - [001 Domain model](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/main/docs/001-domain.md)
  - [002 Authorization](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/main/docs/002-authorization.md)
  - [003 Execution](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/main/docs/003-execution.md)
  - [005 Panel](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/main/docs/005-panel.md)
  - [007 Architecture](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/main/docs/007-architecture.md)
- [阿里云：DeepSeek Super-agent 架构解析](https://developer.aliyun.com/article/1779111)（二手分析）
