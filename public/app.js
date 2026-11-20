(async () => {
  const D = await (await fetch('data.json', { cache: 'no-cache' })).json();
  const R = D.rows;

  function getTaiwanToday() {
    try {
      return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei' }).format(new Date());
    } catch (e) {
      const d = new Date();
      const tw = new Date(d.getTime() + (d.getTimezoneOffset() + 480) * 60000);
      return `${tw.getFullYear()}-${String(tw.getMonth() + 1).padStart(2, '0')}-${String(tw.getDate()).padStart(2, '0')}`;
    }
  }

  // 強制以當下使用者所在台灣時間 (Asia/Taipei) 作為基準今日
  const TW_TODAY = getTaiwanToday();
  let TODAY = TW_TODAY;
  if (D.today && D.today > TODAY) {
    TODAY = D.today;
  }
  const RF = new Set(D.refeed);
  const $ = (id) => document.getElementById(id);

  const N = [
    ['kcal', '熱量', 'kcal', 'k'],
    ['carb', '碳水', 'g', 'C'],
    ['protein', '蛋白質', 'g', 'P'],
    ['fat', '脂肪', 'g', 'F'],
    ['sodium', '鈉', 'mg', 'S'],
  ];
  const IX = { kcal: 4, carb: 5, protein: 6, fat: 7, sodium: 8 };
  const MEALS = ['早餐', '午餐', '晚餐', '點心'];

  const DAY = {};
  R.forEach((r) => {
    const t = (DAY[r[0]] ??= { kcal: 0, carb: 0, protein: 0, fat: 0, sodium: 0 });
    for (const k in IX) t[k] += +r[IX[k]] || 0;
  });

  const Z = { kcal: 0, carb: 0, protein: 0, fat: 0, sodium: 0 };
  const tot = (d) => DAY[d] || Z;
  const goal = (d) =>
    D.goals
      .filter((g) => g.from <= d)
      .sort((a, b) => (a.from < b.from ? 1 : -1))[0] || D.goals[0];

  const f = (v) => Math.round(v).toLocaleString('zh-TW');
  const p2 = (n) => String(n).padStart(2, '0');
  const esc = (s) =>
    String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  let activeDate = TODAY;

  // 渲染指定日期的「今日進度」區塊
  function renderProgress(targetDate) {
    const g = goal(targetDate);
    const t = tot(targetDate);
    const isRefeed = RF.has(targetDate);

    $('tdate').textContent = targetDate + (targetDate === TODAY ? ' · 今日' : '');
    const rfBadge = $('rfBadge');
    if (rfBadge) {
      rfBadge.style.display = isRefeed ? 'inline-flex' : 'none';
    }

    $('prog').innerHTML = N.map(([k, l, u]) => {
      const v = t[k];
      const G = g[k];
      const L = G - v;
      const pct = Math.min(100, G ? (v / G) * 100 : 0);
      return `<div>
        <div class="prow">
          <span class="prow-label">
            <span class="prow-dot" style="--c:var(--c-${k})"></span>
            <span>${l}</span>
            <span class="prow-nums">${f(v)} / ${f(G)} ${u}</span>
          </span>
          <span class="tabular-nums ${L < 0 ? 'over-t' : 'muted'}">${L >= 0 ? '還剩 ' + f(L) : '超出 ' + f(-L)} ${u}</span>
        </div>
        <div class="bar"><i class="${v > G ? 'over' : ''}" style="--c:var(--c-${k});width:${pct}%"></i></div>
      </div>`;
    }).join('');

    $('goalnote').textContent = '每日目標 · ' + N.map(([k, l, u]) => `${l} ${f(g[k])} ${u}`).join(' · ');
  }

  renderProgress(TODAY);

  // 月曆與月份手風琴下拉選單
  const months = [...new Set([...Object.keys(DAY), TODAY].map((d) => d.slice(0, 7)))].sort().reverse();
  let ym = TODAY.slice(0, 7);

  function cal() {
    const [y, m] = ym.split('-').map(Number);
    const first = new Date(y, m - 1, 1).getDay();
    const n = new Date(y, m, 0).getDate();
    let h =
      '日一二三四五六'
        .split('')
        .map((w) => `<div class="wd">${w}</div>`)
        .join('') + '<div></div>'.repeat(first);

    for (let i = 1; i <= n; i++) {
      const d = `${ym}-${p2(i)}`;
      const T = DAY[d];
      const G = goal(d);
      const isSelected = d === activeDate && d !== TODAY;
      h += `<button type="button" class="day${d === TODAY ? ' today' : ''}${isSelected ? ' selected' : ''}${RF.has(d) ? ' rf' : ''}" data-d="${d}">
        <b>${i}${RF.has(d) ? '<span class="rf-indicator" aria-hidden="true"></span>' : ''}</b>
        ${
          T
            ? N.map(([k, , , s]) => {
                const o = T[k] > G[k];
                return `<span class="n-${k}${o ? ' o' : ''}">${Math.round(T[k])}${s}</span>`;
              }).join('')
            : ''
        }
      </button>`;
    }
    $('cal').innerHTML = h;
  }

  const dd = LiquidGlass.dropdown(
    $('dd'),
    months.map((v) => ({
      value: v,
      label: v.replace('-', ' 年 ').replace(/ 0?(\d+)$/, ' $1') + ' 月',
    })),
    (v) => {
      ym = v;
      cal();
    },
    { value: ym, align: 'left', minWidth: 185 }
  );

  // 餐點篩選手風琴下拉選單
  let mealFilter = 'ALL';
  if ($('mealDd')) {
    LiquidGlass.dropdown(
      $('mealDd'),
      [
        { value: 'ALL', label: '全部餐別' },
        { value: '早餐', label: '早餐' },
        { value: '午餐', label: '午餐' },
        { value: '晚餐', label: '晚餐' },
        { value: '點心', label: '點心' },
      ],
      (v) => {
        mealFilter = v;
        search();
      },
      { value: 'ALL', align: 'right', minWidth: 160 }
    );
  }

  $('back').onclick = () => {
    ym = TODAY.slice(0, 7);
    activeDate = TODAY;
    if (dd) dd.setValue(ym);
    renderProgress(TODAY);
    $('q').value = '';
    updateClearBtn();
    cal();
    search();
  };

  $('cal').onclick = (e) => {
    const c = e.target.closest('.day');
    if (!c) return;
    activeDate = c.dataset.d;
    renderProgress(activeDate);
    $('q').value = c.dataset.d;
    updateClearBtn();
    cal();
    search();
    $('searchSec').scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  cal();

  // 近 7 日統計表
  const rec = [...Array(7)].map((_, i) => {
    const x = new Date(new Date(TODAY + 'T00:00:00') - i * 864e5);
    return `${x.getFullYear()}-${p2(x.getMonth() + 1)}-${p2(x.getDate())}`;
  });

  function renderT7() {
    $('t7').innerHTML =
      '<thead><tr><th>日期</th><th>kcal</th><th>碳水g</th><th>蛋白g</th><th>脂肪g</th><th>鈉mg</th></tr></thead><tbody>' +
      rec
        .map(
          (d) =>
            `<tr class="row-clickable" data-d="${d}"><td>${d.slice(5).replace('-', '/')}${
              RF.has(d) ? '<span class="rf-tag-sm">補碳</span>' : ''
            }</td>${N.map(([k]) => `<td class="n-${k}">${f(tot(d)[k])}</td>`).join('')}</tr>`
        )
        .join('') +
      '</tbody>';
  }
  renderT7();

  $('t7').onclick = (e) => {
    const tr = e.target.closest('tr[data-d]');
    if (!tr) return;
    const d = tr.dataset.d;
    activeDate = d;
    renderProgress(d);
    $('q').value = d;
    updateClearBtn();
    cal();
    search();
    $('searchSec').scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  // 搜尋與餐別手風琴拆解卡片
  const pd = (s) => {
    s = s.trim();
    let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
    if (m) return `${m[1]}-${p2(+m[2])}-${p2(+m[3])}`;
    m = s.match(/^(\d{1,2})[/.-](\d{1,2})$/);
    return m ? `${TODAY.slice(0, 4)}-${p2(+m[1])}-${p2(+m[2])}` : null;
  };

  const line = (r) =>
    `<div class="nl"><span class="n-kcal">${f(r[4])}kcal</span><span class="n-carb">碳${r[5]}g</span><span class="n-protein">蛋${r[6]}g</span><span class="n-fat">脂${r[7]}g</span><span class="n-sodium">鈉${f(r[8])}mg</span></div>`;

  const nm = (r) =>
    `<div class="nm"><span class="food-name">${esc(r[2])}</span>${r[3] ? '<span class="food-grams muted">' + r[3] + 'g</span>' : ''}</div>`;

  const ph = (ks) =>
    ks.length
      ? `<div class="ph">${ks
          .map((k) => `<img src="/thumbs/${encodeURIComponent(k)}" data-k="${esc(k)}" alt="${esc(k)}" loading="eager">`)
          .join('')}</div>`
      : '';

  const photosOf = (i) => {
    const r = R[i];
    if (r[9] && r[9].length) return r[9];
    for (let j = i - 1; j >= 0 && R[j][0] === r[0] && R[j][1] === r[1]; j--) {
      if (R[j][9] && R[j][9].length) return R[j][9];
    }
    return [];
  };

  function search() {
    const kw = $('q').value.trim();
    const d = kw ? pd(kw) : TODAY;
    const hits = [];

    R.forEach((r, i) => {
      if (mealFilter !== 'ALL' && r[1] !== mealFilter) return;
      if (d ? r[0] === d : r[2].includes(kw)) hits.push(i);
    });

    const filterNote = mealFilter !== 'ALL' ? ` · 篩選：${mealFilter}` : '';
    const metaHtml = `<div class="res-meta muted small"><span>${
      d
        ? `${kw ? '' : '當日紀錄 · '}${d}${RF.has(d) ? '（補碳日）' : ''}${filterNote}`
        : `關鍵字「${esc(kw)}」${filterNote}`
    }</span><span class="res-meta-right"><span>${hits.length} 筆${
      !d && hits.length > 200 ? '（顯示最新 200 筆）' : ''
    }</span>${
      d && hits.length
        ? `<button type="button" class="toggle-all-btn lg-btn lg-rim" id="toggleAllMealsBtn" aria-label="全部展開或收起" aria-expanded="true"><svg class="accordion-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg></button>`
        : ''
    }</span></div>`;

    let cardsHtml = '';
    if (d) {
      const targetMeals = mealFilter === 'ALL' ? MEALS : [mealFilter];
      const extractDishLabel = (photoName, fallbackIdx) => {
        if (!photoName) return `餐點 ${fallbackIdx}`;
        const base = photoName.replace(/\.(jpg|jpeg|png|webp)$/i, '');
        const parts = base.split('_');
        if (parts.length >= 3 && parts.slice(2).join('_').trim()) {
          const desc = parts.slice(2).join('_').trim();
          if (!/^\d+$/.test(desc)) return desc;
        }
        return `餐點 ${fallbackIdx}`;
      };
      const sumRows = (indices) => {
        const S = [0, 0, 0, 0, 0, 0, 0, 0, 0];
        indices.forEach((i) => {
          for (let j = 4; j < 9; j++) S[j] += +R[i][j] || 0;
        });
        const r1 = (x) => Math.round(x * 10) / 10;
        return [0, 0, 0, 0, r1(S[4]), r1(S[5]), r1(S[6]), r1(S[7]), r1(S[8])];
      };

      cardsHtml = targetMeals
        .map((m) => {
          const ix = hits.filter((i) => R[i][1] === m);
          if (!ix.length) return '';
          const sr = sumRows(ix);
          const photos = [...new Set(ix.flatMap((i) => R[i][9] || []))];

          // 依照片分組（每遇到帶有照片的列即開啟新餐點小計群組）
          const groups = [];
          ix.forEach((i) => {
            const rowImgs = R[i][9] || [];
            if (rowImgs.length > 0 || groups.length === 0) {
              groups.push({
                label: rowImgs.length ? extractDishLabel(rowImgs[0], groups.length + 1) : '',
                indices: [i],
              });
            } else {
              groups[groups.length - 1].indices.push(i);
            }
          });

          const hasMultiGroups = groups.length > 1;
          const itemsHtml = hasMultiGroups
            ? groups
                .map((g, idx) => {
                  const gSum = sumRows(g.indices);
                  const gTitle = g.label || `餐點 ${idx + 1}`;
                  return `<div class="meal-group">
                    <div class="meal-group-head">
                      <span class="meal-group-title">${esc(gTitle)}</span>
                      <span class="meal-tag">${g.indices.length} 項</span>
                    </div>
                    ${line(gSum).replace('class="nl"', 'class="nl sub meal-group-sub"')}
                    <div class="meal-group-items">
                      ${g.indices.map((i) => `<div class="it">${nm(R[i])}${line(R[i])}</div>`).join('')}
                    </div>
                  </div>`;
                })
                .join('')
            : ix.map((i) => `<div class="it">${nm(R[i])}${line(R[i])}</div>`).join('');

          return `<div class="card lg-rim meal-accordion-card">
            <div class="card-head" role="button" tabindex="0" aria-expanded="true">
              <div class="t">
                <span>${m} 合計</span>
                <span class="meal-tag">${ix.length} 項</span>
              </div>
              <svg class="accordion-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>
            </div>
            ${line(sr).replace('class="nl"', 'class="nl sub"')}
            <div class="accordion-body">
              <div class="accordion-inner">
                <div class="sep"></div>
                ${ph(photos)}
                ${itemsHtml}
              </div>
            </div>
          </div>`;
        })
        .join('');
    } else {
      cardsHtml = hits
        .slice(-200)
        .reverse()
        .map((i) => {
          const r = R[i];
          return `<div class="card lg-rim">
            <div class="card-head" style="cursor:default">
              <div class="t"><span>${r[0]}</span><span class="meal-tag">${r[1]}</span></div>
            </div>
            <div class="it" style="margin-top:4px">${nm(r)}${line(r)}</div>
            ${ph(photosOf(i))}
          </div>`;
        })
        .join('');
    }

    const emptyMsg =
      d === TODAY
        ? `<div class="card lg-rim muted small" style="text-align:center;padding:32px 18px">尚無今日紀錄</div>`
        : `<div class="card lg-rim muted small" style="text-align:center;padding:24px">查無符合條件的紀錄</div>`;
    $('res').innerHTML = metaHtml + (cardsHtml || emptyMsg);

    document.querySelectorAll('.meal-accordion-card').forEach((card) => {
      const head = card.querySelector('.card-head');
      const body = card.querySelector('.accordion-body');
      if (head && body) {
        const toggleCard = () => {
          const collapsed = head.classList.toggle('is-collapsed');
          body.classList.toggle('collapsed', collapsed);
          head.setAttribute('aria-expanded', String(!collapsed));
        };
        head.onclick = toggleCard;
        head.onkeydown = (ev) => {
          if (ev.key === 'Enter' || ev.key === ' ') {
            ev.preventDefault();
            toggleCard();
          }
        };
      }
    });

    const toggleAllBtn = $('toggleAllMealsBtn');
    if (toggleAllBtn) {
      toggleAllBtn.onclick = () => {
        const isCollapsed = toggleAllBtn.classList.toggle('is-collapsed');
        toggleAllBtn.setAttribute('aria-expanded', String(!isCollapsed));
        document.querySelectorAll('.meal-accordion-card').forEach((card) => {
          const head = card.querySelector('.card-head');
          const body = card.querySelector('.accordion-body');
          if (head && body) {
            head.classList.toggle('is-collapsed', isCollapsed);
            body.classList.toggle('collapsed', isCollapsed);
            head.setAttribute('aria-expanded', String(!isCollapsed));
          }
        });
      };
    }
  }

  function updateClearBtn() {
    const clearBtn = $('clearQ');
    if (clearBtn) {
      clearBtn.classList.toggle('show', $('q').value.trim().length > 0);
    }
  }

  let tm;
  $('q').oninput = () => {
    updateClearBtn();
    clearTimeout(tm);
    tm = setTimeout(() => {
      const parsed = pd($('q').value.trim());
      if (parsed) {
        activeDate = parsed;
        renderProgress(parsed);
      } else if (!$('q').value.trim()) {
        activeDate = TODAY;
        renderProgress(TODAY);
      }
      search();
    }, 150);
  };

  if ($('clearQ')) {
    $('clearQ').onclick = () => {
      $('q').value = '';
      updateClearBtn();
      activeDate = TODAY;
      renderProgress(TODAY);
      cal();
      search();
      $('q').focus();
    };
  }

  document.querySelectorAll('.chip[data-kw]').forEach((chip) => {
    chip.onclick = () => {
      $('q').value = chip.dataset.kw;
      updateClearBtn();
      search();
    };
  });

  document.querySelectorAll('[data-acc-btn]').forEach((btn) => {
    const targetId = btn.dataset.accBtn;
    const body = $(targetId);
    if (body) LiquidGlass.bindAccordion(btn, body, false);
  });

  search();

  // 雙層冰晶圖片燈箱 Modal（掛載於 document.body，微回彈進退場）
  const viewer = $('viewer');
  const viewerFrame = viewer ? viewer.querySelector('.viewer-frame') : null;
  const viewerImg = $('viewerImg');
  const viewerCloseBtn = $('viewerClose');
  let viewerCloseTimer = null;

  function openViewer(src, alt) {
    if (!viewer || !viewerFrame || !viewerImg) return;
    clearTimeout(viewerCloseTimer);
    viewerImg.src = src;
    viewerImg.alt = alt || '餐點照片';
    viewer.classList.remove('closing');
    viewerFrame.classList.remove('lg-pop-exit');
    viewerFrame.classList.add('lg-pop-enter');
    viewer.classList.add('on');
    viewer.setAttribute('aria-hidden', 'false');
  }

  function closeViewer() {
    if (!viewer || !viewerFrame || !viewer.classList.contains('on')) return;
    clearTimeout(viewerCloseTimer);
    viewerFrame.classList.remove('lg-pop-enter');
    viewerFrame.classList.add('lg-pop-exit');
    viewer.classList.add('closing');
    viewerCloseTimer = setTimeout(() => {
      viewer.classList.remove('on', 'closing');
      viewerFrame.classList.remove('lg-pop-exit');
      viewer.setAttribute('aria-hidden', 'true');
    }, 200);
  }

  $('res').onclick = (e) => {
    const im = e.target.closest('img');
    if (!im) return;
    openViewer(im.src, im.alt);
  };

  if (viewerCloseBtn) {
    viewerCloseBtn.onclick = (e) => {
      e.stopPropagation();
      closeViewer();
    };
  }

  if (viewer) {
    viewer.onclick = (e) => {
      if (e.target === viewer || e.target.classList.contains('lg-modal-scrim')) closeViewer();
    };
  }

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && viewer && viewer.classList.contains('on')) {
      closeViewer();
    }
  });

  // 雙層冰晶 API 設定對話框（取代原生 window.prompt）
  function promptApiUrlModal() {
    return new Promise((resolve) => {
      const backdrop = document.createElement('div');
      backdrop.className = 'lg-modal-backdrop on';
      backdrop.setAttribute('role', 'dialog');
      backdrop.setAttribute('aria-modal', 'true');
      backdrop.innerHTML = `
        <div class="lg-modal-scrim" aria-hidden="true"></div>
        <div class="lg-ice-frame prompt-dialog-card lg-pop-enter">
          <div class="lg-inner-glass prompt-dialog-inner">
            <h3 class="prompt-dialog-title">同步 API 網址</h3>
            <input type="url" class="prompt-dialog-input" id="lgApiUrlInput" placeholder="https://script.google.com/macros/s/...">
            <div class="prompt-dialog-actions">
              <button type="button" class="btn lg-btn lg-rim" id="lgApiCancel">取消</button>
              <button type="button" class="btn lg-btn lg-rim" id="lgApiConfirm">儲存</button>
            </div>
          </div>
        </div>`;
      document.body.appendChild(backdrop);

      const frame = backdrop.querySelector('.lg-ice-frame');
      const input = backdrop.querySelector('#lgApiUrlInput');
      const cleanup = (val) => {
        frame.classList.remove('lg-pop-enter');
        frame.classList.add('lg-pop-exit');
        backdrop.classList.add('closing');
        setTimeout(() => {
          backdrop.remove();
          resolve(val);
        }, 200);
      };

      backdrop.querySelector('#lgApiCancel').onclick = () => cleanup(null);
      backdrop.querySelector('#lgApiConfirm').onclick = () => cleanup(input.value.trim() || null);
      backdrop.onclick = (e) => {
        if (e.target === backdrop || e.target.classList.contains('lg-modal-scrim')) cleanup(null);
      };
      input.focus();
    });
  }

  // Google Apps Script 即時動態同步 (Live Sync)
  let liveApiUrl = window.CHILEISHA_LIVE_API || localStorage.getItem('chileisha_live_api') || '';

  function parseRowDate(raw) {
    if (!raw) return '';
    const s = String(raw).trim();
    const m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
    if (m) {
      return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
    }
    const dt = new Date(s);
    if (!isNaN(dt.getTime())) {
      try {
        return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei' }).format(dt);
      } catch (e) {
        return dt.toISOString().slice(0, 10);
      }
    }
    return s;
  }

  async function performLiveSync(silent = false) {
    if (!liveApiUrl) {
      if (!silent) {
        const input = await promptApiUrlModal();
        if (input) {
          liveApiUrl = input;
          localStorage.setItem('chileisha_live_api', liveApiUrl);
        } else {
          return;
        }
      } else {
        return;
      }
    }

    const btn = $('syncLiveBtn');
    const icon = btn ? btn.querySelector('.sync-icon') : null;
    const txt = $('syncText');
    if (icon) icon.classList.add('spinning');
    if (txt) txt.textContent = '同步中';

    try {
      const res = await fetch(liveApiUrl, { cache: 'no-cache' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const liveRows = await res.json();
      if (!Array.isArray(liveRows)) return;

      const liveDates = new Set();
      const liveKeys = new Set();
      liveRows.forEach((lr) => {
        if (!lr || lr.length < 9) return;
        const d = parseRowDate(lr[0]);
        if (!d) return;
        const m = String(lr[1]).trim();
        const fName = String(lr[2]).trim();
        liveDates.add(d);
        liveKeys.add(`${d}__${m}__${fName}`);
      });

      let removedCount = 0;
      for (let i = R.length - 1; i >= 0; i--) {
        const r = R[i];
        if (liveDates.has(r[0])) {
          const key = `${r[0]}__${r[1]}__${r[2]}`;
          if (!liveKeys.has(key)) {
            const t = DAY[r[0]];
            if (t) {
              for (const k in IX) t[k] = Math.max(0, t[k] - (+r[IX[k]] || 0));
            }
            R.splice(i, 1);
            removedCount++;
          }
        }
      }

      let addedCount = 0;
      liveRows.forEach((lr) => {
        if (!lr || lr.length < 9) return;
        const d = parseRowDate(lr[0]);
        if (!d) return;
        const m = String(lr[1]).trim();
        const fName = String(lr[2]).trim();
        const exists = R.some((r) => r[0] === d && r[1] === m && r[2] === fName);
        if (!exists) {
          const newRow = [d, m, fName, +lr[3] || 0, +lr[4] || 0, +lr[5] || 0, +lr[6] || 0, +lr[7] || 0, +lr[8] || 0, []];
          R.push(newRow);
          addedCount++;
          const t = (DAY[d] ??= { kcal: 0, carb: 0, protein: 0, fat: 0, sodium: 0 });
          for (const k in IX) t[k] += +newRow[IX[k]] || 0;
        }
      });

      if (addedCount > 0 || removedCount > 0) {
        R.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
        const maxD = R.length ? R[R.length - 1][0] : TODAY;
        if (maxD > TODAY) {
          TODAY = maxD;
          activeDate = maxD;
        }
        cal();
        renderProgress(activeDate);
        renderT7();
        search();
        const summaryLabel =
          addedCount > 0 && removedCount > 0
            ? `+${addedCount}/-${removedCount}`
            : addedCount > 0
              ? `+${addedCount} 筆`
              : `-${removedCount} 筆`;
        if (txt) txt.textContent = summaryLabel;
        if (!silent) LiquidGlass.toast(`已同步 ${summaryLabel}`);
      } else {
        if (txt) txt.textContent = '已最新';
        if (!silent) LiquidGlass.toast('資料已是最新');
      }
    } catch (err) {
      console.warn('即時同步失敗:', err);
      if (txt) txt.textContent = '失敗';
      if (!silent) LiquidGlass.toast('同步失敗');
    } finally {
      if (icon) icon.classList.remove('spinning');
      setTimeout(() => {
        if (txt) txt.textContent = '同步';
      }, 2000);
    }
  }

  if ($('syncLiveBtn')) {
    $('syncLiveBtn').onclick = () => performLiveSync(false);
  }

  if (liveApiUrl) {
    setTimeout(() => performLiveSync(true), 800);
  }
})();
