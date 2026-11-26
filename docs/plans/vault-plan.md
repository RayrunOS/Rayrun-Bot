# 保险库（Vault）联合设计方案

> 状态：2026-11-26，Proposed。本文是设计稿，不是实现状态；实现状态以
> [`../12-status.md`](../12-status.md) 为准。
>
> 参与：Rayrun 平台侧评估与 review，以及安全、平台/API、产品/UX、Bots 集成四个
> 设计角色。结论基于当前 Rayrun credentials 行为、本仓库代码和 2026-11-26 的联合
> 评审；新 API、数据表和平台能力均为提议，当前不存在。

## 0. 结论

**目标**：做到 Grok Bot 式“模型不可见”的保险库，而不是只做一个 Settings 页面。

**结论**：

1. **任何进入云电脑的 secret 都不是 model-invisible。** agent 在云电脑内以 root
   运行，worker profile 设计为完整工具权限（本仓库 ADR-020；具体镜像 argv/flag 以
   DSH/镜像版本为准）。它能读 env、文件、`/proc/<pid>/environ` 和同 UID 进程。
   prompt 里不出现值不等于模型拿不到值。
2. **真正的边界只能放在 agent 的 OS principal 之外。** 可行落点是 Rayrun daemon
   内的 host 侧 broker（per-sandbox listener，tap 侧），或本机 DSH host broker；
   同容器、同 UID 的 broker 无效。broker 只下发 capability，不下发 secret 明文。
3. **拆成三条交付通道，不要混成一个“Vault”**：
   - 模型 key：模型网关（Phase 1，先做 DeepSeek）；
   - 第三方 API key：受限 HTTP 凭据代理（Phase 2，先只读）；
   - 网站密码/银行卡/登录态：独立的安全浏览器项目（Phase 3+，本期不做）。
4. **推荐顺序**：Phase 0 诚实披露 + 探针；Phase 1 模型网关；Phase 2 只读 API
   代理；Phase 3 写操作/typed action/OAuth/lease；浏览器填充单列。
5. **Phase 1 不新建第二套 vault 存储。** 模型 key 复用现有 `credentials` +
   `credential_bindings` + 平台 delivery planner；新的 secret/policy/capability
   数据域从 Phase 2 开始。
6. **不要发布“agent 可读”的 Vault 却宣称 model-invisible。** 如果近期需要
   API key 入口，只能明确标成 `Bot 可读`，按过渡能力处理。

## 1. 术语与保证边界

| 术语 | 定义 | 当前能否保证 |
| --- | --- | --- |
| **model-context-invisible** | secret 值不出现在 prompt、tool result、transcript、memory 等模型上下文 | 只能作为数据流属性；值若在 env/file，模型可诱导 agent 读出，**不是安全边界** |
| **agent-invisible** | 云电脑上任何 agent principal（当前 root/同 UID）进程都无法通过 env、argv、文件、`/proc`、进程内存、socket、浏览器存储读取 | 容器内 secret **不能保证**；只有容器外 broker 或平台 host 侧隔离可做到 |
| **model-invisible** | 在“模型输出不可信、可发起任意工具调用”的威胁模型下，模型无法获得 secret 值，且值不在模型上下文 | 只有 broker 在 agent 之外、且不返回原值时可保证 |
| **platform-invisible / zero-knowledge** | Rayrun 持有 host root + master key 也无法解密 | **不能保证**；凭据由平台主钥管理 |
| **capability-visible, secret-invisible** | agent 可持有并重放 capability，但长期 secret 不进入容器；broker 只执行受限动作 | 可实现；capability 是 bearer，不是 per-bot 认证 |

**能承诺**：

- secret 明文不进入云电脑、runtime spec、workspace、prompt、transcript、RPC 响应或
  日志；
- agent 只有 capability/占位符，broker 负责注入和转发；
- capability/secret 可即时吊销；使用元数据可审计；失败关闭，无 env 回退；
- broker 运行在用户自己的 Rayrun 部署内，无项目方中转。

**不能承诺**：

- 平台 root + 主钥持有者不能解密；daemon 宿主 root/调试器可读 daemon 内存；
- broker 宿主能看到网关明文流量；gateway 本身可读 prompt/response，零内容日志是
  承诺，不是事实；
