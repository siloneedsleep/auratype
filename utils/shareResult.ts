export function downloadResultCard(
  wpm: number,
  accuracy: number,
  language: string
) {
  const speed = Math.round(wpm),
    acc = accuracy.toFixed(1),
    label = language === 'vi' ? 'TIẾNG VIỆT' : 'ENGLISH';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630"><defs><radialGradient id="g"><stop stop-color="#394b27"/><stop offset="1" stop-color="#141912"/></radialGradient></defs><rect width="1200" height="630" rx="40" fill="url(#g)"/><rect x="35" y="35" width="1130" height="560" rx="26" fill="none" stroke="#4b5c3b"/><text x="80" y="120" fill="#c5ee88" font-family="sans-serif" font-size="32" font-weight="700">auratype.</text><text x="80" y="190" fill="#acb99f" font-family="sans-serif" font-size="17">DAILY PRACTICE · ${label}</text><text x="75" y="365" fill="#d7f7ad" font-family="sans-serif" font-size="160" font-weight="700">${speed}</text><text x="85" y="420" fill="#acb99f" font-family="sans-serif" font-size="25">WORDS PER MINUTE</text><text x="720" y="320" fill="#d7f7ad" font-family="sans-serif" font-size="76">${acc}%</text><text x="725" y="370" fill="#acb99f" font-family="sans-serif" font-size="22">ACCURACY</text><path d="M80 475H1120" stroke="#4b5c3b"/><text x="80" y="535" fill="#d0dec3" font-family="sans-serif" font-size="22">Ít xao nhãng. Nhiều tiến bộ.</text><text x="840" y="535" fill="#acb99f" font-family="sans-serif" font-size="20">auratype.vercel.app</text></svg>`;
  const url = URL.createObjectURL(
    new Blob([svg], { type: 'image/svg+xml;charset=utf-8' })
  );
  const a = document.createElement('a');
  a.href = url;
  a.download = 'auratype-result.svg';
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
