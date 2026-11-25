# Hyper · Hyper'jiawei

> 由此观之、生命何等壮丽恢宏！

代码、实践，与生活记录。

[Blog](https://hyper-jiawei.github.io/) · [Gallery](https://hyper-jiawei.github.io/gallery/) · [GitHub](https://github.com/Hyper-jiawei)

## 在做与探索

计算机视觉、嵌入式开发、自动化工具。

- [手势隔空操作](https://github.com/Hyper-jiawei/YTO-Innovation-Gesture-Control)
- [微信聊天离线归档](https://github.com/Hyper-jiawei/WechatBuckup)
- [ESP32 无刷电机云台](https://github.com/Hyper-jiawei/FOC-gimbal-esp32-arduinoIDE)
- [网页操作工具](https://github.com/Hyper-jiawei/webpage-operator)

[网站维护、文章更新与照片上传](https://github.com/Hyper-jiawei/Hyper-jiawei.github.io/blob/main/MAINTENANCE.md)

网站沿用提供的 Blog / Gallery Astro 框架，来源及改动范围见 [NOTICE](https://github.com/Hyper-jiawei/Hyper-jiawei.github.io/blob/main/NOTICE)。

## Income 私人收支工具

访问入口：[Income](https://hyper-jiawei.github.io/income/)。界面使用英文，独立于 Blog / Gallery，不修改原有网站发布流程。

### 部署状态

截至 2026-11-25：

- 页面、财务计算、银行卡记录、加密模块和验证服务代码已完成。
- Cloudflare 已完成账户授权，验证服务已部署到 `https://income-auth.hyper-jiawei.workers.dev`；生产检查 `/health` 返回 `{"ready":true}`。
- 前端已配置该验证服务地址，生产登录入口已开放；左上角使用本地保存的 GitHub 头像，不在登录或财务操作时向头像服务发送请求。
- 私人数据仓库 `Hyper-jiawei/v0` 已创建，没有描述，没有上传真实财务数据。
- GitHub OAuth App 及三个 Cloudflare Secret 已配置；实际 GitHub 登录、专用仓库令牌读写以及 Mac / iPhone 实机 Passkey 解密验收仍未完成。健康检查不代表这些验收已通过。
- 已修正 Cloudflare 不支持 `redirect: 'error'` 导致 OAuth 回调报错的问题。GitHub 请求改用 `redirect: 'manual'`，收到重定向时拒绝，不跟随重定向或转发凭据。
- 验证服务不具备完整配置时返回未就绪；前端不会开放登录，不提供演示账号或绕过验证的入口。
- 93 项自动化测试通过；桌面、手机尺寸的浏览器流程通过；真实 WebAuthn 签名和 PRF 加密已用 Chrome 虚拟认证器验证。另在实际 workerd 运行环境验证了模拟上游的 OAuth 交换、身份检查、空保险箱读取和重定向拒绝。虚拟认证器和模拟上游不代表实际 Apple 设备或 GitHub 凭据已通过验收。

### 架构与数据边界

| 部分 | 所在位置 | 保存的内容 |
| --- | --- | --- |
| 英文界面和公开程序 | 本 GitHub 仓库，通过 GitHub Pages 发布 | 静态 HTML、CSS、JavaScript，不包含个人财务数据或密钥 |
| 财务数据 | GitHub 私人仓库 `Hyper-jiawei/v0` | 唯一文件 `0.bin`，内容为加密封装 |
| 身份验证与会话 | Cloudflare Worker `income-auth` | GitHub 身份验证、Passkey 签名校验、会话控制、GitHub 密文转发 |
| 验证元数据 | Cloudflare SQLite Durable Object `IncomeAuth` | Passkey 公钥、公开 PRF 输入盐值、签名计数器、短期凭据的哈希和到期时间 |
| 解密与编辑 | 当前浏览器内存 | 解密后的财务记录、草稿、非导出的 AES 密钥和会话令牌 |

Cloudflare 不是财务数据的持久存储。Worker 会转发密文，但不会将财务请求正文写入 Durable Object。浏览器中的 PRF 输出和 AES 密钥不发送给 Worker。前端不把财务内容或登录令牌写入 localStorage、sessionStorage 或 IndexedDB。

GitHub 私人仓库没有说明性文件或 README。存储文件名固定为 `0.bin`，提交说明固定为 `Update 0`。封装只使用数字键：

```json
{"0":1,"1":"base64url nonce","2":"base64url ciphertext"}
```

上述值是格式占位符，不是可用密文。月份、银行卡名称、金额等业务字段位于加密内容内部。原始 V2 HTML 包含明文财务记录，不能提交到本公开仓库，也不能直接上传到私人仓库；只能在浏览器本地导入，再加密发布。

### 登录、加密与十分钟失效

1. 页面跳转到 Worker 的 `/auth/start`，再到 GitHub 完成 OAuth 身份授权。授权不申请仓库权限，仅接受 GitHub 用户 ID `209197935`。
2. GitHub 返回 Worker 后，服务验证一次性 state、浏览器绑定和 PKCE，立即丢弃身份令牌，再向页面返回一次性登录票据。
3. 页面领取短期验证凭据，创建或验证该网站自己的 Passkey。每次解锁都要求 WebAuthn 用户验证，不能只依赖 GitHub 已登录的状态。
4. 浏览器使用 Passkey 的 WebAuthn PRF 输出，经 HKDF-SHA-256 派生不可导出的 AES-256-GCM 密钥，在浏览器中加解密财务数据。
5. Worker 验证 Passkey 签名后才发放财务会话。注册凭据、挑战和登录票据都不能直接读取或发布财务数据。
6. 只有前台真实鼠标、触摸或键盘输入才触发会话续期。后台停留、切回页面、读取数据和自动刷新不续期。
7. 页面隐藏时立即清除财务展示。连续十分钟没有有效活动，会话由服务器判为失效，浏览器也清除内存引用并要求重新登录；前台不操作也会失效。单次会话最长八小时。
8. 刷新页面需要重新登录；点击 `Lock` 会立即清除浏览器会话并请求服务器注销。

GitHub 的 `github.com` Passkey 不能直接用于 `hyper-jiawei.github.io`。GitHub OAuth 也不能保证每次都弹出新的 GitHub Passkey 验证。这里采用的是「GitHub 身份 + 网站独立 Passkey」；网站 Passkey 可以由兼容的 Mac / iPhone 凭据提供方保存和同步。

### 配置与部署步骤

#### 1. 准备环境和源码

使用 Node.js 24 和 npm。以下命令在正常的 Node.js 环境中运行，不需要把 Qoder 的临时运行目录提交到仓库。

```bash
git clone https://github.com/Hyper-jiawei/Hyper-jiawei.github.io.git
cd Hyper-jiawei.github.io
npm ci
npm test
npm run build

cd tools/income-auth
npm ci
npm test
npm run check
```

网站测试包含财务模型、双币种、银行卡负债、V2 导入和加密检查。验证服务测试包含 OAuth、Passkey、重放、时限、私有仓库检查及并发冲突。`npm run check` 只构建 Worker，不部署。

#### 2. Cloudflare 授权与首次部署

仅申请账户读取、用户读取、Worker 脚本写入；不要因为 Wrangler 提示缺少默认权限，就添加 Pages、R2、KV、账单或其他无关权限。

```bash
npx wrangler login --device --browser=false --scopes account:read user:read workers_scripts:write --use-keyring
npx wrangler whoami
```

设备授权链接和代码由命令输出，可以在手机浏览器中登录并批准。Apple 账户登录只是登录 Cloudflare 的一种方式，与网站自己的 GitHub 身份验证不同。代码有时限，过期后必须重新生成。macOS 使用 `--use-keyring` 后，凭据以加密文件保存，解密密钥由系统钥匙串保护。

首次使用 Workers 需要注册账户的 `workers.dev` 子域名；当前账户已注册 `hyper-jiawei`，不需要重复注册。配置文件 `tools/income-auth/wrangler.jsonc` 已包含 Worker、SQLite Durable Object 及初始迁移：

```bash
npx wrangler deploy
```

当前服务地址是 `https://income-auth.hyper-jiawei.workers.dev`。缺少 GitHub 凭据时可以部署，但服务保持关闭，不能访问财务数据。不要为了让首页按钮可用而跳过健康检查或身份校验。

#### 3. 创建 GitHub OAuth App

用 `Hyper-jiawei` 登录 GitHub，进入 `Settings → Developer settings → OAuth Apps → New OAuth App`，或打开[创建 OAuth App](https://github.com/settings/applications/new)。手机浏览器也可以操作。

填写：

| 设置 | 值 |
| --- | --- |
| Application name | `Income` |
| Homepage URL | `https://hyper-jiawei.github.io/income/` |
| Application description | 留空 |
| Authorization callback URL | `https://income-auth.hyper-jiawei.workers.dev/auth/callback` |

保存后取得 Client ID，再生成 Client Secret。不要发送到聊天、Issue、README、源代码、命令行参数或截图里。OAuth App 仅供身份登录，不要授予它财务仓库访问权限。

#### 4. 创建专用私人仓库令牌

在 GitHub 的 `Settings → Developer settings → Personal access tokens → Fine-grained tokens` 创建专用令牌，或打开[创建 fine-grained token](https://github.com/settings/personal-access-tokens/new)。

- Resource owner：`Hyper-jiawei`。
- Repository access：选择 `Only select repositories`，只选私人仓库 `v0`。
- Repository permissions：只开 `Contents: Read and write`；GitHub 自动要求的 `Metadata: Read-only` 保留。
- Account permissions：不额外开启；不需要 Actions、Administration 或 Workflows 权限。
- 设置适当到期时间，并在到期前更新 Cloudflare 中的秘密值。

不要使用 GitHub CLI 当前登录的广泛 `repo` 令牌，也不要选择所有仓库。本服务每次读取和写入都会重新检查仓库是否确实为 private；仓库变为 public、不可访问或 API 返回错误时停止访问，没有公开仓库兜底。

#### 5. 把 GitHub 凭据保存到 Cloudflare

手机上进入 Cloudflare Dashboard，选择当前账户，在 `Workers & Pages` 中打开 `income-auth`，进入设置的 `Variables and Secrets`，添加以下三个值，类型均选择 **Secret**，并保存或部署更改：

| 名称 | 来源 |
| --- | --- |
| `GITHUB_CLIENT_ID` | GitHub OAuth App 的 Client ID；虽然不是机密，也可统一存为 Secret |
| `GITHUB_CLIENT_SECRET` | GitHub OAuth App 的 Client Secret |
| `STORE_TOKEN` | 仅允许访问 `v0` 的 fine-grained token |

在电脑上也可以用交互输入完成，值不会写入命令参数：

```bash
npx wrangler secret put GITHUB_CLIENT_ID
npx wrangler secret put GITHUB_CLIENT_SECRET
npx wrangler secret put STORE_TOKEN
npx wrangler secret list
```

`secret list` 只列名称，不应输出秘密内容。上述输入流程可能短暂显示输入字符，操作时避免录屏或共享屏幕。本地若需要 `.dev.vars`，它只能留在已忽略的本地文件中，不能提交。

下面这些不是秘密，已经放在 `wrangler.jsonc` 中：

| 变量 | 值 |
| --- | --- |
| `APP_ORIGIN` | `https://hyper-jiawei.github.io` |
| `RP_ID` | `hyper-jiawei.github.io` |
| `OWNER_ID` | `209197935` |
| `STORE_OWNER` | `Hyper-jiawei` |
| `STORE_REPO` | `v0` |
| `STORE_BRANCH` | `main` |

#### 6. 检查服务并发布 GitHub Pages

```bash
curl --fail https://income-auth.hyper-jiawei.workers.dev/health
```

完整配置存在时应返回 `{"ready":true}`；缺少配置时返回 `{"ready":false}`。健康检查只检查配置完整性，不能证明 GitHub 凭据有效、仓库访问正常或实机 Passkey 兼容。必须继续完成实际登录和加密读写验收。

`public/income/config.json` 中唯一配置项是公开验证服务地址，不允许放任何令牌或财务数据：

```json
{"service":"https://income-auth.hyper-jiawei.workers.dev"}
```

前端会访问 `/health`，未就绪时禁用登录。在网站仓库根目录重新测试和构建，审核变更后提交并推送，由现有 `.github/workflows/pages.yml` 发布到 GitHub Pages：

```bash
npm test
npm run build
git add public/income/config.json README.md
git commit -m "Document and configure the income verification service"
git push origin main
```

首次发布还需要提交已经完成的 `public/income/`、`tests/income.test.mjs` 和 `tools/income-auth/` 程序文件。不要提交 `node_modules`、构建产物、`.dev.vars`、密钥、原始 V2 文件或真实财务数据。Worker 更新使用 `npx wrangler deploy`；GitHub Pages 的发布不会自动更新 Worker。

#### 7. 在 Mac 与 iPhone 上验收

先使用临时数据，不要立即导入真实财务记录：

1. 打开 `/income/`，完成 GitHub 身份验证，创建该网站自己的 Passkey，再完成一次 Passkey 验证。
2. 确认浏览器支持 PRF，能够进入页面；若提示加密不可用，停止，不要绕过报错。
3. 记录一个月，确认并发布，锁定后重新登录，检查解密重开一致。
4. 在另一台实际设备上使用同步后的同一 Passkey 登录，确认能够解密同一份内容。仅登录成功但不能解密，不算通过。
5. 验证离开或无活动十分钟后无法继续读取和发布，需要重新登录；切回页面本身不续期。
6. 同时用两个设备编辑，确认后发布，后提交的一方应看到冲突，而不是覆盖另一台设备的数据。
7. 用不属于指定 GitHub ID 的账户登录应被拒绝。

临时数据通过正式服务发布时也会以密文保存在私人仓库及其历史中。实机验收完成前，不要把该方案当作已验证的真实数据保险箱。

### 日常使用

- **Plan**：设置起始 CNY / HKD、工资与绩效、五险一金、税务扣除、生活费、旅行预算和储蓄目标。
- **Record last month's salary payment**：选择工资所属月份，填写记录前 CNY / HKD、工资和预算，核对超支金额，点击 `Confirm` 后再 `Publish`。工资在次月 25 日到账。
- **Submitted Months**：查看已经发布的月份。点击 `Edit` 后可以修改，但必须重新 `Confirm` 和 `Publish`。
- **Bank Cards**：添加英文卡名、借记卡或贷记卡、CNY 或 HKD；手动填写每月 25 日余额。信用卡的 `Amount Owed` 是负债，汇总时扣除。
- **Use Card Balances**：把对应发薪月份的银行卡净余额填入记录前余额；该月份所有卡片都要先填写，不能沿用上月快照。
- **Import V2**：在本地选择旧 HTML，仅解析数据，不执行文件中的脚本。先检查历史月份、Plan 与币种，再确认需要确认的月份并发布。
- **Home**：有未发布更改时提供 `Stay`、`Discard Changes`、`Publish and Return`。发布失败或发生并发冲突，草稿不会被当作已发布。

预测覆盖未来 36 个完整工资周期；按发薪年份计算累计个税，在每年一月重置；保存的实际税额和实发工资优先于预测。CNY 与 HKD 分开记录；超支按同一个当前汇率比较预期和实际记录前余额，汇率波动本身不算消费超支。预测是按当前设置计算，不保证未来工资、税务政策或投资收益。

### 安全限制与维护

- 静态 HTML 和程序本身是公开的；受到保护的是财务数据，不是把 GitHub Pages 的 HTML 变成私人网页。
- 当前仅支持一枚登记后的 Passkey。**没有恢复密钥、Passkey 更换或账户找回功能**。丢失 Passkey，或删除 Durable Object 中的公钥与盐值，可能导致既有密文无法恢复；不要删除或重建验证存储，不要把重新注册误当作数据恢复。
- GitHub 会保留密文版本历史。删除最新记录不会自动删除旧提交中的密文。仓库名、提交时间和密文长度等元数据不隐藏。
- Cloudflare 及网络服务仍能观察请求时间等运行元数据。项目关闭 Worker observability，不主动记录财务正文、PRF 输出或密钥，但不保证服务提供商不存在平台级元数据。
- 浏览器内存清理只是尽力而为，不能保证操作系统内存、扩展、恶意软件、屏幕截取或被攻陷的设备绝不泄露。端到端加密也不能防御被恶意替换的前端代码。
- 修改域名会改变 WebAuthn RP 和 Origin，旧 Passkey 不能直接迁移。Origin、RP ID、OAuth 回调和前端地址必须一致，不能随意替换。
- 更新 GitHub 专用令牌时只更新 Cloudflare `STORE_TOKEN`，不上传令牌到 GitHub。OAuth Secret 更新同理；这类更新不需要更换财务加密密钥。
- 到期、API 不可达、私有性检查失败、签名错误或密文认证失败时均停止访问。不要添加公开兜底、自动重试覆盖或无验证的恢复入口。
- Worker 和 GitHub Pages 都需要维护与实机验收；Cloudflare 的额度及计费以账户当前套餐为准，本项目不自动启用付费服务。