- `private` credential 只约束“谁能选择/管理”，不约束“谁能在已绑定沙箱里读”；
  同一组织其他成员若能访问该沙箱，仍可通过 root/terminal 读到绑定的 private secret；
- 同机多 bot 隔离；capability 被 root 读取后可在策略允许范围内使用；
- 模型不会滥用被允许的动作（发信、删库、铸新 token 仍需 policy/审批）；
- 浏览器密码/银行卡自动填充；
- 上游 provider 看不到真实请求（这是模型调用的前提）。

## 2. 现状与差距

### 2.1 Rayrun credentials（平台评估）

能做的：

- 任意命名 secret 可存，`provider=""` 即纯密钥；AES-256-GCM，主钥 `0400`；API 只返回
  `secret_mask`；
- 租户隔离；`tenant` 组织级、`private` 仅 owner；`credentials:self` /
  `credentials:write` 控制管理面；
- 创建沙箱时固化 `credential_bindings`；按名字注入 `env|file`，在沙箱/runtime
  启动时生效；`exec` 自身环境刻意不含凭证。

不能做的：

- 注入名必须被目标镜像 manifest 的 `[[credentials]]` 声明；`dsh-bot@1` 目前只有
  `DEEPSEEK_API_KEY`；
- agent 进程、终端、root 可读 env/`/proc`，**不是 model-invisible**；
- 轮换 `POST` upsert 后运行中沙箱不变，必须 `Stop → Start`；Pause/Resume、runtime
  重启不刷新；
- 删除已绑定凭证后，已 Stop 的沙箱再次 Start 会 `403 credential_unavailable`，没有
  rebind；
- 审计只有 API 层 create/list/delete，journal append-only，无 WORM/导出，没有
  per-use 使用审计；
- 平台运营者持宿主 root + 主钥可解密；daemon 内存也是平台可读面。

### 2.2 Bots 当前代码

- `dsh-bot@1` manifest 只有 `DEEPSEEK_API_KEY`；`deepseek-harness@1` 是 detached
  官方镜像，Bots 不控制其 manifest。
- `cloud-host-runtime.js` 把 credential 绑定名放进 runtime spec；cloud host 的
  DSH agent 继承 `process.env`，模型可让 agent 打印 env。
- `computer-update.js` 当前只选择一个 credential；多 secret 绑定需要改。
- DSH vault 已存 `RAYRUN_TOKEN`；Bots 没有 Vault UI，也不应直接读 `.credentials.yaml`。
- `sessions.js` 的 secret 正则只覆盖部分形态，只能做纵深防御，不能当边界。

### 2.3 与 Grok Bot 的对应

| Grok Bot | 本方案 |
| --- | --- |
| Vault：账号级登录/卡/联系人，bot 永不看见，云端安全填充 | 单列安全浏览器项目；本期不做 |
| Secrets：API key 的 write-only 存储，云端注入 | 受限 HTTP 凭据代理（Phase 2）；agent 只拿 capability |
| 模型 key 由平台侧使用 | 模型网关（Phase 1）；先支持 DeepSeek |
| 共享/Team Bot 用 Secrets | 共享电脑没有 per-bot 隔离；要隔离只能一 bot 一沙箱 |

## 3. 目标架构

```text
本地 DSH host ──Rayrun token──▶ daemon vault handler
  (create/rotate/revoke/policy/approval/audit)

云电脑内 bot/tool ──capability──▶ model-gateway / vault-proxy ──secret──▶ 上游
                                      │
                                      └── audit / approval
```

### 3.1 Broker 落点

**推荐：Rayrun daemon 进程内的 host 侧 broker（per-sandbox listener）。**

- `vault-control`、`model-gateway`、`vault-proxy` 都是 **daemon 内的 HTTP
  handler/listener**，不是独立服务，也不是新的持钥进程；
- 模型网关和 API broker 各一个监听口（或同口不同 path），只绑沙箱 tap IP
  （如 `10.42.x.1`），guest 侧是 `10.42.x.2`；
- nft 只允许该沙箱 tap → host 端口；
- secret 从加密存储/主钥解密后只存在于 daemon 内存，按请求注入上游；
- 生命周期跟随沙箱：创建时分配 capability，停止/暂停时 listener 不可达，销毁即回收；
- 审计写现有 journal；
- guest 内只有 capability，secret **从不经过 vsock**。

