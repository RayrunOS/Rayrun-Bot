# 桌面发行版设计（v1.0）

> 状态：2026-11-18。**设计提案，不是已实现功能。** 本文描述一个把 DSH、两个插件和
> 首启向导打包在一起的桌面发行版，以及它的更新单元、签名、回滚和版本矩阵。
> 产品方向见 [`../00-product-direction.md`](../00-product-direction.md)；技术基线见
> [`../01-system-architecture.md`](../01-system-architecture.md)；部署现状见
> [`../09-deployment.md`](../09-deployment.md)；决策登记见
> [`../adr/architecture-decisions.md`](../adr/architecture-decisions.md) ADR-014。
> v0.1 仍是“插件 + 用户自己的 DSH”；本文属于 v1.0。

## 0. 与现有文档的关系

| 文档 | 负责什么 |
| --- | --- |
| [`../00-product-direction.md`](../00-product-direction.md) | v1.0 可选桌面壳的产品范围 |
| [`../01-system-architecture.md`](../01-system-architecture.md) | 薄客户端、插件半区、信任模型 |
| [`../09-deployment.md`](../09-deployment.md) | 今天的安装/运行方式与发布缺口 |
| [`../07-security.md`](../07-security.md) | 供应链、遥测与凭据边界 |
| [`../08-integration.md`](../08-integration.md) | 云端镜像/DSH 版本与平台能力 |
| [`../plans/roadmap.md`](../plans/roadmap.md) | v1.0 的 update story |
| [`../adr/architecture-decisions.md`](../adr/architecture-decisions.md) | ADR-014（桌面发行版与更新单元） |

---

## 1. 目标与非目标

### 1.1 目标

- 用户**只装一次**：安装包内含 DSH、`dsh-rayrun-bots`、`dsh-rayrun-computer` 和首启
  向导；打开 App 就能进入登录/建 bot 流程，不需要单独装 DSH、npm 或插件。
- 更新**以整包为单位**：壳、DSH、两个插件、locale 一次发布、一次验证、一次回滚，
  不让组件各自漂移。
- 更新**可验证、可回滚、失败即停**：签名/哈希/版本矩阵任一不通过，保留旧版本。
- 用户数据（profile、bot 状态、vault）与安装目录分离；更新不碰凭据和会话。

### 1.2 非目标

- 不 fork、不改 DSH；DSH 作为固定依赖原样打包，按它的许可证与通知要求分发。
- 不做项目方控制面；更新源用 GitHub Releases / npm 的静态清单或用户包管理器。
- 不做无账号的“零配置”：用户仍需要自己的 Rayrun 账号和 DeepSeek key。
- v0.1 不包含本文；v0.1 是插件 + 用户自己的 DSH。

---

## 2. 发行包结构

```
Rayrun Bot Desktop
├── shell/                     # 窗口壳（Electron 或 Tauri，见 §9）
├── runtime/dsh/               # 固定版本的 DSH（sidecar）
├── plugins/
│   ├── dsh-rayrun-bots/       # 本仓库
│   └── dsh-rayrun-computer/   # 独立依赖，原样打包
├── update/
│   ├── manifest.json          # 版本矩阵、资产、哈希、签名
│   └── public-key.pem         # 固定在 App 内
└── resources/                 # 图标、locale、许可证与 notices

用户数据（不在安装目录）：
$DSH_HOME/ 或 app.getPath('userData')/
├── profile/                   # DSH profile、bot 定义、session
├── state/rayrun-bot/          # 本地镜像、日志（见 06-local-state）
└── vault / keychain           # Rayrun token、DeepSeek key
```

**安装目录不可变，用户数据外置。** 更新只替换安装目录；profile、vault、日志和 bot
状态不随安装包覆盖。

---

## 3. 更新单元：整包发布

一次 release 固定一个经过测试的组合：

```json
{
  "app": "1.4.0",
  "dsh": "0.2.2-rc.1",
  "plugins": {
    "dsh-rayrun-bots": "0.1.0",
    "dsh-rayrun-computer": "0.2.1"
  },
  "cloudImageDsh": "0.2.0-rc.2",
  "minApp": "1.0.0",
  "channel": "stable",
  "assets": [
    {
      "platform": "linux-x64",
      "url": "https://.../rayrun-bot-1.4.0-linux-x64.AppImage",
      "sha256": "...",
      "signature": "..."
    }
  ]
}
```

