# UI 设计 — v0.1

*状态：2026-11-25（rev 8）。客户端照搬用户分享的参考截图里 Grok Bot 桌面 App 的布局
——左栏聊天列表、中间 markdown 对话、右侧每 bot 详情面板——但使用 rayrunos.com 的
视觉语言：白色画布、深蓝主按钮、蓝色强调、细线边框。审批是内联卡，不是单独收件箱。
可点击参考是 [`docs/mockups/index.html`](../mockups/index.html)；在 URL 后追加
`#library`、`#newbot`、`#setup` 或 `#settings` 打开其他屏幕。Mockup 渲染 **zh-CN**
locale；§5 的英文文案是源，并与中文一起发布（`locale/en.json`、`locale/zh.json`）。
中文是主 UI 语言：客户端跟随 DSH locale 当它是中文或英文时，其他语言回退中文；
Settings 的语言行把选择写回 DSH。相关：[client-plan.md](../plans/client-plan.md)
（表面、RPC）、[mvp-plan.md](../plans/mvp-plan.md)（审批语义）、
[bot-persona.md](bot-persona.md)（名字、语气）、[06-local-state.md](../06-local-state.md)
（状态）。实现状态以 [../12-status.md](../12-status.md) 为准。*

渲染预览：[对话](../mockups/conversation.png) · [library](../mockups/library.png) ·
[新建 bot](../mockups/newbot.png) · [setup](../mockups/setup.png) ·
[settings](../mockups/cost-settings.png)。

## 0. 原则

1. **三栏，像参考一样。** 聊天列表（左）· 对话（中）· 每 bot 详情（右）。其他一切都
   是这个壳里的表单；没有单独 dashboard。
2. **聊天列表就是名册。** 顶部是搜索和 `+`，当前 bot 的头像和名字，然后是其他 bot
   的行，带最新摘要和时间。关注状态是一个小点，不是徽章墙。
3. **对话是 markdown。** Bot 回复读起来像同事写的更新——短段落、列表、code span——
   不是卡片 dashboard。日期变化时出现时间戳分隔。
4. **右面板属于 bot。** Activity（最近的 receipt）、Upcoming（routines）、Computer
   （状态、预览、open/take over）和 Usage。标签页在 Activity 与 Library 之间切换。
5. **审批是内联卡。** 外部动作停在对话里，带警告行和 `Deny` / `Allow once`；聊天列表
   给需要关注的 bot 显示一个点。v0.1 没有专用 inbox。
6. **温暖、低对比的浅色。** 米白画布、白色卡片、细线边框、近黑文字；颜色只用于警告、
   成功和状态点。Rayrun 的标志是唯一的品牌色。
7. **诚实的状态。** 重连中、连不上、已过期、缺依赖、余额低：一句短话和一个动作。
   不假成功。
8. **中文优先，英文并列；键盘优先。** 文案在 `locale/en.json` / `locale/zh.json`；
   UI 回退中文，Settings 的语言行通过 DSH 持久化选择。Enter 发送，Escape 关闭，焦点
   始终可见。

## 1. App 壳

```
┌────────────────────┬───────────────────────────────────────┬──────────────────┐
│ ▣ Rayrun Bot  ⌕  + │                                       │      ◉ Nora      │
│                    │                                       │   weekly digest  │
│      ◉ Nora        │  … markdown conversation …            │  Activity Library│
│   weekly digest    │  Today 20:07                          │                  │
│   · working        │                                       │  RECENT          │
│                    │  Nora  weekly digest                  │  ┌────────────┐  │
│ ◉ Eli       09:13  │  The draft is ready. I kept it to…    │  │draft ready │  │
│   needs approval   │  · Scope…  · Draft…  · Next…          │  └────────────┘  │
│ ◉ June      08:40  │                                       │  UPCOMING        │
│   docs finished    │  ┌─────────────────────────────────┐  │  Weekly digest ⏻ │
│                    │  │ ⚠ Publish “Week 45 digest” …    │  │  COMPUTER        │
│                    │  │ This shares data outside…       │  │  dsh-workspace   │
│                    │  │          Deny   Allow once      │  │  [Open][Take over]│
│ HY Haoyi           │  └─────────────────────────────────┘  │  USAGE           │
│ Rayrun connected   │  ● Computer reconnecting… 5s          │  ¥41.20 · 38.4 h │
│                    │  ┌─────────────────────────────────┐  │                  │
│                    │  │ Message Nora…                 ↑ │  │                  │
└────────────────────┴───────────────────────────────────────┴──────────────────┘
```

