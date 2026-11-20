/* 
  吃了啥 — iOS 液態玻璃 Portal 與物理手風琴互動引擎 (LiquidGlass Engine v3)
  遵循全域液態玻璃規範：document.body Portal 獨立渲染 · 雙層冰晶結構 · 0.42s 手風琴 · Toast 懸浮通知
*/
(function () {
  const SVG_CHECK =
    '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';

  const openPortals = new Set();

  function init() {
    document.documentElement.classList.add('lg-on');
  }

  function lite(el) {
    if (!el) return;
    init();
    el.classList.add('lg', 'lg-lite');
  }

  function add(el) {
    if (!el) return;
    init();
    el.classList.add('lg');
    return { el };
  }

  function auto() {
    init();
    document.querySelectorAll('[data-lg]').forEach((el) => lite(el));
  }

  function update() {}
  function refresh() {}

  function closeAllDropdowns(exceptPortal) {
    openPortals.forEach((entry) => {
      if (entry.portal !== exceptPortal) {
        entry.close(false);
      }
    });
  }

  /* Portal 雙層冰晶下拉選單（獨立掛載 document.body + 0.42s 手風琴 + 微回彈進出） */
  function dropdown(dd, items, onChoose, opts) {
    init();
    if (!dd) return null;
    const btn = dd.querySelector('.lg-dd-btn');
    const label = dd.querySelector('.lg-dd-label') || btn;
    if (!btn) return null;

    // 移除同一觸發器舊有 portal 避免重複建立
    const ownerKey = dd.id || `dd-${Math.random().toString(36).slice(2, 8)}`;
    document
      .querySelectorAll(`.lg-dd-portal[data-dd-for="${ownerKey}"]`)
      .forEach((stale) => stale.remove());

    // 若原 HTML 內有殘留 inline panel，清除確保一律走 Portal 頂層
    const legacyPanel = dd.querySelector('.lg-dd-panel');
    if (legacyPanel) legacyPanel.remove();

    const portal = document.createElement('div');
    portal.className = 'lg-dd-portal lg-ice-frame';
    portal.dataset.ddFor = ownerKey;
    portal.setAttribute('role', 'presentation');
    portal.setAttribute('aria-hidden', 'true');

    const innerGlass = document.createElement('div');
    innerGlass.className = 'lg-inner-glass';

    const acc = document.createElement('div');
    acc.className = 'lg-accordion';

    const accInner = document.createElement('div');
    accInner.className = 'lg-accordion-inner';

    const list = document.createElement('div');
    list.className = 'lg-dd-scroll';
    list.setAttribute('tabindex', '-1');
    list.setAttribute('role', 'listbox');

    accInner.appendChild(list);
    acc.appendChild(accInner);
    innerGlass.appendChild(acc);
    portal.appendChild(innerGlass);
    document.body.appendChild(portal);

    let value = opts && opts.value != null ? opts.value : items[0] && items[0].value;
    let closeTimer = null;

    const render = () => {
      list.innerHTML = items
        .map((i) =>
          i.group
            ? `<div class="lg-dd-group" role="presentation">${i.group}</div>`
            : `<button type="button" class="lg-dd-opt" role="option" data-v="${i.value}" aria-selected="${i.value == value}">
                 <span>${i.label}</span>
                 <span class="lg-dd-check" aria-hidden="true">${i.value == value ? SVG_CHECK : ''}</span>
               </button>`
        )
        .join('');
      const cur = items.find((i) => i.value == value);
      if (cur && label) label.textContent = cur.label;
    };

    const opt = () => [...list.querySelectorAll('.lg-dd-opt')];

    const positionPortal = () => {
      const rect = btn.getBoundingClientRect();
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const minW = (opts && opts.minWidth) || 180;
      const width = Math.min(Math.max(rect.width, minW), vw - 24);
      const alignRight = (opts && opts.align === 'right') || rect.left + width > vw - 12;

      let left = alignRight ? rect.right - width : rect.left;
      left = Math.max(12, Math.min(left, vw - width - 12));

      const estHeight = Math.min(vh * 0.48, items.length * 48 + 30);
      const spaceBelow = vh - rect.bottom - 16;
      const spaceAbove = rect.top - 16;
      const openUp = spaceBelow < Math.min(180, estHeight) && spaceAbove > spaceBelow;

      portal.style.width = `${Math.round(width)}px`;
      portal.style.left = `${Math.round(left)}px`;

      if (openUp) {
        portal.style.top = 'auto';
        portal.style.bottom = `${Math.round(vh - rect.top + 8)}px`;
        portal.style.transformOrigin = alignRight ? 'bottom right' : 'bottom left';
      } else {
        portal.style.bottom = 'auto';
        portal.style.top = `${Math.round(Math.min(rect.bottom + 8, vh - 120))}px`;
        portal.style.transformOrigin = alignRight ? 'top right' : 'top left';
      }
    };

    btn.setAttribute('aria-haspopup', 'listbox');
    btn.setAttribute('aria-expanded', 'false');

    const close = (restoreFocus) => {
      if (!dd.classList.contains('open') && !portal.classList.contains('is-open')) return;
      clearTimeout(closeTimer);
      dd.classList.remove('open');
      btn.setAttribute('aria-expanded', 'false');
      portal.classList.remove('is-open', 'lg-pop-enter');
      portal.classList.add('is-closing', 'lg-pop-exit');
      acc.classList.remove('is-open');

      closeTimer = setTimeout(() => {
        portal.classList.remove('is-closing', 'lg-pop-exit');
        portal.setAttribute('aria-hidden', 'true');
      }, 220);

      if (restoreFocus) btn.focus();
    };

    const open = () => {
      closeAllDropdowns(portal);
      clearTimeout(closeTimer);
      positionPortal();
      dd.classList.add('open');
      btn.setAttribute('aria-expanded', 'true');
      portal.classList.remove('is-closing', 'lg-pop-exit');
      portal.setAttribute('aria-hidden', 'false');
      portal.classList.add('is-open', 'lg-pop-enter');
      requestAnimationFrame(() => {
        acc.classList.add('is-open');
      });
      const selected = list.querySelector('[aria-selected="true"]') || opt()[0];
      if (selected) selected.focus({ preventScroll: true });
    };

    const entry = { portal, close };
    openPortals.add(entry);

    btn.onclick = (e) => {
      e.stopPropagation();
      dd.classList.contains('open') ? close(true) : open();
    };

    list.onclick = (e) => {
      const o = e.target.closest('.lg-dd-opt');
      if (!o) return;
      value = o.dataset.v;
      render();
      close(true);
      if (onChoose) onChoose(value);
    };

    const onKeyDown = (e) => {
      const os = opt();
      const i = os.indexOf(document.activeElement);
      if (e.key === 'Escape') {
        close(true);
        e.preventDefault();
      } else if (e.key === 'ArrowDown') {
        if (!dd.classList.contains('open')) open();
        else os[Math.min(i + 1, os.length - 1)]?.focus();
        e.preventDefault();
      } else if (e.key === 'ArrowUp') {
        os[Math.max(i - 1, 0)]?.focus();
        e.preventDefault();
      }
    };

    dd.addEventListener('keydown', onKeyDown);
    portal.addEventListener('keydown', onKeyDown);

    document.addEventListener('click', (e) => {
      if (!dd.contains(e.target) && !portal.contains(e.target)) {
        close(false);
      }
    });

    window.addEventListener('resize', () => {
      if (portal.classList.contains('is-open')) positionPortal();
    });

    window.addEventListener(
      'scroll',
      (e) => {
        if (!portal.classList.contains('is-open')) return;
        if (e.target && portal.contains(e.target)) return;
        positionPortal();
      },
      { passive: true }
    );

    render();

    return {
      open,
      close,
      setValue(v) {
        value = v;
        render();
      },
      get value() {
        return value;
      },
    };
  }

  /* 通用 0.42s 手風琴綁定器 */
  function bindAccordion(triggerEl, bodyEl, defaultCollapsed = false) {
    if (!triggerEl || !bodyEl) return;
    const labelSpan = triggerEl.querySelector('span');
    const syncState = (collapsed) => {
      triggerEl.setAttribute('aria-expanded', String(!collapsed));
      if (labelSpan) labelSpan.textContent = collapsed ? '展開' : '收合';
    };

    if (defaultCollapsed) {
      triggerEl.classList.add('is-collapsed');
      bodyEl.classList.add('collapsed');
      syncState(true);
    } else {
      syncState(false);
    }

    triggerEl.addEventListener('click', () => {
      const collapsed = triggerEl.classList.toggle('is-collapsed');
      bodyEl.classList.toggle('collapsed', collapsed);
      syncState(collapsed);
    });
  }

  /* 懸浮雙層冰晶通知 Toast（Portal on document.body） */
  let toastHideTimer = null;
  let toastCleanupTimer = null;

  function toast(message, durationMs = 2200) {
    init();
    let host = document.getElementById('lgToastPortal');
    if (!host) {
      host = document.createElement('div');
      host.id = 'lgToastPortal';
      host.className = 'lg-toast-portal';
      host.setAttribute('aria-live', 'polite');
      host.innerHTML =
        '<div class="lg-ice-frame"><div class="lg-inner-glass lg-toast-inner"></div></div>';
      document.body.appendChild(host);
    }
    const frame = host.querySelector('.lg-ice-frame');
    const inner = host.querySelector('.lg-toast-inner');
    if (!frame || !inner) return;

    clearTimeout(toastHideTimer);
    clearTimeout(toastCleanupTimer);
    inner.textContent = message;

    frame.classList.remove('lg-pop-exit');
    frame.classList.add('lg-pop-enter');
    host.classList.add('is-open');

    toastHideTimer = setTimeout(() => {
      frame.classList.remove('lg-pop-enter');
      frame.classList.add('lg-pop-exit');
      toastCleanupTimer = setTimeout(() => {
        host.classList.remove('is-open');
        frame.classList.remove('lg-pop-exit');
      }, 210);
    }, durationMs);
  }

  window.LiquidGlass = {
    add,
    lite,
    auto,
    update,
    refresh,
    dropdown,
    bindAccordion,
    toast,
    hosts: [],
  };
})();

