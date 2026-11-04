# AuraType

A quiet typing studio for Vietnamese and English. Next.js, TypeScript, Zustand, Dexie, Canvas and Gemini.

## Run locally

Use Node.js 24 and npm:

```sh
npm ci
npm run dev
npm test
npm run lint
npm run typecheck
npm run build
```

The studio works immediately with built-in passages. No account or AI key is required for typing, custom passages, results, local history or Ghost replay. Settings and practice data remain in this browser; use Settings → Data to export a backup.

## What changed

- Responsive charcoal/lime studio with a focused typing area, consistent tokens, keyboard focus and optional FX.
- Vietnamese/English grapheme-aware input, real elapsed time, corrected-error accuracy and WPM samples based on the replay timeline.
- Ghost from the best eligible attempt on the same passage/rules, or a steady 30–120 WPM target opponent.
- Custom text (150–1,400 visible characters), whitespace normalization, local-only storage.
- Practice summaries from real completed attempts, results coaching and remaining-error hints.
- Native modal dialogs with focus containment, Escape, focus restoration and keyboard tabs in Settings.
- Gemini server-only credentials, bounded output, deduplicated credential rotation, shared cached passages and no retry storm on quota failures.

## Gemini and production storage

Configure the variables in `.env.example` on the server. For local development, copy the template to `.env.local` and enter your own values. Never commit credentials or prefix them with NEXT_PUBLIC_.

- `GEMINI_API_KEYS`: comma-separated credentials, or `GEMINI_API_KEY` for one credential. Duplicates are removed.
- `GEMINI_MODEL`: defaults to `gemini-3.5-flash` as requested. Google may redirect deprecated model aliases; inspect their current model documentation for actual serving behavior.
- `GEMINI_BACKEND`: `developer` (default) for Gemini API, or `vertex` for explicitly configured Vertex Express. Credential prefixes alone do not establish which Google service is enabled. Keep one backend/project quota group in a pool.
- `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`: required to enable AI in production. Vercel Marketplace aliases `KV_REST_API_URL` and `KV_REST_API_TOKEN` are also recognized. Connect a dedicated Upstash Redis database via Vercel Storage. Redis failures stop new paid generation rather than falling back to an unbounded in-memory limiter.
- `AI_DAILY_REQUEST_LIMIT` / `AI_HOURLY_REQUEST_LIMIT`: ceilings for total provider calls. Defaults 500/day and 120/hour; the first deployment uses 100/day and 30/hour. These count attempts including failed model calls. They cap generation requests, not dollar-denominated billing. Authentication rejections may try another key before a generation succeeds.

One atomic Redis reservation enforces IP cooldown (30–60s), fixed UTC hourly/daily provider budgets and five active leases. Expiring leases recover after timeouts. Session IDs do not bypass the IP cooldown. Deploy behind a trusted proxy that overwrites x-forwarded-for (as Vercel does), rather than exposing this server directly to untrusted proxy headers. Shared IP users share a cooldown.

Healthy credentials rotate across requests within one Google quota group. A 401/403 disables that credential for five minutes; the request may try another healthy credential, at most five credential attempts within the same total timeout. A 429 blocks provider calls across the whole group for at least a minute. SDK automatic retries are explicitly disabled. More keys in one project do not multiply Google quotas. No secrets or raw provider errors are returned to the browser.

Generated, validated passages enter a shared pool of up to 50 per model/prompt version/language/topic/length, expiring after 24 hours. The client sends up to 100 known AI content hashes so the server prefers unseen passages. Cache hits still obey the user cooldown but do not spend the provider-call budget. A cache miss generates once; invalid output is rejected without automatic retries. Custom text never enters this shared cache or the model request.

## Rules and data

- Timer begins with first input (or IME composition start), ends on a correctly typed final character. A wrong final character must be removed and corrected.
- WPM = correct characters currently matching the passage / 5 / elapsed minutes. Accuracy = correct insertions / all insertions, so corrected mistakes still count.
- Retry and passage changes ask before abandoning a running attempt. Switching windows ends the attempt; there is no pause/resume that could inflate a score.
- PB requires completed status, at least 95% accuracy, no remaining errors and matching passage/rules. Replay records positions and timestamps, including deletion.
- Imported results are personal records and are excluded from aggregate practice summaries. No public ranking or anti-cheat claim is made.
- Existing data schema is preserved. No cloud user history or login was added.

## Deploy to Vercel

Import this GitHub repository as a Next.js project. Use Node 24, `npm ci` and `npm run build`; keep the default Next.js output directory. Connect production Redis, set server secrets and the model, then deploy the reviewed commit. Previews have no production AI credentials by default.

The public studio remains usable if AI is unconfigured. The status label reports sample mode until the server is ready; errors preserve the current passage.

## Verification

Automated checks cover scoring, Unicode composition adapters, replay/PB selection, import validation, all sample combinations, custom text bounds, target opponents, historical chart samples, stale AI responses, cache bounds and mocked Gemini credential/quota behavior. No test sends production credentials to a model.

Manual browser QA checks the English passage → saved result → retry with Ghost flow, custom text, abandon confirmation, modal settings, history and responsive layout. Physical Windows Telex/VNI and screen-reader testing remain separate device checks; simulated composition tests do not certify every IME.

See `docs/verification.md` for the verification record and `docs/UI-UX-guidelines.md` for design rationale.

## Practice journey

The Journey panel includes a character heatmap from completed replays (including corrected errors), targeted vocabulary drills by topic, saved accuracy/speed goals, a five-minute practice guide, seven-day WPM/accuracy charts, and downloadable SVG result cards. IME batch timestamps are excluded from reaction-time averages; the heatmap measures committed characters, not physical Telex/VNI keys. Imported results do not affect personal insights.

Daily Flow uses the same rotating built-in short passage for everyone in each language, with the day changing at midnight in Vietnam (UTC+7). Redis stores short-lived runs and daily community leaderboards. Start a run, complete it, close the result dialog, then choose a public nickname and submit in the Daily tab. Only the best daily score per anonymous browser is retained; top 20 are shown. The server recomputes scores from replay, checks timing/ownership, enforces a 90% accuracy floor and 250 WPM ceiling, limits starts per IP, and consumes each run atomically. This is a casual community board; browser-side replay cannot provide tournament-grade anti-cheat. Public results expire after two days and unsubmitted runs after 30 minutes. No personal practice history is uploaded. Redis uses the same existing production environment variables as generation.

## Fair input and keyboard shortcuts

The practice panel blocks Ctrl/Cmd+V (including plain-text paste), Shift+Insert, context-menu paste, drag/drop, and paste/yank/replacement input sources. Both beforeinput and input reconciliation reject these sources, including single-character pastes; rejected input does not score. Normal typing and Vietnamese IME composition remain supported. Custom passage authoring still permits pasting; that creates a passage rather than scoring a typing attempt.

Alt+R retries (with confirmation during a running attempt), Alt+M toggles sound, Alt+K toggles the virtual keyboard, and Alt+/ toggles an inline shortcut guide. Escape opens settings in the typing input or closes the current dialog. Ctrl/Alt+Backspace deletes a word. Alt shortcuts ignore repeats, IME/AltGr, open dialogs, and other editable fields. The practice footer provides the same actions as clickable controls.
