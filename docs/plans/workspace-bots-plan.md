# 工作区 Bot 化：把 DSH Workspace 接入 bot

> 状态：2026-11-28，Proposed；**未实现**。本文是计划，不是实现状态事实源；
> 实现状态以 [`../12-status.md`](../12-status.md) 为准。
>
> 相关：[`../02-bot-model.md`](../02-bot-model.md)（bot 定义）、
> [`../06-local-state.md`](../06-local-state.md)（本地状态）、
> [`../03-client-design.md`](../03-client-design.md)（客户端表面）、
> [`../research/grok-bot-feature-matrix.md`](../research/grok-bot-feature-matrix.md)
> （Grok Bot 对照）。

## Context

用户要求：让 DeepSeek Harness **现在的工作区** bot 化。

现状：

- DSH 的 Workspace 是**项目目录的持久注册表**：`ctx.workspaceRegistry` 维护
  `{ id, path, title, sessions }`；目录是 `fs.realpath` 的 canonical path，session
  按 header cwd 归属到 workspace。客户端通过 `ctx.remote.workspace` 读取/创建/
  重命名/排序，UI 在 DSH 左侧栏。
- Rayrun Bot 的 bot 是**独立对象**：有自己的名字、指令、本地 `session.json` /
  `transcript.jsonl`，以及自己的云端目录 `/workspace/.rayrun/bots/<id>/`；detached
  模式在 `$DSH_HOME/state/rayrun-bot/bots/<id>/workspace/` 做本地 git checkout。
- 两套模型没有关联：用户现有的项目工作区和它的 DSH session 不在 bot 视野里；Bots
  全屏覆盖后只能通过返回按钮回到 DSH。bot 也看不到用户项目文件，除非用户手工同步。

目标：让一个 bot 可以**以某个 DSH workspace（项目目录）为工作目录**，用户在 bot
里工作时，bot 读写的是该项目上下文，而不是一个空的 bot workspace；同时不破坏现有
DSH Workspace UI 和 bot 名册。

## 解释与推荐

"工作区 bot 化"至少有三解：

1. **绑定工作目录（推荐第一版）**：用户把一个 bot 绑定到一个 DSH workspace；
   bot 的本地工作目录指向该路径（或它的受控副本），bot 详情显示 workspace；
   bot 在该项目上下文里执行任务。
2. **历史会话迁移**：把 workspace 已有的 DSH sessions / transcript 导入 bot，
   让 bot 继承过去的对话。工作量和数据语义都更大，第一版不做。
3. **自动为每个 workspace 建 bot**：workspace 行自动出现同名 bot。容易产生噪音和
   意外授权，第一版只支持用户显式绑定/解绑。

推荐：第一版做 1，并只做最小 UI；2 留作后续；3 不做（最多提供"从 workspace 创建
bot"的显式动作）。

## 非目标

- 不替换、重写或 fork DSH 的 Workspaces UI；DSH 仍是宿主。
- 不自动把账号里所有 workspace 绑定/创建 bot。
- 不迁移历史 DSH session 或 transcript。
- 不做多 bot 共享同一工作目录（第一版 1:1；后续再评估）。
- 不改变 ADR-020：云电脑仍是 agent 的安全容器；绑定是用户对项目目录的**显式授权**，
  不是沙箱，也不使 bot 成为安全边界。
- 不把 workspace 内容写进日志、RPC 响应或聊天记录；不自动同步 secrets、`.git`、
  `node_modules` 等（见安全）。

## 产品行为（第一版）

1. **新建/编辑 bot 时选择 workspace**：表单列出 DSH workspace（名称 + 路径）；
   默认"不绑定"。从 DSH workspace 行也可以"用此工作区创建 bot"。
2. **bot 详情显示 workspace**：名称、路径、绑定状态；提供解绑。workspace 被删除或
   路径不可读时显示警告，不回退到其他目录。
3. **执行上下文**：绑定的 bot 使用该 workspace 作为项目目录。第一版建议先把
   workspace 复制/同步到 bot 自己的本地 checkout（`bots/<id>/workspace/`），而不是
   bot 直接写用户目录；这样冲突和权限可控，且不改变现有 `bot-workspace.js` 的
   信任边界。是否允许直接读写用户目录，见开放问题。
4. **云端**：cloudHost 模式下 bot 仍在云电脑执行。第一版**不自动上传**本地项目；
   bot 的云端 workspace 仍由云 host 管理。是否用依赖的 workspace sync 把项目带到
   云端，见开放问题。
5. **返回/切回**：保留 ADR-022 的返回 DSH 按钮；绑定不改变 DSH 的 workspace 归属或
   session 列表。

## 可逆性与回退（回得来吗）

第一版的设计目标是**完全可逆**：

