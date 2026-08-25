# DSH Mobile

React Native + Expo Development Build client for DSH Remote P0.

## Run locally

From the repository root:

```bash
pnpm install
pnpm --filter @dsh/mobile start
```

Build a native development client with:

```bash
pnpm --filter @dsh/mobile ios
pnpm --filter @dsh/mobile android
```

The app defaults to `https://dsh.infomind.cc`. For a local Hub, set:

```bash
EXPO_PUBLIC_HUB_URL=http://localhost:8787
EXPO_PUBLIC_ALLOW_LOCAL_HUB=true
```

Pairing links are intentionally strict: production accepts only `dshremote://pair` links that point to the production HTTPS Hub, and the QR payload is never logged.

## P0 surface

- QR pairing for first owner and subsequent nodes
- in-memory access token + SecureStore refresh rotation
- SQLite normalized cache and source sequence checkpointing
- Home, Sessions, Session Detail, Nodes, Settings
- follow-up, steer, stop, tool cards, approval sheet with biometric allow-once
- foreground reconnect, event batching, dedupe, replay and snapshot fallback
