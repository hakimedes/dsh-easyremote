<div align="center">

# DSH EasyRemote

### Bring the AI workflows on your computer securely to Android

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

[🚀 Start in three steps](#start-in-three-steps) · [⬇️ Download Android APK](https://github.com/hakimedes/dsh-easyremote/releases/latest/download/DSH-EasyRemote-Community.apk) · [📖 Deployment guide](docs/DEPLOYMENT.md) · [🛠️ Troubleshooting](docs/TROUBLESHOOTING.md)

🌐 [中文](README.md) · **English**

</div>

DSH EasyRemote is a local-first Android remote workspace. The Hub and Connector run on your own computer, while the phone connects securely through Cloudflare Tunnel. No router port forwarding or cloud-hosted Hub is required.

> [!IMPORTANT]
> DSH EasyRemote is an independent community project. It is not affiliated with or endorsed by DeepSeek. It is licensed under the [MIT License](LICENSE) and is currently in public preview.

## What you can do

| Capability | Mobile experience |
| --- | --- |
| Remote conversations | View the latest conversation and full history, create sessions, stream replies, and handle running states and approvals |
| Modes and models | Choose an Agent mode for a new session; switch models and reasoning effort when supported by the connected Node |
| Files and images | Take or select images, upload files in chunks, and type `@` to search and reference workspace files |
| Rich content and GenUI | Safely render Markdown, code, tables, images, forms, statistics, basic charts, and guarded `dsh-ui` visualizations |
| Two connection paths | Use a temporary Quick Tunnel without a domain or a stable Named Tunnel on your own domain |
| Local first | The Hub listens only on `127.0.0.1`; there is no hosted relay, full transcript store, or persistent Hub copy of uploaded file bytes |

Ordinary files are saved under `.dsh-easyremote/uploads/<sessionId>/` in the current workspace; images use DSH durable attachments. Workspace search returns paths without reading file contents. See the [privacy model](docs/PRIVACY.md) and [threat model](docs/THREAT_MODEL.md) for details.

## Start in three steps

Prepare:

- Node.js 22.19 or newer;
- a working DeepSeek Harness Web installation;
- an Android 7.0 or newer phone.

### 1. Open the local setup wizard

```bash
npx @hakimedes/dsh-easyremote@latest
```

The package has no `postinstall` script. The wizard listens only on `127.0.0.1` and protects the session with a random bootstrap token and CSRF validation.

### 2. Download the APK and choose a connection path

The wizard first displays the **Community APK download QR**. You can also [download the latest APK directly](https://github.com/hakimedes/dsh-easyremote/releases/latest/download/DSH-EasyRemote-Community.apk), then return to the wizard to continue connection setup.

Then choose:

- **Quick Start**: no account or domain; starts a temporary Cloudflare Quick Tunnel automatically;
- **Deep Configuration**: uses your own domain and Cloudflare account to create a stable local Named Tunnel.

### 3. Scan the connection QR

Only after the Connector and Tunnel are ready does the wizard display the second QR—the **phone connection QR**. If prompted after the first Connector installation, restart DSH Web once, then scan this QR from the APK.

To reconnect later, use **Settings → Remote** in DSH Web to generate or refresh a one-time QR. Issuing a new QR immediately expires the previous one.

> [!TIP]
> The APK download QR installs the app. The connection QR binds the app to this Hub. They are different QRs.

## Quick Start vs Deep Configuration

| | Quick Start | Deep Configuration |
| --- | --- | --- |
| Cloudflare account | Not required | Free account required |
| Your own domain | Not required | A domain with editable Nameservers is required |
| Public endpoint | Temporary `*.trycloudflare.com`; changes after restart | Stable HTTPS hostname |
| Runtime | Managed by the current foreground terminal | Starts after the current user logs in |
| Data and identity | Persist locally | Reuses the same database, `hubId`, and Node identity |
| Best for | First use and temporary access | Stable everyday access |

Closing the Quick Start terminal stops the Hub and Tunnel but preserves the database, device identity, and phone cache. Deep Configuration performs Cloudflare browser authorization on the same computer. It never asks for Cloudflare or registrar passwords, sudo/admin access, SSH, or a cloud server.

See the [local deployment guide](docs/DEPLOYMENT.md) for Nameserver setup, lossless Quick → Named upgrades, and user-login autostart details.

## Android download

- [Download the latest Community APK](https://github.com/hakimedes/dsh-easyremote/releases/latest/download/DSH-EasyRemote-Community.apk)
- [Download SHA-256 checksums](https://github.com/hakimedes/dsh-easyremote/releases/latest/download/SHA256SUMS)
- [View all releases and release notes](https://github.com/hakimedes/dsh-easyremote/releases)

The APK is not embedded in the npm package; the wizard presents its GitHub Release download QR. The Community APK uses a separate long-term signing key and can connect to any HTTPS Hub explicitly confirmed by the user. Android is currently the only published mobile build; there is no iOS App Store release yet.

## Architecture

```text
Android Community APK
        │ HTTPS / WSS
        ▼
Cloudflare Quick or Named Tunnel
        │ forwards only to 127.0.0.1
        ▼
Local EasyRemote Hub ── WSS ── DSH Connector ── DeepSeek Harness
```

- The Hub exposes no LAN or public listening socket; Mobile and Connector use separate identities and tokens.
- Quick endpoint changes and upgrades to a fixed hostname preserve `hubId`, Node Secret, and Install ID.
- The Hub stores identities, session indexes, upload state, and minimum idempotency metadata—not complete chat transcripts.
- Upload bytes pass through a restricted temporary spool and are deleted after Connector consumption; ordinary files are then managed by the user's workspace.
- Complex GenUI runs in a restricted WebView without network or file access. Raw HTML, model JavaScript, and sensitive form fields are rejected.

## Management commands

There is no need for a global install when using `npx`; invoke the latest CLI for each operation:

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

The no-argument command is the smart entry point: before configuration or in Quick mode it opens the local setup/control page; in Named mode it ensures the service is running and opens the control page. Installation state and local data live under `~/.dsh-easyremote/` by default.

## Common problems

Start with:

```bash
npx @hakimedes/dsh-easyremote@latest status
npx @hakimedes/dsh-easyremote@latest doctor
```

| Symptom | Action |
| --- | --- |
| The setup page has no connection QR | Restart DSH Web once after the first Connector installation; the page keeps polling pairing state |
| DSH Web says Hub unreachable | Confirm that the local Hub is running and use `doctor` to inspect the Connector `hubUrl` |
| The phone says the QR expired | Generate a new connection QR from **Settings → Remote** |
| Quick Tunnel cannot connect | Check outbound HTTPS/QUIC access, then inspect the cloudflared log and troubleshooting guide |
| Fixed-domain setup keeps waiting for NS | Check registrar Nameservers and stale DNSSEC/DS records; propagation can take hours |

See [Troubleshooting](docs/TROUBLESHOOTING.md) for more. Never post `install.json`, databases, `cert.pem`, Tunnel credentials, pairing tokens, or complete logs containing tokens in a public issue.

## Development

```bash
pnpm install --frozen-lockfile
pnpm test
pnpm typecheck
pnpm build
pnpm pack:community
```

Workspace packages:

- `apps/easyremote`: npm CLI, setup UI, Tunnel management, autostart, diagnostics, backup, and restore;
- `apps/hub`: local Fastify and SQLite Hub;
- `apps/dsh-plugin`: DSH Connector;
- `apps/mobile`: React Native and Expo Android client;
- `apps/fake-plugin`: protocol integration fixture.

Read [CONTRIBUTING.md](CONTRIBUTING.md) before contributing. Report vulnerabilities privately according to [SECURITY.md](SECURITY.md). See [BACKUP-RESTORE.md](docs/BACKUP-RESTORE.md) for backup and recovery.