- 绑定只写 bot 的 `workspace` 引用；不修改 DSH workspace 的 `path`/`title`/`sessions`，
  不移动/重命名目录，不删除 DSH session。
- DSH 侧继续可用：ADR-022 的返回按钮随时回 DSH；原 workspace 的会话、文件和运行中的
  DSH turn 都不受影响。
- 解绑 = 删除 bot 的 `workspace` 字段；bot 回到自己的独立 workspace。bot 的
  session/transcript/审批/云电脑不丢。
- 受控副本（`bots/<id>/workspace/`）不写用户原目录，所以解绑不会覆盖项目文件；
  副本默认保留，按明确清理或 TTL 删除，不自动删除用户数据。
- 运行中任务：解绑时若 bot 有 running turn，**拒绝解绑**（fail closed，提示先等完成）；
  不静默中断。
- workspace 被 DSH 删除/移动、或路径不可读：绑定标记 `stale`，bot 不自动改用其他
  目录；新 turn 失败关闭并提示，已有对话保留。
- 回退测试：绑定 → 解绑 → DSH 会话继续；绑定 → 删 workspace → bot stale；
  运行中解绑被拒。

## 会话关系（两套 session 怎么办）

第一版：**DSH session 与 bot session 并列，不合并。**

- DSH workspace 的 sessions 是 DSH 原生 session，留在 DSH；绑定**不读取、不导入、
  不改写**它们。
- bot 的 session（`bots/<id>/session.json`、`transcript.jsonl`、云端 DSH session）
  只在 Bots 里；解绑/回 DSH 都不影响它。
- 同一项目目录、两套上下文：在 Bots 里聊进 bot session，在 DSH 里聊进 DSH session。
- bot **不会自动记得项目旧对话**；UI 文案要明确这一点，不承诺“同一个聊天窗口”。
- 后续可选（不在第一版）：
  1. **只读导入**：把指定 DSH session 的 transcript 摘要作为 bot 参考资料，不写回 DSH。
  2. **链接展示**：bot 详情列出 workspace 的 DSH 会话，点击跳回 DSH，不合并。
  3. **迁移/接管**：把 DSH session 变成 bot session；双向不一致风险最大，需要单独 ADR。

## 与 Superagent 的关系

两者共享同一套 bot/session/cloudHost/审批模型，是同一演进线的两个层次，不是两个
平行产品：

- **superagent 解决“谁安排工作”**：账户级 primary + worker roster + 云端单层委派。
- **workspace 化解决“worker 在哪个项目里工作”**：bot 的项目目录上下文。

衔接约定（第一版）：

1. workspace 是 **bot 的属性**（`bot.json.workspace`）；primary 和 worker 使用同一个
   bot 模型，不新增与 bot 并列的第二套“工作区对象”。
2. **primary 默认不绑定 workspace**：primary 是协调者，简单任务在自己的云端 workspace
   直接做；具体项目交给 worker。后续需要再单独决策 primary 是否绑定默认项目。
3. **同一 workspace 第一版只绑定一个 bot**（1:1），避免两个 worker 同时写同一个受控
   副本；与本文的 1:1 约束一致。
4. superagent 的 roster 可带 workspace 元数据（id/title），只用于 primary 的委派判断；
   委派块仍只传 bot id + task，workspace 路径由 cloud host 从 bot 定义解析，不能由
   primary 自由指定。
5. delegation record 记录 `targetBotId`（可选 `workspaceId`），不记录 workspace 内容；
   DSH session、bot session、delegation record 是三层并列的审计，不合并。
6. 审批语义不变：workspace 化不引入新的授权边界；worker 的审批仍由 host 生成并汇总
   到 primary（ADR-019/ADR-022）。

演进顺序（无硬依赖，可串行）：

- 推荐先做 superagent 步骤 1（本地 primary 身份/roster），再做 workspace 绑定，最后
  接 superagent 的委派链；workspace 不阻塞 superagent。
- 或者先把 workspace 绑定落地（bot 模型变更小、可逆），superagent 的 roster 直接
  继承 workspace 元数据。
- 两者都完成后再进入任务系统（Ticket/Report）和多 worker；Rayrun 串行队列不变。

## 数据模型

`bot.json` 增加可选字段（schema 1，向后兼容）：

```json
{
  "workspace": {
    "id": "ws-uuid",
    "path": "/home/user/project",
    "title": "project"
  }
}
```

- `id` 必须是 `workspaceRegistry` 中存在的 workspace id；`path` 必须等于其
  canonical path。校验失败关闭，不静默改写。
- 只存引用，不复制内容。
- 读取时 workspace 已不存在：保留 `workspace` 但标记 `stale: true`（RPC 派生字段），
  不删除 bot，也不改写 path。
- 解绑 = 删除字段；不删除任何目录。

本地可选同步元数据（不放进 `bot.json`）：

