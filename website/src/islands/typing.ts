/**
 * typing.ts — terminal typing effect for elements with [data-typing].
 * Types the element's data-text once when it enters the viewport, with a
 * blinking caret that settles after completion. Honors reduced motion.
 */
const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function typeOnce(el: HTMLElement) {
  const text = el.dataset.text ?? el.textContent ?? '';
  if (reduced) { el.textContent = text; return; }
  el.textContent = '';
  el.classList.add('is-typing');
  let i = 0;
  const tick = () => {
    i += 1 + Math.floor(Math.random() * 2);
    el.textContent = text.slice(0, i);
    if (i < text.length) {
      setTimeout(tick, 18 + Math.random() * 30);
    } else {
      setTimeout(() => el.classList.remove('is-typing'), 1400);
    }
  };
  setTimeout(tick, 350);
}

const io = new IntersectionObserver(
  (entries) => {
    for (const entry of entries) {
      if (entry.isIntersecting) {
        typeOnce(entry.target as HTMLElement);
        io.unobserve(entry.target);
      }
    }
  },
  { threshold: 0.6 },
);

document.querySelectorAll<HTMLElement>('[data-typing]').forEach((el) => io.observe(el));
