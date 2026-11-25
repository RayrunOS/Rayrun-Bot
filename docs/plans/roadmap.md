# 路线图

*状态：2026-11-25。Pre-alpha。两个独立项目：云电脑插件
`RayrunOS/dsh-rayrun-computer` 保持独立，并作为依赖被消费。下面的里程碑来自塑造本
仓库的产品调研；它们是方向，不是承诺。v0.1 客户端壳、health 路由、持久化本地名册
和按轮次的 runtime（依赖 1.1+ 用 detached，1.0.x 用单轮 `rayrun_agent`）已经存在；
常驻云端 runtime 与 bot↔云端 session 映射已在生产完成单 bot cloudHost 聊天和
routine E2E，两 bot 单 host 也已通过。本地 typed 审批执行（机器
start/stop/pause/resume）与云提案 bridge 已有预览；真实 cloud proposal、
start/stop/pause/resume、denial/Continue 与下一轮 context 已 live。本地最小
routines 与 cloudHost 云端调度已实现，生产单 bot routine E2E 已通过。干净 npm
安装（`0.1.1-alpha.1`）已跑通 cloudHost、真实浏览器 golden 与审批 Deny/Allow。
v0.1 的主要验收路径已打通；剩余是稳定版决策和更广动作集。实现状态以
[12-status.md](../12-status.md) 为准。日期刻意省略。*

## 我们在哪（M0 — bootstrap）

仓库已经存在，规则和文档已经写下，产品页描述目标与当前状态。已有 npm 预发布版
`0.1.1-alpha.1`，没有稳定版；v0.1 尚未退出。

退出标准：

- README、docs、CLAUDE.md 和社区文件存在，且每个链接可解析；
- 状态文档说清楚什么能用、什么不能用、什么被 Rayrun 平台阻塞；
- 依赖边界明确：`dsh-rayrun-computer` 是独立项目，保持不动，不迁移、不改名、不
  vendor。

## v0.1 — 闭环

目标：一个人、一台云电脑、一个有名字的 bot（或多个）、一张 fail-closed 审批卡，
以及一张看得见的账单。全部走 DSH 插件 + `dsh web` 路径；没有桌面 App。

任务级计划、spike 与周序：[mvp-plan.md](mvp-plan.md)。

范围：

- **Rayrun Bot 包在这里落地。** `dsh-rayrun-bots` 从本仓库发布；
  `dsh-rayrun-computer` 保持独立项目，并作为依赖被消费（v0.1 有版本契约与文档化的
  安装路径）。
- **Bot 名册与 bot↔session 映射。** Bot 有名字、指令、技能、记忆目录和持久 session；
  映射在 DSH 重启后仍然存在，而不是住在 host 内存里。
- **机器上的常驻 DSH host。** 把“每个 prompt 跑一次 `headless`”换成受监督的 host，
  让 bot 在笔记本合上后继续工作。平台 R-G008 runtimes API 已实现并本机 dev 全量
  验收通过，2026-11-24 已部署生产（`5c2ff48`）；hosted 单 bot cloudHost 聊天、
  routine E2E 和两 bot 单 host 均已通过。
- **Fail-closed 审批。** 云端 proposal → 本地 host 的决定/执行 claim → 浏览器卡片。
  超时、未知或面板关闭都算拒绝。ADR-019 首版允许本地执行机器 start/stop/pause/
  resume；云端凭据动作仍等待平台 host/agent 隔离（ADR-001）；云提案 bridge、
  start/stop/pause/resume、denial/Continue 与下一轮 context 已 live。文件邮箱
  不是授权边界。
- **Routines，最小版（ADR-009，2026-11-23）。** 默认由本地 scheduler 按间隔把
  普通 prompt 入队 bot 的 session；cloudHost 模式改由云 host 读取镜像定义调度，
  可在本地 DSH 停止时运行（机器/runtime 需 Running），结果回导本地 history。
  支持创建、启停、删除，不做 cron、事件触发或触发器市场；cloudHost 路径已在
  Rayrun dev/test 环境 live 验证，生产单 bot routine E2E 已通过。
- **成本栏。** 机时与余额可见；idle stop 仍是插件选项（只停，永不 destroy）。
- **打包与 CI。** npm 包、与 DSH 的版本兼容、测试和发布路径。

退出标准（全部满足）：

1. 新用户可以从文档的安装路径走到跑起来的 bot，约三分钟，不用读源码。
2. 用户合上笔记本后，bot 仍能完成一个后台任务。
3. 受控动作停在审批处，只有用户在浏览器里批准后才继续。
4. 同一个 bot 的第二次对话接着第一次停下的地方。
5. 本次 session 的余额和机时可见。
6. 缺少 token 或云调用失败产生清晰错误，绝不假成功。
7. 两个插件都通过文档化路径安装——Rayrun Bot 加独立的 `dsh-rayrun-computer`。

早期调研目标还提到 20 名种子用户、首个 bot 成功率高于 80%、周留存高于 40%；
把这些当作内部验证信号，不是公开承诺。基于可用的云电脑底座，v0.1 的聚焦估算是 4–6
周工作量——乐观，且不是承诺。

## v0.2 — 远程审批

目标：用户不用打开 DSH 页面，就能从手机回答 bot。

范围：

- 可选的 IM 通道，使用用户自己的 bot token（Telegram 或飞书）——没有本项目运行的
  中继服务器；
- 审批和“需要你关注”的消息送到该通道；
- 与浏览器路径相同的 fail-closed 语义；
- 候选、未承诺：通过共享 workspace 的 bot-to-bot 交接、一个 primary bot 负责
  check-in、一个记忆审阅面板——见 [inspiration.md](../research/inspiration.md)。