```
bots/<id>/workspace.json   # { schema: 1, sourceWorkspaceId, syncedAt, strategy }
```

## 实现步骤

### 1. host：workspace 读取与绑定

- host half 通过 `ctx.inject(['workspaceRegistry'])` 读取 workspace；服务不存在时
  整个功能关闭（`bots.list` 不返回 workspace 能力，创建/更新拒绝绑定）。
- `bots.create` / `bots.update` 接受 `workspaceId`，用 registry 校验 id/path；
  校验失败返回稳定错误码 + locale。
- `bots.list` 返回每个 bot 的 workspace（id/title/path/stale）。
- 测试：`test/bot-store.mjs` 或新增 `test/workspace-bind.mjs`：合法绑定、非法 id、
  路径变化、workspace 删除、无 registry 失败关闭、解绑不删目录。

### 2. runtime：把 workspace 作为项目上下文

- **第一版（推荐）**：`lib/bot-workspace.js` 在初始化 bot checkout 时，若 bot 绑定了
  workspace，则把 workspace 内容复制/同步到 `bots/<id>/workspace/`（受控副本），
  bot 仍只在这个副本里工作。忽略规则：`.git/`、`.dsh/`、`node_modules/`、`.env`、
  token/key 文件；大小上限。
- detached：现有 `dsh.start` 的 `local_dir` 继续指向该副本，不直接指向用户目录。
- cloudHost：第一版保持不变（云 host 使用自己的 `/workspace/.rayrun/bots/<id>/`）；
  不把本地项目自动上传。后续可用依赖的 workspace sync（`rayrun_workspace`）做
  push/pull，沿用两侧 SHA-256 与不自动应用 pull 的规则。
- 测试：副本策略、忽略规则、大目录/权限失败关闭、workspace 删除后不重复创建。

### 3. client：绑定 UI

- 新建/编辑 bot 表单增加 workspace 选择（来自 `bots.list` 的 workspace 能力或
  独立 RPC；不直接信任客户端传入的 path）。
- 详情增加 Workspace 行：名称/路径/解绑；`stale` 时显示警告。
- 不新增独立页面；不替换 DSH Workspaces。
- 测试：`client-contract` 的文案与控件断言；locale 三处同步；页面 smoke。

### 4. 从 workspace 出发的入口（可选，第二版）

- 在 DSH workspace 行的 slot（若 DSH 暴露）注入"Open bot"或"Create bot here"。
- 若 DSH 没有稳定 slot，先只做 Bots 内的选择器，不逆向注入宿主 UI。

## 验证

1. 单元/契约：
   - 新增 `node packages/dsh-rayrun-bots/test/workspace-bind.mjs`
   - `node packages/dsh-rayrun-bots/test/bot-store.mjs`
   - `node packages/dsh-rayrun-bots/test/client-contract.mjs`
   - `node packages/dsh-rayrun-bots/test/locale-audit.mjs`
2. 页面 smoke：绑定 workspace → 详情显示；解绑；workspace 删除后显示 stale；
   创建 bot 时选择 workspace。
3. live（Rayrun）：绑定的 bot 在受控副本里执行 detached 任务，结果回收到 transcript；
   确认用户原目录未被 bot 直接写入。
4. 失败关闭：无 `workspaceRegistry`、路径不可读、非目录、绑定后 workspace 删除。

## 风险与开放问题

- **安全**：绑定意味着 bot 可以看到项目内容并（经副本）写入；如果后续允许直接读写
  用户目录或上传到云电脑，agent 的 `danger-full-access` 会扩大到项目文件。第一版用
  副本 + 忽略规则，绑定确认文案必须写明范围；不把它说成沙箱。
- **所有权与冲突**：DSH workspace 的目录由用户/DSH 拥有，bot 的副本是派生物；副本
  覆盖/合并策略需要明确（沿用依赖 workspace sync 的 pull 不自动应用规则）。
- **大项目/成本**：复制或上传整个项目可能很慢且计费；需要大小上限和忽略规则。
- **历史会话**：第一版不迁移；用户可能期待 bot 记得项目旧对话，需在 UI 文案中说明。
- **DSH API 稳定性**：`workspaceRegistry` / `remote.workspace` 是 DSH 内部包 API；
  需要版本契约（`engines.dsh`）与缺失时关闭功能，不猜路径。
- **多 bot / 多 workspace**：第一版 1:1；同项目多 bot、跨 workspace 的 bot 都留到
  后续决策。

## 需要用户决策

1. 会话关系：并列（推荐）还是只读导入/迁移？
2. bot 与 workspace 是 **1:1**，还是允许多 bot 共享一个项目？
3. 第一版执行上下文用**受控副本**（推荐，安全可控），还是允许 bot 直接读写用户目录？
4. cloudHost 第一版是否需要把项目同步到云电脑，还是只做 detached？