- 版本矩阵至少包含：**壳 × 本地 DSH × `dsh-rayrun-computer` × `dsh-rayrun-bots` ×
  云端镜像里的 DSH**。
- 本地 DSH 与云端镜像 DSH 不一致时，必须明确行为：阻止更新、阻止“合上笔记本继续
  工作”，或选择兼容镜像。示例：本地基线 `0.2.2-rc.1`，云端镜像 `0.2.0-rc.2`
  （写入时的状态，见 [`../08-integration.md`](../08-integration.md) §5）。
- DSH 的 profile/session 格式变更要有迁移与备份；迁移失败回滚。
- **不要**让壳、DSH、插件各自更新；这会产生“壳是新的、插件是旧的”的版本错配。

---

## 4. 更新流程

1. **检查**：启动后或每天一次，HTTPS 拉 manifest；只带版本、平台和 channel，不带
   prompt、key 或 workspace 数据。
2. **验证**：用固定在 App 内的公钥验签；校验 SHA-256、平台、DSH/镜像兼容性、
   `minApp`。任一项失败 → 不更新，保留旧版本（fail closed）。
3. **下载**：后台下载到临时目录；支持差分包可选，v1 先用完整安装包。
4. **安装**：解压到 `versions/<version>/`，再次校验；切换指针/symlink，保留上一版本。
5. **重启**：默认提示“更新已就绪，重启生效”；用户可稍后。自动安装是 opt-in，不静默
   杀进程。
6. **迁移**：更新前备份 profile；迁移失败 → 回滚到上一版本，保留用户数据。
7. **健康检查**：启动后检查 DSH、两个插件、版本矩阵；失败自动回滚并提示。
8. **回滚**：保留上一版本与数据备份；签名/哈希/迁移/健康检查任一失败都回滚。

---

## 5. 数据布局与迁移

- **安装目录不可变**：壳、DSH、插件只读；不把用户状态写进安装目录。
- **用户数据外置**：DSH profile、bot 定义、session、local state、日志、vault。
- **更新前备份**：profile 与 `state/rayrun-bot/` 的 schema 版本；迁移失败可回滚。
- **vault 不动**：Rayrun token、DeepSeek key 的存储路径和权限不随更新改变；更新器
  不读取、不迁移、不记录它们。
- **云端状态不动**：更新只影响本地 App；云电脑与 `/workspace/.rayrun/` 由 bot host
  和用户数据管理，不由安装器触碰。

---

## 6. 版本兼容

| 组合 | 行为 |
| --- | --- |
| 本地 DSH = 云端镜像 DSH | 正常 |
| 本地 DSH 较新、云端镜像较旧 | 检查兼容性；不兼容时阻止“合上笔记本”或提示切镜像 |
| 插件与 DSH 不兼容 | 阻止更新；保留旧包；给一句可执行提示 |
| `dsh-rayrun-computer` 版本不匹配 | `E_DEP_VERSION`；阻止 bot 层启动 |
| 壳版本低于 `minApp` | 强制提示更新；不静默运行不兼容组合 |

版本矩阵写进 manifest 与 release notes；兼容性检查在启动和更新时都跑一次。

---

## 7. 安全与合规

- **代码签名**：Windows Authenticode，macOS notarization；Linux 提供签名包/校验和。
- **Manifest 签名**：更新包与 manifest 都签名，公钥固定在 App；不从可变分支直接拉。
- **更新源**：GitHub Releases / npm 的静态清单或用户包管理器；不新增项目方控制面。
- **不静默更新**：这个 App 持有 Rayrun token 和云电脑访问权；默认“提示 + 用户
  确认”，自动安装 opt-in。
- **更新检查不是遥测**：只发版本/平台/channel；在 [`../07-security.md`](../07-security.md)
  的 outbound 清单里写明。
- **回滚**：保留上一版本和用户数据备份；失败即停，不给假成功。
- **许可证**：DSH 与两个插件按各自许可证分发；打包 notices，不改版权与许可文本。

---

