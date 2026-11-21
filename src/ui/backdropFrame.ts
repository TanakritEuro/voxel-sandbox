// The title screen's live backdrop (Milestone 20): the game in `?backdrop` mode in a frame behind the
// world list, added once the list is up (so the list still comes up without Three.js) and faded in
// when its view is in. None when the system asks for less motion, or with `?nobackdrop`.

/** The world it shows: a seed and place among snowy mountains and spruce forest, in the morning. */
const BACKDROP = '?backdrop&seed=20261022&at=-40,360&radius=6&mobs=0&time=0.31&workers=2';

export function showBackdrop(): void {
  if (new URLSearchParams(location.search).has('nobackdrop')) return;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const frame = document.createElement('iframe');
  frame.className = 'backdrop-frame';
  frame.title = '';
  frame.tabIndex = -1;
  frame.setAttribute('aria-hidden', 'true');
  frame.src = `${location.pathname}${BACKDROP}`;
  window.addEventListener('message', (e) => {
    if (e.origin === location.origin && e.source === frame.contentWindow && e.data === 'backdrop-ready') frame.classList.add('on');
  });
  document.body.prepend(frame);
}
