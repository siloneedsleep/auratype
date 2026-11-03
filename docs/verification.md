# Verification record

## Automated

- 21 tests pass: scoring, corrected mistakes, Unicode composition adapter, replay/PB selection, import, all language/topic/length samples, custom passage limits, target opponent positions, historical WPM samples, stale response protection, bounded passage cache and mocked Gemini rotation/429 handling.
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

## First production deployment

- Public page served from https://auratype.vercel.app.
- GET /api/generate reports AI configured and Redis available.
- First UI generation attempt enforced shared cooldown but Google rejected the selected credential (401/403 path). Investigating provider backend/permissions; a successful live AI response has not yet been verified.

- Safe provider diagnostics identified HTTP 403 SERVICE_DISABLED on the Vertex endpoint. Production is being checked with the explicitly selected Gemini Developer API backend. Credential failure state is scoped by backend so changing endpoints does not inherit an unrelated disabled-key cache.