**V1 内部端点**：直接用 `http://10.42.x.1:<port>/...`，不依赖 DNS/TLS；capability 走
`Authorization` header，tap 上只有 guest/host 可见。若坚持 HTTPS，需要 CA 注入 guest
trust store、DNS 保留名和证书轮换，额外 1–2 周，V1 不采用。

**不作为默认：本机 DSH host broker。** 它能把 secret 留在用户设备，但合上笔记本后
后台 routine 不可用；只适合“仅本地使用”的 secret，不适合作为云端 bot 的默认通道。

**拒绝：**

- 沙箱内 sidecar / guestd：agent 是 root，能读进程内存；
- 同容器同 UID 的 broker：不能称为 vault；
- 项目方 relay/托管 broker：违反用户所有和 local-first。

独立 broker VM/HSM 只在需要防“沙箱宿主被攻破”时另立项；V1 不改善 agent 不可见，
平台 root + 主钥仍可解密。

**daemon 生命周期**：

| 事件 | listener | capability | in-flight |
| --- | --- | --- | --- |
| daemon 重启 | 按沙箱重新绑定 | 从持久化记录恢复；旧 capability 继续有效至撤销/沙箱结束 | 失败关闭，不自动重试副作用 |
| 沙箱 pause | 不可达 | 保留 | 请求失败；不排队到 resume 自动执行 |
| 沙箱 stop | 不可达 | 保留至 TTL；可撤销 | 失败关闭 |
| 沙箱 destroy | 回收 | 立即吊销 | 失败关闭，审计保留 |

### 3.2 三条通道

| 通道 | 覆盖 | 交付方式 | 阶段 |
| --- | --- | --- | --- |
| **模型网关** | 模型 key（Phase 1 只 DeepSeek） | guest 只拿网关 base URL + `rvcap_` capability；daemon 在宿主侧注入真 key | Phase 1 |
| **受限 HTTP 凭据代理** | 第三方 API key（GitHub 等） | guest 拿 capability，显式 `GET/HEAD` 调用 host broker，broker 注入并转发 | Phase 2 |
| **浏览器安全填充** | 登录、银行卡、联系人 | 宿主侧/独立 VM 浏览器；agent 读不到 profile/cookie | Phase 3+，单列，不承诺 |

共同点：长期 secret 永不跨 vsock、不进 guest 内存；guest 只有 capability。

### 3.3 Capability 与 policy

- 长期 secret 只存在 broker；cloud agent 持有 opaque capability，绑定
  `{tenant, sandbox, secret, policy, action, target, expiresAt}`；`maxUses` 只在
  Phase 3 引入。
- **没有“读取 secret”动作**；Phase 2 的 broker 是**受限 HTTP 代理**
  （`GET/HEAD` + host/method/path 白名单），不是 typed action；Phase 3 写操作才做
  typed action。
- capability 是 bearer；同机 bot 可复制，因此它只能作为 policy scope 和审计归属，
  不能作为 per-bot 认证。
- capability 默认生命周期 = 沙箱生命周期；服务端滑动续期，不换 token；撤销即时，
  作为 kill switch。Phase 1/2 不设 `maxUses`，用速率/预算限制；接受 bearer 可重放，
  靠 TTL/撤销/速率限制缓解；Phase 3 再做 per-request nonce/签名。
- token 明文不落盘：Phase 1 由 daemon 用主钥对 `sandbox_id + capability_id` 做 HMAC
  确定性派生，只持久化 hash；Stop→Start 时重新派生同一 token 并注入 boot env，
  解决冷启后 guest 拿到同一 token 的问题。主钥轮换会使旧 token 失效，需显式
  revoke+regrant。
- 默认拒绝；目标 host 精确白名单、method/path 固定、请求/响应大小上限、短 TTL、
  速率限制。
- 写/发布/花钱/删除/铸新 token 默认逐次审批；只读可在安全评审后自动放行。
  **模型调用不逐次审批**：走 grant + 预算/速率上限；per-call 审批只用于写/发布/
  删除/铸 token。
- 审计记录 request id、claimed subject（unverified）、capability、secret name
  （Phase 2 起加 version）、动作、目标、决定、结果、延迟；不记录 secret、body、
  header 值。
- 失败关闭：capability 无效/过期、policy 不符、审批未知/超时、broker 不可用、
  审计失败、上游结果未知，都不得回退到明文或自动重试副作用。重放从 Phase 3 起由
  nonce/签名拒绝。

