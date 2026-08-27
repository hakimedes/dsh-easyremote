<div align="center">

# DSH EasyRemote

### A local-first Android remote workspace that is ready out of the box

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
[![Status](https://img.shields.io/badge/Status-Pre--release-8b5cf6.svg)](#project-status)
[![GitHub stars](https://img.shields.io/github/stars/hakimedes/dsh-easyremote?style=flat&logo=github)](https://github.com/hakimedes/dsh-easyremote/stargazers)

🌐 [中文](README.md) · **English**

</div>

DSH EasyRemote lets you securely use DeepSeek Harness running on your own computer from an Android phone. The Hub always listens on `127.0.0.1`; Cloudflare Tunnel provides the public HTTPS/WSS path.

> DSH EasyRemote is an independent community project. It is not affiliated with or endorsed by DeepSeek. Licensed under MIT.

## Project status

The project is currently in public preview. The public npm package `0.2.1` and long-term-signed Community APK `0.2.0` are available now. Launch setup with `npx` or download Android assets from [GitHub Releases](https://github.com/hakimedes/dsh-easyremote/releases). Additional physical-device and cross-platform regression testing will continue.

## Quick start without a domain

Install Node.js 22.19 or newer, then run:

```bash
npx @hakimedes/dsh-easyremote
```

The first run opens a setup wizard that is available only on localhost:

- **Quick Start** downloads and verifies `cloudflared`, then starts the local Hub with a temporary Quick Tunnel. No account or domain is required. A new `trycloudflare.com` address is generated after every restart, so the phone must scan a fresh recovery QR.
- **Deep Configuration** reuses the same Hub, database, and device identities while configuring your domain, a Cloudflare Named Tunnel, and a current-user login service.

The wizard follows a single sequence: download the APK, establish the Hub connection, then scan the live pairing QR. When exactly one authorized Android device is connected through ADB, the APK can be installed directly. Later, **Settings → Remote** in DSH Web can generate or refresh a one-time connection QR; issuing a new QR immediately expires the previous one.

## Fixed-domain mode

Deep Configuration requires:

1. a domain whose Nameservers can be changed;
2. a free Cloudflare account;
3. the domain added to Cloudflare Free and delegated to the two assigned Cloudflare Nameservers.

The wizard verifies the exact public NS records, opens the official `cloudflared tunnel login` authorization, creates the Named Tunnel and DNS route, then registers a user-level login service. It never asks for Cloudflare or registrar passwords, sudo/admin access, or SSH credentials.

PP.UA and EU.org may provide free domains, but can involve phone activation, public registration details, or manual review. Their rules may change. DuckDNS and No-IP usually do not let users replace Nameservers and are therefore not compatible with this setup path.

See the [local deployment guide](docs/DEPLOYMENT.md) for the full flow.

## Commands

```bash
dsh-easyremote setup
dsh-easyremote quick
dsh-easyremote start
dsh-easyremote stop
dsh-easyremote status
dsh-easyremote doctor
dsh-easyremote backup
dsh-easyremote restore <backup-directory>
dsh-easyremote upgrade
dsh-easyremote uninstall
```

Running the command without arguments is the smart entry point: it opens setup before configuration, creates a new temporary endpoint in Quick mode, or ensures the local service is online and opens the control page in Named mode.

## Architecture

```text
Android Community APK
        │ HTTPS / WSS
        ▼
Cloudflare Quick or Named Tunnel
        │ forwards only to 127.0.0.1
        ▼
Local EasyRemote Hub ── WSS ── Connector ── DeepSeek Harness
```

- The Hub does not expose a LAN or public listening socket.
- Connector and Mobile establish outbound connections only.
- A public-origin change preserves `hubId`, Node Secret, and Install ID.
- The Hub stores identity, session indexes, and idempotency metadata, not complete chat transcripts.
- Stopping Quick mode removes the temporary public path while preserving the database and offline cache.
- Named mode runs only after the current user logs in. The phone is offline when the computer sleeps, shuts down, or loses connectivity.

Read the [privacy model](docs/PRIVACY.md) and [threat model](docs/THREAT_MODEL.md) for trust boundaries and stored-data details.

## Android builds

GitHub Releases provide the independently signed Community APK, SHA-256 checksums, and release notes. Community builds can connect to any HTTPS Hub explicitly confirmed by the user. Internal builds remain separate with an independent application ID and signature, so both variants can be installed side by side.

Always verify the downloaded APK against `SHA256SUMS`. Version 1 does not include an iOS App Store build.

## Development

```bash
pnpm install --frozen-lockfile
pnpm test
pnpm typecheck
pnpm build
pnpm pack:community
```

Workspace packages:

- `apps/easyremote`: npm CLI, setup/control UI, Tunnel supervision, autostart, diagnostics, backup, and restore;
- `apps/hub`: local Fastify and SQLite Hub;
- `apps/dsh-plugin`: outbound Connector;
- `apps/mobile`: React Native and Expo Android client;
- `apps/fake-plugin`: protocol integration fixture.

Read [CONTRIBUTING.md](CONTRIBUTING.md) before contributing. Report vulnerabilities privately according to [SECURITY.md](SECURITY.md). Backup and troubleshooting references are available in [BACKUP-RESTORE.md](docs/BACKUP-RESTORE.md) and [TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md).
