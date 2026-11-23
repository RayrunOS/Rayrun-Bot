# Rayrun Bot 顶层工程指令

> 本文件是 Claude Code 在本仓库中的项目级**指令**，不承载项目状态、交付进度或文档索引。
> 状态入口：`docs/12-status.md`。根 `README.md` / `README.zh-CN.md` 是营销页，不承载事实。
> 文档索引：`docs/README.md`；营销页：`README.md`；事实与设计：`docs/`。
>
> 本文件用中文。产品 README 是英中双语营销页；`docs/` 全部用中文；代码、注释、接口命名和提交信息用英文（见 §5）。

**取舍：** 这些规则偏向谨慎而非速度；琐碎任务自行判断。

## 0. 项目身份

- 项目：**Rayrun Bot**（`RayrunOS/Rayrun-Bot`）。给 DeepSeek Harness 里的 bot 一个名字、一副身体和一个家：bot 有名字、指令、记忆和日程，运行在用户自己的 Rayrun 云电脑上，用用户自己的 DeepSeek key 思考。
- 不是托管的聊天服务：没有项目方账号、控制面、代理或中继。计算在用户的 Rayrun 账号上，模型账单是用户的，审批提示就是契约。
- 本仓库构建的是 **bot 层**。云电脑能力来自独立项目 `RayrunOS/dsh-rayrun-computer`（MIT），本项目只通过它已发布的 tools/RPC 表面和版本契约消费它。两个插件，一个产品。
- 真相源：`docs/12-status.md`（实现状态，唯一事实源）、`docs/`（产品方向、架构与设计细节）、代码本身。`README.md` / `README.zh-CN.md` 是英中双语营销页，不是事实依据；不要从 README 推断实现状态。不要凭记忆描述现状；先读文件。
- 不要把本项目描述成完整的托管平台或已经可用的产品；状态陈述以 `docs/12-status.md` 为准。

## 1. 设计原则

### 1.1 四条通用原则

以下四条改编自 Andrej Karpathy 2026 年 1 月关于 LLM 编码陷阱的观察（经 MIT 许可的 `multica-ai/andrej-karpathy-skills` artifact）。项目特定规则更具体时优先。

1. **先想后写。** 不假设、不隐藏困惑、摆出取舍。实现前说明假设；有多种解释就列出，不要静默选择；有更简单的方案就说；不清楚时停下，点名困惑并提问。
2. **简单优先。** 用能解决问题的最少代码，不做投机设计。不实现没要求的功能；不为单次使用造抽象；不加未要求的“灵活性”“可配置性”或未来扩展点；不为不可能发生的场景堆错误处理——信任边界除外（见 §6）。200 行能 50 行解决就重写。
3. **外科手术式修改。** 只碰必须碰的。不顺手“改进”相邻代码、注释或格式；不重构没坏的代码；匹配现有风格。本次变更造成的 orphan（未使用的 import/变量/函数/文件）必须清理；变更前就存在的死代码只指出，不擅自删除。判据：每一行变更都能直接追溯到用户请求。
4. **目标驱动执行。** 把任务转化为可验证目标，例如“加校验”= 先为非法输入写测试再让它通过；“修 bug”= 先写复现测试；“重构 X”= 重构前后测试都通过。多步骤任务先给简短计划，每步写验证方式：`步骤 → 验证: [检查]`。用证据宣告完成，不用“应该能跑”。

### 1.2 本项目原则

- **Local-first where it protects the user.** 审批、本地 profile 和 Rayrun token 留在用户一侧；执行可以离开本机，决策和凭据不行。
- **Approval-first, fail closed.** 有外部副作用的行为先请求、后执行；超时、错误或未知状态一律拒绝。
- **用户付费，用户所有.** 所有计算走用户自己的 Rayrun 账号和 DeepSeek key，不经项目方账号、代理或中转。
- **Boring on purpose.** 纯 ESM、零运行时依赖、无构建步骤；桌面端和云端跑同一套 DSH。

