# DSH EasyRemote 本机部署指南

DSH EasyRemote 的 Hub 一律运行在用户自己的电脑上并监听 `127.0.0.1`。安装器没有云服务器、SSH、远程 Docker 或 sudo 流程。

## 1. 前置条件

- Windows 10/11 x64、macOS x64/arm64，或 Linux x64/arm64；
- Node.js 22.19 或更新版本；
- 已安装并可启动的 DeepSeek Harness；
- Android 7.0 或更新版本手机。

深度配置还需要一个可修改 Nameserver 的域名和 Cloudflare Free 账号。快速启动不需要这两项。

## 2. 首次安装

```bash
npx @hakimedes/dsh-easyremote
```

命令会在随机可用端口启动引导页，只监听 `127.0.0.1`，并尝试打开默认浏览器。URL 含随机会话令牌；首次换取 HttpOnly 会话 Cookie 后该令牌立即失效。所有写操作都校验 Origin、CSRF Token 和一次性操作 ID。

安装状态保存在 `~/.dsh-easyremote/install.json`，敏感材料保存在独立文件并限制为当前用户可读。引导中断后重新执行命令即可从已完成阶段继续。

首次引导固定按三个阶段展示：

1. 扫码下载并安装 Community APK；
2. 选择快速启动或完成固定域名配置；
3. Connector 就绪后，在同一页面扫描实时互联二维码。

Connector 首次安装到已运行的 DSH Web 时需要重启一次。引导页会持续检测，不需要刷新浏览器。

## 3. 快速启动

选择 **快速启动** 后，安装器会：

1. 根据系统和架构下载锁定版本的 Cloudflare 官方 `cloudflared`；
2. 对下载文件执行发布清单中的 SHA-256 校验；
3. 在可用端口启动只监听 `127.0.0.1` 的 Hub；
4. 使用 `~/.dsh-easyremote/cloudflared/quick.yml` 启动 Quick Tunnel，避免读取用户已有的默认 Cloudflare 配置；
5. 写入当前公网地址，更新 Connector 配置并生成一次性配对或恢复二维码。

Quick 模式由当前终端的 supervisor 管理。按 `Ctrl+C` 或关闭终端会停止 Hub 和 Tunnel，但数据库、`hubId`、Owner、Node 身份与手机缓存不会被删除。下次启动会产生新地址，因此手机需要扫描新的恢复二维码。

## 4. 深度配置

选择 **深度配置**，输入根域名和公开主机名；默认主机名为 `dsh.<根域名>`。

引导页按以下阶段执行：

1. 提示注册或登录 Cloudflare，并将域名加入 Free 套餐；
2. 记录 Cloudflare 分配的两条 Nameserver；
3. 指导用户在域名注册商处修改 Nameserver；
4. 通过公共 DNS 轮询，只有两条 NS 精确生效后才继续；
5. 执行官方 `cloudflared tunnel login`，由浏览器完成 Cloudflare 授权；
6. 创建 `dsh-easyremote-<installId>` Named Tunnel；
7. 创建固定主机名的 DNS 路由，写入显式配置与凭据路径；
8. 验证 HTTPS、WebSocket 与 `/v1/meta`；
9. 安装当前用户登录后自启的 Hub + Tunnel 服务。

Nameserver 修改完全在注册商网站完成。引导程序不读取账号密码；DNS 激活可能持续数分钟到数小时，可以安全退出后继续。

Cloudflare 文件位于 `~/.dsh-easyremote/cloudflared/`。官方授权证书仍遵循 `cloudflared tunnel login` 的标准位置：程序会验证并复用已有证书，但不会自动覆盖或删除不可用证书。

## 5. Quick 升级为 Named

重新执行：

```bash
dsh-easyremote setup
```

选择深度配置即可。升级复用 SQLite 数据库、`hubId`、Owner、Node Secret 和 Connector Install ID，只替换公网入口并轮换手机恢复凭据。完成后扫描恢复二维码，不需要重新创建 DSH Node。

## 6. Connector 与手机

安装器会打包随 npm 包提供的 Connector，并调用 DSH CLI 安装到 `web` profile。Connector 配置位于 `~/.dsh-easyremote/connector.json`：

```json
{
  "schemaVersion": 1,
  "hubUrl": "http://127.0.0.1:8787",
  "publicOrigin": "https://your-current-hub.example",
  "nodeName": "Optional computer name",
  "defaultCwd": "/optional/workspace"
}
```

Connector 始终通过回环地址直连本机 Hub，避免电脑端请求绕经 Cloudflare 后再回到本机。`publicOrigin` 只用于检测公网入口变化并轮换手机恢复二维码；它变化时不会改变 Node Secret 或 Install ID。环境变量仍作为兼容回退。

从引导页扫码下载并安装 Community APK。Tunnel 与 Connector 就绪后，引导页会自动显示第二个、用于连接手机的一次性二维码。首次扫描 Hub 二维码时，Community APK 会显示域名确认；一个 App 同时只绑定一个 Hub。更换无关 Hub 必须退出登录，合法恢复二维码只能重绑同一个 `hubId`。

DSH Web 重启后会在 **Settings → Remote** 自动装载连接状态。已连接用户可选择 **Generate connection QR**；二维码显示期间可选择 **Refresh connection QR**。每次生成新码时，Hub 会立即让同一 Node 的旧待用二维码过期。

## 7. 自启实现

- macOS：用户目录下的 LaunchAgent；
- Linux：`systemd --user` 服务；
- Windows：当前用户 Task Scheduler 任务。

三种方式都不需要 sudo 或管理员权限，只在用户登录后运行。电脑关机、休眠、用户未登录或网络中断时，手机会显示离线缓存。

## 8. 管理命令

```bash
dsh-easyremote status
dsh-easyremote doctor
dsh-easyremote stop
dsh-easyremote start
dsh-easyremote backup
dsh-easyremote restore <backup-file>
dsh-easyremote upgrade
dsh-easyremote uninstall
```

`doctor` 检查 Node.js、cloudflared 校验值、回环监听、DNS NS、Tunnel、HTTPS/WebSocket、Connector、Hub 元数据和自启状态。`upgrade` 会先创建数据库备份。

卸载默认保留数据库与 Cloudflare Tunnel/DNS。删除外部 Cloudflare 资源必须由用户明确选择并二次确认；安装器不会默认执行。

高级用户如需使用容器，只可将 Hub 端口发布到宿主机 `127.0.0.1`，再让本机 `cloudflared` 代理该地址。此方式不进入引导流程。
