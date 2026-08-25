# Security Policy

## Supported versions

Security fixes are provided for the latest GitHub Release. Upgrade the npm CLI, Connector and Community APK together when a release note marks a protocol or credential change.

## Reporting a vulnerability

Please do not open a public issue for a suspected vulnerability. Use GitHub's private security advisory form for `hakimedes/dsh-easyremote` and include the affected version, reproduction steps, impact and any suggested mitigation. Do not include real Pair Tokens, Refresh Tokens, Node Secrets, Tunnel credentials, databases or Cloudflare certificates.

We will acknowledge a report as soon as practical, validate the impact, coordinate a fix and publish a disclosure after users have had a reasonable upgrade window.

## Security expectations

- Only install APKs and npm packages from the project's official Releases/npm scope and verify published SHA-256 values.
- Never publish `~/.dsh-easyremote`, `~/.cloudflared/cert.pem`, Hub databases, signing keys or `.env` files.
- The setup UI must remain bound to `127.0.0.1`; do not expose it through the Tunnel.
- Revoked or lost phones should be removed from Mobile's Nodes page, then credentials should be rotated.