退出标准：

- 受控动作可以从用户自己的 IM bot 批准或拒绝；
- 消息路径没有项目方托管组件，也不把用户 token 送到项目服务器；
- 未配置 IM 时，浏览器路径继续可用。

## v1.0 — 预配置 DSH 发行版与稳定性

目标：交付 B1，一个 Rayrun 品牌的安装器，把官方 DSH 和两个插件装进桌面 profile，
用户打开 DSH 时 Bots 已就绪，不需要手动装插件。DSH 保留官方更新器；插件通过我们的
签名 manifest/bootstrap 更新。B2 是自定义 DSH 桌面构建、一个签名更新单元，只有在
profile 持久化、完整品牌化或 analytics 让 B1 不够时才作为升级路径。不做轻量壳；
永不重写聊天 UI。

稳定 v1.0 还包含（按容量）：

- 文档化的版本兼容矩阵（DSH × 云镜像 × 包）；
- 发布与安装打磨（npm 预发布、provenance 与 dist-tag 已落地；安装器与更新故事
  仍待做）；v1.0 发行版是 B1，见
  [桌面发行版](../design/desktop-distribution.md)（ADR-014）；
- 构建安装器前先做 spike D-S1a：DSH 更新后的 profile 持久化、安装器再分发条款、
  无人值守/离线安装与回滚、卸载、analytics（清单见设计文档 §5.7）。2026-11-21 的
  Rayrun web-profile 实测覆盖插件安装/合成/渲染、移除、离线 tarball 安装、损坏包
  fail-stop，以及 DSH 更新后的 profile 持久化；`profiles/desktop`、安装器、回滚、
  App 卸载、再分发和 analytics 仍需要官方 Windows/macOS 桌面（设计文档 §5.8）；
- 公开、带日期的状态文档，与已发布代码一致（[12-status.md](../12-status.md)）。

退出标准：

- 干净机器从安装器走到 Bots setup，不需要手动装插件；
- DSH 更新保留或修复插件 profile，插件更新校验签名、原子暂存、失败回滚；
- 壳只增加打包与 OS 集成；UI 是 DSH 的；
- 用户可以干净卸载，并在供应商处撤销访问；
- 文档的状态声明对照发布检查，而不是愿望。

## 不计划

以下明确超出范围。有些是永久的，有些需要新决策才可能进入里程碑：

- 多租户 SaaS、托管账号，或任何项目方运行的控制面；
- fork、vendor 或合并 `dsh-rayrun-computer`；它保持独立项目，作为依赖被消费；
- 团队角色/RBAC、审计导出、SSO/SCIM、企业合规包；
- bot 或技能市场；
- 原生移动 App（IM 暂时满足“从手机处理”的需求）；
- 能登录第三方站点或替模型填表的凭据库；
- 多区域托管、高可用，或本项目提供的 SLA；
- 对 Rayrun 算力或模型 token 的计费、计量或转售；
- 让后端可以换成 E2B 类服务的供应商抽象，除非它成为明确决策。今天的插件是
  Rayrun 专用的，假装不是会误导用户。

## 被 Rayrun 平台阻塞

有些项取决于平台，而不是本仓库。第一项已在生产部署并完成单 bot E2E；第二项仍待
决策/平台端点；其余是 v0.2/beta：

- R-G008 常驻 runtime：平台 runtimes API 已实现并本机 dev 全量验收通过（`rayrun-bot-gaps`，
  `4709ac0`），2026-11-24 已部署生产（`5c2ff48`）；session 由 bot host 写
  `/workspace`，host 资产已进包（`cloud-host/`），projection 页面 E2E 已通过；
  hosted 生产 cloudHost 聊天 E2E 已通过（`PROD_OK`，2026-11-24），生产 routine
  E2E 已通过（`CLOUD_ROUTINE_PROD_OK`，2026-11-24）；生产两 bot 单 host 已通过
  （2026-11-25）；
- host/agent 权限隔离与 host-only 审批端点（ADR-001：云端凭据动作）。平台答复
  （2026-11-22）：同沙箱不可行，平台端点非首版；host/agent 分域路径需要本项目新
  ADR；本地 typed 审批执行已按 ADR-019 走本地路径，云端凭据动作仍无执行；
- 余额宽限与护栏（今天唯一的生命周期上限是 stop；耗尽会 force-destroy 机器和磁盘）；
- 带认证的安全入向网络（今天 token ingress 不可用，只有 `public` 可用）——v0.2；
- 跨 session 和重启的持久浏览器 profile 与登录状态（老系统用例需要）——v0.2；
- idle 自动停机或按请求唤醒、spend cap、运行期 egress 更新，以及模型槽之外的通用
  secret 注入——beta。

完整 handoff 清单、期望的 API 形态和我们的 workaround 见
[08-integration.md](../08-integration.md)。[01-system-architecture.md](../01-system-architecture.md)
解释每一项；[faq.md](../faq.md) 有面向用户的版本。有一个打包限制不是平台的：
两个包都已上 npm，一条 `dsh plugin add` 可同时安装；S6 已验证（2026-11-24）：
一条 `dsh plugin add` 装两个包会同时启用两个 bundle；单包声明依赖不会自动启用
依赖 bundle，真正的单包安装仍待 DSH 支持或 meta-package。

## 范围怎么定

护栏是三分钟首个 bot：如果某个功能让首次运行路径更长或更不诚实，它就等。安全不变量
（fail-closed 审批、密钥不离开用户侧、不自动 destroy、默认无遥测）优先于里程碑——
里程碑不能成为削弱它们的理由。
