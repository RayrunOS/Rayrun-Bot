/**
 * Client half of the Rayrun Bot bundle.
 *
 * v0.1 shell: chat list, conversation, details, new bot, setup, and settings,
 * in the layout of docs/ui-design.md and docs/mockups/index.html. Copy comes
 * from locale/en.json and locale/zh.json (embedded below; the locale audit
 * checks they match). The host half persists the bot roster; the chat list
 * reads it when it has entries, and creating a bot writes through to it.
 * Messages, approvals, routines and settings on this page are still in-memory
 * preview state; decisions are not sent to a worker.
 *
 * Preview states with these DSH page URL parameters: ?first-run=1,
 * ?low-balance=1, ?computer=live|reconnecting|sleeping|unreachable.
 */
window.__ModuleLoader__.load({
  id: 'dsh-rayrun-bots',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useEffect, useRef, useState } = React
    const PREVIEW = new URLSearchParams(window.location.search)
    const FIRST_RUN_PREVIEW = PREVIEW.get('first-run') === '1'
    const LOW_BALANCE_PREVIEW = PREVIEW.get('low-balance') === '1'
    const COMPUTER_PREVIEW = ['live', 'reconnecting', 'sleeping', 'unreachable'].includes(PREVIEW.get('computer'))
      ? PREVIEW.get('computer')
      : null

    const EN = {
  "meta": {
    "title": "Rayrun Bot",
    "description": "Adds a Bots entry and the v0.1 three-column shell: chat list, conversation with approval cards, details, setup and settings. Everything on the page is an in-memory preview; no machine and no credential are used."
  },
  "panel": {
    "label": "Bots"
  },
  "brand": "Rayrun Bot",
  "preview": {
    "badge": "Preview"
  },
  "chat": {
    "working": "Working…",
    "simulatedReply": "Done. This reply is simulated in the preview; the approval below is also local.",
    "simulatedSnippet": "Needs approval: simulated result",
    "simulatedApprovalTitle": "Post the simulated result to the team channel",
    "simulatedApprovalMeta": "Requested just now",
    "simulatedTarget": "Team channel"
  },
  "list": {
    "search": "Search",
    "searchPlaceholder": "Search bots",
    "newBot": "New bot",
    "settings": "Settings",
    "empty": "No matching bots"
  },
  "attention": {
    "needs": "needs attention",
    "unread": "unread",
    "working": "working"
  },
  "approval": {
    "title": "Needs approval",
    "allowOnce": "Allow once",
    "deny": "Deny",
    "waits": "waits for you",
    "expires": "expires in {n} min",
    "expired": "Expired — the bot did not act",
    "irreversible": "This can't be undone.",
    "outside": "This shares data outside your computer.",
    "originChat": "From this chat",
    "originBackground": "From a routine",
    "riskOutside": "Outside your computer",
    "riskIrreversible": "Can't be undone",
    "warning": "This shares data outside your computer, and it can't be undone.",
    "allowedLocal": "Allowed once, on this page only. Nothing was sent.",
    "deniedLocal": "Denied, on this page only. Nothing was sent.",
    "snippetAllowed": "Allowed once — not sent",
    "snippetDenied": "Denied — not sent"
  },
  "draft": {
    "send": "Send",
    "discard": "Discard"
  },
  "details": {
    "activity": "Activity",
    "library": "Library",
    "recent": "Recent",
    "recentEmpty": "No activity yet.",
    "recentEmptyHint": "Replies and receipts show up here after your bot works.",
    "upcoming": "Upcoming",
    "computer": "Computer",
    "usage": "Usage",
    "jobComputer": "{job} · {computer}"
  },
  "receipt": {
    "ready": "Ready",
    "waiting": "Waiting",
    "done": "Done"
  },
  "library": {
    "today": "Today",
    "week": "This week",
    "older": "Older",
    "empty": "No artifacts yet.",
    "emptyHint": "Files your bot saves in the workspace show up here."
  },
  "routine": {
    "empty": "No routines yet.",
    "emptyHint": "Routines run on a schedule and stop for approval before acting outside your computer.",
    "paused": "All routines are paused.",
    "on": "on",
    "off": "off"
  },
  "computer": {
    "live": "live",
    "reconnecting": "reconnecting…",
    "unreachable": "Couldn't reach the computer.",
    "sleeping": "sleeping",
    "takeOver": "Take over",
    "open": "Open",
    "view": "View",
    "onComputer": "On the computer · {where}",
    "desktopLater": "The desktop opens in the cloud-computer plugin. This page can't open it yet.",
    "noMachine": "No cloud computer yet. Create one in the cloud-computer plugin.",
    "noMachineShort": "No computer",
    "stop": "Stop",
    "stopConfirm": "Stop the computer? Running work will pause.",
    "stopConfirmAction": "Stop computer",
    "cancel": "Cancel",
    "stopping": "Stopping…",
    "stopped": "Computer stopped.",
    "stopTimeout": "The computer is still stopping.",
    "stopFailed": "Could not stop the computer: {message}",
    "connectFirst": "Connect Rayrun first (Settings → Set up).",
    "popupBlocked": "Allow pop-ups for this page to open the desktop.",
    "starting": "Starting the computer…",
    "startTimeout": "The computer did not start in time.",
    "noDesktop": "This computer has no remote desktop.",
    "openFailed": "Could not open the computer: {message}",
    "opened": "Computer opened in a new tab.",
    "passwordTitle": "Desktop password",
    "passwordBody": "Use this password on the desktop page.",
    "passwordEmpty": "No desktop password found.",
    "copy": "Copy",
    "copied": "Copied",
    "copyFailed": "Copy failed. Select the password manually.",
    "close": "Close"
  },
  "notice": {
    "recovering": "The bot host is restarting. This conversation resumes on its own.",
    "reconnecting": "Computer reconnecting… retrying in 5s",
    "sleeping": "Computer is sleeping. Open it in the cloud-computer plugin to wake it.",
    "attach": "Attachments aren't available in this preview.",
    "preview": "In-memory preview. Nothing on this page is saved, and approvals are not sent to a worker."
  },
  "composer": {
    "placeholder": "Message {name}…",
    "attach": "Add attachment",
    "send": "Send"
  },
  "usage": {
    "balanceLine": "Balance {balance} · {hours} machine-hours",
    "weekLine": "This week {spend} · idle stop {idle}",
    "liveLine": "Live from your Rayrun account · idle stop {idle}",
    "sampleBalance": "¥41.20",
    "sampleHours": "38.4",
    "sampleSpend": "¥6.80"
  },
  "cost": {
    "low": "Balance is low — top up in the Rayrun console. Stop is safe; destroy is not.",
    "lowShort": "Balance low"
  },
  "empty": {
    "heading": "No bots yet",
    "body": "Create one with the plus button. It stays on this page until a bot host exists.",
    "thread": "No messages yet. What you type stays on this page.",
    "snippet": "No messages yet"
  },
  "newBot": {
    "title": "New bot",
    "sub": "Give it a name and one job. Instructions can be changed later.",
    "monogramHint": "Letter avatar · color is assigned from the name",
    "name": "Name",
    "job": "Job, one line",
    "instructions": "Instructions, optional",
    "placeholder": "You are {name}, a teammate on the user's team. Your job: …",
    "defaultName": "Weekly Watch",
    "defaultJob": "Summarises weekly PRs and drafts the digest",
    "cancel": "Cancel",
    "create": "Create bot"
  },
  "persona": {
    "template": "You are {name}, a teammate on the user's team.\nYour job: {job}.\nWork in short, factual updates. Say what you did, what you did not do, and what you need next. Ask before any action that leaves this computer (messages, publishing, spending, another machine). Never claim work you have not verified.\nIf something is unclear, ask one question instead of guessing."
  },
  "setup": {
    "title": "Set up Rayrun Bot",
    "sub": "Four steps. Each one says what is missing and where to fix it.",
    "back": "Back",
    "skip": "Skip for now",
    "continue": "Continue",
    "steps": {
      "dependency": "Dependency",
      "rayrun": "Rayrun",
      "key": "Computer",
      "bot": "First bot"
    },
    "dependencyTitle": "Cloud-computer plugin",
    "dependencyBody": "Cloud computers come from the separate dsh-rayrun-computer plugin. The host checks whether it is installed; fix it and restart DSH before connecting Rayrun.",
    "dependencyStatus": "Not checked",
    "dependencyOk": "Installed · v{version}",
    "dependencyMissing": "Missing — install dsh-rayrun-computer, then restart DSH.",
    "dependencyIncompatible": "Not supported · {version} (need {required}).",
    "rayrunTitle": "Connect Rayrun",
    "rayrunBody": "The cloud computer is provided by Rayrun. Paste a Rayrun API token; the cloud-computer plugin stores it in the DSH vault.",
    "notConnected": "Not connected",
    "tokenPlaceholder": "Paste a Rayrun API token",
    "useToken": "Use API token",
    "tokenHint": "Paste a Rayrun API token from the console. The cloud-computer plugin stores it in the DSH vault.",
    "tokenRequired": "Paste a Rayrun API token first.",
    "connecting": "Connecting…",
    "connected": "Connected · balance {balance} · {machines} machines",
    "connectedShort": "Connected",
    "connectFailed": "Could not connect: {message}",
    "tokenRejected": "Rayrun rejected this API token. Check the token and try again.",
    "connect": "Connect",
    "accountLine": "Account: — · Balance: —",
    "computerTitle": "Cloud computer",
    "computerBody": "Bots creates one cloud computer on your Rayrun account. It is billable while it runs. The DeepSeek key becomes its model credential and does not go into the workspace.",
    "computerExisting": "Using your existing computer · {name}",
    "computerExistingHint": "The cloud-computer plugin owns this machine's settings and model credential.",
    "computerNeedsRayrun": "Connect Rayrun on the previous step before creating a computer.",
    "computerChecking": "Checking your Rayrun computers…",
    "computerLoadFailed": "Could not read your Rayrun computers: {message}",
    "computerName": "Computer name",
    "computerKeyPlaceholder": "Paste a DeepSeek API key (optional)",
    "computerKeyHint": "Optional if this machine already has a DeepSeek credential.",
    "computerCreate": "Create cloud computer",
    "computerCreating": "Creating… about 15 seconds",
    "computerCreated": "Created · {name}",
    "computerCreateFailed": "Could not create the computer: {message}",
    "computerCost": "Creates a billable machine on your Rayrun account. Bots never destroys it.",
    "botTitle": "First bot",
    "botBody": "Give it a name and one job. It is added to this page only, not to a cloud computer."
  },
  "settings": {
    "title": "Settings",
    "sub": "Account, usage, and the few settings this plugin owns.",
    "account": "Account",
    "usage": "Usage",
    "notifications": "Notifications",
    "appearance": "Appearance",
    "rayrunAccount": "Rayrun account",
    "rayrunHint": "Token stays in the DSH vault · host side only",
    "setup": "Set up",
    "host": "Rayrun Bot host",
    "hostHint": "Same-origin health check. No Rayrun token or DeepSeek key.",
    "hostChecking": "Checking…",
    "hostLoaded": "Loaded · v{version} · bot layer not ready",
    "hostReady": "Ready · v{version}",
    "hostDepMissing": "Cloud-computer plugin missing — install dsh-rayrun-computer, then restart DSH.",
    "hostDepVersion": "Cloud-computer plugin {version} is not supported (need {required}).",
    "retry": "Retry",
    "plugin": "Cloud-computer plugin",
    "pluginHint": "dsh-rayrun-computer v1.0.0",
    "pluginOk": "OK",
    "pluginMissing": "Missing",
    "pluginIncompatible": "Incompatible",
    "pluginUnknown": "Unknown",
    "usageHint": "From your Rayrun account. Same-origin RPC; no token in the page.",
    "usageLine": "Balance {balance} · {hours} machine-hours · {machines} machines",
    "usageConnect": "Connect Rayrun to see usage.",
    "usageFailed": "Could not read usage: {message}",
    "idle": "Idle stop",
    "idleHint": "Stop the computer when idle. Never destroy it.",
    "idle15": "15 minutes",
    "idle30": "30 minutes",
    "idleOff": "Off",
    "lowBalance": "Low-balance reminder",
    "lowBalanceHint": "Show a notice when the balance drops below this.",
    "notify": "Notifications",
    "notifyHint": "Notify when a bot finishes or needs you.",
    "language": "Language",
    "languageHint": "Chinese is primary; English is available.",
    "langEn": "English",
    "langZh": "简体中文"
  },
  "sample": {
    "user": {
      "name": "Haoyi",
      "initials": "HY",
      "foot": "Rayrun connected · {balance}"
    },
    "nora": {
      "name": "Nora",
      "job": "weekly digest",
      "snippet": "Draft is in the library, waiting for you",
      "time": "20:07",
      "user": "Summarize last week's PRs and draft the weekly digest. Wait for me before publishing.",
      "day": "Today 20:07",
      "reply1": "The draft is ready. I kept it to five sections, and each item links back to its PR.\n\n- **Scope.** 14 merged PRs, 2 still open, 1 reverted.\n- **Draft.** `week-45-digest.md` in the workspace, 420 words.\n- **Next.** Publishing to `#weekly` needs your approval.",
      "reply2": "The draft is in the Library tab if you want to read it first. I'll wait for your answer.",
      "computerTitle": "On the computer · Feishu #weekly",
      "computerSub": "Pasted the digest, waiting for your approval",
      "approvalTitle": "Publish “Week 45 digest” to Feishu #weekly",
      "approvalMeta": "Requested 20:07",
      "r1": "Draft the weekly digest",
      "r1meta": "09:13 · 3 artifacts · today ¥3.10",
      "r2": "Publish to #weekly",
      "r2meta": "Needs your approval · waits for you",
      "r3": "Docs refresh",
      "r3meta": "08:40 · 3 pages · today ¥0.60",
      "f1": "week-45-digest.md",
      "f1badge": "420 words",
      "f1meta": "Created by Nora · 09:13",
      "f2": "channel-preview.png",
      "f2badge": "Image",
      "f2meta": "Sent in this chat · 09:12",
      "f3": "week-44-digest.md",
      "f3badge": "Done",
      "f3meta": "Created by Nora · Monday",
      "f4": "Feishu channel",
      "f4badge": "Link",
      "f4meta": "Last week"
    },
    "eli": {
      "name": "Eli",
      "job": "channel publish",
      "snippet": "Needs approval: publish the digest",
      "time": "09:13",
      "day": "Today 09:13",
      "reply": "Publishing would send the digest to the channel. I'm stopped here until you approve.",
      "approvalTitle": "Publish “Week 45 digest” to Feishu #weekly",
      "approvalMeta": "Requested 09:13",
      "expiredDay": "Yesterday 18:00",
      "expiredTitle": "Publish “Week 44 digest” to Feishu #weekly",
      "expiredMeta": "Requested yesterday 18:00"
    },
    "june": {
      "name": "June",
      "job": "docs",
      "snippet": "Docs refresh finished — 3 pages",
      "time": "08:40",
      "day": "Today 08:40",
      "reply": "Docs refresh is finished, 3 pages. Nothing needs your approval.",
      "r1": "Docs refresh",
      "r1meta": "08:40 · 3 pages · today ¥0.60"
    },
    "routine": {
      "weekly": "Weekly digest",
      "weeklyWhen": "Friday · 09:00",
      "inbox": "Inbox sweep",
      "inboxWhen": "Weekdays · 08:00",
      "standup": "Standup notes",
      "standupWhen": "Weekdays · 18:00"
    },
    "computerName": "dsh-workspace"
  },
  "error": {
    "hostDown": "The bot host is not responding.",
    "botCreate": "Could not save the bot: {message}"
  }
}
    const ZH = {
  "meta": {
    "title": "Rayrun Bot",
    "description": "在侧边栏加入 Bots 入口和 v0.1 三栏界面：会话列表、带审批卡的对话、详情面板、初始化与设置。页面内容全部是内存预览，不连接机器，也不使用凭据。"
  },
  "panel": {
    "label": "Bots"
  },
  "brand": "Rayrun Bot",
  "preview": {
    "badge": "预览"
  },
  "chat": {
    "working": "正在处理…",
    "simulatedReply": "完成。这是预览里的模拟回复；下面的审批也只在本页。",
    "simulatedSnippet": "待审批：模拟结果",
    "simulatedApprovalTitle": "把模拟结果发到团队频道",
    "simulatedApprovalMeta": "刚刚请求",
    "simulatedTarget": "团队频道"
  },
  "list": {
    "search": "搜索",
    "searchPlaceholder": "搜索 Bot",
    "newBot": "新建 Bot",
    "settings": "设置",
    "empty": "没有匹配的 Bot"
  },
  "attention": {
    "needs": "待你处理",
    "unread": "未读",
    "working": "工作中"
  },
  "approval": {
    "title": "需要审批",
    "allowOnce": "仅批准这一次",
    "deny": "拒绝",
    "waits": "等你处理",
    "expires": "{n} 分钟后过期",
    "expired": "已过期——Bot 没有执行",
    "irreversible": "此操作无法撤销。",
    "outside": "这会把数据发到你的电脑之外。",
    "originChat": "来自本对话",
    "originBackground": "来自定时任务",
    "riskOutside": "离开你的电脑",
    "riskIrreversible": "无法撤销",
    "warning": "这会把数据发到你的电脑之外，且无法撤销。",
    "allowedLocal": "只记在这一页：已批准一次。没有发送到任何地方。",
    "deniedLocal": "只记在这一页：已拒绝。没有发送到任何地方。",
    "snippetAllowed": "已批准一次 · 未发送",
    "snippetDenied": "已拒绝 · 未发送"
  },
  "draft": {
    "send": "发送",
    "discard": "丢弃"
  },
  "details": {
    "activity": "动态",
    "library": "资料库",
    "recent": "最近",
    "recentEmpty": "还没有动态。",
    "recentEmptyHint": "Bot 开始工作后，回复和收据会出现在这里。",
    "upcoming": "即将进行",
    "computer": "电脑",
    "usage": "用量",
    "jobComputer": "{job} · {computer}"
  },
  "receipt": {
    "ready": "已就绪",
    "waiting": "等待中",
    "done": "已完成"
  },
  "library": {
    "today": "今天",
    "week": "本周",
    "older": "更早",
    "empty": "还没有产物。",
    "emptyHint": "Bot 保存在工作区里的文件会出现在这里。"
  },
  "routine": {
    "empty": "还没有日程。",
    "emptyHint": "日程按计划运行；在电脑之外执行动作前会停下来等审批。",
    "paused": "所有日程都已暂停。",
    "on": "开",
    "off": "关"
  },
  "computer": {
    "live": "在线",
    "reconnecting": "正在重连…",
    "unreachable": "连不上电脑。",
    "sleeping": "休眠",
    "takeOver": "接管",
    "open": "打开",
    "view": "查看",
    "onComputer": "电脑上 · {where}",
    "desktopLater": "桌面在云电脑插件里。这一页还打不开它。",
    "noMachine": "还没有云电脑。在云电脑插件里创建一台。",
    "noMachineShort": "还没有电脑",
    "stop": "停止",
    "stopConfirm": "停止云电脑？正在运行的工作会暂停。",
    "stopConfirmAction": "停止电脑",
    "cancel": "取消",
    "stopping": "正在停止…",
    "stopped": "云电脑已停止。",
    "stopTimeout": "云电脑仍在停止中。",
    "stopFailed": "停止云电脑失败：{message}",
    "connectFirst": "先连接 Rayrun（设置 → 首次设置）。",
    "popupBlocked": "允许此页面弹窗，才能打开桌面。",
    "starting": "正在启动云电脑…",
    "startTimeout": "云电脑没有在预期时间内启动。",
    "noDesktop": "这台云电脑没有远程桌面。",
    "openFailed": "打开云电脑失败：{message}",
    "opened": "云电脑已在新标签打开。",
    "passwordTitle": "桌面密码",
    "passwordBody": "在桌面页面输入这个密码。",
    "passwordEmpty": "没有读到桌面密码。",
    "copy": "复制",
    "copied": "已复制",
    "copyFailed": "复制失败，请手动选中密码。",
    "close": "关闭"
  },
  "notice": {
    "recovering": "Bot host 正在重启，这个会话会自动恢复。",
    "reconnecting": "电脑正在重连… 5 秒后重试",
    "sleeping": "电脑正在休眠。打开云电脑插件即可唤醒。",
    "attach": "这个预览里还不能添加附件。",
    "preview": "这是页内预览。内容不会保存，审批也不会发给 worker。"
  },
  "composer": {
    "placeholder": "给 {name} 发消息…",
    "attach": "添加附件",
    "send": "发送"
  },
  "usage": {
    "balanceLine": "余额 {balance} · {hours} 机时",
    "weekLine": "本周 {spend} · 空闲停机 {idle}",
    "liveLine": "来自你的 Rayrun 账号 · 空闲停机 {idle}",
    "sampleBalance": "¥41.20",
    "sampleHours": "38.4",
    "sampleSpend": "¥6.80"
  },
  "cost": {
    "low": "余额偏低——去 Rayrun 控制台充值。停机会保留磁盘，销毁不会。",
    "lowShort": "余额偏低"
  },
  "empty": {
    "heading": "还没有 Bot",
    "body": "用加号新建一个。在 Bot host 出现之前，它只留在这一页。",
    "thread": "还没有消息。你输入的内容只留在这一页。",
    "snippet": "还没有消息"
  },
  "newBot": {
    "title": "新建 Bot",
    "sub": "给它一个名字和一项职责，指令之后可以再改。",
    "monogramHint": "字母头像 · 颜色由名字自动分配",
    "name": "名字",
    "job": "职责（一行）",
    "instructions": "指令（可选）",
    "placeholder": "你是 {name}，用户团队里的一名同事。你的职责： …",
    "defaultName": "Weekly Watch",
    "defaultJob": "Summarises weekly PRs and drafts the digest",
    "cancel": "取消",
    "create": "创建 Bot"
  },
  "persona": {
    "template": "你是 {name}，用户团队里的一名同事。\n你的职责：{job}。\n用简短、事实性的更新汇报：做了什么、没做什么、下一步需要什么。任何离开这台电脑的动作（发消息、发布、花钱、动另一台机器）先征求同意。不要声称未经验证的结果。不清楚时只问一个关键问题，不要猜。"
  },
  "setup": {
    "title": "设置 Rayrun Bot",
    "sub": "四步。每一步都会显示还缺什么、去哪里补。",
    "back": "返回",
    "skip": "暂时跳过",
    "continue": "继续",
    "steps": {
      "dependency": "依赖",
      "rayrun": "Rayrun",
      "key": "云电脑",
      "bot": "第一个 Bot"
    },
    "dependencyTitle": "检查云电脑插件",
    "dependencyBody": "云电脑由单独的 dsh-rayrun-computer 插件提供。Host 会检查它是否已安装；修好并重启 DSH 后再连接 Rayrun。",
    "dependencyStatus": "未检查",
    "dependencyOk": "已安装 · v{version}",
    "dependencyMissing": "缺失 — 安装 dsh-rayrun-computer 后重启 DSH。",
    "dependencyIncompatible": "不受支持 · {version}（需要 {required}）。",
    "rayrunTitle": "连接 Rayrun",
    "rayrunBody": "云电脑由 Rayrun 提供。粘贴 Rayrun API token；云电脑插件会把它存进 DSH 凭证库。",
    "notConnected": "未连接",
    "tokenPlaceholder": "粘贴 Rayrun API token",
    "useToken": "使用 API Token",
    "tokenHint": "从 Rayrun 控制台粘贴 API token；云电脑插件会把它存进 DSH 凭证库。",
    "tokenRequired": "请先粘贴 Rayrun API token。",
    "connecting": "连接中…",
    "connected": "已连接 · 余额 {balance} · {machines} 台云电脑",
    "connectedShort": "已连接",
    "connectFailed": "连接失败：{message}",
    "tokenRejected": "Rayrun 拒绝了这个 API token。检查后重试。",
    "connect": "连接",
    "accountLine": "账号：— · 余额：—",
    "computerTitle": "云电脑",
    "computerBody": "Bots 会在你的 Rayrun 账号上创建一台云电脑。运行期间会计费。DeepSeek key 会成为它的模型凭据，不会进入工作区。",
    "computerExisting": "使用已有云电脑 · {name}",
    "computerExistingHint": "这台机器的设置和模型凭据由云电脑插件管理。",
    "computerNeedsRayrun": "先在上一页连接 Rayrun，才能创建云电脑。",
    "computerChecking": "正在检查你的 Rayrun 云电脑…",
    "computerLoadFailed": "读取 Rayrun 云电脑失败：{message}",
    "computerName": "云电脑名称",
    "computerKeyPlaceholder": "粘贴 DeepSeek API key（可选）",
    "computerKeyHint": "如果这台机器已有 DeepSeek 凭据，可以留空。",
    "computerCreate": "创建云电脑",
    "computerCreating": "创建中…约 15 秒",
    "computerCreated": "已创建 · {name}",
    "computerCreateFailed": "创建云电脑失败：{message}",
    "computerCost": "会在你的 Rayrun 账号上创建一台计费机器。Bots 永不销毁它。",
    "botTitle": "第一个 Bot",
    "botBody": "给它一个名字和一项职责。它只加到这一页，不会出现在云电脑上。"
  },
  "settings": {
    "title": "设置",
    "sub": "账号、用量，以及这个插件自己的少量设置。",
    "account": "账号",
    "usage": "用量",
    "notifications": "通知",
    "appearance": "外观",
    "rayrunAccount": "Rayrun 账号",
    "rayrunHint": "token 存在 DSH 凭证库 · 只在 Host 侧",
    "setup": "首次设置",
    "host": "Rayrun Bot host",
    "hostHint": "同源健康检查，不携带 Rayrun token 或 DeepSeek key。",
    "hostChecking": "检查中…",
    "hostLoaded": "已加载 · v{version} · Bot 层尚未就绪",
    "hostReady": "已就绪 · v{version}",
    "hostDepMissing": "缺少云电脑插件 — 安装 dsh-rayrun-computer 后重启 DSH。",
    "hostDepVersion": "云电脑插件 {version} 不受支持（需要 {required}）。",
    "retry": "重试",
    "plugin": "云电脑插件",
    "pluginHint": "dsh-rayrun-computer v1.0.0",
    "pluginOk": "正常",
    "pluginMissing": "缺失",
    "pluginIncompatible": "不兼容",
    "pluginUnknown": "未知",
    "usageHint": "来自你的 Rayrun 账号。同源 RPC；页面不持有 token。",
    "usageLine": "余额 {balance} · {hours} 机时 · {machines} 台云电脑",
    "usageConnect": "连接 Rayrun 后显示用量。",
    "usageFailed": "读取用量失败：{message}",
    "idle": "空闲停机",
    "idleHint": "空闲时停止电脑，绝不销毁。",
    "idle15": "15 分钟",
    "idle30": "30 分钟",
    "idleOff": "关闭",
    "lowBalance": "低余额提醒",
    "lowBalanceHint": "余额低于该值时显示提示。",
    "notify": "通知",
    "notifyHint": "Bot 完成或等你处理时通知。",
    "language": "语言",
    "languageHint": "以简体中文为主，可切换 English。",
    "langEn": "English",
    "langZh": "简体中文"
  },
  "sample": {
    "user": {
      "name": "Haoyi",
      "initials": "HY",
      "foot": "Rayrun 已连接 · {balance}"
    },
    "nora": {
      "name": "Nora",
      "job": "每周摘要",
      "snippet": "草稿在资料库里，等你答复",
      "time": "20:07",
      "user": "总结上周的 PR，并起草每周摘要。发布前等我确认。",
      "day": "今天 20:07",
      "reply1": "草稿好了。我控制在五个小节，每一项都链回了对应 PR。\n\n- **范围。**14 个已合并 PR，2 个仍开着，1 个已回滚。\n- **草稿。**工作区里的 `week-45-digest.md`，420 字。\n- **下一步。**发布到 `#weekly` 需要你批准。",
      "reply2": "如果你想先看草稿，它在「资料库」标签里。我会等你答复。",
      "computerTitle": "电脑上 · Feishu #weekly",
      "computerSub": "已粘贴摘要，等待你的审批",
      "approvalTitle": "发布《Week 45 摘要》到 Feishu #weekly",
      "approvalMeta": "请求于 20:07",
      "r1": "起草每周摘要",
      "r1meta": "09:13 · 3 个产物 · 今日 ¥3.10",
      "r2": "发布到 #weekly",
      "r2meta": "需要你的审批 · 等你处理",
      "r3": "文档刷新",
      "r3meta": "08:40 · 3 页 · 今日 ¥0.60",
      "f1": "week-45-digest.md",
      "f1badge": "420 字",
      "f1meta": "由 Nora 创建 · 09:13",
      "f2": "channel-preview.png",
      "f2badge": "图片",
      "f2meta": "本对话中发送 · 09:12",
      "f3": "week-44-digest.md",
      "f3badge": "已完成",
      "f3meta": "由 Nora 创建 · 周一",
      "f4": "Feishu 频道",
      "f4badge": "链接",
      "f4meta": "上周"
    },
    "eli": {
      "name": "Eli",
      "job": "频道发布",
      "snippet": "待审批：发布摘要",
      "time": "09:13",
      "day": "今天 09:13",
      "reply": "发布会把摘要发到频道里，我停在这里等你批准。",
      "approvalTitle": "发布《Week 45 摘要》到 Feishu #weekly",
      "approvalMeta": "请求于 09:13",
      "expiredDay": "昨天 18:00",
      "expiredTitle": "发布《Week 44 摘要》到 Feishu #weekly",
      "expiredMeta": "请求于昨天 18:00"
    },
    "june": {
      "name": "June",
      "job": "文档",
      "snippet": "文档刷新完成 — 3 页",
      "time": "08:40",
      "day": "今天 08:40",
      "reply": "文档刷新完成，一共 3 页。没有需要你批准的动作。",
      "r1": "文档刷新",
      "r1meta": "08:40 · 3 页 · 今日 ¥0.60"
    },
    "routine": {
      "weekly": "每周摘要",
      "weeklyWhen": "周五 · 09:00",
      "inbox": "收件箱清扫",
      "inboxWhen": "工作日 · 08:00",
      "standup": "站会纪要",
      "standupWhen": "工作日 · 18:00"
    },
    "computerName": "dsh-workspace"
  },
  "error": {
    "hostDown": "Bot host 没有响应。",
    "botCreate": "无法保存 Bot：{message}"
  }
}

    const PANEL_ID = 'rayrun-bots'
    const SAMPLE_COMPUTER = 'dsh-workspace'
    const DEFAULT_COMPUTER = 'rayrun-bot'
    const pickMachine = (machines) => machines.find((item) => item.name === DEFAULT_COMPUTER)
      || machines.find((item) => item.remote_desktop && item.desktop_url)
      || machines[0]
    const machineStatus = (status) => status === 'Running' ? 'live'
      : status === 'Starting' || status === 'Stopping' ? 'reconnecting'
        : status === 'Stopped' || status === 'Paused' ? 'sleeping'
          : 'unreachable'
    const MARK_PATHS = [
      'M2.97 12.92A2 2 0 0 0 2 14.63v3.24a2 2 0 0 0 .97 1.71l3 1.8a2 2 0 0 0 2.06 0L12 19v-5.5l-5-3-4.03 2.42Z',
      'm7 16.5-4.74-2.85',
      'm7 16.5 5-3',
      'M7 16.5v5.17',
      'M12 13.5V19l3.97 2.38a2 2 0 0 0 2.06 0l3-1.8a2 2 0 0 0 .97-1.71v-3.24a2 2 0 0 0-.97-1.71L17 10.5l-5 3Z',
      'm17 16.5-5-3',
      'm17 16.5 4.74-2.85',
      'M17 16.5v5.17',
      'M7.97 4.42A2 2 0 0 0 7 6.13v4.37l5 3 5-3V6.13a2 2 0 0 0-.97-1.71l-3-1.8a2 2 0 0 0-2.06 0l-3 1.8Z',
      'M12 8 7.26 5.15',
      'm12 8 4.74-2.85',
      'M12 13.5V8',
    ]
    const AVATAR_PALETTE = [
      ['#1d4ed8', '#e3eafc'],
      ['#1e40af', '#e7eefc'],
      ['#3730a3', '#ecebfe'],
      ['#0f766e', '#e7f4f2'],
      ['#9a3412', '#f8eee8'],
    ]
    const PINNED_AVATARS = new Set(['Nora', 'Eli', 'June', 'Weekly Watch', 'Haoyi'])

    const CSS = `
.rb-frame, .rb-frame *, .rb-frame *::before, .rb-frame *::after { box-sizing: border-box; }
.rb-frame { position: fixed; inset: var(--dsh-frame-chrome-top, 0px) 0 0 0; z-index: 10; min-height: 0; display: flex; flex-direction: column; overflow: hidden; background: #fff; color: #0f172a; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", "Microsoft YaHei", sans-serif; font-size: 14px; line-height: 1.55; -webkit-font-smoothing: antialiased; }
.rb-frame button, .rb-frame input, .rb-frame textarea, .rb-frame select { font: inherit; color: inherit; }
.rb-frame button.rb-icon { color: #5b6472; }
.rb-frame button.rb-send { color: #fff; }
.rb-frame button.rb-tab { color: #8a93a3; }
.rb-frame button.rb-tab.rb-active { color: #0e2050; }
.rb-frame button.rb-textbtn { color: #8a93a3; }
.rb-frame .rb-snav button { color: #8a93a3; }
.rb-frame .rb-snav button.rb-active { color: #0e2050; }
.rb-frame button { cursor: pointer; }
.rb-frame :focus { outline: none; }
.rb-frame :focus-visible { outline: 2px solid #1d4ed8; outline-offset: 2px; }
.rb-frame ::-webkit-scrollbar { width: 9px; }
.rb-frame ::-webkit-scrollbar-thumb { background: #d5dbe6; border-radius: 5px; }
.rb-app { flex: 1; min-height: 0; display: grid; overflow: hidden; }
.rb-desktop-toast { position: fixed; right: 20px; bottom: 20px; z-index: 30; width: min(360px, calc(100vw - 40px)); background: #fff; border: 1px solid #e2e8f0; border-radius: 12px; box-shadow: 0 12px 32px rgba(15, 23, 42, 0.16); padding: 14px 16px; }
.rb-desktop-toast h3 { margin: 0 0 4px; font-size: 13px; font-weight: 650; color: #0e2050; }
.rb-desktop-toast p { margin: 0 0 8px; font-size: 12px; color: #64748b; }
.rb-desktop-toast code { display: block; padding: 8px 10px; border: 1px solid #e2e8f0; border-radius: 8px; background: #f8fafc; font-size: 13px; word-break: break-all; }
.rb-desktop-toast .rb-line { display: flex; gap: 8px; margin-top: 10px; }
.rb-sr { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }
.rb-list { background: #f7f8fa; border-right: 1px solid #eef1f6; display: flex; flex-direction: column; min-height: 0; min-width: 0; }
.rb-list-top { display: flex; align-items: center; justify-content: space-between; padding: 14px 16px 8px; gap: 8px; }
.rb-brand { display: flex; align-items: center; gap: 8px; color: #0e2050; font-weight: 650; font-size: 13px; min-width: 0; }
.rb-preview-pill { padding: 1px 7px; border: 1px solid #d8e3f5; border-radius: 999px; background: #eef4ff; color: #1d4ed8; font-size: 10.5px; font-weight: 600; line-height: 1.7; letter-spacing: .02em; }
.rb-mark { flex: none; }
.rb-tools { display: flex; gap: 4px; }
.rb-icon { width: 28px; height: 28px; border: 0; border-radius: 8px; background: transparent; color: #5b6472; display: grid; place-items: center; padding: 0; }
.rb-icon:hover { background: #eef2f8; color: #0f172a; }
.rb-search { margin: 0 16px 8px; }
.rb-search input { width: 100%; background: #fff; border: 1px solid #e4e8f0; border-radius: 9px; padding: 6px 10px; font-size: 13px; }
.rb-current { display: grid; justify-items: center; gap: 5px; padding: 6px 16px 16px; text-align: center; }
.rb-avatar { border-radius: 50%; display: grid; place-items: center; font-weight: 600; color: #1d4ed8; background: #e3eafc; flex: none; }
.rb-avatar.rb-big { width: 52px; height: 52px; font-size: 18px; }
.rb-avatar.rb-mid { width: 34px; height: 34px; font-size: 12px; }
.rb-avatar.rb-sm { width: 26px; height: 26px; font-size: 10px; }
.rb-avatar.rb-new { width: 38px; height: 38px; font-size: 13px; }
.rb-current .rb-name, .rb-profile .rb-name { font-size: 15px; font-weight: 600; }
.rb-current .rb-label, .rb-profile .rb-sub { color: #8a93a3; font-size: 11.5px; }
.rb-profile .rb-sub { font-size: 11px; }
.rb-chats { overflow: auto; padding: 2px 10px 10px; display: flex; flex-direction: column; gap: 1px; min-height: 0; }
.rb-row { display: grid; grid-template-columns: 34px minmax(0, 1fr) auto; gap: 10px; align-items: center; padding: 8px 9px; border: 0; border-radius: 10px; background: transparent; text-align: left; width: 100%; }
.rb-row:hover { background: #eef2f8; }
.rb-row.rb-active { background: #eaf1fd; }
.rb-nm { font-size: 13px; font-weight: 500; display: flex; align-items: center; gap: 6px; }
.rb-sn { color: #8a93a3; font-size: 11.5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.rb-tm { color: #8a93a3; font-size: 10.5px; }
.rb-dot { width: 6px; height: 6px; border-radius: 50%; background: #8a93a3; flex: none; display: inline-block; }
.rb-dot.rb-needs { background: #b45309; }
.rb-dot.rb-working { background: #15803d; }
.rb-dot.rb-unread { background: #5b7fc4; }
.rb-dot.rb-danger { background: #b42318; }
.rb-foot { margin-top: auto; border-top: 1px solid #eef1f6; padding: 10px 14px; display: flex; align-items: center; gap: 9px; }
.rb-who { flex: 1; font-size: 12px; min-width: 0; }
.rb-who small { display: block; color: #8a93a3; font-size: 10.5px; }
.rb-textbtn { border: 0; background: transparent; padding: 0; color: #8a93a3; font-size: 10.5px; text-align: left; }
.rb-textbtn:hover { color: #0f172a; }
.rb-frame button.rb-textbtn.rb-textbtn-low { color: #b45309; }
.rb-textbtn .rb-dot { margin-right: 4px; vertical-align: middle; }
.rb-empty-list { color: #8a93a3; font-size: 12px; padding: 8px 10px; }
.rb-firstrun { padding: 10px; }
.rb-main { background: #fff; display: flex; flex-direction: column; min-width: 0; min-height: 0; }
.rb-thread { flex: 1; overflow: auto; padding: 26px 34px 12px; display: flex; flex-direction: column; gap: 20px; }
.rb-thread > * { max-width: 760px; width: 100%; align-self: center; }
.rb-day { text-align: center; color: #8a93a3; font-size: 10.5px; margin: 4px 0 2px; }
.rb-msg { display: grid; grid-template-columns: 28px minmax(0, 1fr); gap: 12px; }
.rb-msg-avatar { margin-top: 2px; }
.rb-msg .rb-body { min-width: 0; }
.rb-msg .rb-who-line { font-size: 11.5px; color: #5b6472; margin-bottom: 3px; display: flex; gap: 8px; align-items: baseline; }
.rb-msg .rb-who-line b { color: #0f172a; font-weight: 600; font-size: 12.5px; }
.rb-msg p { margin: 0 0 9px; }
.rb-msg p:last-child { margin-bottom: 0; }
.rb-msg ul { margin: 0 0 9px; padding-left: 18px; }
.rb-msg li { margin-bottom: 3px; }
.rb-msg code { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 12px; background: #eef2f8; border-radius: 4px; padding: 1px 4px; }
.rb-msg.rb-user { grid-template-columns: minmax(0, 1fr); justify-items: end; }
.rb-bubble { background: #f1f4f9; border-radius: 12px; padding: 8px 13px; max-width: 560px; font-size: 13.5px; overflow-wrap: anywhere; }
.rb-card { border: 1px solid #e4e8f0; background: #fff; border-radius: 12px; padding: 13px 15px; display: grid; gap: 8px; }
.rb-card-expired { opacity: .72; }
.rb-card-fields { display: flex; flex-wrap: wrap; gap: 6px; }
.rb-chip { border: 1px solid #e4e8f0; border-radius: 999px; padding: 1px 7px; color: #5b6472; font-size: 10.5px; line-height: 1.6; }
.rb-chip-target { color: #3a4351; background: #f6f8fb; }
.rb-card-top { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; }
.rb-card-title { font-size: 13px; font-weight: 600; display: flex; align-items: center; gap: 6px; min-width: 0; }
.rb-warn { color: #b45309; }
.rb-m { color: #8a93a3; font-size: 10.5px; white-space: nowrap; }
.rb-warnline { color: #b42318; font-size: 11.5px; }
.rb-meta { color: #8a93a3; font-size: 10.5px; }
.rb-result { color: #5b6472; font-size: 12.5px; }
.rb-actions { display: flex; justify-content: flex-end; gap: 8px; padding-top: 2px; }
.rb-btn { border: 1px solid #e4e8f0; background: #fff; color: #0f172a; border-radius: 9px; padding: 5px 12px; font-size: 12.5px; font-weight: 500; }
.rb-btn:hover { background: #f5f7fb; }
.rb-btn.rb-primary { background: #0e2050; border-color: #0e2050; color: #fff; }
.rb-btn.rb-primary:hover { background: #16306e; }
.rb-btn.rb-ghost { border-color: transparent; background: transparent; color: #5b6472; }
.rb-btn.rb-ghost:hover { color: #0f172a; background: #eef2f8; }
.rb-btn:disabled { opacity: .45; cursor: not-allowed; }
.rb-notice { margin: 0 34px 8px; max-width: 760px; align-self: center; width: 100%; color: #b45309; font-size: 11.5px; display: flex; gap: 7px; align-items: center; }
.rb-notice.rb-quiet { color: #5b6472; }
.rb-notice.rb-error { color: #b42318; }
.rb-composer { max-width: 760px; width: 100%; align-self: center; display: flex; align-items: center; gap: 8px; border: 1px solid #e4e8f0; background: #fff; border-radius: 14px; padding: 7px 8px 7px 10px; margin: 0 34px 18px; }
.rb-composer input { flex: 1; border: 0; outline: 0; background: transparent; font-size: 13.5px; min-width: 0; }
.rb-composer input:focus { outline: none; }
.rb-composer input::placeholder { color: #8a93a3; }
.rb-send { width: 30px; height: 30px; border-radius: 50%; border: 0; background: #0e2050; color: #fff; font-size: 13px; display: grid; place-items: center; padding: 0; flex: none; }
.rb-send:hover { background: #16306e; }
.rb-detail { background: #f7f8fa; border-left: 1px solid #eef1f6; display: flex; flex-direction: column; min-height: 0; min-width: 0; overflow: auto; }
.rb-profile { display: grid; justify-items: center; gap: 5px; padding: 22px 16px 12px; text-align: center; }
.rb-tabs { display: flex; justify-content: center; gap: 22px; border-bottom: 1px solid #eef1f6; padding: 4px 16px 0; }
.rb-tab { border: 0; background: transparent; color: #8a93a3; font-size: 12px; padding: 7px 0 9px; border-bottom: 1.5px solid transparent; }
.rb-tab.rb-active { color: #0e2050; border-bottom-color: #1d4ed8; }
.rb-computer-act { display: grid; grid-template-columns: 44px minmax(0, 1fr) auto; gap: 10px; align-items: center; border: 1px solid #e4e8f0; background: #fff; border-radius: 10px; padding: 8px 10px; }
.rb-computer-act .rb-t, .rb-computer .rb-nm { font-size: 12px; }
.rb-computer-act .rb-s, .rb-computer .rb-st, .rb-act .rb-s, .rb-routine .rb-s { color: #8a93a3; font-size: 10.5px; }
.rb-computer .rb-st { display: flex; align-items: center; gap: 5px; }
.rb-computer .rb-st.rb-st-live { color: #15803d; }
.rb-computer .rb-st.rb-st-reconnecting { color: #b45309; }
.rb-computer .rb-st.rb-st-sleeping { color: #8a93a3; }
.rb-computer .rb-st.rb-st-offline { color: #8a93a3; }
.rb-computer .rb-st.rb-st-unreachable { color: #b42318; }
.rb-sections { padding: 14px 16px 24px; display: grid; gap: 20px; }
.rb-sec h3 { margin: 0 0 8px; color: #8a93a3; font-size: 10px; font-weight: 500; letter-spacing: .08em; text-transform: uppercase; display: flex; align-items: baseline; justify-content: space-between; gap: 8px; }
.rb-count { color: #8a93a3; font-size: 10px; font-weight: 500; letter-spacing: 0; text-transform: none; }
.rb-empty { background: #fff; border: 1px dashed #e4e8f0; border-radius: 10px; padding: 12px; display: grid; gap: 3px; }
.rb-empty-title { color: #5b6472; font-size: 12px; font-weight: 500; }
.rb-empty-hint { color: #8a93a3; font-size: 10.5px; line-height: 1.5; }
.rb-act { background: #fff; border: 1px solid #e4e8f0; border-radius: 10px; padding: 10px 12px; display: grid; gap: 4px; margin-bottom: 7px; }
.rb-act .rb-t { font-size: 12px; font-weight: 600; display: flex; justify-content: space-between; gap: 8px; }
.rb-ok { color: #15803d; font-weight: 500; font-size: 11px; white-space: nowrap; }
.rb-paused { color: #8a93a3; font-size: 11px; margin: 0 0 4px; }
.rb-routine { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 10px; align-items: center; padding: 7px 0; border-bottom: 1px solid #eef1f6; }
.rb-routine:last-child { border-bottom: 0; }
.rb-routine .rb-t { font-size: 12px; }
.rb-toggle { width: 34px; height: 19px; border-radius: 10px; border: 0; background: #cbd5e1; position: relative; flex: none; padding: 0; }
.rb-toggle::after { content: ""; position: absolute; top: 2px; left: 2px; width: 15px; height: 15px; border-radius: 50%; background: #fff; transition: left .12s; }
.rb-toggle.rb-on { background: #0e2050; }
.rb-toggle.rb-on::after { left: 17px; }
.rb-computer { display: grid; gap: 8px; }
.rb-comp-row { display: flex; align-items: center; gap: 9px; }
.rb-thumb { width: 44px; height: 30px; border-radius: 5px; background: #0b1b3a; border: 1px solid #e4e8f0; position: relative; overflow: hidden; flex: none; }
.rb-thumb::before { content: ""; position: absolute; inset: 18% 46% 18% 8%; background: #14285a; border-radius: 2px; }
.rb-thumb::after { content: ""; position: absolute; inset: 28% 8% 22% 58%; background: #22407f; border-radius: 2px; }
.rb-comp-acts { display: flex; justify-content: flex-end; gap: 6px; }
.rb-stop-confirm { padding: 8px 10px; border: 1px solid #e2e8f0; border-radius: 8px; background: #f8fafc; }
.rb-stop-confirm p { margin: 0 0 6px; font-size: 11.5px; color: #5b6472; }
.rb-comp-acts .rb-btn { padding: 4px 9px; font-size: 11px; }
.rb-usage { color: #5b6472; font-size: 12px; display: grid; gap: 3px; }
.rb-usage b { color: #0f172a; font-weight: 600; }
.rb-usage .rb-usage-low b { color: #b45309; }
.rb-low { color: #b45309; font-size: 12px; }
.rb-faint { color: #8a93a3; font-size: 11px; }
.rb-page { background: #fff; overflow: auto; display: flex; flex-direction: column; min-height: 0; min-width: 0; }
.rb-wizard-wrap { min-height: 100%; display: grid; place-items: center; padding: 40px 20px; }
.rb-wizard { width: 480px; max-width: 100%; }
.rb-wizard h1, .rb-page-inner h1 { margin: 0 0 4px; font-size: 18px; font-weight: 650; }
.rb-wizard .rb-sub { color: #8a93a3; margin: 0 0 24px; font-size: 11.5px; }
.rb-steps { display: flex; gap: 6px; margin-bottom: 24px; }
.rb-step { flex: 1; display: grid; gap: 5px; }
.rb-bar { height: 2px; border-radius: 1px; background: #e4e8f0; }
.rb-step.rb-done .rb-bar { background: #b6c2d6; }
.rb-step.rb-current .rb-bar { background: #0f172a; }
.rb-lbl { font-size: 10px; color: #8a93a3; }
.rb-step.rb-current .rb-lbl { color: #0f172a; }
.rb-wizard h2 { margin: 0 0 6px; font-size: 14px; font-weight: 600; }
.rb-say { color: #5b6472; margin: 0 0 16px; font-size: 12px; }
.rb-line { display: flex; gap: 8px; align-items: center; }
.rb-stack { display: grid; gap: 10px; }
.rb-field { flex: 1; width: 100%; background: #fff; border: 1px solid #e4e8f0; border-radius: 9px; color: #0f172a; padding: 8px 10px; font-size: 13px; }
.rb-field.rb-area { min-height: 66px; resize: vertical; }
.rb-flabel { display: grid; gap: 5px; font-size: 11px; color: #5b6472; }
.rb-form-foot { display: flex; justify-content: space-between; align-items: center; margin-top: 26px; padding-top: 14px; border-top: 1px solid #eef1f6; gap: 12px; }
.rb-mono { margin-bottom: 16px; }
.rb-hint { color: #8a93a3; font-size: 11.5px; }
.rb-page-inner { max-width: 760px; width: 100%; align-self: center; padding: 34px 34px 60px; }
.rb-page-inner .rb-back { margin: 0 0 14px; padding-left: 0; }
.rb-page-inner .rb-sub { color: #8a93a3; margin: 0 0 22px; font-size: 11.5px; }
.rb-snav { display: flex; gap: 16px; border-bottom: 1px solid #eef1f6; margin-bottom: 8px; }
.rb-snav button { border: 0; background: transparent; color: #8a93a3; font-size: 12px; padding: 8px 0; border-bottom: 1.5px solid transparent; }
.rb-snav button.rb-active { color: #0e2050; border-bottom-color: #1d4ed8; }
.rb-srow { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 13px 0; border-bottom: 1px solid #eef1f6; }
.rb-srow:last-child { border-bottom: 0; }
.rb-srow .rb-l { display: grid; gap: 1px; font-size: 13px; }
.rb-srow .rb-l small { color: #8a93a3; font-size: 11px; }
.rb-srow select, .rb-srow input { background: #fff; border: 1px solid #e4e8f0; border-radius: 8px; color: #0f172a; font-size: 12.5px; padding: 5px 8px; }
.rb-status { display: flex; align-items: center; gap: 6px; color: #5b6472; font-size: 11.5px; border: 0; background: transparent; padding: 0; }
.rb-status .rb-retry { padding: 2px 8px; font-size: 11px; }
.rb-center-empty { margin: auto; max-width: 420px; text-align: center; display: grid; gap: 8px; justify-items: center; padding: 48px 24px; }
.rb-center-empty h2 { margin: 0; font-size: 18px; font-weight: 650; }
.rb-center-empty p { margin: 0; color: #5b6472; font-size: 13px; }
.rb-thread-empty { color: #8a93a3; font-size: 13px; text-align: center; padding: 24px 0; }
.rb-thread-welcome { margin: auto; display: grid; gap: 6px; justify-items: center; text-align: center; padding: 40px 16px; }
.rb-thread-welcome-title { font-size: 15px; font-weight: 650; }
.rb-thread-welcome-job { color: #8a93a3; font-size: 12px; }
.rb-thread-welcome .rb-thread-empty { padding: 0; }
.rb-working-row { display: flex; align-items: center; gap: 8px; color: #5b6472; font-size: 13px; }
.rb-mini { display: flex; gap: 8px; padding: 8px 12px; border-bottom: 1px solid #eef1f6; }
@media (prefers-reduced-motion: reduce) {
  .rb-toggle::after { transition: none; }
}
`

    function lookup(catalog, key) {
      const parts = String(key || '').split('.')
      let cur = catalog
      for (const part of parts) {
        if (!cur || typeof cur !== 'object') return key
        cur = cur[part]
      }
      return typeof cur === 'string' ? cur : key
    }

    function fill(text, vars) {
      return String(text).replace(/\{(\w+)\}/g, (token, name) => {
        if (!vars || vars[name] == null || vars[name] === '') return token
        return String(vars[name])
      })
    }

    function makeT(catalog) {
      return (key, vars) => fill(lookup(catalog, key), vars)
    }

    function moneyNumber(value) {
      const n = Number(String(value ?? '').replace(/[^\d.]/g, ''))
      return Number.isFinite(n) ? n : NaN
    }

    /** Same-origin POST to one of the two plugin RPC routes. */
    async function pluginRpc(path, action, payload = {}) {
      const res = await fetch(path, {
        method: 'POST',
        mode: 'same-origin',
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, ...payload }),
      })
      let body = null
      try { body = await res.json() } catch { body = null }
      if (!res.ok || body?.ok !== true) {
        const error = body?.error
        const code = typeof error === 'string' ? error : error?.code ?? `http_${res.status}`
        const message = error && typeof error === 'object' && error.message
          ? error.message
          : `RPC failed (${res.status}).`
        const failure = new Error(`${code}: ${message}`)
        failure.code = code
        throw failure
      }
      return body
    }

    /** Call into the cloud-computer plugin; the token never enters this plugin. */
    const rayRpc = (action, payload) => pluginRpc('/plugins/rayrun/rpc', action, payload)

    /** Call into this bundle's host half; health stays a GET. */
    const hostRpc = (action, payload) => pluginRpc('/plugins/rayrun-bots', action, payload)

    function balanceText(balance) {
      const cents = Number(balance?.balance_cents)
      if (!Number.isFinite(cents)) return '—'
      return `${balance?.currency === 'USD' ? '$' : '¥'}${(cents / 100).toFixed(2)}`
    }

    function monogram(name) {
      const trimmed = String(name || '').trim()
      if (!trimmed) return '?'
      const chars = Array.from(trimmed)
      return chars[0].toUpperCase()
    }

    function avatarStyle(seed) {
      const key = String(seed || '')
      if (PINNED_AVATARS.has(key)) return { color: '#1d4ed8', background: '#e3eafc' }
      let hash = 0
      for (const ch of Array.from(key)) hash = (hash * 31 + ch.codePointAt(0)) >>> 0
      const [color, background] = AVATAR_PALETTE[hash % AVATAR_PALETTE.length]
      return { color, background }
    }

    /** Map one host roster entry to the client's bot shape; the conversation is still local. */
    function realBot(bot) {
      return {
        id: bot.id,
        name: bot.name,
        job: bot.label,
        source: 'real',
        attention: null,
        time: '',
        snippetKey: 'empty.snippet',
        messages: [],
        approvals: {},
        receipts: [],
        routines: [],
        library: [],
      }
    }

    let seq = 0
    function uid(prefix) {
      seq += 1
      return `${prefix}-${seq}`
    }

    function clock() {
      const now = new Date()
      const h = String(now.getHours()).padStart(2, '0')
      const m = String(now.getMinutes()).padStart(2, '0')
      return `${h}:${m}`
    }

    function markdownBlocks(text) {
      const blocks = []
      let paragraph = []
      let list = []
      const flushParagraph = () => {
        if (!paragraph.length) return
        const value = paragraph.join(' ').trim()
        if (value) blocks.push({ type: 'p', text: value })
        paragraph = []
      }
      const flushList = () => {
        if (!list.length) return
        blocks.push({ type: 'ul', items: list })
        list = []
      }
      for (const line of String(text || '').split('\n')) {
        const item = /^\s*[-*]\s+(.*)$/.exec(line)
        if (item) {
          flushParagraph()
          list.push(item[1])
          continue
        }
        if (line.trim() === '') {
          flushParagraph()
          flushList()
          continue
        }
        flushList()
        paragraph.push(line.trim())
      }
      flushParagraph()
      flushList()
      return blocks
    }

    function inlineNodes(text, keyPrefix) {
      const nodes = []
      const re = /(\*\*([^*]+)\*\*|`([^`]+)`)/g
      let last = 0
      let match = re.exec(text)
      let index = 0
      while (match) {
        if (match.index > last) nodes.push(text.slice(last, match.index))
        if (match[2] != null) nodes.push(h('strong', { key: `${keyPrefix}-b${index}` }, match[2]))
        else nodes.push(h('code', { key: `${keyPrefix}-c${index}` }, match[3]))
        last = match.index + match[0].length
        index += 1
        match = re.exec(text)
      }
      if (last < text.length) nodes.push(text.slice(last))
      return nodes
    }

    function RichText({ text }) {
      return markdownBlocks(text).map((block, index) => {
        if (block.type === 'ul') {
          return h(
            'ul',
            { key: `ul${index}` },
            block.items.map((item, itemIndex) => h('li', { key: itemIndex }, inlineNodes(item, `i${index}-${itemIndex}`))),
          )
        }
        return h('p', { key: `p${index}` }, inlineNodes(block.text, `p${index}`))
      })
    }

    function seedBots() {
      return [
        {
          id: 'nora',
          nameKey: 'sample.nora.name',
          jobKey: 'sample.nora.job',
          attention: 'working',
          timeKey: 'sample.nora.time',
          snippetKey: 'sample.nora.snippet',
          messages: [
            { id: 'nora-u', kind: 'user', textKey: 'sample.nora.user' },
            { id: 'nora-d', kind: 'day', textKey: 'sample.nora.day' },
            { id: 'nora-b1', kind: 'bot', textKey: 'sample.nora.reply1' },
            { id: 'nora-c', kind: 'computer', titleKey: 'sample.nora.computerTitle', subKey: 'sample.nora.computerSub' },
            { id: 'nora-a', kind: 'approval', approvalId: 'nora-pub' },
            { id: 'nora-b2', kind: 'bot', textKey: 'sample.nora.reply2' },
          ],
          approvals: {
            'nora-pub': {
              id: 'nora-pub',
              titleKey: 'sample.nora.approvalTitle',
              metaKey: 'sample.nora.approvalMeta',
              state: 'pending',
              origin: 'chat',
              target: 'Feishu #weekly',
              risk: ['outside', 'irreversible'],
            },
          },
          receipts: [
            { titleKey: 'sample.nora.r1', stateKey: 'receipt.ready', metaKey: 'sample.nora.r1meta' },
            { titleKey: 'sample.nora.r2', stateKey: 'receipt.waiting', metaKey: 'sample.nora.r2meta' },
            { titleKey: 'sample.nora.r3', stateKey: 'receipt.done', metaKey: 'sample.nora.r3meta' },
          ],
          routines: [
            { titleKey: 'sample.routine.weekly', scheduleKey: 'sample.routine.weeklyWhen', on: true },
            { titleKey: 'sample.routine.inbox', scheduleKey: 'sample.routine.inboxWhen', on: true },
            { titleKey: 'sample.routine.standup', scheduleKey: 'sample.routine.standupWhen', on: false },
          ],
          library: [
            { group: 'today', titleKey: 'sample.nora.f1', badgeKey: 'sample.nora.f1badge', metaKey: 'sample.nora.f1meta' },
            { group: 'today', titleKey: 'sample.nora.f2', badgeKey: 'sample.nora.f2badge', metaKey: 'sample.nora.f2meta' },
            { group: 'week', titleKey: 'sample.nora.f3', badgeKey: 'sample.nora.f3badge', metaKey: 'sample.nora.f3meta' },
            { group: 'older', titleKey: 'sample.nora.f4', badgeKey: 'sample.nora.f4badge', metaKey: 'sample.nora.f4meta' },
          ],
        },
        {
          id: 'eli',
          nameKey: 'sample.eli.name',
          jobKey: 'sample.eli.job',
          attention: 'needs',
          timeKey: 'sample.eli.time',
          snippetKey: 'sample.eli.snippet',
          messages: [
            { id: 'eli-xd', kind: 'day', textKey: 'sample.eli.expiredDay' },
            { id: 'eli-x', kind: 'approval', approvalId: 'eli-expired' },
            { id: 'eli-d', kind: 'day', textKey: 'sample.eli.day' },
            { id: 'eli-b', kind: 'bot', textKey: 'sample.eli.reply' },
            { id: 'eli-a', kind: 'approval', approvalId: 'eli-pub' },
          ],
          approvals: {
            'eli-expired': {
              id: 'eli-expired',
              titleKey: 'sample.eli.expiredTitle',
              metaKey: 'sample.eli.expiredMeta',
              state: 'expired',
              origin: 'background',
              target: 'Feishu #weekly',
              risk: ['outside', 'irreversible'],
            },
            'eli-pub': {
              id: 'eli-pub',
              titleKey: 'sample.eli.approvalTitle',
              metaKey: 'sample.eli.approvalMeta',
              state: 'pending',
              expiresMin: 1,
              origin: 'background',
              target: 'Feishu #weekly',
              risk: ['outside', 'irreversible'],
            },
          },
          receipts: [
            { titleKey: 'sample.nora.r2', stateKey: 'receipt.waiting', metaKey: 'sample.eli.approvalMeta' },
          ],
          routines: [],
          library: [],
        },
        {
          id: 'june',
          nameKey: 'sample.june.name',
          jobKey: 'sample.june.job',
          attention: 'unread',
          timeKey: 'sample.june.time',
          snippetKey: 'sample.june.snippet',
          messages: [
            { id: 'june-d', kind: 'day', textKey: 'sample.june.day' },
            { id: 'june-b', kind: 'bot', textKey: 'sample.june.reply' },
          ],
          approvals: {},
          receipts: [
            { titleKey: 'sample.june.r1', stateKey: 'receipt.done', metaKey: 'sample.june.r1meta' },
          ],
          routines: [],
          library: [],
        },
      ]
    }

    function createState() {
      return {
        screen: 'chat',
        selectedId: 'nora',
        tab: 'activity',
        computer: COMPUTER_PREVIEW,
        realOverview: null,
        realMachine: null,
        realError: '',
        searchOpen: false,
        search: '',
        composer: '',
        flash: null,
        live: '',
        focusComposer: false,
        settingsTab: 'account',
        setupStep: 0,
        forceList: false,
        forceDetail: false,
        settings: {
          idle: '15',
          lowBalance: '10',
          notifications: true,
          lang: null,
        },
        bots: FIRST_RUN_PREVIEW ? [] : seedBots(),
      }
    }

    function tickApprovals(state) {
      let changed = false
      const bots = state.bots.map((bot) => {
        let botChanged = false
        let botExpired = false
        const approvals = {}
        for (const [id, approval] of Object.entries(bot.approvals)) {
          if (approval.state !== 'pending' || !Number.isFinite(approval.expiresMin)) {
            approvals[id] = approval
            continue
          }
          const next = approval.expiresMin - 1
          approvals[id] = next <= 0
            ? { ...approval, state: 'expired', expiresMin: 0 }
            : { ...approval, expiresMin: next }
          botChanged = true
          if (next <= 0) botExpired = true
        }
        if (!botChanged) return bot
        changed = true
        const stillPending = Object.values(approvals).some((approval) => approval.state === 'pending')
        return {
          ...bot,
          approvals,
          attention: bot.attention === 'needs' && !stillPending ? null : bot.attention,
          snippet: botExpired && !stillPending ? null : bot.snippet,
          snippetKey: botExpired && !stillPending ? 'approval.expired' : bot.snippetKey,
          time: botExpired && !stillPending ? clock() : bot.time,
          timeKey: botExpired && !stillPending ? null : bot.timeKey,
        }
      })
      return changed ? { ...state, bots } : state
    }

    function botName(bot, t) {
      return bot.name || t(bot.nameKey)
    }

    function botJob(bot, t) {
      return bot.job || (bot.jobKey ? t(bot.jobKey) : '')
    }

    function botSnippet(bot, t) {
      if (bot.snippet) return bot.snippet
      if (bot.snippetKey) return t(bot.snippetKey)
      return ''
    }

    function botTime(bot, t) {
      if (bot.time) return bot.time
      if (bot.timeKey) return t(bot.timeKey)
      return ''
    }

    function attentionText(bot, t) {
      if (bot.attention === 'needs') return t('attention.needs')
      if (bot.attention === 'unread') return t('attention.unread')
      if (bot.attention === 'working') return t('attention.working')
      return ''
    }

    function textOf(entry, t) {
      if (entry.text) return entry.text
      if (entry.textKey) return t(entry.textKey)
      return ''
    }

    function fieldText(entry, t, keyName) {
      if (entry.text) return entry.text
      const key = entry[keyName]
      return key ? t(key) : ''
    }

    function useDshLang(ctx) {
      const locale = ctx?.get?.('locale') ?? ctx?.locale
      const read = () => {
        try {
          return String(locale?.getLocale?.()?.active ?? '')
        } catch {
          return ''
        }
      }
      const [id, setId] = useState(read)
      useEffect(() => {
        if (typeof locale?.subscribe !== 'function') return undefined
        return locale.subscribe(() => setId(read()))
      }, [locale])
      return id
    }

    function resolveLang(dshId, override) {
      const chosen = String(override || '').toLowerCase()
      if (chosen === 'zh' || chosen === 'en') return chosen
      const id = String(dshId || '').toLowerCase()
      if (id.startsWith('zh')) return 'zh'
      if (id.startsWith('en')) return 'en'
      return 'zh'
    }

    function useContainerWidth(ref) {
      const [width, setWidth] = useState(1280)
      useEffect(() => {
        const el = ref.current
        if (!el || typeof ResizeObserver !== 'function') return undefined
        const measure = () => setWidth(el.clientWidth || 1280)
        measure()
        const observer = new ResizeObserver(measure)
        observer.observe(el)
        return () => observer.disconnect()
      }, [ref])
      return width
    }

    function Mark() {
      return h(
        'svg',
        {
          className: 'rb-mark',
          width: 20,
          height: 20,
          viewBox: '0 0 24 24',
          fill: 'none',
          stroke: '#003d9b',
          strokeWidth: 2,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          'aria-hidden': 'true',
        },
        MARK_PATHS.map((d) => h('path', { key: d, d })),
      )
    }

    function SearchIcon() {
      return h(
        'svg',
        { width: 15, height: 15, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', 'aria-hidden': 'true' },
        h('circle', { cx: 11, cy: 11, r: 7 }),
        h('path', { d: 'm16.5 16.5 4.5 4.5' }),
      )
    }

    function GearIcon() {
      return h(
        'svg',
        { width: 15, height: 15, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', 'aria-hidden': 'true' },
        h('path', { d: 'M4 7h9M18 7h2M4 12h3M11 12h9M4 17h7M15 17h5' }),
        h('circle', { cx: 15, cy: 7, r: 2 }),
        h('circle', { cx: 9, cy: 12, r: 2 }),
        h('circle', { cx: 13, cy: 17, r: 2 }),
      )
    }

    function Avatar({ size, name, text, className }) {
      return h(
        'div',
        {
          className: `rb-avatar rb-${size}${className ? ` ${className}` : ''}`,
          style: avatarStyle(name),
          'aria-hidden': 'true',
        },
        text || monogram(name),
      )
    }

    function lineParts(template, vars, boldKeys) {
      const nodes = []
      const re = /\{(\w+)\}/g
      let last = 0
      let index = 0
      let match = re.exec(template)
      while (match) {
        if (match.index > last) nodes.push(template.slice(last, match.index))
        const name = match[1]
        const value = vars && vars[name] != null ? String(vars[name]) : ''
        nodes.push(boldKeys.has(name) ? h('b', { key: `${name}${index}` }, value) : value)
        last = match.index + match[0].length
        index += 1
        match = re.exec(template)
      }
      if (last < template.length) nodes.push(template.slice(last))
      return nodes
    }

    function Toggle({ on, label, onClick }) {
      return h('button', {
        type: 'button',
        className: on ? 'rb-toggle rb-on' : 'rb-toggle',
        'aria-pressed': on ? 'true' : 'false',
        'aria-label': label,
        onClick,
      })
    }

    function BotFields({ t, name, job, instructions, onName, onJob, onInstructions }) {
      return h(
        'div',
        null,
        h(
          'div',
          { className: 'rb-line rb-mono' },
          h(Avatar, { size: 'new', name: name || t('newBot.defaultName') }),
          h('div', { className: 'rb-hint' }, t('newBot.monogramHint')),
        ),
        h(
          'div',
          { className: 'rb-stack' },
          h(
            'label',
            { className: 'rb-flabel' },
            t('newBot.name'),
            h('input', {
              className: 'rb-field',
              value: name,
              maxLength: 40,
              autoFocus: true,
              onChange: (event) => onName(event.target.value),
            }),
          ),
          h(
            'label',
            { className: 'rb-flabel' },
            t('newBot.job'),
            h('input', {
              className: 'rb-field',
              value: job,
              maxLength: 80,
              onChange: (event) => onJob(event.target.value),
            }),
          ),
          h(
            'label',
            { className: 'rb-flabel' },
            t('newBot.instructions'),
            h('textarea', {
              className: 'rb-field rb-area',
              rows: 4,
              value: instructions,
              placeholder: t('newBot.placeholder', { name: name || t('newBot.defaultName') }),
              onChange: (event) => onInstructions(event.target.value),
            }),
          ),
        ),
      )
    }

    function idleLabel(t, idle) {
      if (idle === '30') return t('settings.idle30')
      if (idle === '0') return t('settings.idleOff')
      return t('settings.idle15')
    }

    function BotsApp({ ctx }) {
      const [state, setState] = useState(createState)
      const [host, setHost] = useState({ status: 'checking' })
      const [hostAttempt, setHostAttempt] = useState(0)
      const [desktop, setDesktop] = useState(null)
      const dshLang = useDshLang(ctx)
      const lang = resolveLang(dshLang, state.settings.lang)

      useEffect(() => {
        const previous = document.title
        document.title = 'Rayrun Bot'
        return () => { document.title = previous }
      }, [])
      const t = makeT(lang === 'zh' ? ZH : EN)
      const frameRef = useRef(null)
      const searchRef = useRef(null)
      const composerRef = useRef(null)
      const replyTimers = useRef(new Map())
      const width = useContainerWidth(frameRef)

      useEffect(() => {
        const onKey = (event) => {
          if (event.key !== 'Escape') return
          setState((current) => {
            if (current.searchOpen) return { ...current, searchOpen: false, search: '' }
            if (current.screen !== 'chat') return { ...current, screen: 'chat', flash: null }
            return current
          })
        }
        document.addEventListener('keydown', onKey)
        return () => document.removeEventListener('keydown', onKey)
      }, [])

      useEffect(() => () => {
        for (const timer of replyTimers.current.values()) clearTimeout(timer)
        replyTimers.current.clear()
      }, [])

      useEffect(() => {
        const timer = setInterval(() => setState(tickApprovals), 60 * 1000)
        return () => clearInterval(timer)
      }, [])

      useEffect(() => {
        if (state.searchOpen) searchRef.current?.focus()
      }, [state.searchOpen])

      useEffect(() => {
        if (!state.focusComposer || state.screen !== 'chat') return
        composerRef.current?.focus()
        setState((current) => ({ ...current, focusComposer: false }))
      }, [state.focusComposer, state.screen])

      useEffect(() => {
        const controller = new AbortController()
        const run = async () => {
          setHost({ status: 'checking' })
          try {
            const response = await fetch('/plugins/rayrun-bots?action=health', {
              method: 'GET',
              mode: 'same-origin',
              credentials: 'same-origin',
              cache: 'no-store',
              headers: { Accept: 'application/json' },
              signal: controller.signal,
            })
            if (!response.ok) throw new Error(`health ${response.status}`)
            const body = await response.json()
            if (!body || body.ok !== true || body.plugin !== 'rayrun-bots') throw new Error('bad health envelope')
            setHost({ status: 'loaded', version: String(body.version ?? ''), ready: body.ready === true, dependency: body.dependency ?? null })
          } catch (error) {
            if (error?.name === 'AbortError') return
            setHost({ status: 'down' })
          }
        }
        run()
        return () => controller.abort()
      }, [hostAttempt])

      useEffect(() => {
        if (host.status !== 'loaded') return undefined
        let cancelled = false
        void (async () => {
          try {
            const body = await hostRpc('bots.list')
            const bots = Array.isArray(body.bots) ? body.bots : []
            if (cancelled || bots.length === 0) return
            setState((current) => {
              const roster = bots.map(realBot)
              const selectedId = roster.some((bot) => bot.id === current.selectedId)
                ? current.selectedId
                : roster[0].id
              return { ...current, bots: roster, selectedId }
            })
          } catch {
            // Keep the preview; the Settings host row reports the failure.
          }
        })()
        return () => { cancelled = true }
      }, [host.status])

      const selected = state.bots.find((bot) => bot.id === state.selectedId) || state.bots[0] || null
      const listOn = width >= 900 || state.forceList
      const detailOn = state.screen === 'chat' && (width >= 1120 || state.forceDetail)
      const columns = `${listOn ? '296px ' : ''}minmax(0,1fr)${detailOn ? ' 328px' : ''}`

      const patch = (partial) => setState((current) => ({ ...current, ...partial }))

      useEffect(() => {
        if (state.screen !== 'chat') return undefined
        let cancelled = false
        void (async () => {
          try {
            const overview = await rayRpc('overview')
            if (cancelled) return
            const machines = Array.isArray(overview.machines) ? overview.machines : []
            patch({ realOverview: overview, realMachine: pickMachine(machines) || null, realError: '' })
          } catch (error) {
            if (!cancelled) patch({ realError: String(error?.message ?? error) })
          }
        })()
        return () => {
          cancelled = true
        }
      }, [state.screen])

      const realConfigured = state.realOverview?.connection?.configured === true
      const realBalanceCents = Number(state.realOverview?.balance?.balance_cents)
      const realBalance = Number.isFinite(realBalanceCents) ? realBalanceCents / 100 : NaN

      const openScreen = (screen) => patch({ screen, flash: null, searchOpen: false })

      const selectBot = (id) => {
        setState((current) => ({
          ...current,
          selectedId: id,
          screen: 'chat',
          tab: 'activity',
          forceList: false,
          flash: null,
          bots: current.bots.map((bot) => (bot.id === id && bot.attention === 'unread' ? { ...bot, attention: null } : bot)),
        }))
      }

      const updateBot = (id, fn) => {
        setState((current) => ({
          ...current,
          bots: current.bots.map((bot) => (bot.id === id ? fn(bot) : bot)),
        }))
      }

      const send = () => {
        const text = state.composer.trim()
        if (!text || !selected || selected.working) return
        const botId = selected.id
        const workingId = uid('working')
        const userId = uid('user')
        const snippet = text.length > 48 ? `${text.slice(0, 47)}…` : text
        setState((current) => ({
          ...current,
          composer: '',
          flash: null,
          live: t('chat.working'),
          bots: current.bots.map((bot) => {
            if (bot.id !== botId) return bot
            return {
              ...bot,
              working: true,
              attention: 'working',
              snippet,
              snippetKey: null,
              time: clock(),
              timeKey: null,
              messages: [...bot.messages, { id: userId, kind: 'user', text }, { id: workingId, kind: 'working' }],
            }
          }),
        }))
        const timer = setTimeout(() => {
          replyTimers.current.delete(botId)
          setState((current) => ({
            ...current,
            live: t('chat.simulatedReply'),
            bots: current.bots.map((bot) => {
              if (bot.id !== botId) return bot
              const approvalId = uid('approval')
              return {
                ...bot,
                working: false,
                attention: 'needs',
                snippet: null,
                snippetKey: 'chat.simulatedSnippet',
                time: clock(),
                timeKey: null,
                messages: [
                  ...bot.messages.filter((entry) => entry.id !== workingId),
                  { id: uid('bot'), kind: 'bot', textKey: 'chat.simulatedReply' },
                  { id: uid('approval-card'), kind: 'approval', approvalId },
                ],
                approvals: {
                  ...bot.approvals,
                  [approvalId]: {
                    id: approvalId,
                    titleKey: 'chat.simulatedApprovalTitle',
                    metaKey: 'chat.simulatedApprovalMeta',
                    state: 'pending',
                    origin: 'chat',
                    targetKey: 'chat.simulatedTarget',
                    risk: ['outside', 'irreversible'],
                  },
                },
              }
            }),
          }))
        }, 1200)
        replyTimers.current.set(botId, timer)
      }

      const decide = (approvalId, decision) => {
        if (!selected) return
        const allowed = decision === 'allowed'
        const sentence = t(allowed ? 'approval.allowedLocal' : 'approval.deniedLocal')
        const snippet = t(allowed ? 'approval.snippetAllowed' : 'approval.snippetDenied')
        setState((current) => ({
          ...current,
          flash: sentence,
          live: sentence,
          bots: current.bots.map((bot) => {
            if (bot.id !== selected.id) return bot
            const currentApproval = bot.approvals[approvalId]
            if (!currentApproval || currentApproval.state !== 'pending') return bot
            const approvals = { ...bot.approvals, [approvalId]: { ...currentApproval, state: decision } }
            const stillPending = Object.values(approvals).some((item) => item.state === 'pending')
            return {
              ...bot,
              approvals,
              attention: bot.attention === 'needs' && !stillPending ? null : bot.attention,
              snippet: stillPending ? bot.snippet : snippet,
              snippetKey: stillPending ? bot.snippetKey : null,
            }
          }),
        }))
      }

      const createBot = async (draft) => {
        const name = draft.name.trim()
        if (!name) return
        const job = draft.job.trim()
        const instructions = draft.instructions.trim() || t('persona.template', { name, job: job || '…' })
        const body = await hostRpc('bots.create', { name, label: job, instructions })
        const bot = body.bot
        if (!bot || typeof bot.id !== 'string') throw new Error('bots.create returned no bot')
        setState((current) => ({
          ...current,
          screen: 'chat',
          selectedId: bot.id,
          tab: 'activity',
          flash: null,
          focusComposer: true,
          bots: [...current.bots.filter((item) => item.source === 'real'), realBot(bot)],
        }))
      }

      const flash = (text) => patch({ flash: text, live: text })

      const openComputer = async () => {
        const win = window.open('', '_blank')
        if (!win) {
          flash(t('computer.popupBlocked'))
          return
        }
        win.opener = null
        try {
          const overview = await rayRpc('overview')
          if (overview.connection?.configured !== true) {
            win.close()
            flash(t('computer.connectFirst'))
            return
          }
          const machines = Array.isArray(overview.machines) ? overview.machines : []
          const selectedMachine = pickMachine(machines)
          patch({ realOverview: overview, realMachine: selectedMachine || null, realError: '' })
          let machine = selectedMachine
          if (!machine) {
            win.close()
            flash(t('computer.noMachine'))
            return
          }
          if (machine.status !== 'Running') {
            flash(t('computer.starting'))
            await rayRpc('machine.action', {
              id: machine.id,
              verb: machine.status === 'Paused' ? 'resume' : 'start',
            })
            for (let i = 0; i < 40; i += 1) {
              await new Promise((resolve) => setTimeout(resolve, 1500))
              machine = (await rayRpc('machine.get', { id: machine.id })).machine
              if (machine?.status === 'Running') break
            }
          }
          if (machine?.status !== 'Running') {
            win.close()
            flash(t('computer.startTimeout'))
            return
          }
          patch({ realMachine: machine })
          await rayRpc('machine.desktopRepair', { id: machine.id }).catch(() => {})
          if (!machine.desktop_url) {
            win.close()
            flash(t('computer.noDesktop'))
            return
          }
          const password = await rayRpc('machine.password', { id: machine.id })
          const result = password.result ?? {}
          const secret = [result.stdout, result.stderr].filter(Boolean).join('\n').trim()
          if (!win.closed) win.location = machine.desktop_url
          setDesktop({ password: secret, copied: false })
          flash(t('computer.opened'))
        } catch (error) {
          win.close()
          const detail = String(error?.message ?? error)
          flash(/token_required|unauthorized/i.test(detail)
            ? t('computer.connectFirst')
            : t('computer.openFailed', { message: detail }))
        }
      }

      const stopComputer = async () => {
        const machine = state.realMachine
        if (!machine?.id) {
          flash(t('computer.noMachineShort'))
          return
        }
        if (machine.status !== 'Running') return
        try {
          flash(t('computer.stopping'))
          const result = await rayRpc('machine.action', { id: machine.id, verb: 'stop' })
          let next = result?.machine ?? machine
          for (let i = 0; i < 20; i += 1) {
            await new Promise((resolve) => setTimeout(resolve, 1500))
            next = (await rayRpc('machine.get', { id: machine.id })).machine ?? next
            if (next?.status !== 'Running' && next?.status !== 'Stopping') break
          }
          patch({ realMachine: next })
          const overview = await rayRpc('overview').catch(() => null)
          if (overview) patch({ realOverview: overview })
          if (next?.status === 'Running' || next?.status === 'Stopping') flash(t('computer.stopTimeout'))
          else flash(t('computer.stopped'))
        } catch (error) {
          const detail = String(error?.message ?? error)
          flash(/token_required|unauthorized/i.test(detail)
            ? t('computer.connectFirst')
            : t('computer.stopFailed', { message: detail }))
        }
      }

      const catalog = lang === 'zh' ? ZH : EN
      const balance = Number.isFinite(realBalance) ? realBalance : moneyNumber(t('usage.sampleBalance'))
      const threshold = moneyNumber(state.settings.lowBalance)
      const low = LOW_BALANCE_PREVIEW
        || (realConfigured && Number.isFinite(realBalance) && Number.isFinite(threshold) && realBalance < threshold)

      const query = state.search.trim().toLowerCase()
      const rows = state.bots.filter((bot) => {
        if (selected && bot.id === selected.id) return false
        if (!query) return true
        const hay = `${botName(bot, t)} ${botJob(bot, t)} ${botSnippet(bot, t)}`.toLowerCase()
        return hay.includes(query)
      })

      const center = renderCenter({
        state,
        t,
        lang,
        selected,
        low,
        onComposer: (composer) => patch({ composer }),
        onSend: send,
        onDecide: decide,
        onView: () => flash(t('computer.desktopLater')),
        onAttach: () => flash(t('notice.attach')),
        onCreate: createBot,
        onScreen: openScreen,
        onSetupStep: (setupStep) => patch({ setupStep }),
        onFlash: flash,
        onSettings: (partial) => {
          let next = partial
          if (partial?.lang === 'zh' || partial?.lang === 'en') {
            try {
              const locale = ctx?.get?.('locale') ?? ctx?.locale
              if (typeof locale?.setLocale === 'function') {
                locale.setLocale(partial.lang)
                // DSH owns the persisted preference; follow it instead of
                // pinning a session-only override.
                next = { ...partial, lang: null }
              }
            } catch {
              // Keep the in-memory language when DSH cannot persist the choice.
            }
          }
          setState((current) => ({ ...current, settings: { ...current.settings, ...next } }))
        },
        onSettingsTab: (settingsTab) => patch({ settingsTab }),
        catalog,
        width,
        composerRef,
        host,
        onRetryHost: () => setHostAttempt((n) => n + 1),
        onToggleList: () => patch({ forceList: !state.forceList }),
        onToggleDetail: () => patch({ forceDetail: !state.forceDetail }),
      })

      return h(
        'div',
        { className: 'rb-frame', ref: frameRef, id: 'rayrun-bots-root' },
        h('style', null, CSS),
        h('p', { className: 'rb-sr' }, t('notice.preview')),
        h('div', { className: 'rb-sr', 'aria-live': 'polite' }, state.live),
        h(
          'div',
          { className: 'rb-app', style: { gridTemplateColumns: columns } },
          listOn ? h(ChatList, {
            t,
            state,
            rows,
            selected,
            searchRef,
            low,
            connected: realConfigured,
            balance: realConfigured ? balanceText(state.realOverview?.balance) : null,
            onSearchToggle: () => patch({ searchOpen: !state.searchOpen, search: state.searchOpen ? '' : state.search }),
            onSearch: (search) => patch({ search }),
            onSelect: selectBot,
            onNew: () => openScreen('newbot'),
            onSettings: () => openScreen('settings'),
            onSetup: () => {
              patch({ screen: 'setup', setupStep: 0, flash: null, searchOpen: false })
            },
          }) : null,
          center,
          detailOn && selected ? h(Details, {
            t,
            catalog,
            bot: selected,
            tab: state.tab,
            onTab: (tab) => patch({ tab }),
            computer: state.computer,
            machine: state.realMachine,
            configured: realConfigured,
            overview: state.realOverview,
            usageError: state.realError,
            usagePreview: LOW_BALANCE_PREVIEW,
            low,
            idle: idleLabel(t, state.settings.idle),
            onToggleRoutine: (index) => updateBot(selected.id, (bot) => ({
              ...bot,
              routines: bot.routines.map((routine, routineIndex) => (routineIndex === index ? { ...routine, on: !routine.on } : routine)),
            })),
            onComputer: openComputer,
            onStop: stopComputer,
          }) : null,
        ),
        desktop ? h(
          'div',
          { className: 'rb-desktop-toast', role: 'status' },
          h('h3', null, t('computer.passwordTitle')),
          h('p', null, t('computer.passwordBody')),
          h('code', null, desktop.password || t('computer.passwordEmpty')),
          h(
            'div',
            { className: 'rb-line' },
            h('button', {
              type: 'button',
              className: 'rb-btn',
              disabled: !desktop.password,
              onClick: async () => {
                try {
                  await navigator.clipboard.writeText(desktop.password)
                  setDesktop({ ...desktop, copied: true })
                } catch {
                  flash(t('computer.copyFailed'))
                }
              },
            }, desktop.copied ? t('computer.copied') : t('computer.copy')),
            h('button', { type: 'button', className: 'rb-btn rb-ghost', onClick: () => setDesktop(null) }, t('computer.close')),
          ),
        ) : null,
      )
    }

    function ChatList({ t, state, rows, selected, searchRef, low, connected, balance, onSearchToggle, onSearch, onSelect, onNew, onSettings, onSetup }) {
      const userName = t('sample.user.name')
      return h(
        'aside',
        { className: 'rb-list', 'aria-label': t('panel.label') },
        h(
          'div',
          { className: 'rb-list-top' },
          h('div', { className: 'rb-brand' }, h(Mark), h('span', null, t('brand')), h('span', { className: 'rb-preview-pill' }, t('preview.badge'))),
          h(
            'div',
            { className: 'rb-tools' },
            h('button', { type: 'button', className: 'rb-icon', title: t('list.search'), 'aria-label': t('list.search'), 'aria-pressed': state.searchOpen ? 'true' : 'false', onClick: onSearchToggle }, h(SearchIcon)),
            h('button', { type: 'button', className: 'rb-icon', title: t('list.newBot'), 'aria-label': t('list.newBot'), onClick: onNew }, '+'),
          ),
        ),
        state.searchOpen ? h(
          'div',
          { className: 'rb-search' },
          h('input', {
            ref: searchRef,
            value: state.search,
            placeholder: t('list.searchPlaceholder'),
            'aria-label': t('list.search'),
            onChange: (event) => onSearch(event.target.value),
          }),
        ) : null,
        selected ? h(
          'div',
          { className: 'rb-current' },
          h(Avatar, { size: 'big', name: botName(selected, t) }),
          h('div', { className: 'rb-name' }, botName(selected, t)),
          h('div', { className: 'rb-label' }, attentionText(selected, t) ? `${botJob(selected, t)} · ${attentionText(selected, t)}` : botJob(selected, t)),
        ) : h(
          'div',
          { className: 'rb-current' },
          h('div', { className: 'rb-name' }, t('empty.heading')),
          h('div', { className: 'rb-label' }, t('empty.body')),
        ),
        h(
          'div',
          { className: 'rb-chats' },
          rows.length ? rows.map((bot) => {
            const name = botName(bot, t)
            const snippet = botSnippet(bot, t)
            const attention = attentionText(bot, t)
            return h(
              'button',
              {
                type: 'button',
                key: bot.id,
                className: 'rb-row',
                onClick: () => onSelect(bot.id),
                'aria-label': attention ? `${name}. ${snippet}. ${attention}` : `${name}. ${snippet}`,
              },
              h(Avatar, { size: 'mid', name }),
              h(
                'div',
                { style: { minWidth: 0 } },
                h(
                  'div',
                  { className: 'rb-nm' },
                  name,
                  bot.attention ? h('span', { className: `rb-dot rb-${bot.attention}`, title: attention }) : null,
                ),
                h('div', { className: 'rb-sn' }, snippet),
              ),
              h('div', { className: 'rb-tm' }, botTime(bot, t)),
            )
          }) : state.bots.length === 0
            ? h(
              'div',
              { className: 'rb-firstrun' },
              h('button', { type: 'button', className: 'rb-btn rb-primary', onClick: onNew }, t('newBot.create')),
            )
            : state.search.trim()
              ? h('div', { className: 'rb-empty-list' }, t('list.empty'))
              : null,
        ),
        h(
          'div',
          { className: 'rb-foot' },
          h(Avatar, { size: 'sm', name: userName, text: t('sample.user.initials') }),
          h(
            'div',
            { className: 'rb-who' },
            userName,
            h(
              'small',
              null,
              h('button', {
                type: 'button',
                className: low ? 'rb-textbtn rb-textbtn-low' : 'rb-textbtn',
                onClick: onSetup,
                title: t('setup.title'),
              },
              low ? h('span', { className: 'rb-dot rb-needs', 'aria-hidden': 'true' }) : null,
              connected ? t('sample.user.foot', { balance }) : t('setup.notConnected'),
              low ? h('span', { className: 'rb-sr' }, t('cost.lowShort')) : null),
            ),
          ),
          h('button', { type: 'button', className: 'rb-icon', title: t('list.settings'), 'aria-label': t('list.settings'), onClick: onSettings }, h(GearIcon)),
        ),
      )
    }

    function ApprovalCard({ t, approval, onDecide }) {
      const pending = approval.state === 'pending'
      const expired = approval.state === 'expired'
      const title = fieldText(approval, t, 'titleKey')
      const meta = fieldText(approval, t, 'metaKey')
      const origin = approval.origin === 'background'
        ? t('approval.originBackground')
        : approval.origin === 'chat'
          ? t('approval.originChat')
          : ''
      const target = approval.targetKey ? t(approval.targetKey) : approval.target || ''
      const risks = Array.isArray(approval.risk)
        ? approval.risk
          .map((risk) => risk === 'outside' ? t('approval.riskOutside') : risk === 'irreversible' ? t('approval.riskIrreversible') : null)
          .filter(Boolean)
        : []
      const riskLine = risks.length ? risks.join(' · ') : t('approval.warning')
      let side = t('approval.waits')
      if (pending && Number.isFinite(approval.expiresMin)) side = t('approval.expires', { n: approval.expiresMin })
      if (approval.state === 'allowed') side = t('approval.snippetAllowed')
      if (approval.state === 'denied') side = t('approval.snippetDenied')
      if (expired) side = t('approval.expired')
      return h(
        'div',
        { className: expired ? 'rb-card rb-card-expired' : 'rb-card', 'data-state': approval.state, role: 'group', 'aria-label': title },
        h(
          'div',
          { className: 'rb-card-top' },
          h('span', { className: 'rb-card-title' }, h('span', { className: 'rb-warn', 'aria-hidden': 'true' }, '⚠'), title),
          h('span', { className: 'rb-m' }, side),
        ),
        origin || target ? h(
          'div',
          { className: 'rb-card-fields' },
          origin ? h('span', { className: 'rb-chip' }, origin) : null,
          target ? h('span', { className: 'rb-chip rb-chip-target' }, target) : null,
        ) : null,
        pending ? h('div', { className: 'rb-warnline' }, riskLine) : expired ? null : h('div', { className: 'rb-result' }, t(approval.state === 'allowed' ? 'approval.allowedLocal' : 'approval.deniedLocal')),
        h('div', { className: 'rb-meta' }, meta),
        pending ? h(
          'div',
          { className: 'rb-actions' },
          h('button', { type: 'button', className: 'rb-btn rb-ghost', onClick: () => onDecide(approval.id, 'denied') }, t('approval.deny')),
          h('button', { type: 'button', className: 'rb-btn rb-primary', onClick: () => onDecide(approval.id, 'allowed') }, t('approval.allowOnce')),
        ) : null,
      )
    }

    function Notice({ t, flash, computer }) {
      if (flash) {
        return h(
          'div',
          { className: 'rb-notice', role: 'status', 'data-computer': computer },
          h('span', { className: 'rb-dot rb-needs', 'aria-hidden': 'true' }),
          flash,
        )
      }
      if (!computer || computer === 'live') return null
      const sleeping = computer === 'sleeping'
      const unreachable = computer === 'unreachable'
      return h(
        'div',
        {
          className: unreachable ? 'rb-notice rb-error' : sleeping ? 'rb-notice rb-quiet' : 'rb-notice',
          role: 'status',
          'data-computer': computer,
        },
        h('span', { className: `rb-dot${unreachable ? ' rb-danger' : sleeping ? '' : ' rb-needs'}`, 'aria-hidden': 'true' }),
        t(sleeping ? 'notice.sleeping' : unreachable ? 'computer.unreachable' : 'notice.reconnecting'),
      )
    }

    function Conversation({ t, state, bot, composerRef, onComposer, onSend, onDecide, onView, onAttach, showListButton, showDetailButton, onToggleList, onToggleDetail }) {
      const name = botName(bot, t)
      const job = botJob(bot, t)
      const threadRef = useRef(null)
      useEffect(() => {
        const thread = threadRef.current
        if (thread) thread.scrollTop = thread.scrollHeight
      }, [bot.id, bot.messages.length])
      return h(
        'main',
        { className: 'rb-main', 'data-screen': 'chat' },
        showListButton || showDetailButton ? h(
          'div',
          { className: 'rb-mini' },
          showListButton ? h('button', { type: 'button', className: 'rb-btn', 'aria-pressed': state.forceList ? 'true' : 'false', onClick: onToggleList }, t('panel.label')) : null,
          showDetailButton ? h('button', { type: 'button', className: 'rb-btn', 'aria-pressed': state.forceDetail ? 'true' : 'false', onClick: onToggleDetail }, name) : null,
        ) : null,
        h(
          'div',
          { className: 'rb-thread', ref: threadRef },
          bot.messages.length ? bot.messages.map((entry) => {
            if (entry.kind === 'working') return h('div', { key: entry.id, className: 'rb-working-row', role: 'status' }, h('span', { className: 'rb-dot rb-working', 'aria-hidden': 'true' }), t('chat.working'))
            if (entry.kind === 'day') return h('div', { key: entry.id, className: 'rb-day' }, textOf(entry, t))
            if (entry.kind === 'user') {
              return h('div', { key: entry.id, className: 'rb-msg rb-user' }, h('div', { className: 'rb-bubble' }, textOf(entry, t)))
            }
            if (entry.kind === 'computer') {
              return h(
                'div',
                { key: entry.id, className: 'rb-computer-act' },
                h('div', { className: 'rb-thumb', 'aria-hidden': 'true' }),
                h('div', null, h('div', { className: 'rb-t' }, t(entry.titleKey)), h('div', { className: 'rb-s' }, t(entry.subKey))),
                h('button', { type: 'button', className: 'rb-btn rb-ghost', onClick: onView }, t('computer.view')),
              )
            }
            if (entry.kind === 'approval') {
              const approval = bot.approvals[entry.approvalId]
              if (!approval) return null
              return h(ApprovalCard, { key: entry.id, t, approval, onDecide })
            }
            return h(
              'div',
              { key: entry.id, className: 'rb-msg' },
              h(Avatar, { size: 'sm', name, className: 'rb-msg-avatar' }),
              h(
                'div',
                { className: 'rb-body' },
                h('div', { className: 'rb-who-line' }, h('b', null, name), h('span', null, job)),
                h(RichText, { text: textOf(entry, t) }),
              ),
            )
          }) : h(
            'div',
            { className: 'rb-thread-welcome' },
            h(Avatar, { size: 'big', name }),
            h('div', { className: 'rb-thread-welcome-title' }, name),
            h('div', { className: 'rb-thread-welcome-job' }, job),
            h('p', { className: 'rb-thread-empty' }, t('empty.thread')),
          ),
        ),
        h(Notice, { t, flash: state.flash, computer: state.computer }),
        h(
          'div',
          { className: 'rb-composer' },
          h('button', { type: 'button', className: 'rb-icon', title: t('composer.attach'), 'aria-label': t('composer.attach'), onClick: onAttach }, '+'),
          h('input', {
            ref: composerRef,
            value: state.composer,
            disabled: !!bot.working,
            placeholder: t('composer.placeholder', { name }),
            'aria-label': t('composer.placeholder', { name }),
            onChange: (event) => onComposer(event.target.value),
            onKeyDown: (event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault()
                onSend()
              }
            },
          }),
          h('button', { type: 'button', className: 'rb-send', disabled: !!bot.working, title: t('composer.send'), 'aria-label': t('composer.send'), onClick: onSend }, '↑'),
        ),
      )
    }

    function EmptyBlock({ name, title, hint }) {
      return h(
        'div',
        { className: 'rb-empty', 'data-empty': name },
        h('div', { className: 'rb-empty-title' }, title),
        h('div', { className: 'rb-empty-hint' }, hint),
      )
    }

    function Details({ t, catalog, bot, tab, onTab, computer, machine, configured, overview, usageError, usagePreview, low, idle, onToggleRoutine, onComputer, onStop }) {
      const name = botName(bot, t)
      const job = botJob(bot, t)
      const count = (n) => (n ? h('span', { className: 'rb-count' }, String(n)) : null)
      const routinesPaused = bot.routines.length > 0 && bot.routines.every((routine) => !routine.on)
      const groups = [
        ['today', 'library.today'],
        ['week', 'library.week'],
        ['older', 'library.older'],
      ]
      const computerStatus = computer || (machine ? machineStatus(machine.status) : 'offline')
      const computerName = machine?.name ?? (computer ? t('sample.computerName') : '—')
      return h(
        'aside',
        { className: 'rb-detail', 'aria-label': name },
        h(
          'div',
          { className: 'rb-profile' },
          h(Avatar, { size: 'big', name }),
          h('div', { className: 'rb-name' }, name),
          h('div', { className: 'rb-sub' }, t('details.jobComputer', { job, computer: computerName })),
        ),
        h(
          'div',
          { className: 'rb-tabs', role: 'tablist' },
          h('button', { type: 'button', className: tab === 'activity' ? 'rb-tab rb-active' : 'rb-tab', role: 'tab', 'aria-selected': tab === 'activity' ? 'true' : 'false', onClick: () => onTab('activity') }, t('details.activity')),
          h('button', { type: 'button', className: tab === 'library' ? 'rb-tab rb-active' : 'rb-tab', role: 'tab', 'aria-selected': tab === 'library' ? 'true' : 'false', onClick: () => onTab('library') }, t('details.library')),
        ),
        tab === 'activity' ? h(
          'div',
          { className: 'rb-sections' },
          h(
            'section',
            { className: 'rb-sec' },
            h('h3', null, t('details.recent'), count(bot.receipts.length)),
            bot.receipts.length ? bot.receipts.map((receipt, index) => h(
              'div',
              { key: index, className: 'rb-act' },
              h('div', { className: 'rb-t' }, h('span', null, t(receipt.titleKey)), h('span', { className: 'rb-ok' }, t(receipt.stateKey))),
              h('div', { className: 'rb-s' }, t(receipt.metaKey)),
            )) : h(EmptyBlock, { name: 'recent', title: t('details.recentEmpty'), hint: t('details.recentEmptyHint') }),
          ),
          h(
            'section',
            { className: 'rb-sec' },
            h('h3', null, t('details.upcoming'), count(bot.routines.length)),
            routinesPaused ? h('div', { className: 'rb-paused', 'data-paused': 'true', role: 'status' }, t('routine.paused')) : null,
            bot.routines.length ? bot.routines.map((routine, index) => {
              const title = t(routine.titleKey)
              return h(
                'div',
                { key: title, className: 'rb-routine' },
                h('div', null, h('div', { className: 'rb-t' }, title), h('div', { className: 'rb-s' }, t(routine.scheduleKey))),
                h(Toggle, {
                  on: routine.on,
                  label: `${title} ${routine.on ? t('routine.on') : t('routine.off')}`,
                  onClick: () => onToggleRoutine(index),
                }),
              )
            }) : h(EmptyBlock, { name: 'routines', title: t('routine.empty'), hint: t('routine.emptyHint') }),
          ),
          h(ComputerBlock, { t, status: computerStatus, name: computerName, configured, onComputer, onStop }),
          h(UsageBlock, { t, catalog, idle, low, overview, configured, error: usageError, preview: usagePreview }),
        ) : h(
          'div',
          { className: 'rb-sections' },
          bot.library.length ? groups.map(([group, labelKey]) => {
            const items = bot.library.filter((item) => item.group === group)
            if (!items.length) return null
            return h(
              'section',
              { key: group, className: 'rb-sec' },
              h('h3', null, t(labelKey), count(items.length)),
              items.map((item, index) => h(
                'div',
                { key: `${group}-${index}`, className: 'rb-act' },
                h('div', { className: 'rb-t' }, h('span', null, t(item.titleKey)), h('span', { className: 'rb-ok' }, t(item.badgeKey))),
                h('div', { className: 'rb-s' }, t(item.metaKey)),
              )),
            )
          }) : h(EmptyBlock, { name: 'library', title: t('library.empty'), hint: t('library.emptyHint') }),
        ),
      )
    }

    function ComputerBlock({ t, status, name, configured, onComputer, onStop }) {
      const [confirming, setConfirming] = useState(false)
      useEffect(() => {
        if (status !== 'live') setConfirming(false)
      }, [status])
      const canStop = status === 'live' && Boolean(onStop)
      const label = status === 'live' ? t('computer.live')
        : status === 'sleeping' ? t('computer.sleeping')
        : status === 'unreachable' ? t('computer.unreachable')
        : status === 'reconnecting' ? t('computer.reconnecting')
        : configured ? t('computer.noMachineShort')
        : t('setup.notConnected')
      const dot = status === 'live' ? 'rb-working'
        : status === 'unreachable' ? 'rb-danger'
        : status === 'sleeping' || status === 'offline' ? ''
        : 'rb-needs'
      return h(
        'section',
        { className: 'rb-sec' },
        h('h3', null, t('details.computer')),
        h(
          'div',
          { className: 'rb-computer', 'data-state': status },
          h(
            'div',
            { className: 'rb-comp-row' },
            h(
              'div',
              null,
              h('div', { className: 'rb-nm' }, name),
              h(
                'div',
                { className: `rb-st rb-st-${status}` },
                h('span', { className: `rb-dot ${dot}`.trim(), 'aria-hidden': 'true' }),
                label,
              ),
            ),
            h('div', { className: 'rb-thumb', 'aria-hidden': 'true' }),
          ),
          h(
            'div',
            { className: 'rb-comp-acts' },
            h('button', { type: 'button', className: 'rb-btn', onClick: onComputer }, t('computer.open')),
            h('button', { type: 'button', className: 'rb-btn', onClick: onComputer }, t('computer.takeOver')),
            canStop ? h('button', { type: 'button', className: 'rb-btn', onClick: () => setConfirming(true) }, t('computer.stop')) : null,
          ),
          canStop && confirming ? h(
            'div',
            { className: 'rb-stop-confirm', role: 'status' },
            h('p', null, t('computer.stopConfirm')),
            h(
              'div',
              { className: 'rb-line' },
              h('button', {
                type: 'button',
                className: 'rb-btn',
                onClick: () => {
                  setConfirming(false)
                  onStop()
                },
              }, t('computer.stopConfirmAction')),
              h('button', { type: 'button', className: 'rb-btn rb-ghost', onClick: () => setConfirming(false) }, t('computer.cancel')),
            ),
          ) : null,
        ),
      )
    }

    function UsageBlock({ t, catalog, idle, low, overview, configured, error, preview }) {
      if (configured) {
        const balance = balanceText(overview?.balance)
        const hours = Number(overview?.usage?.vm_hours)
        return h(
          'section',
          { className: 'rb-sec' },
          h('h3', null, t('details.usage')),
          h(
            'div',
            { className: 'rb-usage', 'data-low': low ? 'true' : 'false' },
            h('span', { className: low ? 'rb-usage-low' : '' }, lineParts(lookup(catalog, 'usage.balanceLine'), { balance, hours: Number.isFinite(hours) ? hours.toFixed(1) : '—' }, new Set(['balance']))),
            h('span', null, t('usage.liveLine', { idle })),
            low ? h('span', { className: 'rb-low' }, t('cost.low')) : null,
          ),
        )
      }
      if (preview) {
        const balance = t('usage.sampleBalance')
        const hours = t('usage.sampleHours')
        const spend = t('usage.sampleSpend')
        return h(
          'section',
          { className: 'rb-sec' },
          h('h3', null, t('details.usage')),
          h(
            'div',
            { className: 'rb-usage', 'data-low': low ? 'true' : 'false' },
            h('span', { className: low ? 'rb-usage-low' : '' }, lineParts(lookup(catalog, 'usage.balanceLine'), { balance, hours }, new Set(['balance']))),
            h('span', null, lineParts(lookup(catalog, 'usage.weekLine'), { spend, idle }, new Set(['spend']))),
            low ? h('span', { className: 'rb-low' }, t('cost.low')) : null,
          ),
        )
      }
      return h(
        'section',
        { className: 'rb-sec' },
        h('h3', null, t('details.usage')),
        h(
          'div',
          { className: 'rb-usage', 'data-low': 'false' },
          h('span', null, error ? t('settings.usageFailed', { message: error }) : t('settings.usageConnect')),
        ),
      )
    }

    function HostStatus({ t, host, onRetry }) {
      if (host.status === 'loaded') {
        if (host.dependency?.status === 'missing') {
          return h(
            'span',
            { className: 'rb-status', 'data-host': 'missing' },
            h('span', { className: 'rb-dot rb-danger', 'aria-hidden': 'true' }),
            t('settings.hostDepMissing'),
          )
        }
        if (host.dependency?.status === 'incompatible') {
          return h(
            'span',
            { className: 'rb-status', 'data-host': 'incompatible' },
            h('span', { className: 'rb-dot rb-danger', 'aria-hidden': 'true' }),
            t('settings.hostDepVersion', { version: host.dependency.version ?? '?', required: host.dependency.required ?? '' }),
          )
        }
        return h(
          'span',
          { className: 'rb-status', 'data-host': 'loaded' },
          h('span', { className: 'rb-dot rb-working', 'aria-hidden': 'true' }),
          t(host.ready ? 'settings.hostReady' : 'settings.hostLoaded', { version: host.version }),
        )
      }
      if (host.status === 'down') {
        return h(
          'span',
          { className: 'rb-status', 'data-host': 'down' },
          h('span', { className: 'rb-dot rb-danger', 'aria-hidden': 'true' }),
          t('error.hostDown'),
          h('button', { type: 'button', className: 'rb-btn rb-ghost rb-retry', onClick: onRetry }, t('settings.retry')),
        )
      }
      return h(
        'span',
        { className: 'rb-status', 'data-host': 'checking' },
        h('span', { className: 'rb-dot', 'aria-hidden': 'true' }),
        t('settings.hostChecking'),
      )
    }

    function renderCenter(ctx) {
      const { state, t, selected, width } = ctx
      if (state.screen === 'newbot') return h(NewBotScreen, { t, onCancel: () => ctx.onScreen('chat'), onCreate: ctx.onCreate })
      if (state.screen === 'setup') {
        return h(SetupScreen, {
          t,
          step: state.setupStep,
          flash: state.flash,
          host: ctx.host,
          onRetryHost: ctx.onRetryHost,
          onStep: ctx.onSetupStep,
          onClose: () => ctx.onScreen('chat'),
          onCreate: ctx.onCreate,
          onFlash: ctx.onFlash,
        })
      }
      if (state.screen === 'settings') {
        return h(SettingsScreen, {
          t,
          lang: ctx.lang,
          state,
          host: ctx.host,
          onRetryHost: ctx.onRetryHost,
          onTab: ctx.onSettingsTab,
          onChange: ctx.onSettings,
          onClose: () => ctx.onScreen('chat'),
          onSetup: () => {
            ctx.onSetupStep(0)
            ctx.onScreen('setup')
          },
        })
      }
      if (!selected) {
        return h(
          'main',
          { className: 'rb-main', 'data-screen': 'chat' },
          h('div', { className: 'rb-center-empty' }, h('h2', null, t('empty.heading')), h('p', null, t('empty.body')), h('button', { type: 'button', className: 'rb-btn rb-primary', onClick: () => ctx.onScreen('newbot') }, t('newBot.create'))),
        )
      }
      return h(Conversation, {
        t,
        state,
        bot: selected,
        composerRef: ctx.composerRef,
        onComposer: ctx.onComposer,
        onSend: ctx.onSend,
        onDecide: ctx.onDecide,
        onView: ctx.onView,
        onAttach: ctx.onAttach,
        showListButton: width < 900,
        showDetailButton: width < 1120,
        onToggleList: ctx.onToggleList,
        onToggleDetail: ctx.onToggleDetail,
      })
    }

    function NewBotScreen({ t, onCancel, onCreate }) {
      const [name, setName] = useState(() => t('newBot.defaultName'))
      const [job, setJob] = useState(() => t('newBot.defaultJob'))
      const [instructions, setInstructions] = useState('')
      const [busy, setBusy] = useState(false)
      const [error, setError] = useState('')
      const submit = async () => {
        if (!name.trim() || busy) return
        setBusy(true)
        setError('')
        try {
          await onCreate({ name, job, instructions })
        } catch (failure) {
          setError(t('error.botCreate', { message: String(failure?.message ?? failure) }))
        } finally {
          setBusy(false)
        }
      }
      return h(
        'main',
        { className: 'rb-page', 'data-screen': 'newbot' },
        h(
          'div',
          { className: 'rb-wizard-wrap' },
          h(
            'div',
            { className: 'rb-wizard' },
            h('h1', null, t('newBot.title')),
            h('p', { className: 'rb-sub' }, t('newBot.sub')),
            h(BotFields, { t, name, job, instructions, onName: setName, onJob: setJob, onInstructions: setInstructions }),
            error ? h('p', { className: 'rb-say', role: 'alert', style: { color: '#b45309' } }, error) : null,
            h(
              'div',
              { className: 'rb-form-foot' },
              h('button', { type: 'button', className: 'rb-btn rb-ghost', onClick: onCancel }, t('newBot.cancel')),
              h('button', {
                type: 'button',
                className: 'rb-btn rb-primary',
                disabled: busy || !name.trim(),
                onClick: submit,
              }, t('newBot.create')),
            ),
          ),
        ),
      )
    }

    function SetupScreen({ t, step, flash, host, onRetryHost, onStep, onClose, onCreate, onFlash }) {
      const [name, setName] = useState(() => t('newBot.defaultName'))
      const [job, setJob] = useState(() => t('newBot.defaultJob'))
      const [instructions, setInstructions] = useState('')
      const tokenRef = useRef(null)
      const keyRef = useRef(null)
      const [tokenBusy, setTokenBusy] = useState(false)
      const [tokenError, setTokenError] = useState('')
      const [connection, setConnection] = useState(null)
      const [machine, setMachine] = useState(null)
      const [machineLoading, setMachineLoading] = useState(false)
      const [machineBusy, setMachineBusy] = useState(false)
      const [machineError, setMachineError] = useState('')
      const [creating, setCreating] = useState(false)
      const [computerName, setComputerName] = useState(DEFAULT_COMPUTER)
      const steps = [
        ['dependency', 'setup.steps.dependency'],
        ['rayrun', 'setup.steps.rayrun'],
        ['key', 'setup.steps.key'],
        ['bot', 'setup.steps.bot'],
      ]
      const dependency = host.status === 'loaded' ? host.dependency : null
      const dependencyLine = dependency?.status === 'ok'
        ? t('setup.dependencyOk', { version: dependency.version ?? '?' })
        : dependency?.status === 'missing'
          ? t('setup.dependencyMissing')
          : dependency?.status === 'incompatible'
            ? t('setup.dependencyIncompatible', { version: dependency.version ?? '?', required: dependency.required ?? '' })
            : t('setup.dependencyStatus')
      const configured = connection?.connection?.configured === true
      const canContinue = step === 0
        ? dependency?.status === 'ok'
        : step === 1
          ? configured
          : step === 2
            ? Boolean(machine)
            : step === 3
              ? Boolean(name.trim())
              : false
      useEffect(() => {
        if (step !== 2) return undefined
        let cancelled = false
        setMachineLoading(true)
        setMachineError('')
        void (async () => {
          try {
            const overview = await rayRpc('overview')
            if (cancelled) return
            setConnection(overview)
            const machines = Array.isArray(overview.machines) ? overview.machines : []
            setMachine(pickMachine(machines) || null)
          } catch (error) {
            if (!cancelled) setMachineError(t('setup.computerLoadFailed', { message: String(error?.message ?? error) }))
          } finally {
            if (!cancelled) setMachineLoading(false)
          }
        })()
        return () => {
          cancelled = true
        }
      }, [step])
      const back = () => {
        if (step === 0) onClose()
        else onStep(step - 1)
      }
      const skip = () => {
        if (step >= 3) onClose()
        else onStep(step + 1)
      }
      const next = async () => {
        if (!canContinue || creating) return
        if (step < 3) {
          onStep(step + 1)
          return
        }
        setCreating(true)
        try {
          await onCreate({ name, job, instructions })
        } catch (error) {
          onFlash(t('error.botCreate', { message: String(error?.message ?? error) }))
        } finally {
          setCreating(false)
        }
      }
      const createComputer = async () => {
        const name = computerName.trim()
        const key = keyRef.current?.value.trim() ?? ''
        setMachineBusy(true)
        setMachineError('')
        try {
          const overview = await rayRpc('overview')
          if (overview.connection?.configured !== true) {
            setConnection(overview)
            setMachineError(t('setup.computerNeedsRayrun'))
            return
          }
          const machines = Array.isArray(overview.machines) ? overview.machines : []
          const existing = machines.find((item) => item.name === name) || pickMachine(machines)
          if (existing) {
            setConnection(overview)
            setMachine(existing)
            onFlash(t('setup.computerExisting', { name: existing.name ?? existing.id ?? '—' }))
            return
          }
          const defaults = overview.defaults ?? {}
          const result = await rayRpc('machine.create', {
            name,
            agent: defaults.agent || 'deepseek-harness@1',
            cpu_cores: Number(defaults.cpu_cores) || 2,
            memory_mb: Math.max(2048, Number(defaults.memory_mb) || 2048),
            remote_desktop: true,
            ...(key ? { modelKey: key } : {}),
          })
          if (keyRef.current) keyRef.current.value = ''
          setConnection({ ...overview, machines: [result.machine, ...(Array.isArray(overview.machines) ? overview.machines : [])] })
          setMachine(result.machine)
          onFlash(t('setup.computerCreated', { name: result.machine?.name ?? name }))
        } catch (error) {
          const detail = String(error?.message ?? error)
          setMachineError(/token_required|unauthorized/i.test(detail)
            ? t('setup.computerNeedsRayrun')
            : t('setup.computerCreateFailed', { message: detail }))
        } finally {
          setMachineBusy(false)
        }
      }
      const connectToken = async () => {
        const token = tokenRef.current?.value.trim() ?? ''
        if (!token) {
          setTokenError(t('setup.tokenRequired'))
          return
        }
        setTokenBusy(true)
        setTokenError('')
        try {
          await rayRpc('connection.save', { token })
          const overview = await rayRpc('overview')
          if (tokenRef.current) tokenRef.current.value = ''
          setConnection(overview)
        } catch (error) {
          const detail = String(error?.message ?? error)
          setTokenError(/unauthorized/i.test(detail)
            ? t('setup.tokenRejected')
            : t('setup.connectFailed', { message: detail }))
        } finally {
          setTokenBusy(false)
        }
      }
      return h(
        'main',
        { className: 'rb-page', 'data-screen': 'setup' },
        h(
          'div',
          { className: 'rb-wizard-wrap' },
          h(
            'div',
            { className: 'rb-wizard' },
            h('h1', null, t('setup.title')),
            h('p', { className: 'rb-sub' }, t('setup.sub')),
            h(
              'div',
              { className: 'rb-steps' },
              steps.map(([id, labelKey], index) => h(
                'div',
                { key: id, className: index < step ? 'rb-step rb-done' : index === step ? 'rb-step rb-current' : 'rb-step' },
                h('div', { className: 'rb-bar' }),
                h('div', { className: 'rb-lbl' }, t(labelKey)),
              )),
            ),
            step === 0 ? h(
              'div',
              null,
              h('h2', null, t('setup.dependencyTitle')),
              h('p', { className: 'rb-say' }, t('setup.dependencyBody')),
              h('div', { className: 'rb-faint' }, dependencyLine),
              h(
                'div',
                { className: 'rb-line', style: { marginTop: 10 } },
                h('span', { className: 'rb-faint' }, t('settings.host')),
                h(HostStatus, { t, host, onRetry: onRetryHost }),
              ),
            ) : null,
            step === 1 ? h(
              'div',
              null,
              h('h2', null, t('setup.rayrunTitle')),
              h('p', { className: 'rb-say' }, t('setup.rayrunBody')),
              h(
                'div',
                { className: 'rb-line' },
                h('button', {
                  type: 'button',
                  className: 'rb-btn rb-primary',
                  onClick: () => {
                    tokenRef.current?.focus()
                    onFlash(t('setup.tokenHint'))
                  },
                }, t('setup.useToken')),
                h('span', { className: 'rb-faint' }, configured ? t('setup.connectedShort') : t('setup.notConnected')),
              ),
              h(
                'div',
                { className: 'rb-line', style: { marginTop: 9 } },
                h('input', {
                  ref: tokenRef,
                  className: 'rb-field',
                  type: 'password',
                  autoComplete: 'off',
                  spellCheck: false,
                  placeholder: t('setup.tokenPlaceholder'),
                  'aria-label': t('setup.tokenPlaceholder'),
                }),
                h('button', { type: 'button', className: 'rb-btn', disabled: tokenBusy, onClick: connectToken }, tokenBusy ? t('setup.connecting') : t('setup.connect')),
              ),
              tokenError ? h('p', { className: 'rb-say', role: 'alert', style: { color: '#b45309' } }, tokenError) : null,
              h(
                'div',
                { className: 'rb-faint', style: { marginTop: 10 } },
                configured
                  ? t('setup.connected', { balance: balanceText(connection.balance), machines: connection.machines.length })
                  : t('setup.accountLine'),
              ),
            ) : null,
            step === 2 ? h(
              'div',
              null,
              h('h2', null, t('setup.computerTitle')),
              h('p', { className: 'rb-say' }, t('setup.computerBody')),
              machineLoading ? h('p', { className: 'rb-faint' }, t('setup.computerChecking')) : null,
              !machineLoading && machine ? h(
                'div',
                null,
                h('p', { className: 'rb-say' }, t('setup.computerExisting', { name: machine.name ?? machine.id ?? '—' })),
                h('p', { className: 'rb-faint' }, t('setup.computerExistingHint')),
              ) : null,
              !machineLoading && !machine && !configured ? h('p', { className: 'rb-say', role: 'status' }, t('setup.computerNeedsRayrun')) : null,
              !machineLoading && !machine && configured ? h(
                'div',
                null,
                h(
                  'div',
                  { className: 'rb-line' },
                  h('input', {
                    className: 'rb-field',
                    value: computerName,
                    maxLength: 64,
                    placeholder: t('setup.computerName'),
                    'aria-label': t('setup.computerName'),
                    onChange: (event) => setComputerName(event.target.value),
                  }),
                ),
                h(
                  'div',
                  { className: 'rb-line', style: { marginTop: 9 } },
                  h('input', {
                    ref: keyRef,
                    className: 'rb-field',
                    type: 'password',
                    autoComplete: 'off',
                    spellCheck: false,
                    placeholder: t('setup.computerKeyPlaceholder'),
                    'aria-label': t('setup.computerKeyPlaceholder'),
                  }),
                ),
                h('p', { className: 'rb-faint' }, t('setup.computerKeyHint')),
                h(
                  'div',
                  { className: 'rb-line', style: { marginTop: 10 } },
                  h('button', {
                    type: 'button',
                    className: 'rb-btn rb-primary',
                    disabled: machineBusy || !computerName.trim(),
                    onClick: createComputer,
                  }, machineBusy ? t('setup.computerCreating') : t('setup.computerCreate')),
                ),
                h('p', { className: 'rb-faint' }, t('setup.computerCost')),
              ) : null,
              machineError ? h('p', { className: 'rb-say', role: 'alert', style: { color: '#b45309' } }, machineError) : null,
            ) : null,
            step === 3 ? h(
              'div',
              null,
              h('h2', null, t('setup.botTitle')),
              h('p', { className: 'rb-say' }, t('setup.botBody')),
              h(BotFields, { t, name, job, instructions, onName: setName, onJob: setJob, onInstructions: setInstructions }),
            ) : null,
            flash ? h('p', { className: 'rb-say', role: 'status', style: { color: '#b45309' } }, flash) : null,
            h(
              'div',
              { className: 'rb-form-foot' },
              h('button', { type: 'button', className: 'rb-btn rb-ghost', disabled: creating, onClick: back }, t('setup.back')),
              h(
                'div',
                { className: 'rb-line' },
                h('button', { type: 'button', className: 'rb-btn rb-ghost', disabled: creating, onClick: skip }, t('setup.skip')),
                h('button', { type: 'button', className: 'rb-btn rb-primary', disabled: creating || !canContinue, onClick: next }, t('setup.continue')),
              ),
            ),
          ),
        ),
      )
    }

    function SettingsScreen({ t, lang, state, host, onRetryHost, onTab, onChange, onClose, onSetup }) {
      const shownLang = state.settings.lang || lang || 'zh'
      const [usage, setUsage] = useState(null)
      const [usageLoading, setUsageLoading] = useState(true)
      const [usageError, setUsageError] = useState('')
      useEffect(() => {
        let cancelled = false
        void (async () => {
          try {
            const overview = await rayRpc('overview')
            if (!cancelled) setUsage(overview)
          } catch (error) {
            if (!cancelled) setUsageError(String(error?.message ?? error))
          } finally {
            if (!cancelled) setUsageLoading(false)
          }
        })()
        return () => {
          cancelled = true
        }
      }, [])
      const usageConfigured = usage?.connection?.configured === true
      const usageHours = Number(usage?.usage?.vm_hours)
      const usageLine = usageLoading
        ? t('settings.hostChecking')
        : usageError
          ? t('settings.usageFailed', { message: usageError })
          : usageConfigured
            ? t('settings.usageLine', {
                balance: balanceText(usage.balance),
                hours: Number.isFinite(usageHours) ? usageHours.toFixed(1) : '—',
                machines: Array.isArray(usage.machines) ? usage.machines.length : 0,
              })
            : t('settings.usageConnect')
      const scrollTo = (id) => {
        onTab(id)
        const reduce = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
        document.getElementById(`rb-settings-${id}`)?.scrollIntoView({ block: 'start', behavior: reduce ? 'auto' : 'smooth' })
      }
      return h(
        'main',
        { className: 'rb-page', 'data-screen': 'settings' },
        h(
          'div',
          { className: 'rb-page-inner' },
          h('button', {
            type: 'button',
            className: 'rb-btn rb-ghost rb-back',
            'aria-label': t('setup.back'),
            onClick: onClose,
          }, `← ${t('setup.back')}`),
          h('h1', null, t('settings.title')),
          h('p', { className: 'rb-sub' }, t('settings.sub')),
          h(
            'div',
            { className: 'rb-snav' },
            ['account', 'usage', 'notifications', 'appearance'].map((id) => h(
              'button',
              {
                type: 'button',
                key: id,
                className: state.settingsTab === id ? 'rb-active' : '',
                onClick: () => scrollTo(id),
              },
              t(`settings.${id}`),
            )),
          ),
          h(
            'div',
            { id: 'rb-settings-account', className: 'rb-srow' },
            h('div', { className: 'rb-l' }, t('settings.rayrunAccount'), h('small', null, t('settings.rayrunHint'))),
            h(
              'button',
              { type: 'button', className: 'rb-status', onClick: onSetup },
              h('span', { className: 'rb-dot', 'aria-hidden': 'true' }),
              t('settings.setup'),
            ),
          ),
          h(
            'div',
            { className: 'rb-srow' },
            h('div', { className: 'rb-l' }, t('settings.host'), h('small', null, t('settings.hostHint'))),
            h(HostStatus, { t, host, onRetry: onRetryHost }),
          ),
          h(
            'div',
            { className: 'rb-srow' },
            h('div', { className: 'rb-l' }, t('settings.plugin'), h('small', null, t('settings.pluginHint'))),
            h(
              'span',
              { className: 'rb-status' },
              h('span', {
                className: host.status === 'loaded' && (host.dependency?.status === 'missing' || host.dependency?.status === 'incompatible') ? 'rb-dot rb-danger' : 'rb-dot rb-working',
                'aria-hidden': 'true',
              }),
              t(
                host.status !== 'loaded'
                  ? 'settings.pluginUnknown'
                  : host.dependency?.status === 'missing'
                    ? 'settings.pluginMissing'
                    : host.dependency?.status === 'incompatible'
                      ? 'settings.pluginIncompatible'
                      : 'settings.pluginOk',
              ),
            ),
          ),
          h(
            'div',
            { id: 'rb-settings-usage', className: 'rb-srow' },
            h('div', { className: 'rb-l' }, t('settings.usage'), h('small', null, t('settings.usageHint'))),
            h(
              'span',
              { className: 'rb-status' },
              h('span', {
                className: usageError ? 'rb-dot rb-danger' : usageLoading || !usageConfigured ? 'rb-dot' : 'rb-dot rb-working',
                'aria-hidden': 'true',
              }),
              usageLine,
            ),
          ),
          h(
            'div',
            { className: 'rb-srow' },
            h('div', { className: 'rb-l' }, t('settings.idle'), h('small', null, t('settings.idleHint'))),
            h(
              'select',
              {
                value: state.settings.idle,
                'aria-label': t('settings.idle'),
                onChange: (event) => onChange({ idle: event.target.value }),
              },
              h('option', { value: '15' }, t('settings.idle15')),
              h('option', { value: '30' }, t('settings.idle30')),
              h('option', { value: '0' }, t('settings.idleOff')),
            ),
          ),
          h(
            'div',
            { className: 'rb-srow' },
            h('div', { className: 'rb-l' }, t('settings.lowBalance'), h('small', null, t('settings.lowBalanceHint'))),
            h('input', {
              value: state.settings.lowBalance,
              style: { width: 76 },
              inputMode: 'decimal',
              'aria-label': t('settings.lowBalance'),
              onChange: (event) => onChange({ lowBalance: event.target.value.replace(/[^\d.]/g, '').slice(0, 8) }),
            }),
          ),
          h(
            'div',
            { id: 'rb-settings-notifications', className: 'rb-srow' },
            h('div', { className: 'rb-l' }, t('settings.notify'), h('small', null, t('settings.notifyHint'))),
            h(Toggle, {
              on: state.settings.notifications,
              label: `${t('settings.notify')} ${state.settings.notifications ? t('routine.on') : t('routine.off')}`,
              onClick: () => onChange({ notifications: !state.settings.notifications }),
            }),
          ),
          h(
            'div',
            { id: 'rb-settings-appearance', className: 'rb-srow' },
            h('div', { className: 'rb-l' }, t('settings.language'), h('small', null, t('settings.languageHint'))),
            h(
              'select',
              {
                value: shownLang,
                'aria-label': t('settings.language'),
                onChange: (event) => onChange({ lang: event.target.value }),
              },
              h('option', { value: 'zh' }, t('settings.langZh')),
              h('option', { value: 'en' }, t('settings.langEn')),
            ),
          ),
        ),
      )
    }

    function PanelIcon({ size }) {
      const edge = typeof size === 'number' && size > 0 ? size : 20
      return h(
        'svg',
        {
          width: edge,
          height: edge,
          viewBox: '0 0 24 24',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.7,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          'aria-hidden': 'true',
        },
        h('rect', { x: 3.2, y: 4.2, width: 17.6, height: 12.4, rx: 2 }),
        h('path', { d: 'M8 20.4h8M12 16.6v3.8' }),
        h('circle', { cx: 9, cy: 10.4, r: 1.1 }),
        h('circle', { cx: 15, cy: 10.4, r: 1.1 }),
      )
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        ctx.slots.inject('sidebar.panellist', () =>
          ctx.slots.register(
            {
              name: 'sidebar.panellist',
              id: PANEL_ID,
              order: 30,
              label: () => {
                try {
                  const id = String((ctx.get?.('locale') ?? ctx.locale)?.getLocale?.()?.active ?? '')
                  return id.toLowerCase().startsWith('zh') ? ZH.panel.label : EN.panel.label
                } catch {
                  return 'Bots'
                }
              },
            },
            PanelIcon,
          ),
        )
        ctx.slots.inject('main', () => {
          const dispose = ctx.slots.register(
            {
              name: 'main',
              key: PANEL_ID,
            },
            () => h(BotsApp, { ctx }),
          )
          // Bots is the product surface: activate it on entry when DSH exposes
          // the layout service. Without that service, stay on the DSH page.
          ctx.inject?.(['layout'], (child) => {
            try {
              child.layout.selectPanel(PANEL_ID)
            } catch (error) {
              ctx.logger?.warn?.(`dsh-rayrun-bots: could not activate Bots: ${String(error?.message ?? error)}`)
            }
          })
          return dispose
        })
      },
    }
  },
})
