# Pairing onboarding and QR refresh design

## Goal

Make first-time setup a single ordered journey: download the Community APK, establish the local Hub/Tunnel connection, then scan a live phone-pairing QR. Keep later recovery inside DSH Web Settings.

## Data flow

The Connector remains the authority that requests Pair and Recovery Tokens from Hub. Whenever its connection or QR state changes, it atomically publishes a short-lived `pairing.json` handoff next to `connector.json`, with owner-only permissions. The localhost wizard validates this file, rejects expired or malformed payloads, converts the live payload to SVG server-side, and exposes only the rendered QR through its authenticated loopback session.

The wizard never reads Node Secret, Refresh Token, Cloudflare credentials, or DSH session content. The handoff is excluded from backups and becomes unusable after five minutes even if a process exits before replacing the file.

## User experience

The setup page presents three numbered stages:

1. download or ADB-install the Community APK;
2. choose Quick Start or finish Named Tunnel configuration;
3. scan the automatically detected connection QR.

If DSH Web was already running when the Connector was installed, stage three explains that one restart is required and continues polling automatically.

DSH Web registers a `Settings → Remote` section through the Connector browser module. Connected users can generate a new recovery QR and refresh it while visible. The standalone pairing page provides the same fallback controls.

## Rotation semantics

Creating a new initial pairing expires earlier pending pairings for the same Connector Install ID. Creating a recovery pairing expires earlier pending recovery pairings for the same Node. Therefore only the most recently displayed QR remains usable.

## Verification

- Wizard tests assert APK-before-pairing order and ensure raw QR payloads are not returned by the loopback API.
- Hub integration tests assert that a replaced token returns `PAIR_TOKEN_EXPIRED`.
- Connector E2E covers pairing handoff publication, settings/standalone refresh, stale-token rejection, and successful claim of the latest QR.
- Full TypeScript, unit, build, and npm package checks remain required before release.
