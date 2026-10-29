// Inlined after <main>: scroll reveals must not wait for the module graph or images.
(() => {
  let currentMain = null;
  let dispose = () => {};

  const init = () => {
    const main = document.querySelector('main');
    if (!main || main === currentMain) return;
    dispose();
    currentMain = main;
    const timers = new Set();
    const observers = [];
    let frame = 0;
    let cancelled = false;
    const cleanups = [];

    // Own plain image clicks immediately, even while the module graph is loading
    // or a viewer is already opening. Neither the router nor the browser should
    // navigate to the image URL as a side effect of a second click.
    const photoClick = (event) => {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
      const link = event.target?.closest?.('a[data-pswp-width]');
      const gallery = link?.closest('[data-gallery]');
      if (!gallery) return;
      event.preventDefault();
      if (gallery.dataset.lightboxReady !== 'true') {
        gallery.dataset.lightboxPending = String([...gallery.querySelectorAll('a[data-pswp-width]')].indexOf(link));
      }
    };
    main.addEventListener('click', photoClick, { capture: true });
    cleanups.push(() => main.removeEventListener('click', photoClick, { capture: true }));

    // Waterfalls: deal cards, in their order, into the currently shortest column.
    // Heights come from each card's stored aspect ratio plus a fixed caption height
    // (titles are one line), so nothing is measured but the container's width.
    const arrange = (waterfall) => {
      const width = waterfall.clientWidth;
      if (!width) return;
      const style = getComputedStyle(waterfall);
      const gap = parseFloat(style.columnGap) || 0;
      const min = parseFloat(style.getPropertyValue('--col-min')) || 0;
      const max = parseInt(style.getPropertyValue('--col-max'), 10) || 1;
      const captionHeight = parseFloat(style.getPropertyValue('--cap-h')) || 0;
      const count = Math.max(1, Math.min(max, Math.floor((width + gap) / (min + gap))));
      const columnWidth = (width - gap * (count - 1)) / count;
      const cards = [...waterfall.querySelectorAll('[data-card]')];
      cards.forEach((card, i) => { if (card.dataset.i === undefined) card.dataset.i = String(i); });
      cards.sort((a, b) => a.dataset.i - b.dataset.i);
      const shown = cards.filter((card) => !card.hidden);
      const key = `${count}:${Math.round(columnWidth)}:${shown.map((card) => card.dataset.i).join(',')}`;
      if (waterfall.dataset.arranged === key) return;
      const columns = Array.from({ length: count }, () => {
        const column = document.createElement('div');
        column.className = 'wf-col';
        return column;
      });
      const heights = new Array(count).fill(0);
      for (const card of shown) {
        let shortest = 0;
        for (let j = 1; j < count; j++) if (heights[j] < heights[shortest] - 0.5) shortest = j;
        columns[shortest].append(card);
        heights[shortest] += columnWidth / (Number(card.dataset.ar) || 1) + captionHeight
          + (card.classList.contains('is-album') ? 10 : 0);
      }
      // Filtered-out cards stay in the page (hidden) for the next filter change.
      for (const card of cards) if (card.hidden) columns[0].append(card);
      waterfall.replaceChildren(...columns);
      waterfall.classList.add('is-arranged');
      waterfall.dataset.arranged = key;
    };
    const waterfalls = [...main.querySelectorAll('[data-waterfall]')];
    if (waterfalls.length && typeof getComputedStyle === 'function') {
      const arrangeAll = () => waterfalls.forEach(arrange);
      arrangeAll();
      window.__arrangeWaterfalls = arrangeAll;
      // Phone browsers fire resize as the address bar slides in and out while
      // scrolling; only a change of width can change the columns.
      let resizeFrame = 0;
      let viewportWidth = window.innerWidth;
      const onResize = () => {
        if (window.innerWidth === viewportWidth) return;
        viewportWidth = window.innerWidth;
        cancelAnimationFrame(resizeFrame);
        resizeFrame = requestAnimationFrame(arrangeAll);
      };
      window.addEventListener('resize', onResize);
      cleanups.push(() => {
        cancelAnimationFrame(resizeFrame);
        window.removeEventListener('resize', onResize);
        if (window.__arrangeWaterfalls === arrangeAll) delete window.__arrangeWaterfalls;
      });
    }

    // Mark a reveal done (which drops its clip) only once its curtain has actually
    // finished. A fixed delay cut it short whenever the transition started late (a busy
    // main thread, a slow network, or WebKit holding entrances until the page change
    // ends), so the photo snapped to full just before the motion settled.
    const reveal = (el) => {
      el.classList.add('is-visible');
      let timer;
      // Chrome can report a reveal's transitions as ended at elapsedTime 0, in the same
      // frame they start, while a fast scroll is under way. Treating that as the end
      // cut the curtain off (the card flashed in), so only a run that actually took
      // time counts; the timer covers anything else.
      const done = (e) => {
        if (e && (e.target !== el || e.propertyName !== 'transform' || e.elapsedTime < 0.5)) return;
        el.classList.add('is-done');
        el.removeEventListener('transitionend', done);
        clearTimeout(timer);
        timers.delete(timer);
      };
      el.addEventListener('transitionend', done);
      // Fallback for elements that never transition (hidden by a filter, for example).
      timer = setTimeout(done, 4000);
      timers.add(timer);
    };
    const reveals = main.querySelectorAll('.reveal:not(.is-visible)');
    if ('IntersectionObserver' in window) {
      const observer = new IntersectionObserver((entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          reveal(entry.target);
          observer.unobserve(entry.target);
        }
      }, { rootMargin: '0px 0px -8% 0px' });
      reveals.forEach((el) => observer.observe(el));
      observers.push(observer);
    } else reveals.forEach(reveal);

    const load = (img) => {
      if (cancelled) return;
      const src = img.getAttribute('data-deferred-src');
      if (!src) return;
      const srcset = img.getAttribute('data-deferred-srcset');
      // Set responsive candidates before src to avoid requesting two image sizes.
      if (srcset) img.setAttribute('srcset', srcset);
      img.setAttribute('src', src);
      img.removeAttribute('data-deferred-srcset');
      img.removeAttribute('data-deferred-src');
    };
    // Clipped slides overlap in the viewport, so IntersectionObserver considers
    // all five visible. Fetch only the selected photo, then its next neighbour.
    const hero = main.querySelector('[data-hero]');
    if (hero) {
      const slides = [...hero.querySelectorAll('[data-slide]')];
      let stopWarm = () => {};
      const loadSlide = () => {
        stopWarm();
        const index = slides.findIndex((slide) => slide.classList.contains('is-active'));
        const current = slides[index]?.querySelector('img');
        if (!current) return;
        current.fetchPriority = 'high';
        current.loading = 'eager';
        load(current);
        const warmNext = () => {
          stopWarm();
          if (cancelled || !slides[index].classList.contains('is-active')) return;
          const next = slides[(index + 1) % slides.length]?.querySelector('img');
          if (!next || next === current) return;
          next.fetchPriority = 'low';
          next.loading = 'eager';
          load(next);
        };
        const returning = document.documentElement?.classList.contains('is-return');
        if (!returning && current.complete) warmNext();
        else if (!returning) {
          current.addEventListener('load', warmNext, { once: true });
          current.addEventListener('error', warmNext, { once: true });
          stopWarm = () => {
            current.removeEventListener('load', warmNext);
            current.removeEventListener('error', warmNext);
          };
        }
      };
      hero.addEventListener('gallery:slide-change', loadSlide);
      cleanups.push(() => {
        stopWarm();
        hero.removeEventListener('gallery:slide-change', loadSlide);
      });
      loadSlide();
    }
    // Leave a paint for the layout/colour placeholders before starting image requests.
    frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => {
        if (cancelled) return;
        const images = [...main.querySelectorAll('img[data-deferred-src]')]
          .filter((img) => !img.closest('[data-slide]'));
        if ('IntersectionObserver' in window) {
          const observer = new IntersectionObserver((entries) => {
            for (const entry of entries) {
              if (!entry.isIntersecting) continue;
              load(entry.target);
              observer.unobserve(entry.target);
            }
          }, { rootMargin: '100% 0px' });
          images.forEach((img) => observer.observe(img));
          observers.push(observer);
        } else images.forEach(load);
      });
    });
    dispose = () => {
      cancelled = true;
      cancelAnimationFrame(frame);
      observers.forEach((observer) => observer.disconnect());
      timers.forEach((timer) => clearTimeout(timer));
      cleanups.forEach((cleanup) => cleanup());
      currentMain = null;
    };
  };
  document.addEventListener('astro:before-swap', () => dispose());
  document.addEventListener('astro:after-swap', init);
  document.addEventListener('astro:page-load', init);
  init();
})();
