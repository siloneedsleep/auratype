export interface KeyGesture {
  key: string;
  code?: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
  isComposing?: boolean;
  altGraph?: boolean;
}
export function isPasteGesture(e: KeyGesture) {
  return Boolean(
    !e.altKey &&
    (((e.ctrlKey || e.metaKey) &&
      (e.key.toLowerCase() === 'v' || e.code === 'KeyV')) ||
      (e.shiftKey && !e.ctrlKey && !e.metaKey && e.key === 'Insert'))
  );
}
export function studioShortcut(
  e: KeyGesture
): 'retry' | 'sound' | 'keyboard' | 'help' | null {
  if (
    !e.altKey ||
    e.ctrlKey ||
    e.metaKey ||
    e.shiftKey ||
    e.isComposing ||
    e.altGraph
  )
    return null;
  const code =
    e.code ||
    (
      { r: 'KeyR', m: 'KeyM', k: 'KeyK', '/': 'Slash' } as Record<
        string,
        string
      >
    )[e.key.toLowerCase()];
  return (
    (
      { KeyR: 'retry', KeyM: 'sound', KeyK: 'keyboard', Slash: 'help' } as const
    )[code as 'KeyR' | 'KeyM' | 'KeyK' | 'Slash'] ?? null
  );
}
