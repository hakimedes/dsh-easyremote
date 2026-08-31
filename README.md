<div align="center">

# DSH EasyRemote

### 本机优先、开箱即用的 Android 远程工作台

[![CI](https://github.com/hakimedes/dsh-easyremote/actions/workflows/ci.yml/badge.svg)](https://github.com/hakimedes/dsh-easyremote/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/@hakimedes/dsh-easyremote.svg?logo=npm)](https://www.npmjs.com/package/@hakimedes/dsh-easyremote)
[![npm downloads](https://img.shields.io/npm/dm/@hakimedes/dsh-easyremote.svg?logo=npm)](https://www.npmjs.com/package/@hakimedes/dsh-easyremote)
[![License: MIT](https://img.shields.io/badge/License-MIT-f2c94c.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-22.19%2B-43853d.svg?logo=node.js&logoColor=white)](https://nodejs.org/)
[![Android](https://img.shields.io/badge/Android-7.0%2B-3ddc84.svg?logo=android&logoColor=white)](apps/mobile)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178c6.svg?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![React Native](https://img.shields.io/badge/React_Native-Expo-61dafb.svg?logo=react&logoColor=111)](apps/mobile)
[![Platforms](https://img.shields.io/badge/Host-macOS%20%7C%20Windows%20%7C%20Linux-667085.svg)](docs/DEPLOYMENT.md)
[![Local First](https://img.shields.io/badge/Hub-127.0.0.1%20only-54d6ff.svg)](docs/THREAT_MODEL.md)
[![Cloudflare](https://img.shields.io/badge/Tunnel-Quick%20%7C%20Named-f38020.svg?logo=cloudflare&logoColor=white)](docs/DEPLOYMENT.md)
[![Status](https://img.shields.io/badge/Status-Pre--release-8b5cf6.svg)](#项目状态)
[![GitHub stars](https://img.shields.io/github/stars/hakimedes/dsh-easyremote?style=flat&logo=github)](https://github.com/hakimedes/dsh-easyremote/stargazers)

🌐 **中文** · [English](README_EN.md)

</div>

让 Android 手机安全地远程使用运行在自己电脑上的 DeepSeek Harness。Hub 始终只监听本机 `127.0.0.1`，公网访问由 Cloudflare Tunnel 提供。

> DSH EasyRemote 是独立社区项目，与 DeepSeek 官方无隶属或背书关系。项目采用 MIT License。

## 项目状态

当前版本处于公开预览阶段。npm 公共包与带长期签名的 Community APK 使用同一 `0.3.0` 版本发布；可直接通过 `npx` 启动，并从 [GitHub Releases](https://github.com/hakimedes/dsh-easyremote/releases) 下载 Android 安装包。后续仍会继续进行更多真机和跨平台回归。

`0.3.0` 增加 Mobile 文件与富内容能力：可拍照、选择图片或文件、使用 `@` 搜索工作区路径，并在会话中安全渲染 Markdown、表格、表单、基础图表及受限 `dsh-ui` 可视化。普通文件只写入当前工作区的 `.dsh-easyremote/uploads/`；图片使用 DSH 原生持久附件，Hub 不保存文件字节或完整聊天正文。

## 最快开始：不需要域名

需要 Node.js 22.19 或更新版本。直接执行：

```bash
npx @hakimedes/dsh-easyremote
```

首次运行会打开仅限本机访问的引导页：

- **快速启动**：自动下载并校验 `cloudflared`，启动本机 Hub 和临时 Quick Tunnel，不需要 Cloudflare 账号或域名。每次重启会获得新的 `trycloudflare.com` 地址，需要扫描新的恢复二维码。
- **深度配置**：复用同一个 Hub、数据库和设备身份，配置自己的固定域名和 Cloudflare Named Tunnel，并安装当前用户登录后自启的服务。

引导页按照“下载 APK → 建立连接 → 扫描互联二维码”的顺序完成首次配置。电脑已通过 ADB 连接 Android 手机时，也可以直接一键安装。后续需要重连时，可在 DSH Web 的 **Settings → Remote** 生成或刷新一次性二维码；生成新码会立即使旧码失效。

## 固定域名模式

深度配置前需要：

1. 一个可修改 Nameserver 的域名；
2. 免费 Cloudflare 账号；
3. 将域名加入 Cloudflare Free，并在注册商处改为 Cloudflare 分配的两条 Nameserver。

引导程序会精确检查 NS 是否生效，随后拉起官方 `cloudflared tunnel login` 授权，自动创建 Named Tunnel、DNS 路由和本机用户级自启。程序不会读取 Cloudflare、域名注册商密码，也不会请求 sudo、管理员权限或 SSH 信息。

PP.UA、EU.org 可能提供免费域名，但分别可能要求手机激活、公开注册信息或人工审核，规则也可能变化，请在申请前自行确认。DuckDNS、No-IP 等只提供子域名且通常不能修改 Nameserver，不适用于本流程。

完整操作见 [本机部署指南](docs/DEPLOYMENT.md)。

## 常用命令

```bash
dsh-easyremote setup
dsh-easyremote quick
dsh-easyremote start
dsh-easyremote stop
dsh-easyremote status
dsh-easyremote doctor
dsh-easyremote backup
dsh-easyremote restore <backup-file>
dsh-easyremote upgrade
dsh-easyremote uninstall
```

无参数运行是智能入口：未配置时进入引导；快速模式启动新的临时隧道；深度模式确保本机服务运行并打开控制台。

## 系统结构

```text
Android Community APK
        │ HTTPS / WSS
        ▼
Cloudflare Quick 或 Named Tunnel
        │ 仅转发到 127.0.0.1
        ▼
本机 DSH EasyRemote Hub ── WSS ── DSH Connector ── DSH
```

- Hub 不暴露局域网或公网监听端口；Quick/Named Tunnel 都只代理回环地址。
- Connector 与手机都只建立出站连接；切换公网地址不会改变 `hubId`、Node Secret 或 Install ID。
- Hub 保存身份、会话索引和幂等元数据，不持久化完整聊天正文。
- 快速模式退出前台进程后会停止 Hub 与 Tunnel，但数据库和离线缓存保留。
- 深度模式仅在当前用户登录后运行；电脑关机、休眠或断网时手机端离线。

更多边界说明见 [隐私模型](docs/PRIVACY.md)与[威胁模型](docs/THREAT_MODEL.md)。

## Android 版本

GitHub Releases 提供通用签名的 Community APK、SHA-256 和变更日志。Community APK 可连接用户确认过的任意 HTTPS Hub；内部版继续固定 `dsh.infomind.cc`，二者 application ID 与签名独立，可同时安装。

下载后请校验 Release 中的 `SHA256SUMS`。项目 v1 暂不发布 iOS App Store 版本。

## 从源码开发

```bash
pnpm install --frozen-lockfile
pnpm test
pnpm build
pnpm pack:community
```

工作区包含：

- `apps/easyremote`：npm CLI、引导页、Tunnel 管理、自启、诊断和备份恢复；
- `apps/hub`：本机 Fastify/SQLite Hub；
- `apps/dsh-plugin`：DSH Connector；
- `apps/mobile`：React Native / Expo Android 客户端；
- `apps/fake-plugin`：协议集成测试夹具。

贡献前请阅读 [CONTRIBUTING.md](CONTRIBUTING.md)；安全问题请按 [SECURITY.md](SECURITY.md) 私下报告。备份恢复和常见问题分别见 [BACKUP-RESTORE.md](docs/BACKUP-RESTORE.md) 与 [TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md)。