## 2. 仓库分层

- `README.md` / `README.zh-CN.md` — 英中双语营销页；英文为准，中文同 commit 镜像；不承载状态、版本、安装细节或验证读数。
- `CLAUDE.md` — 本文件，只放指令。
- `docs/README.md` — 文档索引、分类与 ADR 登记册。
- `docs/12-status.md` — 实现状态的唯一事实源。
- `docs/` — 编号顶层文档：00-product-direction、01-system-architecture、02-bot-model、03-client-design、04-cloud-host、05-approvals、06-local-state、07-security、08-integration、09-deployment、10-rayrun-verification、11-dsh-rayrun-computer-issues、12-status、faq；子目录：`adr/`（ADR 登记）、`plans/`（MVP/客户端/路线图）、`design/`（UI/人格）、`research/`（调研）、`mockups/`（视觉素材）。
- `packages/dsh-rayrun-bots/` — 目前唯一的包：host half（`index.js`）、client half（`client.js`）、`lib/`、`cloud-host/`（随包交付的云 host 资产：queue/DSH agent）、`locale/en.json` + `zh.json`、`test/`、`cordis.patch.yml`、包 `README.md`、`package.json`。
- `tools/update-poc/` — 更新内核原型（签名 manifest、校验、暂存、原子切换、回滚）；不进入插件运行时，也不进 npm 包。
- `tools/rayrun-deploy/` — CI 部署 helper（`fetch-url.mjs`）与部署契约测试；不进入插件运行时，也不进 npm 包。
- 根 `package.json` — 私有 workspace 根；无依赖、无构建步骤。
- `.github/workflows/checks.yml` — push/PR 的 checks CI，以及 main-only 的可选 Rayrun deploy job。
- `.github/scripts/deploy-rayrun.mjs` — deploy job 调用的 Rayrun 沙盒部署脚本（上传、安装、重启 `dsh web`）。
- `LICENSE`、`SECURITY.md`、`CONTRIBUTING.md`、`CODE_OF_CONDUCT.md` — 许可证、漏洞上报、PR 规则与行为准则。
- 非本仓库：`dsh-rayrun-computer`（独立项目，绝不修改、fork 或 vendor）、Rayrun 平台、DeepSeek Harness 运行时。

## 3. 模块边界与依赖

- **bot 层 ↔ 云电脑插件。** 只通过已发布的 tools/RPC 表面和版本契约集成。需要它改行为 → 去它自己的仓库提 issue/PR，或在本仓库写 adapter；不修改、不 fork、不 vendor、不复制它的代码。
- **包身份。** 每个包的包名、client module id、bundle row `name` 必须一致；`lib/*.js` 必须留在 `files` 列表；client half 必须自包含，只能加载 DSH 自身提供的模块。
- **本机 ↔ 云端。** 执行可以在云端，审批、本地 profile 和 Rayrun token 留在本机。云端 → 本机状态通过 `/workspace/.rayrun/` 下的文件，本机 → 云端通过 Rayrun API；不使用入站网络，不把 public desktop 当产品面板。
- **页面 ↔ host。** 同源、origin 校验的 RPC；不要把 token 交给页面来绕过它。
- **依赖方向。** 根 `package.json` 是私有 workspace 根，无运行时依赖。`dsh-rayrun-computer` 的版本契约与安装路径以 `docs/09-deployment.md`、`docs/version-matrix.md` 和 `docs/plans/mvp-plan.md` §4.5 为准。

## 4. Claude Code 工作方式

当用户要求实现或修改代码时，Claude **严格**按以下方式工作：