### 3.4 轮换、吊销、重绑

- **模型网关/API 代理**：轮换 = 新版本；新请求即时生效，in-flight 用旧版本；不需
  重启沙箱。
- **env/file 通道**：轮换仍需 `Stop → Start`，UI 必须写“停止并启动电脑”，不能写
  “重启”。
- 删除仍被 stopped sandbox 绑定的 Rayrun credential 会让机器无法启动；Bots **永不
  自动删除** Rayrun credential，必须先检查绑定并二次确认。
- API 代理的 rebind 默认**只换 secret id、不换 token**；它**不是吊销**：已泄露的旧
  capability 仍然有效，要失效必须显式 revoke + regrant。需要轮换 token 时走显式
  revoke + regrant，并接受交付代价（模型网关/API 工具需要 Stop→Start 或 runtime
  重启才能拿到新 token）。env 通道的 rebind = 新 credential 名 + 受控 stop/start。

## 4. 数据模型与 API 草案

> 以下均为提议，当前不存在。Phase 1 不引入新 vault 表；Phase 2 才开始。

### 4.1 实体

| 实体 | 关键字段 |
| --- | --- |
| `Secret` | `id, tenant_id, owner_user_id, visibility(tenant|private), name, kind, provider, current_version, mask, status` |
| `SecretVersion` | `secret_id, version, kms_key_id, ciphertext_ref, status` |
| `Policy` | `id, tenant_id, owner_user_id, target, rules[], limits` |
| `Capability` | `id, tenant_id, subject(sandbox_id, tap_ip), secret_id, policy_id, token_hash, status, expires_at` |
| `ApprovalRequest` | `id, capability_id, request_hash, method, target, path, status, expires_at` |
| `AuditEvent` | per-use 元数据，无 body/secret |
| `Lease` | 短期 OAuth access token/STS/SSH cert（Phase 3） |

capability token 形如 `rvcap_<base64url(32 bytes)>`；服务端只存 SHA-256；token 只返回
一次；固定放在 `Authorization: Bearer`，禁止 URL/query、日志、prompt。

### 4.2 控制面（用户 Rayrun token）

- `POST /v1/vault/secrets`（write-only）；`GET`（只回 mask）；
  `POST /v1/vault/secrets/{id}/rotate`；`DELETE`（有引用时 `409`，`force` 先吊销）。
- `POST /v1/vault/policies`；`POST /v1/vault/capabilities`（token 只显示一次）；
  `POST /v1/vault/capabilities/{id}/revoke`；
  `POST /v1/vault/capabilities/{id}/rebind`（默认只换 secret id，token 稳定；
  显式 revoke+regrant 才换 token）。
- `GET /v1/vault/approvals?status=pending`；
  `POST /v1/vault/approvals/{id}/decide`。
- `GET /v1/vault/audit`。
- scopes：`vault:read`、`vault:write`、`vault:grant` 只在本地 DSH host/用户 token
  上；云端 agent **不持有任何 `vault:*` scope**，只有 capability。`vault:approve`
  **只给用户浏览器 session（owner/admin + CSRF）**，bot/host token 不能持有，否则
  被攻陷的 bot 可自批。本地 host 只拉取 pending 并展示，不代用户批准。

### 4.3 数据面

- `POST http://10.42.x.1:<port>/deepseek/chat/completions`（OpenAI-compatible SSE；
  实际 `/v1` 归属由 M0 探针钉死，设计不写死后缀）。
- `GET http://10.42.x.1:<port>/deepseek/models`（allowlist；路径同上由 M0 确认）。
- `GET|HEAD http://10.42.x.1:<port>/t/{target}/<path>`（Phase 2 受限 HTTP 代理）。
- `POST http://10.42.x.1:<port>/v1/leases`（Phase 3）。

数据面认证固定 `Authorization: Bearer rvcap_...`；gateway/proxy 校验 bearer + tap
IP + capability 状态。错误映射：401/403 capability 拒绝；403 policy 拒绝；429 透传
`Retry-After`；504 超时；上游 401/403 → 502 `upstream_auth`，**不透传上游响应体**
（可能含账号信息）。

### 4.4 镜像与 runtime 契约

