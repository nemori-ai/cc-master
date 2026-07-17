/**
 * theme-toggle.ts — flips data-theme on <html>, persists to localStorage.
 * Expects buttons with [data-theme-toggle]; updates their pressed state.
 */
const buttons = document.querySelectorAll<HTMLButtonElement>('[data-theme-toggle]');

function current(): 'light' | 'dark' {
  return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
}

function apply(theme: 'light' | 'dark') {
  document.documentElement.dataset.theme = theme;
  try { localStorage.setItem('ccm-theme', theme); } catch { /* private mode */ }
  buttons.forEach((b) => b.setAttribute('aria-pressed', String(theme === 'dark')));
}

buttons.forEach((b) => {
  b.setAttribute('aria-pressed', String(current() === 'dark'));
  b.addEventListener('click', () => apply(current() === 'dark' ? 'light' : 'dark'));
});
