/**
 * reveal.ts — IntersectionObserver scroll reveal.
 * Any element with .reveal gets .is-in when entering the viewport (once).
 */
const io = new IntersectionObserver(
  (entries) => {
    for (const entry of entries) {
      if (entry.isIntersecting) {
        entry.target.classList.add('is-in');
        io.unobserve(entry.target);
      }
    }
  },
  { threshold: 0.12, rootMargin: '0px 0px -6% 0px' },
);

document.querySelectorAll('.reveal').forEach((el) => io.observe(el));