1. 明确任务目标、成功标准和可能影响的包、文档与模块。
2. 需求不完整时显式说明假设，不假设需求已完整。
3. 有多种解释时列出主要解释；不阻塞时选最合理路径继续，影响长期架构时停下询问。
4. 有更简单方案主动说明；过度复杂、维护成本高或偏离 MVP 时反向提醒。
5. 读本文件、`docs/12-status.md`、目标包的 `README.md` 和相关 `docs/` 页；读要改的代码，不凭记忆。根 README 只作营销叙事，不作为事实来源。
6. 跨包、跨项目变更先说明影响面，再改代码。
7. 先 grep 找最接近的现有模式并扩展它；不为仓库已有的东西造平行 helper。
8. 最小 diff；不顺手优化相邻代码、注释或格式；不重构没坏且不属于当前任务的代码；匹配现有风格。
9. 本次变更引入的未使用 import、变量、函数或文件必须清理；变更前已存在的死代码只指出，不擅自删除。
10. 用户可见变更 → 同一次变更更新 `docs/12-status.md`；涉及营销叙事时同步更新 `README.md` 和 `README.zh-CN.md`；相关 `docs/` 页同步。
11. 非平凡任务先给简短计划，每步写验证方式（`步骤 → 验证: [检查]`）。
12. 运行 §8 的检查；不用“应该能跑”宣告完成。
13. 完成后说明改了哪些文件、如何验证、剩余风险与未覆盖的缺口。
14. 不一次性重写大量文件，除非用户明确要求。
15. 临时实验代码不入核心包；放临时目录或明确标记。
16. 每行变更可追溯到用户请求、已声明假设或验证目标。
17. 提交用英文 conventional prefix：`feat:`、`fix:`、`chore:`、`docs:`；一个逻辑变更一个提交。
18. 不提交 `.env`、token、key、本地 profile 路径或云端拉取产物（`.dsh/incoming/`）。
19. **push 只在用户当次明确要求时执行。** “commit”/“提交”只授权本地提交；`git push` 或任何写 `origin` 的操作，需要用户当次明确要求 push 或 sync。过去的“同步到 GitHub”不授权之后的 push。本地提交后报告分支领先 `origin`，等待 push 指令。

## 5. 代码风格与工程纪律

- Plain ESM JavaScript，Node 24+（DSH 运行时自带 Node）。无构建步骤、无运行时依赖、无 bundler。
- Client half 只能加载 DSH 提供的模块（`react` 等）；浏览器全局对象可用，Node 内置模块不可用。
- 代码、注释、接口命名和提交信息用英文；产品 README 是英中双语营销页，英文为准并维护中文镜像；`docs/` 全部用中文（技术标识、代码、schema、UI 文案保持英文）。**本文件是刻意使用中文的 agent 指令**。
- 错误：审批、凭据、云生命周期相关的错误绝不吞掉；给出可执行的信息，让调用方失败（fail closed）。
- 不实现用户没要求的功能；不为单次使用造不必要的抽象；不加未要求的“灵活性”“可配置性”或未来扩展点；不为不可能发生的场景堆错误处理——信任边界（RPC、审批、凭据、文件/网络入口）除外。
- 200 行能 50 行解决就重写；提交前自问资深工程师会不会认为过度复杂，会就简化。
- 不引入遥测；默认不收集、不上传任何数据。
- 不写死不可复现的本机路径。
- 测试沿用现有 `node test/<name>.mjs` 模式，不引入测试框架。

## 6. 安全与权限默认值（不变量，永不破坏）

