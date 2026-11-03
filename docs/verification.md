# Verification record

## Automated

- 22 tests pass: scoring, corrected mistakes, Unicode composition adapter, replay/PB selection, import, all language/topic/length samples, custom passage limits, target opponent positions, historical WPM samples, stale response protection, bounded passage cache and mocked Gemini rotation/429 handling.
- TypeScript check passes.
- ESLint passes with zero warnings.
- Production build passes on Node 24 / Next.js 15.5.28 using an isolated `.next-check` output directory.
- `npm audit --omit=dev` reports zero production dependency vulnerabilities after a compatible PostCSS override. Development-only advisory findings are not included in that claim.

## Browser

- Chrome: complete English sample by real sequential key input → 227/227, 100% accuracy → persisted result → retry loads the eligible Ghost.
- Custom passage modal accepts a valid 160-character passage, loads it into the engine and labels it as personal content.
- Retry during a running attempt asks for confirmation; cancel preserves input and confirm resets the attempt.
- Settings modal and tabs inspected; local history remains available.
- Mobile viewport 390px: no horizontal overflow; stacked panels and controls remain visible. Target Ghost appears without a PB and remains functional with reduced-motion emulation.
- Browser error log is empty after these flows.

## Limits

- Mocked provider tests exercise the installed Google SDK but do not certify live Google credentials or Redis connectivity.
- Physical Telex/VNI, screen readers and device frame-time profiling require separate checks; no universal FPS or complete WCAG conformance claim is made.
- Live deployment checks are recorded after release.

## Production verification — 04/11/2026 (Asia/Saigon)

- Public page serves at https://auratype.vercel.app without a sign-in gate.
- Production Redis connectivity is verified through GET /api/generate and real generation reservations.
- The UI successfully generated and saved a 246-character Vietnamese passage through the configured Gemini API. The source changed to AI GENERATED and the remaining cooldown appeared.
- A follow-up API request returned fromCache=true, hasText=true and a positive retryAfterMs, confirming that shared cached passages avoid another model call while retaining cooldown.
- Endpoint diagnosis is resolved: AQ. authorization keys are supported by Gemini Developer API. Prefix-based Vertex inference was removed; Vertex requires explicit configuration. Safe logs record only status/reason/backend, never raw provider errors or credentials.
- Production config uses gemini-3.5-flash, five deduplicated server credentials, 100 generation requests/day, 30/hour and a shared Redis limiter/cache.
- Google documents that the deprecated gemini-3.5-flash alias may route to its replacement; the application preserves the requested configured model name.