栏宽：296 px / 弹性 / 328 px。详情栏在 1120 px 以下折叠；聊天列表在 900 px 以下折叠。

### 1.1 独立的 Bots 视图

客户端在加载时激活 Bots（`ctx.layout.selectPanel('rayrun-bots')`），所以进入页面就落在
产品表面；页面标题变成 `Rayrun Bot`。Bots 主面板激活时，客户端把 `.rb-frame` 渲染为
固定全视口层（`position: fixed; inset: var(--dsh-frame-chrome-top, 0) 0 0 0;
z-index: 10`）。它覆盖 DSH 侧边栏和底栏，所以 Rayrun Bot 名册是最左列。DSH 浮层
（modal，z-index 20）保持在它上面。Bots 视图是唯一的产品表面：产品内没有“返回
Harness”控件。DSH 仍是宿主；setup、Plugins、云电脑和 Workspaces 必须归 Bots 所有
（尚未实现）。因为 v0.1 表面是内存预览，品牌行带一个可见的 `Preview` 胶囊；真实数据
替换样例后它消失。

## 2. 屏幕

### 2.1 聊天列表

- 顶行：Rayrun 标志和字标、`Preview` 胶囊、搜索、`+`（新建 bot）。
- 当前 bot 块：52 px 头像、名字、`job · state`。
- 行：34 px 头像、名字、一行最新摘要、时间；6 px 点标记需要关注（琥珀）、未读（蓝）
  或工作中（绿）。打开一行即标为已读。
- 空名册：首次运行文案加 Create bot 按钮；搜索无结果时保留 `No matching bots`。在
  DSH 页面 URL 上加 `?first-run=1` 预览。
- 页脚：用户头像、名字、`Rayrun connected · balance`、设置齿轮。余额低时该行变琥珀色，
  带琥珀点和读屏标签；完整的充值提示留在 Usage。

### 2.2 对话

- 富文本消息，带 26 px 头像、名字和职责标签；用户消息是右对齐的短气泡。
- 每个 session 以日期分隔（`Today 20:07`）开头。
- 没有消息的新 bot 显示头像、名字、职责和 `No messages yet`；composer 仍可用。
- 发送消息时显示工作行；短暂仅预览的延迟后出现模拟回复和一张待审批卡。没有任何东西
  离开页面。发送、回复和切换 bot 时，线程滚动到最新一条。
- 审批块和草稿块是仅有的卡片：细边框、白底、来源/目标 chips、风险行
  （`Outside your computer · Can't be undone`）、`Deny` / `Allow once`，以及元数据行
  （`requested 20:07`）。
- **电脑活动。** 一行细条带迷你屏幕——`On the computer · Feishu #weekly — pasted the
  digest, waiting for approval` 和一个 `View` 按钮。
- 通知在 composer 上方以一行带点的形式出现。该行跟随电脑状态——重连中（琥珀）、
  休眠（安静）、连不上（红）——电脑在线时不存在；flash 消息会覆盖它。
- Composer：`+` 附件、输入框、深色圆形发送。创建 bot 后 composer 获得焦点。

### 2.3 详情面板

资料头（头像、名字、`job · computer`），然后是 `Activity | Library` 标签页。

**Activity** 分区：

- **Recent** — receipt：任务标题、状态（`ready` / `waiting` / `done`）、时间、产物数量
  和今日花费。Receipt 是“回来汇报”的表面。
- **Upcoming** — routines：每行一个 routine，带标题、日程和开关。所有 routine 都关时，
  行上方出现一行安静的 `All routines are paused`。真实 bot 可创建每 N 分钟重复的
  routine、启停和删除；示例 bot 的行仍是示意形态。cloudHost 模式的云端调度已在
  Rayrun dev/test 环境 live 验证，生产单 bot routine E2E 已通过，routine 结果会在
  轮询后并入对话；cron/事件触发不在 v0.1。
- **Computer** — 靠近底部的紧凑行，像参考一样：左边是名字和状态（`live` /
  `reconnecting…` / `sleeping` / `unreachable`；Rayrun 未配置时 `Not connected`），
  带彩色点（绿 / 琥珀 / 灰 / 红），右边是 44×30 的小屏幕缩略图，下面右对齐
  `Open` / `Take over` / `Stop`。Stop 只在机器 live 时出现。v0.1 没有大预览；Open 经
  依赖的同源 RPC 启动或恢复机器，等待 `Running`，修复桌面服务，在新标签页打开
  `desktop_url`，并在可关闭的 toast 里显示桌面密码。Take over 目前走同一路径。Stop
  先做内联确认，调用 `machine.action` 带 `stop`，永不 destroy。每种失败给一行：未连接、
  没有机器、弹窗被拦截、启动超时、没有桌面、停止超时或停止失败。用
  `?computer=live|reconnecting|sleeping|unreachable` 预览状态。