1. **审批优先，失败即拒绝。** 任何有外部副作用的动作（花钱、以用户身份发送或发布、销毁电脑、触碰另一台机器或凭据）必须在请求并获批后才执行。超时、错误或未知状态 = 拒绝，绝不继续。
2. **用户密钥永不离开用户机器。** Rayrun token 只存在于 Harness vault、host 侧，绝不进入 client module、RPC 响应或日志。DeepSeek key 只经 Rayrun credential injection 注入，绝不进入 workspace、仓库、fixture、prompt 或聊天。密码只留在内存。
3. **用户付费，用户所有。** 每个 bot 都跑在用户自己的 Rayrun 账号和 key 上。任何代码路径都不得把计算、数据或计费转到项目方账号、代理或中继。
4. **执行可以离开本机；权限与凭据不行。** bot 跑在用户自己的云电脑上，session 可以放在那里；但审批、本地 profile 和 Rayrun token 留在用户侧。不要为了简化功能把决策或密钥移到云端。
5. **不静默扩大范围。** 除非任务明确要求，不新增审批绕过、默认放行规则、新权限或新网络出口。
6. **包身份保持一致。** 每个包的包名、client module id、bundle row `name` 必须相同；`lib/*.js` 必须留在 `files` 列表；client half 必须自包含，只加载 DSH 自身提供的模块。
7. **永不自动销毁。** Rayrun 的 `destroy` 会不可逆地删除机器及其 workspace。idle 策略只能 stop 或 pause；销毁必须由人类明确请求。
8. **同源 RPC。** 新的 page→host 动作保持同源、origin 校验的 RPC 属性；不要把 token 交给页面来绕过它。
9. **文档诚实。** 绝不把计划中的功能写成已实现。`docs/12-status.md` 中带日期的状态陈述是事实；做了就更新，发现失效的说法就修。README 营销叙事不得声称未实现的功能已经可用。
10. **默认无遥测。** 不收集、不上传任何东西。未来的遥测必须 opt-in、有文档，且绝不包含 prompt、key 或 workspace 内容。
11. **没有 bubblewrap 的云端就是 root。** worker profile 故意跑 `danger-full-access`，这是 workaround，不是隔离。绝不把它说成沙箱保证，也不削弱 `docs/07-security.md` 中的警告。
12. **云电脑插件是依赖，不是我们的代码。** `dsh-rayrun-computer` 在自己的仓库里，绝不从这里编辑、fork 或 vendor。集成只通过其已发布 tools/RPC 表面和版本契约；需要它改行为 → 去那个仓库开 issue/PR，或在本仓库写 adapter。
13. **CI 部署凭据是维护者凭据，不是产品运行时凭据。** Rayrun deploy token 只存 GitHub Actions secret，只用于 main-only deploy job；不进仓库、日志、沙盒、client 或 RPC。PR/fork 永远不运行部署。今天 Rayrun token 是账号级、无 scope；用专用、可吊销的 token。

## 7. 文档约定

- `README.md` / `README.zh-CN.md` 是营销页：英中双语，英文为准，**同一 commit 更新**。只放产品叙事、价值主张、概念图和指向 `docs/` 的入口；不承载状态、版本号、安装步骤、配置表、验证读数或 CI 细节。
- 状态陈述带日期、与代码一致；构建了某功能就更新状态；“状态”以 `docs/12-status.md` 为准，不在本文件复述。
- `docs/` 全部用中文；技术标识、代码、schema、UI 文案保持英文。新增文档先登记到 `docs/README.md` 的文档地图；新增决策在 ADR 登记册加一行。Markdown 链接必须可解析。
- 本文件只承载指令，不承载项目状态、交付进度或文档索引。
- 产品方向以 `docs/00-product-direction.md` 为准，技术基线以 `docs/01-system-architecture.md` 为准；实现状态只回 `docs/12-status.md`。
- 文档事实源与语言由 ADR-018（2026-11-22）决定：README 只做营销，`docs/12-status.md` 是实现状态唯一事实源，`docs/` 全中文。
- 架构性决策同步到 `docs/01-system-architecture.md`、`docs/07-security.md`、`docs/adr/architecture-decisions.md` 或对应计划页；平台相关缺口进 `docs/08-integration.md`。
- 不描述不存在的功能；不夸大安全保证。代码与文档冲突时，先核实当前行为，再修正错误的一方。

## 8. 测试与验证

