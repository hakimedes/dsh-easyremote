<div align="center">

# DSH EasyRemote

### 把电脑上的 AI 工作流安全地带到 Android 手机

[![Latest release](https://img.shields.io/github/v/release/hakimedes/dsh-easyremote?display_name=tag&sort=semver&logo=github)](https://github.com/hakimedes/dsh-easyremote/releases/latest)
[![npm version](https://img.shields.io/npm/v/@hakimedes/dsh-easyremote.svg?logo=npm)](https://www.npmjs.com/package/@hakimedes/dsh-easyremote)
[![npm downloads](https://img.shields.io/npm/dm/@hakimedes/dsh-easyremote.svg?logo=npm)](https://www.npmjs.com/package/@hakimedes/dsh-easyremote)
[![CI](https://github.com/hakimedes/dsh-easyremote/actions/workflows/ci.yml/badge.svg)](https://github.com/hakimedes/dsh-easyremote/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-f2c94c.svg)](LICENSE)

[![Node.js](https://img.shields.io/badge/Node.js-22.19%2B-43853d.svg?logo=node.js&logoColor=white)](https://nodejs.org/)
[![Android](https://img.shields.io/badge/Android-7.0%2B-3ddc84.svg?logo=android&logoColor=white)](apps/mobile)
[![Host platforms](https://img.shields.io/badge/Host-macOS%20%7C%20Windows%20%7C%20Linux-667085.svg)](docs/DEPLOYMENT.md)
[![Local Hub](https://img.shields.io/badge/Hub-127.0.0.1%20only-54d6ff.svg)](docs/THREAT_MODEL.md)
[![GitHub stars](https://img.shields.io/github/stars/hakimedes/dsh-easyremote?style=flat&logo=github)](https://github.com/hakimedes/dsh-easyremote/stargazers)

[🚀 三步开始](#三步开始) · [⬇️ 下载 Android APK](https://github.com/hakimedes/dsh-easyremote/releases/latest/download/DSH-EasyRemote-Community.apk) · [📖 部署指南](docs/DEPLOYMENT.md) · [🛠️ 故障排查](docs/TROUBLESHOOTING.md)

🌐 **中文** · [English](README_EN.md)

</div>

DSH EasyRemote 是一套本机优先的 Android 远程工作台：Hub 和 Connector 运行在你自己的电脑上，手机通过 Cloudflare Tunnel 安全访问，无需开放路由器端口，也不需要把 Hub 部署到云服务器。

> [!IMPORTANT]
> DSH EasyRemote 是独立社区项目，与 DeepSeek 官方无隶属或背书关系。项目采用 [MIT License](LICENSE)，当前处于公开预览阶段。

## 你可以做什么

| 能力 | Mobile 体验 |
| --- | --- |
| 远程对话 | 查看最近会话和完整历史，创建会话，流式接收回复，处理运行状态与审批 |
| 模式与模型 | 新建会话时选择 Agent 模式；按当前 Node 能力切换模型与思考强度 |
| 文件与图片 | 拍照、选择图片或文件，分块上传；输入 `@` 搜索并引用当前工作区文件 |
| 富内容与 GenUI | 安全渲染 Markdown、代码、表格、图片、表单、统计、基础图表及受限 `dsh-ui` 可视化 |
| 两种连接方式 | 无域名的临时 Quick Tunnel，或使用自有域名的 Named Tunnel 固定连接 |
| 本机优先 | Hub 只监听 `127.0.0.1`；不提供托管中继，不持久化完整聊天正文或上传文件字节 |

普通文件会保存到当前工作区的 `.dsh-easyremote/uploads/<sessionId>/`；图片使用 DSH 原生持久附件。候选文件搜索只返回路径，不读取文件内容。更多边界见[隐私模型](docs/PRIVACY.md)与[威胁模型](docs/THREAT_MODEL.md)。

## 三步开始

准备好以下环境：

- Node.js 22.19 或更新版本；
- 已安装并可启动的 DeepSeek Harness Web；
- Android 7.0 或更新版本手机。

### 1. 打开本机引导页

```bash
npx @hakimedes/dsh-easyremote@latest
```

命令不会执行 `postinstall`，引导页只监听 `127.0.0.1`，并使用随机会话令牌与 CSRF 防护。

### 2. 下载 APK 并选择连接方式

引导页会先展示 **Community APK 下载二维码**。也可以直接[下载最新版 APK](https://github.com/hakimedes/dsh-easyremote/releases/latest/download/DSH-EasyRemote-Community.apk)，安装完成后返回引导页继续配置连接。

然后选择：

- **快速启动**：不需要账号或域名，自动启动临时 Cloudflare Quick Tunnel；
- **深度配置**：使用自己的域名和 Cloudflare 账号，在本机创建稳定的 Named Tunnel。

### 3. 扫描互联二维码

Connector 与 Tunnel 就绪后，引导页才会展示第二个二维码——**手机互联二维码**。首次安装 Connector 后如页面提示，请重启一次 DSH Web，再用 APK 扫码连接。

后续需要重连时，在 DSH Web 的 **Settings → Remote** 生成或刷新一次性二维码。新二维码生成后，旧二维码立即失效。

> [!TIP]
> APK 下载二维码用于“安装应用”，互联二维码用于“绑定当前 Hub”，两者不是同一个二维码。

## 快速启动与深度配置

| | 快速启动 | 深度配置 |
| --- | --- | --- |
| Cloudflare 账号 | 不需要 | 需要 Free 账号 |
| 自有域名 | 不需要 | 需要可修改 Nameserver 的域名 |
| 公网地址 | 临时 `*.trycloudflare.com`，重启后变化 | 固定 HTTPS 域名 |
| 运行方式 | 当前终端前台管理 | 当前用户登录后自动启动 |
| 数据与身份 | 持久保留 | 与快速模式复用同一数据库、`hubId` 和 Node 身份 |
| 适合场景 | 首次体验、临时访问 | 日常稳定使用 |

快速模式关闭终端后会停止 Hub 与 Tunnel，但不会删除数据库、设备身份或手机缓存。深度配置只在本机完成 Cloudflare 浏览器授权，不读取 Cloudflare/注册商密码，不请求 sudo、管理员权限、SSH 或云服务器。

固定域名的 Nameserver 配置、Quick → Named 无损升级和自启说明见[本机部署指南](docs/DEPLOYMENT.md)。

## Android 下载

- [下载最新版 Community APK](https://github.com/hakimedes/dsh-easyremote/releases/latest/download/DSH-EasyRemote-Community.apk)
- [下载 SHA-256 校验文件](https://github.com/hakimedes/dsh-easyremote/releases/latest/download/SHA256SUMS)
- [查看全部 Releases 与变更记录](https://github.com/hakimedes/dsh-easyremote/releases)

APK 不包含在 npm 包中；引导页从 GitHub Releases 提供下载二维码。Community APK 使用独立长期签名，可连接用户明确确认过的任意 HTTPS Hub。项目当前仅发布 Android 版本，暂无 iOS App Store 版本。

## 系统结构

```text
Android Community APK
        │ HTTPS / WSS
        ▼
Cloudflare Quick 或 Named Tunnel
        │ 仅转发到 127.0.0.1
        ▼
本机 EasyRemote Hub ── WSS ── DSH Connector ── DeepSeek Harness
```

- Hub 不暴露局域网或公网监听端口；手机与 Connector 使用独立身份和令牌。
- Quick Tunnel 地址变化或升级到固定域名时，`hubId`、Node Secret 与 Install ID 保持不变。
- Hub 保存身份、会话索引、上传状态和最小幂等元数据，不保存完整聊天正文。
- 上传内容只在权限受限的临时 spool 中中转，Connector 接收后立即清理；普通文件最终由用户工作区管理。
- 复杂 GenUI 运行在禁用网络与文件访问的受限 WebView 中；原始 HTML、模型 JavaScript 和敏感表单字段均被拒绝。

## 管理命令

使用 `npx` 的用户无需全局安装，每次都可以执行最新版 CLI：

```bash
npx @hakimedes/dsh-easyremote@latest setup
npx @hakimedes/dsh-easyremote@latest quick
npx @hakimedes/dsh-easyremote@latest start
npx @hakimedes/dsh-easyremote@latest stop
npx @hakimedes/dsh-easyremote@latest status
npx @hakimedes/dsh-easyremote@latest doctor
npx @hakimedes/dsh-easyremote@latest backup
npx @hakimedes/dsh-easyremote@latest restore <backup-directory>
npx @hakimedes/dsh-easyremote@latest upgrade
npx @hakimedes/dsh-easyremote@latest uninstall
```

无参数命令是智能入口：未配置或处于快速模式时打开本机引导/控制页；深度模式下确保服务运行并打开控制页。安装状态与本机数据默认位于 `~/.dsh-easyremote/`。

## 常见问题

先运行：

```bash
npx @hakimedes/dsh-easyremote@latest status
npx @hakimedes/dsh-easyremote@latest doctor
```

| 现象 | 建议 |
| --- | --- |
| 引导页没有互联二维码 | 首次安装 Connector 后重启一次 DSH Web；页面会继续轮询配对状态 |
| DSH Web 显示 Hub unreachable | 确认本机 Hub 已启动，并用 `doctor` 检查 Connector 的 `hubUrl` |
| 手机二维码过期 | 在 **Settings → Remote** 生成新的互联二维码 |
| Quick Tunnel 无法建立 | 检查出站 HTTPS/QUIC 网络；详见 cloudflared 日志和故障排查文档 |
| 固定域名一直等待 NS | 检查注册商 NS 与残留 DNSSEC/DS；DNS 生效可能需要数小时 |

更多解决方案见[故障排查](docs/TROUBLESHOOTING.md)。报告问题时，请勿公开 `install.json`、数据库、`cert.pem`、Tunnel 凭据、配对 Token 或包含 Token 的完整日志。

## 从源码开发

```bash
pnpm install --frozen-lockfile
pnpm test
pnpm typecheck
pnpm build
pnpm pack:community
```

工作区包含：

- `apps/easyremote`：npm CLI、引导页、Tunnel 管理、自启、诊断与备份恢复；
- `apps/hub`：本机 Fastify / SQLite Hub；
- `apps/dsh-plugin`：DSH Connector；
- `apps/mobile`：React Native / Expo Android 客户端；
- `apps/fake-plugin`：协议集成测试夹具。

贡献前请阅读 [CONTRIBUTING.md](CONTRIBUTING.md)；安全问题请按 [SECURITY.md](SECURITY.md) 私下报告。备份与恢复见 [BACKUP-RESTORE.md](docs/BACKUP-RESTORE.md)。
