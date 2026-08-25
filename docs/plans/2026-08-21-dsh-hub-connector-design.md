# DSH Hub Connector design

## Decision

Implement `@dsh-remote/hub-connector` as a DeepSeek Harness host plugin. The
plugin opens one outbound WebSocket to the configured Hub and translates the
versioned Remote Protocol into DSH process-local services. It does not expose a
new inbound control port and does not proxy DSH's internal HTTP or WebSocket
API.

The alternatives were a separate sidecar and the existing direct-tunnel
prototype. A sidecar cannot safely own live `agents`, `sessionQuery`, and
`approval/request` capabilities. The tunnel prototype makes a bearer URL the
control boundary and bypasses Hub ownership, audit, revocation, and protocol
versioning. Both conflict with the P0 spec.

## Components and data flow

The connector owns a local identity file under
`$DSH_HOME/remote-hub/node-identity.json`. It contains a stable install ID, a
random 256-bit Node secret, and—after claim—the Hub Node ID. The directory and
file use owner-only permissions. A fresh plugin asks Hub for a five-minute,
one-use pairing payload and exposes it as a QR page inside the existing DSH Web
server. The phone claims that payload. The plugin polls with the separate poll
token, persists the returned Node ID, then replaces pairing traffic with an
authenticated outbound Node WebSocket.

Hub commands are adapted to DSH services:

- `session.list` and `session.snapshot` read `sessionQuery`.
- `session.create` calls `agents.create` and retains the returned owner handle.
- `session.followup` and `session.steer` resume a persisted session when needed,
  then call the corresponding live Agent method with a plugin-attributed user
  message.
- `session.stop` calls `agent.cancel({ kind: "user" })`.
- `approval.respond` settles a pending `approval/request` waterfall listener.

`session/event` is translated from DSH slash names into the canonical dotted
Remote Protocol names while preserving DSH's native zero-based `event.seq` as
`sourceSeq`. Tool arguments/results become Mobile tool-card fields; no raw DSH
API object is exposed as a transport contract.

## Failure handling and security

The connector sends heartbeats every 15 seconds and reconnects with bounded
exponential backoff. A revoked or missing Node identity clears only the Hub
Node ID and starts a new one-time pairing; the local install ID and Node secret
remain stable. Pending local approvals are replayed after a Hub reconnect and
are cancelled when DSH aborts the owning turn. When the Hub is unavailable,
local DSH remains usable and no command is accepted through another path.

Commands are rejected after `expiresAt`, acknowledged before execution, and
completed with a structured result or fixed error code. Hub owns write
idempotency by `(user_id, request_id)`; the plugin additionally keeps a bounded
in-memory result cache so a duplicated command frame cannot execute twice in
one plugin lifetime.

The pairing QR is served only through the already-running DSH Web server. The
Node secret and poll token are never returned by that route or written to logs.
The QR contains only Hub URL plus one-use pair token.

## Verification

Pure tests cover DSH-to-canonical event mapping, including native sequence zero.
Protocol tests cover duplicate command result replay. Workspace verification
builds the plugin, packs the installable tarball, runs Hub integration tests and
the full REST/WebSocket smoke flow, then rebuilds and inspects the Android APK.