## 8. 首启体验

1. 安装 App，打开。
2. 内置 DSH 启动，加载两个插件，打开 `dsh web` 窗口。
3. 向导：Rayrun 登录 → DeepSeek key → 选择/创建云电脑 → 创建第一个 bot。
4. 用户不需要单独安装 DSH、npm 或插件；仍需要自己的 Rayrun 账号和 DeepSeek key。

失败状态（依赖缺失、token/key 缺失、机器停止、host down、审批过期、余额低、网络
离线）沿用 [`../03-client-design.md`](../03-client-design.md) §6 的“一句提示 + 一个
下一步”。

---

## 9. 实现选择

| 方案 | 更新器 | 代价 |
| --- | --- | --- |
| Electron 壳 + sidecar DSH | `electron-updater` / Squirrel / NSIS | 包大；但更新器成熟，DSH 进程管理直接 |
| Tauri 壳 + sidecar Node/DSH | Tauri updater + minisign | 包小；需要自己管理 sidecar 进程、端口和跨平台二进制 |
| 薄启动器（不开窗） | 安装器 + 浏览器打开 `dsh web` | 最简单；不再是“桌面 App”体验 |

**建议**：Electron 薄壳 + DSH sidecar，先用 spike D-S1 验证：

- DSH 进程生命周期、端口、退出清理；
- sidecar 在 Windows/macOS/Linux 的启动与路径；
- `electron-updater` 的签名、差分包、回滚；
- 本地 DSH 与云端镜像 DSH 的兼容检查。

如果包体积成为主要问题，再评估 Tauri；不要在 v1 同时做两套。

---

## 10. 发布流程

1. 固定 DSH 版本 + 插件版本，跑版本矩阵与 A1–A12 的桌面变体。
2. 构建各平台安装包，签名、notarize、生成 SHA-256。
3. 生成并签名 manifest，发布到 GitHub Releases（stable/beta channel）。
4. 从 N-1 升级到 N 的验收：启动、登录、建 bot、审批、重启、回滚。
5. 分阶段放量；保留 kill switch / 最低版本；安全更新可以要求重启后继续。
6. 发布说明列出：壳/DSH/插件版本、兼容的云端镜像、已知问题。

---

## 11. 验收标准

- 干净机器：安装 → 打开 → 登录 → 建电脑 → 建 bot → 第一条回复，无需额外安装。
- 从 N-1 更新到 N：用户数据、bot、session、vault 全部保留。
- 签名/哈希/manifest 任一失败：不更新，旧版本仍可用。
- 本地 DSH 与云端镜像不兼容：阻止“合上笔记本”或提示切镜像，不静默继续。
- 更新中断/磁盘满：旧版本可回滚，用户数据不损坏。
- 卸载：删除 App 与本地状态；Rayrun token 由用户在 vault 吊销。
- 无遥测：更新检查只发版本/平台/channel；不带 prompt、key、workspace。
- 代码签名与 notarization 在 Windows/macOS 上通过。

---

## 12. 未决项

| 问题 | 影响 | 决策 |
| --- | --- | --- |
| Electron 还是 Tauri | 包体积、进程管理、构建工具 | ADR-014 / spike D-S1 |
| 整包更新是否唯一路径 | 版本错配 | 建议是（ADR-014） |
| 静默 vs 提示更新 | 信任与安全 | 建议提示 + opt-in 自动安装 |
| 本地 DSH 与云端镜像不一致时阻断什么 | 产品承诺 | 版本矩阵与 feature gate |
| 发布源与签名密钥管理 | 供应链 | GitHub Releases + 固定公钥 |
| DSH 上游安全更新的跟进节奏 | 维护成本 | 固定版本 + 定期整包发布 |

---

## 13. 相关文档

- [`../00-product-direction.md`](../00-product-direction.md) v1.0
- [`../01-system-architecture.md`](../01-system-architecture.md)
- [`../09-deployment.md`](../09-deployment.md)
- [`../07-security.md`](../07-security.md)
- [`../08-integration.md`](../08-integration.md)
- [`../adr/architecture-decisions.md`](../adr/architecture-decisions.md) ADR-014
- [`../plans/roadmap.md`](../plans/roadmap.md) v1.0