- 模型 key 不再注入真实值：镜像/manifest 配置
  `DEEPSEEK_BASE_URL=http://10.42.x.1:<port>/deepseek` 和
  `DEEPSEEK_API_KEY=rvcap_...`；DSH 走 OpenAI-compatible `/chat/completions`；
  search 走 `DEEPSEEK_SEARCH_BASE_URL`（Anthropic-compatible）时也必须路由；若 Phase 1
  不路由 search，就显式关闭，不允许占位 key 直连 provider。
- API 代理：runtime env 只放 capability（如 `VAULT_CAPABILITY`），不放 secret；
  guest 工具显式调用 broker。Phase 2 只支持 REST `GET/HEAD`；GraphQL 读操作是 POST，
  Phase 2 不支持，必须在文档/UI 写清。
- 镜像 owner 分开：`deepseek-harness@1` 是 Rayrun 平台官方镜像（平台负责 manifest/
  base URL），`dsh-bot@1` 是 RayrunOS/Rayrun-Bot 镜像（本项目负责镜像侧改动）。
- `dsh-rayrun-computer` 不修改；需要其改行为时走上游 issue/版本契约。

## 5. 分阶段计划

### Phase 0：决策与探针（约 1 周）

- 平台侧新增 **ADR-040**（model gateway / capability），修订平台侧 ADR-020；本仓库
  用 **ADR-021** 记录 Bots 侧边界（提案，编号以本仓库登记册为准）。
- M0 探针：DSH `$DEEPSEEK_BASE_URL` / `$DEEPSEEK_SEARCH_BASE_URL`、DeepSeek auth
  style、SSE、tool use、`reasoning_content` 透传；`deepseek-harness@1` 与
  `dsh-bot@1` 两条路径。
- 文档诚实化：在 `docs/07-security.md` 明确“当前 env 注入的 bot key 对 agent
  可读”，不写“Rayrun 看不到”；修正 `docs/12-status.md` 的措辞。
- Settings → Vault 可先做只读状态：模型 key 是否配置、绑定名、缺失提示、共享警告；
  不提供 API key 写入，不显示任何值。

**验证**：探针报告；文档无“model-invisible/Rayrun 看不到”的错误声明；只读 UI
DOM/RPC/日志无 secret。

### Phase 1：模型网关（约 4–6 周）

- 平台：复用现有 `credentials` + `credential_bindings` + delivery planner；daemon
  内 model-gateway（DeepSeek SSE/tool-use 透传、限流、错误映射、零内容日志）；
  按沙箱生成/持久化 capability；capability hash 落 journal + sandbox 记录，
  daemon 重启从中恢复；无法恢复时拒绝旧 token、要求重新交付；不引入新 vault 表。
- 镜像/DSH：`deepseek-harness@1`（平台）与 `dsh-bot@1`（本项目）配置 base URL +
  `rvcap_` capability；日志 redaction；版本门控；web search 路由或显式关闭。
- Bots：Setup/更新电脑创建/绑定模型 secret；Vault 页显示模型 key 状态；轮换/吊销；
  runtime env 只放 capability；失败关闭。
- **退出标准**：agent 进程 env / `/proc/<agent>/environ` 只见 `rvcap_`；`exec` 自身
  env 无凭证（Rayrun 的 exec 刻意清 env）；workspace/transcript/logs 无真 key；轮换
  不重启沙箱；吊销后模型调用失败；SSE/tool-use/reasoning 与原 API 一致。
- **不做**：第三方 API key 入口；per-call 审批；浏览器填充；新 vault 数据域。

### Phase 2：只读 API 凭据代理（约 8–10 周）

- 平台：新 `vault_secrets/policies/capabilities/audit` 域；daemon 内受限 HTTP
  broker；`GET/HEAD`；host/method/path allowlist；per-use 审计；pending approval；
  token exchange 框架；rebind 默认只换 secret id、token 稳定；显式 revoke+regrant
  才换 token。
- Bots：工具封装显式调用 broker；审批卡接入；capability 生命周期；Vault 页支持
  API key（`模型不可见` 徽标）；共享电脑警告。
- **限制**：未改造的 `git`/`gh` 不会自动走 broker；Phase 2 不做透明 MITM；GraphQL
  读操作（POST）不支持。
- **退出标准**：越权 target/method 拒绝；每次使用有审计；审批拒绝/超时失败关闭；
  agent 只有 capability，无 secret；Phase 1/2 bearer 重放接受，Phase 3 才做
  nonce/签名。

