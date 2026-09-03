// Tinder-style swipe gesture: drag-follow + rotate, threshold to commit or
// snap back. Touch is primary (touchstart/touchmove/touchend per spec);
// mouse drag is layered on for desktop/dev testing of the same code path.
window.MP = window.MP || {};

(function () {
  "use strict";

  function makeSwipeable(el, opts) {
    const threshold = opts.threshold || 100;
    let startX = 0, startY = 0, curX = 0, curY = 0, dragging = false, moved = false;

    function onStart(x, y) {
      dragging = true;
      moved = false;
      startX = x; startY = y; curX = x; curY = y;
      el.style.transition = "none";
    }

    function onMove(x, y) {
      if (!dragging) return;
      curX = x; curY = y;
      const dx = curX - startX, dy = curY - startY;
      if (Math.abs(dx) > 5 || Math.abs(dy) > 5) moved = true;
      el.style.transform = `translate(${dx}px, ${dy}px) rotate(${dx / 20}deg)`;
      el.style.opacity = String(Math.max(1 - Math.abs(dx) / 500, 0.5));
    }

    function onEnd() {
      if (!dragging) return;
      dragging = false;
      const dx = curX - startX, dy = curY - startY;
      el.style.transition = "transform 0.3s ease, opacity 0.3s ease";
      if (Math.abs(dx) > threshold) {
        const dir = dx > 0 ? 1 : -1;
        el.style.transform = `translate(${dir * window.innerWidth}px, ${dy}px) rotate(${dir * 30}deg)`;
        el.style.opacity = "0";
        const cb = dir > 0 ? opts.onSwipeRight : opts.onSwipeLeft;
        setTimeout(() => cb && cb(), 300);
      } else {
        el.style.transform = "";
        el.style.opacity = "";
        if (!moved && opts.onTap) opts.onTap();
      }
    }

    el.addEventListener("touchstart", (e) => {
      const t = e.touches[0];
      onStart(t.clientX, t.clientY);
    }, { passive: true });
    el.addEventListener("touchmove", (e) => {
      const t = e.touches[0];
      onMove(t.clientX, t.clientY);
    }, { passive: true });
    el.addEventListener("touchend", onEnd);

    el.addEventListener("mousedown", (e) => {
      onStart(e.clientX, e.clientY);
      const mm = (e2) => onMove(e2.clientX, e2.clientY);
      const mu = () => {
        onEnd();
        window.removeEventListener("mousemove", mm);
        window.removeEventListener("mouseup", mu);
      };
      window.addEventListener("mousemove", mm);
      window.addEventListener("mouseup", mu);
    });
  }

  MP.makeSwipeable = makeSwipeable;
})();
