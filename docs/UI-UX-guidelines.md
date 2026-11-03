# UI and UX implementation notes

The primary task is typing. The studio uses a charcoal surface, lime accent and restrained spacing hierarchy. Interface text uses system fonts so loading/building does not depend on a remote font service; passage text uses the local monospace stack.

- Keep the typing viewport stable as metrics change. Numbers use tabular glyphs.
- Use semantic color tokens and test contrast on actual background pairs.
- Pending text remains readable; errors add an underline as well as color.
- Components expose loading, unavailable, cooldown, empty, completed and save-error states.
- Use native dialogs for inert background, focus containment, Escape and restoration. Settings tabs support arrows, Home and End.
- Motion is decorative. Input, scoring and persistence never wait for animation.
- Respect the current system reduced-motion preference; stop Canvas effects when disabled.
- Prefer transform and opacity for movement, then measure actual browser rendering. Do not claim automatic GPU acceleration or universal 120 FPS.
- Canvas uses a fixed particle pool and capped device pixel ratio. Avoid multiple redundant animation libraries.
- Reuse passage layout for Ghost. Replay stores character positions and times rather than pixels.
- Do not send custom passages to AI or the shared passage pool.
- Use one clear next action after results: retry, with an optional coaching tip based on the recorded accuracy/errors.
- Keep empty statistics truthful. Do not draw invented historical performance data.

References: [W3C WAI](https://www.w3.org/WAI/tutorials/), [Modal dialogs](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/), [Google animation performance](https://web.dev/articles/animations-guide), [NN/g heuristics](https://www.nngroup.com/articles/ten-usability-heuristics/).