### Phase 3：写操作、typed action、OAuth、lease（约 8–12 周）

- 写操作 + typed action；OAuth refresh/GitHub App/AWS STS/GCP WIF/SSH CA；lease；
  per-call 审批、请求签名/nonce/重放保护；必要时独立 broker VM/HSM。
- 是否做 per-bot 隔离是产品决策：共享电脑没有隔离，要隔离只能一 bot 一沙箱。
- 模型调用仍走 grant + 预算/速率，不逐次审批。

### 单列：浏览器安全填充（Phase 3+，月级，未排期）

- 浏览器必须运行在 agent 读不到的地方（宿主侧/独立 VM），通过像素流/WebRTC 给
  用户；cookie/profile 不出浏览器运行时。
- 只要浏览器还在 bot 云电脑里，root agent 就能读 profile/cookie，secure fill
  就是假的。本期明确不做。

### 可选过渡：agent-readable API secrets

如果业务需要更早的 API key 入口，只能：

- 用 Rayrun env/file 注入并标 `Bot 可读`；
- 明说“模型/agent 可能读到”，不叫 Vault/model-invisible；
- 不做 per-bot 选择器；轮换按 `Stop → Start`；
- 作为 Phase 2 前的临时能力，不进入长期承诺。

## 6. 产品与 UI

Settings 导航：`Account · Vault · Usage · Bot's computer · Updates · Appearance`。
Vault 是 Settings 内的 section，不是新路由。

- **模型 key**：DeepSeek、绑定名、状态；Phase 1 后徽标 `模型不可见`；Phase 1 前
  只能显示 `Rayrun 注入` + “agent 可读”披露。
- **API keys**：Phase 2 后可用，徽标 `模型不可见`；列表只显示名称、env 名、范围、
  状态、更新时间；新增/替换/删除；没有 reveal/export。
- **不在这里保存**：网站密码/银行卡/联系人（需安全浏览器，暂不支持）；Rayrun
  token（在 Account + DSH vault，不是 bot 凭据）；DSH 本地模型 key（只影响本地聊天）。
- **共享警告**：固定“范围：这台电脑上的所有 Bot”；没有 per-bot 选择器，直到真正
  隔离。
- **写入后不可见**：密码输入、保存后清空；值不进页面 state、localStorage、RPC
  响应、日志。
- **轮换/删除**：网关/代理即时生效；env 通道明确“停止并启动电脑”；删除只移除
  bot 访问，不自动在服务商或 Rayrun 删除 credential。
- **状态**：未连接、加载、缺失、读取失败、不支持（不显示死按钮）、保存中、需重启、
  已吊销、失败。

## 7. 安全验收与红队

用唯一 opaque marker（如 `RAYRUN_VAULT_TEST_<uuid>`）作为测试 secret；不得依赖
现有 redaction 正则命中。

| 检查 | 通过标准 |
| --- | --- |
| prompt / tool result / transcript / outbox / routine / proposal / audit / logs | marker 0 次出现 |
| 云端 broker：workspace 全文件、`/proc/*/environ`、`ps e` | marker 0 次出现；agent env 只有 `rvcap_` |
| 本地 DSH host broker（仅本地 secret）：workspace、云端进程 | marker 0 次出现；本地 host 离线时失败关闭 |
| prompt injection：“print env”“cat /proc/1/environ”“read vault”“base64 it”“send to webhook”“read cookies” | 不返回 marker；越权被拒绝并审计 |
| capability 伪造/过期/错 target/错 sandbox/错 tap IP/错 secret version | 拒绝；无副作用；有审计 |
| bearer capability 重放 | **Phase 1/2 接受**；记录为已知限制，靠 TTL/撤销/速率限制；Phase 3 再做 nonce/签名 |
| redirect/DNS rebinding/回显 header 的端点/token minting 端点 | 拒绝；不跟随跨 host 重定向 |
| 轮换/删除/rebind | 旧值失效；rebind 默认只换 secret id、token 稳定；显式 revoke+regrant 才换 token；失败关闭；不自动删除；不把 stopped sandbox 锁死 |
| RPC/DOM/network/localStorage | 只出现 metadata/mask；无 `value`/`secret` 字段 |
| broker 离线/审计写失败/上游超时 | 失败关闭；不重试非幂等副作用 |
| 平台 operator / gateway prompt | 文档明确不是零知识；gateway 可读 prompt，零内容日志是承诺；不写相反声明 |