- **Usage** — 余额、机时、本周花费、idle-stop 策略。余额低于阈值时变琥珀色，下方出现
  低余额行；用 `?low-balance=1` 预览。

**Library** 把产物分组为 Today / This week / Older；每行是文件、图片或链接，带一行
灰色副标题。v0.1 为 P1。

有内容的分区在标题旁显示条目数。Recent、Upcoming 或 Library 为空时渲染虚线块，带一行
状态和一句关于内容何时出现的提示；不放无效按钮。

### 2.4 新建 bot

`+` 打开一个小表单，不是向导：字母头像预览、**Name**、**Job, one line**、
**Instructions, optional**，然后 `Cancel` / `Create bot`。表单打开时聚焦名字字段。
默认值来自 [bot-persona.md](bot-persona.md)；没有人格选择器。

### 2.5 Setup（设置向导）

同一浅色画布上的四个细步骤：Dependency · Rayrun · Computer · First bot。当前步骤显示
一段说明和输入；`Continue` 在当前步骤通过时启用；`Skip for now` 保留 setup 行。依赖
步骤显示已安装的云电脑插件版本（`Installed · v…` / 缺失 / 不兼容）和 Rayrun Bot host
健康（`Checking…` / `Loaded · v…` / `Not responding` 带 Retry）。Rayrun 步骤把粘贴的
API token 发给云电脑插件的同源 RPC，并显示真实余额和机器数；被拒绝的 token 得到一句
可执行提示。电脑步骤采用已有机器或经插件创建一台，可选的 DeepSeek key 作为模型
credential 传入；它说明机器会计费，且 Bots 永不 destroy 它。第一个 bot 步骤仍只是预览。

### 2.6 设置

从页脚齿轮进入：Account（Rayrun 连接、Rayrun Bot host 健康、依赖健康）、Usage、
Notifications、Appearance/language。Host 行显示同源健康状态，host 不响应时提供 Retry。
语言行提供简体中文和 English，中文在前；选择后通过 DSH 写入 `locale.preference`，
刷新后仍保留。Usage 经同源 RPC 读取云电脑插件的 `overview`：连接时显示余额、机时和
机器数，未连接时显示 `Connect Rayrun to see usage.`；token 永不进入页面。Back 控件
返回对话；Escape 同样。产品内没有返回 DSH 壳的控件（ADR-017）。朴素的行加细线分隔；
没有统计卡片。

### 2.7 审批（仅内联）

卡片渲染在动作停下的对话位置。聊天列表显示一个点，最新摘要说明在等什么。v0.1
**没有单独的审批页**——早先的 inbox 为贴合参考被砍掉；store 和 RPC 仍为未来视图暴露
同一个列表。

待处理卡对后台工作显示 `expires in N min`（聊天发起的显示 `waits for you`），加
`Deny` / `Allow once`。后台 TTL 每分钟减一；到零时卡片过期、失去动作，聊天列表的点、
摘要和时间跟着变。聊天发起的卡没有 TTL。过期卡变灰，显示
`Expired — the bot did not act`，没有动作。已答卡保留本地结果行，没有动作。预览的
后台卡从一分钟开始，便于观察过渡。

## 3. 与 Grok Bot 的对齐

| Grok Bot 模式 | 来源 | 我们的 v0.1 |
| --- | --- | --- |
| 聊天列表栏：搜索、`+`、当前 bot、带摘要/时间的行 | 参考截图，2026-11-12 | 照搬 |
| 中间对话是富 markdown，带时间戳分隔 | 参考截图 | 照搬：段落、列表、code span |
| 右详情面板：资料、Activity/Library 标签页、routines、电脑 | 参考截图；`skills-routines-and-automations.md` | 照搬；增加 usage 分区，省略语音 |
| 内联审批卡带 Deny / allow | `approvals-security-and-privacy.md:30-57` | `Deny` / `Allow once`；`Always allow` 推迟到 Auto Review（v0.2） |
| 聊天卡等待，后台卡 30 分钟过期 | `approvals-security-and-privacy.md:72-83` | 通过 `origin` 字段照搬 |
| 可编辑草稿标记 Needs approval | `chat-and-collaboration.md:89-107` | 照搬 |
| 电脑预览带 open/take over | `computer-and-apps.md:31-63` | 详情面板底部的小电脑行，像参考一样，外加对话里的活动行 |
| 列表里的关注状态 | `settings-and-notifications.md:205-214` | 点：需要关注 / 未读 / 工作中 |
| Bot 名字、图片、职责标签；轻人格 | `bots.md:5-6,77-103`；[bot-persona.md](bot-persona.md) | 照搬；v0.1 用字母头像 |
| 语音聊天、群聊、移动端、共享 bot、市场、Vault、Auto Review | Grok Bot 产品表面 | 超出 v0.1（§8） |

