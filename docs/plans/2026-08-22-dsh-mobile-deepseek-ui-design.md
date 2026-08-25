# DSH Mobile DeepSeek UI Design

## Direction

DSH Mobile will use the visual grammar of the official DeepSeek mobile app without pretending to be the chat product. The interface becomes quiet, bright, and task-first: white or near-white canvases, compact soft-gray surfaces, one DeepSeek blue action color, restrained borders, and generous but practical spacing. Decorative editorial typography and the green/coral palette are removed. The product remains a remote control for DeepSeek Harness, so running sessions, machine availability, approvals, and the composer stay more prominent than ornamental branding.

The official black whale mark from the locally installed `@deepseek-ai/dsh-web-frontend` package becomes the single brand asset. It appears in the launcher icon, splash screen, onboarding, compact header branding, pairing success, and empty states. The mark remains black on a white tile in both light and dark modes so the requested black-whale identity is never recolored or distorted. The wordmark reads `deepseek HARNESS` with `REMOTE` as a product qualifier.

## Screen system

- Onboarding mirrors DeepSeek's calm new-chat welcome: centered whale, short headline, supporting copy, and one blue QR action.
- Home prioritizes the live session, then recent sessions, then nodes, matching the P0 priority order.
- Sessions and Nodes become compact list cards with truncation and flex behavior that prevents long Chinese titles, paths, and machine names from overflowing.
- Session detail is chat-first. Assistant content sits directly on the canvas, user content uses a pale-blue bubble, tool events use compact neutral cards, and the composer resembles DeepSeek's rounded message field.
- Scan, pairing success, settings, errors, offline states, and approval sheets reuse the same semantic tokens and control shapes.
- Bottom navigation is a stable native-style bar with line icons rather than text glyphs.

## Quality and verification

The redesign preserves system light/dark mode, Dynamic Type, safe areas, TalkBack labels, disabled/offline behavior, and all P0 flows. Brand asset configuration receives an automated integration test. TypeScript, the existing test suite, a release APK build, and screenshots from the connected Android phone provide the completion gate.