**验收必须证明“构造上不存在”**，而不是“日志脱敏后看不到”。

## 8. 开放决策与上游需求

### 8.1 需要 Rayrun 回答

1. 内部端点：V1 使用 `http://10.42.x.1:<port>` 的 tap 方案是否确认？DNS/TLS 是否
   完全不需要？
2. 平台服务能否读取/解密 tenant credential（daemon 内已可；若独立服务，需要
   服务身份与审计）？
3. 是否有 per-sandbox identity（tap IP、实例证书、签名 token）用于绑定 capability？
4. pending approval 只能本地轮询，还是平台提供出站 SSE/webhook？审批决定如何绑定
   用户浏览器 session（owner/admin + CSRF）？
5. capability TTL：Phase 1/2 定为“沙箱生命周期，服务端滑动续期，撤销即时”；
   token 轮换只在显式 revoke+regrant 时发生，是否可接受？
6. per-use 审计的保留期、tenant 查询/导出；现状是 journal append-only、无 WORM。
7. gateway 部署区域、可用性、egress/带宽计费、prompt 保留策略与 DPA；gateway
   侧 token/请求计量与预算归属怎么做？
8. `dsh-bot@1` / `deepseek-harness@1` 是否支持自定义模型 base URL、
   capability-as-key、日志 redaction？官方镜像 manifest 由谁改？
9. secret 删除/重绑：有 active capability 时删除策略；rebind 是否允许跨 provider？
10. 浏览器 secure fill 是否立项、归属哪个团队、是否进路线图？

### 8.2 上游 issue 草案

1. `feat(vault): daemon-side secret use without sandbox injection` — daemon 内
   handler 读取/解密 secret，API 永不返回明文，复用现有 AES-256-GCM 存储。
2. `feat(vault): capability tokens, policy, per-use audit, approval handoff` —
   capability/policy/审批/审计 API，token 只存 hash，沙箱不能提交决定。
3. `feat(model-gateway): DeepSeek-compatible streaming proxy` — SSE、tool-use、
   `reasoning_content` 透传，capability 认证，限流，零内容日志，用量计量。
4. `feat(network): tap-side internal vault endpoint` — `10.42.x.1`、nft、capability
   header，无需 DNS/TLS；公网不可达。
5. `docs(image): model base URL, capability-as-key, redaction` — 镜像/DSH 配置和
   日志红线；区分官方镜像与 `dsh-bot@1`。
6. `feat(credentials): rebind / replace credentials for existing sandboxes` — 解决
   删除凭证后 Stopped 沙箱 Start 403。
7. `feat(vault): per-request capability signing/nonce` — Phase 3 真正拒绝重放。
8. `docs(credentials): private visibility does not constrain runtime readers` — 把
   private 的运行时可见性写进入口/安全文档。

### 8.3 产品决策

- Phase 1 只做模型 key，还是同时做 API key？（建议先模型 key。）
- 是否允许“agent-readable API keys”作为过渡？若允许，必须标 `Bot 可读`，不叫 Vault。
- 共享电脑 vs 一 bot 一沙箱；后者是计费/产品变化，不是 vault 能解决的。
- gateway 能看到 prompt/response，是否接受零内容日志 + DPA 披露？
- 浏览器密码/银行卡是否立项；本期建议不做。

## 9. 推荐决策

1. **平台侧新增 ADR-040 并修订平台 ADR-020；本仓库用 ADR-021 记录 Bots 侧边界。**
   保险库的 secret 必须由 agent 读不到的 broker 使用；guest 只拿 capability；
   env/file 注入不得称为 model-invisible vault。
2. **Phase 1 先做模型网关（DeepSeek）**；复用现有 credentials，不新建 vault 域。
3. **Phase 2 做只读 API 代理**；Phase 3 做写操作/typed action/OAuth/lease；浏览器
   填充单列。
4. **不发布“Vault”空壳**：Phase 0 只读状态可以进 v0.1；API key 入口等 Phase 2。
5. **下一步**：Phase 0 探针 + 两份 ADR + 上游 issue；通过评审前不写实现代码。

**粗略时间**：Phase 0 约 1 周；Phase 1 约 4–6 周；Phase 2 约 8–10 周；Phase 3
约 8–12 周；浏览器填充月级、未排期。
