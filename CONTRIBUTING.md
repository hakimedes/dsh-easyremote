# Contributing

Thank you for improving DSH EasyRemote. This is an independent community project; please avoid wording or assets that imply official DeepSeek endorsement.

## Development

Requirements: Node.js 22.19+, pnpm 9.12, and platform SDKs only for native Android work.

```bash
pnpm install --frozen-lockfile
pnpm test
pnpm build
```

Keep changes focused and include tests for observable behavior. Installer changes must preserve these invariants: Hub listens on loopback, no sudo/SSH flow, no lifecycle install scripts, Cloudflare credentials stay out of the Hub database, and Quick-to-Named upgrades retain `hubId` and device identity.

Before opening a pull request, run `pnpm pack:community`, inspect the tarball contents, and confirm no databases, credentials, logs, APK signing keys or personal paths are included. UI changes should also be tested in dark/light modes, large text, TalkBack and Android Reduce Motion.

Use Conventional Commit-style subjects where practical. By contributing, you agree that your contribution is licensed under MIT.