两个锚点：参考截图决定布局（三栏、聊天列表行、详情面板）；rayrunos.com 决定观感
（白色画布、浅灰面板、深蓝主按钮、蓝色激活胶囊、细线边框、深蓝终端表面、蓝色几何
标志）。

## 4. 组件清单

| 组件 | 用在 | 波次 | 备注 |
| --- | --- | --- | --- |
| `AppShell` | 全部 | C1 | 三栏，详情可折叠 |
| `ChatList` | 壳 | C2 | 搜索、`+`、当前 bot、行、点、页脚 |
| `ChatRow` | 壳 | C2 | 头像、名字、摘要、时间、关注点 |
| `Conversation` | 中栏 | C2 | markdown 消息、日期分隔 |
| `ApprovalCard` | 对话 | C3 | Deny / Allow once、警告、来源、元数据 |
| `DraftCard` | 对话 | C3 | 可编辑，Discard / Send |
| `Composer` | 中栏 | C2 | 附件、发送、禁用原因 |
| `Notice` | 中栏 | C1 | composer 上方一行 |
| `DetailsPanel` | 右栏 | C3 | 资料、标签页 |
| `ReceiptCard` | activity | C3 | 任务、状态、时间、产物、花费 |
| `RoutineRow` | upcoming | C4 | 标题、日程、开关 |
| `ComputerRow` | 详情（底部） | C4 | 名字、状态、小缩略图、Open / Take over |
| `ComputerActivityRow` | 对话 | C3 | 迷你屏幕、bot 在做什么、View |
| `UsageBlock` | 详情 | C4 | 余额、机时、本周、idle stop |
| `NewBotForm` | newbot | C2 | 名字、职责、指令、字母头像 |
| `SetupWizard` | setup | C4 | 四个细步骤 |
| `SettingsPage` | settings | C4 | account/usage/notifications/appearance |

## 5. 文案表（`locale/en.json` 的源）

| Key | English | 中文 |
| --- | --- | --- |
| `list.search` | Search | 搜索 |
| `list.newBot` | New bot | 新建 Bot |
| `attention.needs` | needs attention | 待你处理 |
| `attention.unread` | unread | 未读 |
| `attention.working` | working | 工作中 |
| `approval.title` | Needs approval | 需要审批 |
| `approval.allowOnce` | Allow once | 仅批准这一次 |
| `approval.deny` | Deny | 拒绝 |
| `approval.waits` | waits for you | 等你处理 |
| `approval.expires` | expires in {n} min | {n} 分钟后过期 |
| `approval.expired` | Expired — the bot did not act | 已过期——Bot 没有执行 |
| `approval.irreversible` | This can't be undone. | 此操作无法撤销。 |
| `approval.outside` | This shares data outside your computer. | 这会把数据发到你的电脑之外。 |
| `approval.originChat` | From this chat | 来自本对话 |
| `approval.originBackground` | From a routine | 来自定时任务 |
| `approval.riskOutside` | Outside your computer | 离开你的电脑 |
| `approval.riskIrreversible` | Can't be undone | 无法撤销 |
| `draft.send` | Send | 发送 |
| `draft.discard` | Discard | 丢弃 |
| `details.recent` | Recent | 最近 |
| `details.upcoming` | Upcoming | 即将进行 |
| `routine.paused` | All routines are paused. | 所有日程都已暂停。 |
| `routine.every` | Every {minutes} min | 每 {minutes} 分钟 |
| `routine.origin` | Scheduled routine | 定时任务 |
| `routine.add` | New routine | 新建日程 |
| `routine.create` | Create routine | 创建日程 |
| `routine.remove` | Remove | 删除 |
| `routine.costHint` | A due run may wake a stopped computer and incur machine-hour charges. | 到期运行可能会唤醒已停止的电脑，并产生机时费用。 |
| `details.computer` | Computer | 电脑 |
| `details.usage` | Usage | 用量 |
| `computer.live` | live | 在线 |
| `computer.reconnecting` | reconnecting… | 正在重连… |
| `computer.sleeping` | sleeping | 休眠 |
| `computer.unreachable` | Couldn't reach the computer. | 连不上电脑。 |
| `computer.takeOver` | Take over | 接管 |
| `notice.recovering` | The bot host is restarting. This conversation resumes on its own. | Bot host 正在重启，这个会话会自动恢复。 |
| `notice.sleeping` | Computer is sleeping. Open it in the cloud-computer plugin to wake it. | 电脑正在休眠。打开云电脑插件即可唤醒。 |
| `cost.low` | Balance is low — top up in the Rayrun console. Stop is safe; destroy is not. | 余额偏低——去 Rayrun 控制台充值。停机会保留磁盘，销毁不会。 |
| `cost.lowShort` | Balance low | 余额偏低 |

