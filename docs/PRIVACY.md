# Privacy Model

DSH EasyRemote is designed for one Owner operating personal Nodes through a self-hosted Hub.

## Stored on the computer

- Hub identity, Owner/device records, Node metadata and session indexes;
- command IDs and the minimum result needed for idempotency, subject to retention cleanup;
- SQLite schema migrations and operational metadata;
- Cloudflare Tunnel configuration and credentials in a separate restricted directory;
- Connector identity and the current public Hub URL.
- the current one-time pairing handoff in `~/.dsh-easyremote/pairing.json`, readable only by the current user and ignored after its five-minute expiry.

The Hub does not intentionally persist complete chat transcripts. Session snapshots are relayed from DSH and cached by Mobile for offline display; tool output and model content remain subject to DSH's own local storage behavior.

## Stored on Android

The Community app stores the confirmed server origin, `hubId` and rotating Refresh Token in platform SecureStore. Access Tokens remain short-lived. A limited recent snapshot may be cached for offline reading.

## Third parties

Cloudflare carries encrypted HTTPS/WSS traffic between Mobile and the local Hub. Quick Tunnel uses a temporary Cloudflare hostname; Named Tunnel uses the owner's domain. DSH EasyRemote itself does not provide a hosted relay, analytics account, advertising SDK or team data service.

Backups can contain identity and session metadata. Treat them as secrets and never attach them to issues.