```bash
git diff --check
node --check packages/dsh-rayrun-bots/index.js
node --check packages/dsh-rayrun-bots/client.js
node packages/dsh-rayrun-bots/test/manifest-check.mjs
node packages/dsh-rayrun-bots/test/locale-audit.mjs
node packages/dsh-rayrun-bots/test/rpc-contract.mjs
node packages/dsh-rayrun-bots/test/client-contract.mjs
node packages/dsh-rayrun-bots/test/bot-store.mjs
node packages/dsh-rayrun-bots/test/session-runtime.mjs
node packages/dsh-rayrun-bots/test/routines.mjs
node packages/dsh-rayrun-bots/test/routine-results.mjs
node packages/dsh-rayrun-bots/test/cloud-host-routines.mjs
node packages/dsh-rayrun-bots/test/cloud-routine-bridge.mjs
node packages/dsh-rayrun-bots/test/cloud-routine-e2e.mjs
node packages/dsh-rayrun-bots/test/rayrun-runtime.mjs
node packages/dsh-rayrun-bots/test/rayrun-detached-runtime.mjs
node packages/dsh-rayrun-bots/test/runtime-rpc.mjs
node packages/dsh-rayrun-bots/test/cloud-host-runtime.mjs
node packages/dsh-rayrun-bots/test/host-projection.mjs
node packages/dsh-rayrun-bots/test/cloud-host.mjs
node packages/dsh-rayrun-bots/test/cloud-host-dsh-agent.mjs
node packages/dsh-rayrun-bots/test/bot-workspace.mjs
node packages/dsh-rayrun-bots/test/dependency.mjs
node packages/dsh-rayrun-bots/test/approvals.mjs
node packages/dsh-rayrun-bots/test/package-contents.mjs
node tools/update-poc/test/update.mjs
node tools/rayrun-deploy/test/contract.mjs
```

- 新行为必须带测试；测试是纯 Node、无框架，沿用 `node test/*.mjs`。
- 审批拒绝、超时、密钥泄漏的负向测试在该代码出现后是强制项。
- 绝不为了让改动通过而削弱或删除安全测试；修行为，或说明为什么测试本身错了。
- 实时集成测试需要真实 Rayrun 凭据，绝不在 CI 运行。
- 页面变更只做语法/契约检查不算打通；v0.1 没有浏览器测试框架，手工 golden path 见 `docs/plans/client-plan.md`。
- CI（`.github/workflows/checks.yml`）在 push/PR 上跑语法检查、所有 `test/*.mjs`、更新内核原型的测试和 Rayrun 部署契约。push 到 main 的可选 `deploy` job 只在配置了 `RAYRUN_TOKEN`/`RAYRUN_SANDBOX_ID` 且 `packages/dsh-rayrun-bots/**` 有变更时运行；它使用真实 Rayrun token，只做部署，不做集成测试。

**“完成”的标准：**

- 用户请求的成功标准以证据满足（命令输出、截图、测试结果），不是“应该能跑”。
- 所有改动文件通过上述检查。
- Markdown 链接可解析；没有文档声称不存在的功能。
- 代码、日志、fixture、diff 中没有密钥、凭据或 token。
- 没有新依赖、无关 diff、无关重构。
- `docs/12-status.md` 与代码一致；`README.md` / `README.zh-CN.md` 仍是诚实的营销叙事；`CLAUDE.md` 仍然准确。

审批层或密钥处理的变更，手工冒烟测试是：把插件载入本地 DSH profile，启动一个 bot，触发一个受控动作，确认它停在审批上。在该路径存在之前，变更必须在纸面上保持这条规则为真，并明确说明缺口。

## 9. 当前可用命令

