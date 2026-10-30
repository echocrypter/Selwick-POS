/**
 * Selwick POS – HTML escaping utility.
 *
 * Escapes the five characters that have special meaning in HTML so that
 * arbitrary user-supplied strings can be safely interpolated into HTML
 * document strings (e.g. printReceipt window).
 *
 * The receipt is written via document.write() into a new browser window,
 * which means any unescaped dynamic field would be interpreted as HTML/JS.
 * Always pass every user-controlled value through escHtml() before
 * interpolating it into the receipt HTML template.
 */
export function escHtml(value: unknown): string {
  if (value === null || value === undefined) return '';
  const s = String(value);
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

