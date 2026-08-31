# Threat Model

## Assets

Primary assets are Hub/Owner identity, Node Secret, Mobile Refresh Token, one-time pairing and recovery tokens, Cloudflare Tunnel credentials, local DSH access and cached session metadata.

## Trust boundaries

- The setup UI is trusted only from the same computer and is bound to `127.0.0.1`.
- Cloudflare terminates the public TLS connection and forwards traffic through an outbound tunnel.
- Hub authenticates Mobile and Connector separately; neither public hostname knowledge nor `hubId` alone grants access.
- DSH remains the authority for sessions and model actions.

## Main threats and mitigations

| Threat | Mitigation |
| --- | --- |
| Remote access to setup UI | Loopback-only listener, random bootstrap token, HttpOnly session cookie, Origin/Host checks and CSRF token. |
| Replay of pairing or setup actions | Short-lived one-time Pair/Recovery Tokens, immediate invalidation when a replacement QR is generated, and one-time wizard operation IDs. The local handoff file is owner-readable only and is not included in backups. |
| Hub substitution | Community app asks the user to confirm HTTPS origin and pins the returned stable `hubId`; mismatches are rejected. |
| Secret disclosure in source/releases | Restricted credential paths, package file allowlist, secret scanning and tarball audit. |
| Local Cloudflare config collision | Installer always supplies its own config, credential and log paths. |
| Native dependency supply-chain risk | Pinned cloudflared version and platform SHA-256 verification before execution. |
| Stolen phone | SecureStore tokens, token rotation and explicit Node/mobile revocation. |
| Exposed Hub port | Native Hub binds `127.0.0.1`; optional Docker example publishes only to host loopback. |
| Upload path traversal or symlink escape | Hub accepts only sequential bounded chunks; Connector validates spool realpaths, regular files, sizes and SHA-256 before atomically copying to a fixed workspace directory without overwriting existing files. |
| Malicious model-generated UI | Raw HTML and model JavaScript are disabled; the native renderer uses a bounded white list, while complex visuals run in a no-network/no-file CSP WebView with sanitized options. Password, token, secret and API-key fields are blocked. |
| Attachment identifier theft | Mobile download routes require the authenticated Owner and Node/session authorization; Connector reads through DSH's authoritative attachment service and exports one-time spool files. |

## Out of scope for v1

The system does not implement multi-tenant hosting, team sharing, RBAC, shared Nodes, SSH deployment or high availability. A fully compromised user computer, Android OS or Cloudflare account can compromise the corresponding installation.