| 命令 | 说明 |
| --- | --- |
| `git diff --check` | 检查尾随空白与冲突标记 |
| `node --check packages/dsh-rayrun-bots/index.js` | host half 语法检查 |
| `node --check packages/dsh-rayrun-bots/client.js` | client half 语法检查 |
| `node packages/dsh-rayrun-bots/test/manifest-check.mjs` | 包清单、bundle 与身份一致性 |
| `node packages/dsh-rayrun-bots/test/locale-audit.mjs` | en/zh key 对齐、内嵌 locale 一致 |
| `node packages/dsh-rayrun-bots/test/rpc-contract.mjs` | RPC 信封、同源门、体积上限 |
| `node packages/dsh-rayrun-bots/test/client-contract.mjs` | 客户端文案、无外部请求、无占位符 |
| `node packages/dsh-rayrun-bots/test/bot-store.mjs` | 持久 roster：校验、原子写、创建、更新、删除 |
| `node packages/dsh-rayrun-bots/test/session-runtime.mjs` | 持久 session/transcript：队列、fake runtime、失败脱敏、重启恢复 |
| `node packages/dsh-rayrun-bots/test/routines.mjs` | 本地 routines：schema/上限、到期选择、busy/失败关闭、scheduler 入队与 timer |
| `node packages/dsh-rayrun-bots/test/routine-results.mjs` | 云端 routine 结果：校验、去重、history 合并、无 session 与损坏文件 |
| `node packages/dsh-rayrun-bots/test/cloud-host-routines.mjs` | 云 host routine scheduler：镜像定义、claim、busy、损坏文件、结果文件 |
| `node packages/dsh-rayrun-bots/test/cloud-routine-bridge.mjs` | 本地↔云 routine bridge：定义上传、停机不读、结果导入/去重/拒绝 |
| `node packages/dsh-rayrun-bots/test/cloud-routine-e2e.mjs` | fake 端到端：本地 routine → 云调度/队列 → 结果导入本地 history |
| `node packages/dsh-rayrun-bots/test/rayrun-runtime.mjs` | `rayrun_agent` adapter：prompt、机器选择、失败映射、拒绝自动建机器 |
| `node packages/dsh-rayrun-bots/test/rayrun-detached-runtime.mjs` | `dsh.start/status/result` adapter：workspace、task id、reply.md、错误映射 |
| `node packages/dsh-rayrun-bots/test/runtime-rpc.mjs` | 依赖 1.2+ `runtime.*` host RPC client：动作、无 token、创建语义、错误映射 |
| `node packages/dsh-rayrun-bots/test/cloud-host-runtime.mjs` | 云 host runtime adapter：机器启动、runtime ensure、projection、inbox/outbox、错误关闭 |
| `node packages/dsh-rayrun-bots/test/host-projection.mjs` | host 资产 SHA-256 manifest、上传/回读校验、缓存、失败关闭 |
| `node packages/dsh-rayrun-bots/test/cloud-host.mjs` | 云 host：队列、transcript、outbox、恢复、去重、日志脱敏 |
| `node packages/dsh-rayrun-bots/test/cloud-host-dsh-agent.mjs` | 云 host DSH agent：profile bootstrap、headless JSON、session id、错误脱敏 |
| `node packages/dsh-rayrun-bots/test/bot-workspace.mjs` | 每 bot 的本地 git checkout：幂等、非 git 失败关闭 |
| `node packages/dsh-rayrun-bots/test/dependency.mjs` | 依赖检测与 1.1+ detached 版本门 |
| `node packages/dsh-rayrun-bots/test/approvals.mjs` | 审批协议：schema、canonical hash、TTL、幂等/重放、审计 |
| `node packages/dsh-rayrun-bots/test/package-contents.mjs` | npm tarball 内容：host/client/locale/lib/bundle 与排除项 |
| `node tools/update-poc/test/update.mjs` | 更新内核原型：签名、哈希、版本、原子切换、回滚 |
| `node tools/rayrun-deploy/test/contract.mjs` | Rayrun 部署契约：main-only、secret 来源、URL 不打印 |
| `dsh plugin --profile web add <绝对路径>` | 从 checkout 载入 DSH profile；改 client half 后需重启 DSH |
| `git log --oneline` | 查看提交历史 |

不要编造命令、路径或状态。

## 10. 禁止事项

