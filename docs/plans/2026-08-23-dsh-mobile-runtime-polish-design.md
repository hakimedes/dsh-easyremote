# DSH Mobile runtime polish design

## Outcome

DSH Mobile keeps the current black-whale identity while fixing the complete
runtime path for agent presets, model selection, session naming, and streamed
assistant output. App startup becomes a branded transition instead of exposing
the network/bootstrap delay.

## Runtime contracts

- A node hello refreshes the persisted Connector and DSH versions. The live
  connection remains the source of truth for capabilities.
- Hub continues to expose the existing preset and model routes and adds one
  idempotent session rename route. Connector forwards rename through DSH's
  native `sessions.rename` API.
- DSH `session/title` events become canonical `session.title` events. Hub
  updates its session index and broadcasts the event; Mobile updates both the
  open session and history rows. Native automatic titles therefore appear
  after the first turn, while an explicit user rename pins the DSH title.
- Assistant deltas update one in-progress message. The final assistant message
  settles that same message instead of appending a duplicate. Large upstream
  chunks are visually revealed with an adaptive catch-up animation without
  changing stored text or transport ordering.

## Mobile experience

- The conversation header exposes a compact edit action. Rename uses a focused
  sheet with validation, pending state, and server-confirmed commit.
- Model and reasoning controls remain a single atomic selection. Errors retain
  the server's actionable code/message instead of becoming an unexplained
  local state change.
- The startup scene is "Abyssal Signal": restrained sonar rings and particles
  converge on the existing black whale, a tail-sweep reveals the line
  “探索未至之境”, and the scene dissolves into Home. It runs in the current
  light/dark palette, has a bounded minimum duration, and honors Reduce Motion.

## Verification seams

- Connector bridge/protocol unit tests: rename request and title/delta mapping.
- Hub HTTP/WebSocket integration: hello metadata refresh, rename forwarding,
  title index update, and model routes.
- Mobile domain/store tests: title propagation and assistant final-message
  settlement; API tests cover rename.
- Release APK ADB regression: startup animation, preset creation, model plus
  reasoning selection, rename, and visible incremental assistant output.