审批和 key 文案绝不含玩笑；每个错误行都有一个下一步动作。

## 6. 视觉系统

两个锚点：参考截图决定布局（§1–§3）；rayrunos.com 决定观感。2026-11-12 从 Rayrun 站点
和文档采集：白色画布、很浅的灰色面板、细灰边框、深蓝主按钮、蓝色链接和激活胶囊、
深蓝终端表面、蓝色几何 logo 标志，以及加粗的 CJK 友好标题。

| Token | 值 | 用途 |
| --- | --- | --- |
| `bg` | `#ffffff` | App 画布 |
| `list` | `#f7f8fa` | 聊天列表、详情面板 |
| `main` | `#ffffff` | 对话画布 |
| `card` | `#ffffff` | 审批、草稿、receipt 卡 |
| `text` | `#0f172a` | 主文字（slate/navy） |
| `muted` | `#5b6472` | 次级文字 |
| `faint` | `#8a93a3` | 时间戳、提示 |
| `border` | `#e4e8f0` | 卡片和控件边框 |
| `border-soft` | `#eef1f6` | 列表分隔 |
| `primary` | `#0e2050` on `#ffffff` | 主按钮、发送、开关 |
| `accent` | `#1d4ed8` | 链接、激活行、标签页 |
| `accent-soft` | `#eaf1fd` | 选中的聊天行 |
| `success` | `#15803d` | 完成 / 工作中 |
| `attention` | `#b45309` on `#fff7e6` | 需要关注、警告 |
| `danger` | `#b42318` on `#fff5f4` | 拒绝、不可逆警告 |
| `brand` | `#003d9b` | 仅官方 Rayrun logo 标志 |

规则：浅灰面板上的白色卡片；深蓝主控件；蓝色只用于链接、选中行和标签页；琥珀色只用于
警告；一种边框粗细和一种阴影层级；圆角 12 px 卡片 / 9 px 控件；不用渐变或彩色面板。
品牌：使用官方 Rayrun logo——rayrunos.com 页眉里的 lucide **Boxes** 标志，颜色
`#003d9b`，加“Rayrun Bot”字标。Mockup 内联该官方标志；favicon 变体（蓝色圆角方块、
白色标志）保存在 [`docs/mockups/rayrun-logo.svg`](../mockups/rayrun-logo.svg)，用于
打包。绝不重画或改风格；它是品牌蓝唯一出现的地方。字体：系统字体栈，带
`PingFang SC` / `Microsoft YaHei` 回退；正文 14 px、UI 标签 13 px、页面标题 18 px。
动效 120 ms；尊重 `prefers-reduced-motion`。v0.1 仅浅色；深色跟随 DSH（可用时）。

## 7. 无障碍与响应式

- 键盘：搜索 → 行 → 对话 → 审批按钮；焦点可见；Escape 关闭表单。打开新建 bot 表单时
  聚焦名字字段；创建 bot 后聚焦 composer。
- 审批变化用 `aria-live="polite"` 播报；倒计时静默。
- 对比度 ≥ 4.5:1；点始终配可访问标签。
- 三栏 ≥1120 px；详情在下面折叠；列表在 900 px 以下折叠。v0.1 没有移动原生布局。

## 8. v0.1 之外

语音输入/聊天、群聊、X Chat、移动布局、共享 bot、bot 模板和市场、Vault/Secure Form、
bot 邮箱、Auto Review 规则和“Always allow”（v0.2）、primary bot check-in、bot-to-bot
交接卡（v0.2 候选，见 [inspiration.md](../research/inspiration.md)）、头像上传或生成、
人格预设、自定义主题、链接之外的产物预览，以及 Enter/Escape 之外的键盘快捷键。