- 不提交密钥、token、cookie、私有证书、生产配置、客户数据、`.env`、本地 profile 路径或云端拉取产物。
- 不绕过审批层或同源 RPC；不新增默认放行、权限或网络出口。
- 不把“计划中”写成“已实现”；不把 `danger-full-access` 描述成隔离或沙箱。
- 不修改、fork 或 vendor `dsh-rayrun-computer`；不把它的代码复制进本仓库。
- 不自动 destroy；idle 只能 stop 或 pause。
- 不静默扩大任务范围；新增功能、重构、依赖和目录调整都必须能解释必要性。
- 不掩盖困惑、失败或测试结果；不清楚就直说。
- 不在没有当次明确指令时 push 或部署到公网。
- 不引入遥测。
- 不编造命令、路径或状态。

## 11. 沟通偏好

- 默认中文解释架构与取舍；代码、目录、接口、协议命名用英文；产品文档和提交信息用英文。
- 回答直接，优先给可执行步骤、文件路径和具体修改点。
- 需求不完整但不阻塞时，先做合理假设并继续推进；会影响长期架构时，明确提出需要用户决策。
- 说明权衡，不要只给结论；架构、依赖、模块边界和长期维护成本尤其要讲清利弊。
- 简单任务直接完成；复杂任务先给简短计划与验证方式。
- 状态类问题先读 `docs/12-status.md` 和代码再回答，不凭记忆。

## 12. 依赖决策

- 零运行时依赖、无构建步骤是有意的产品选择（boring on purpose），不是临时状态。
- 唯一的外部运行时依赖是独立项目 `dsh-rayrun-computer`；集成走其发布表面和版本契约，依赖声明与版本检查的状态以 `docs/12-status.md` 和 `docs/version-matrix.md` 为准。
- 新增依赖前说明：现有能力为何不够、替代方案、影响范围、是否破坏零依赖/无构建；需要用户明确同意。
- 不 vendor、不 fork、不复制它的代码；需要它改行为去它自己的仓库。
- 不为测试引入框架；沿用 `node test/*.mjs`。

## 13. 常见陷阱

- **包身份三处一致。** `package.json` 的 `name`、`client.js` 中 `window.__ModuleLoader__.load({ id })` 的 `id`、`cordis.patch.yml` 的 `name` 必须一致；bundle row 的 `id` 必须等于 host 的 `name`（`rayrun-bots`）。`manifest-check` 会抓，但改之前先看这三处。
- **客户端是自包含的。** `client.js` 通过 `window.__ModuleLoader__` 注册，`factory(require)` 只应拿到 DSH 提供的模块（如 `react`）；不要 import Node 内置模块，也不要把运行时文件加进包却忘了写进 `files`。
- **locale 有三份。** `locale/en.json`、`locale/zh.json` 和 `client.js` 内嵌的 `EN`/`ZH` 必须同步；`client-contract` 检查内嵌副本与 JSON 一致，新增文案要三处一起改。
- **改 client half 要重启 DSH。** 客户端只在页面启动时加载；`dsh plugin add` 后也要重启才能看到。
- **同源门的细节。** POST 没有 `Origin` 视为 host 侧调用（工具、测试），不是浏览器；有 `Origin` 时必须与请求到达的 `Host` 一致。不要“修”成强制要求 `Origin`，否则会打断 host 侧调用。
- **CI 自动跑新测试。** workflow 用 `for test in packages/dsh-rayrun-bots/test/*.mjs`；新增测试文件会被自动执行，无需改 workflow。
- **无 `node_modules`。** 不要跑 `npm install` 或引入包；根 workspace 是私有的、无依赖。
- **状态不在本文件。** 问进度看 `docs/12-status.md`；本文件不维护状态。
- **README 不是事实源。** 根 README 只做营销叙事；不要在 README 写状态表、版本号、安装步骤或验证读数，也不要让其他文档引用 README 证明事实。

---

**这些规则有效的标志：** 不必要的修改更少，因过度复杂而返工更少，澄清发生在实现之前，且没有为了通过测试而削弱任何审批或密钥不变量。
