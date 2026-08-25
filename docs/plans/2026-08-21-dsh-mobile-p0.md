# DSH Mobile P0 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build the first React Native + Expo Development Build client for pairing a local DSH node and remotely continuing its sessions from a phone.

**Architecture:** Add a standalone `apps/mobile` Expo Router app. Keep access tokens in memory and the refresh token in SecureStore; keep normalized node/session metadata and `lastSourceSeq` in SQLite. A small API client owns refresh-token rotation and UUIDv7 request IDs, while a reconnecting realtime client owns subscriptions, 33–50ms event batching, source-sequence deduplication, and replay/snapshot fallback. Screens consume a Zustand store and expose the P0 flow: onboarding/QR scan, Home, Session Detail, Nodes, Settings, and a global Approval modal.

**Tech Stack:** React Native, Expo Development Build, Expo Router, TypeScript, TanStack Query, Zustand, expo-secure-store, expo-local-authentication, expo-sqlite, expo-camera, expo-haptics, React Native Gesture Handler/Reanimated.

---

### Task 1: Scaffold the Mobile app and runtime configuration

**Files:**
- Create: `apps/mobile/package.json`
- Create: `apps/mobile/app.json`
- Create: `apps/mobile/tsconfig.json`
- Create: `apps/mobile/babel.config.js`
- Create: `apps/mobile/index.js`
- Create: `apps/mobile/src/config.ts`

**Step 1:** Add Expo Router scripts and the P0 runtime dependencies.

**Step 2:** Configure the `dshremote` deep-link scheme, iOS/Android camera permission strings, and the production Hub defaults.

**Step 3:** Add strict TypeScript configuration and a small config module that normalizes HTTP/WSS endpoints.

**Step 4:** Run `pnpm --filter @dsh/mobile typecheck` after dependencies are installed.

### Task 2: Implement the protocol, QR, storage, and API layers

**Files:**
- Create: `apps/mobile/src/domain/types.ts`
- Create: `apps/mobile/src/domain/ids.ts`
- Create: `apps/mobile/src/domain/qr.ts`
- Create: `apps/mobile/src/storage/secure.ts`
- Create: `apps/mobile/src/storage/database.ts`
- Create: `apps/mobile/src/api/client.ts`
- Create: `apps/mobile/src/api/realtime.ts`
- Test: `apps/mobile/src/domain/qr.test.ts`
- Test: `apps/mobile/src/domain/ids.test.ts`

**Step 1:** Write tests for strict QR validation and UUIDv7 request IDs.

**Step 2:** Implement parsing for `dshremote://pair?server=...&token=...`, allowing only HTTPS production Hub URLs by default and never logging raw QR contents.

**Step 3:** Implement SecureStore refresh-token persistence, SQLite schema/init helpers, and normalized cache records.

**Step 4:** Implement the REST client for claim, refresh rotation, `/me`, nodes, sessions, snapshots, follow-up/steer/stop, approvals, with single-flight refresh and request-id reuse.

**Step 5:** Implement foreground realtime connection/reconnection, subscribe/sync frames, event dedupe, output batching, and `snapshot.required` fallback.

### Task 3: Build state and P0 navigation

**Files:**
- Create: `apps/mobile/src/state/app-store.ts`
- Create: `apps/mobile/src/state/session-reducer.ts`
- Create: `apps/mobile/src/hooks/use-app-bootstrap.ts`
- Create: `apps/mobile/app/_layout.tsx`
- Create: `apps/mobile/app/index.tsx`
- Create: `apps/mobile/app/scan.tsx`
- Create: `apps/mobile/app/pairing-success.tsx`
- Create: `apps/mobile/app/home.tsx`
- Create: `apps/mobile/app/sessions.tsx`
- Create: `apps/mobile/app/nodes.tsx`
- Create: `apps/mobile/app/settings.tsx`
- Create: `apps/mobile/app/session/[sessionId].tsx`

**Step 1:** Add bootstrap logic that restores refresh-token-backed identity, loads cache first, reconnects on foreground, and preserves the intended onboarding state when no token exists.

**Step 2:** Wire Expo Router routes to the required Root → Onboarding/Scan, Home, Sessions, Session Detail, Nodes, Settings hierarchy.

**Step 3:** Add Home priority ordering: running session, recent sessions, then node management; show distinct PC-offline and cloud-unreachable states.

### Task 4: Implement the mobile UI and remote controls

**Files:**
- Create: `apps/mobile/src/ui/theme.ts`
- Create: `apps/mobile/src/ui/primitives.tsx`
- Create: `apps/mobile/src/ui/session-components.tsx`
- Create: `apps/mobile/src/ui/approval-sheet.tsx`
- Modify: `apps/mobile/app/*.tsx`

**Step 1:** Implement the quiet editorial dark/light system UI with safe-area spacing, Dynamic Type-compatible sizing, accessible labels, haptics, and native touch targets.

**Step 2:** Implement QR scanning, pairing success, node/session cards, chat-first session detail, card-based tool events, composer, steer mode, stop state, and `↓ New output` affordance.

**Step 3:** Add global Approval modal with `allow_once`/`deny` only; require LocalAuthentication before allowing once.

### Task 5: Verify and document the P0 app

**Files:**
- Modify: `README.md`
- Create: `apps/mobile/README.md`

**Step 1:** Run focused domain tests and mobile typecheck.

**Step 2:** Run Hub tests and root build to ensure the new workspace package does not regress existing packages.

**Step 3:** Verify the Expo app configuration and review the P0 acceptance path against the fake-plugin flow.

