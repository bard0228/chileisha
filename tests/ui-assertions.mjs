export default async function ({ page, assert }) {
  await page.waitForSelector('.quick-chips .chip', { visible: true });

  const result = await page.evaluate(() => {
    const chips = [...document.querySelectorAll('.quick-chips .chip')];
    const chipLabels = chips.map((c) => c.textContent.trim());
    const chipMetrics = chips.map((c) => {
      const r = c.getBoundingClientRect();
      const cs = getComputedStyle(c);
      return {
        label: c.textContent.trim(),
        height: Math.round(r.height),
        radius: parseFloat(cs.borderTopLeftRadius) || 0,
      };
    });

    const targets = [
      { name: 'monthDd', el: document.querySelector('#dd .lg-dd-btn') },
      { name: 'backBtn', el: document.querySelector('#back') },
      { name: 'mealDd', el: document.querySelector('#mealDd .lg-dd-btn') },
      { name: 'toggleAllBtn', el: document.querySelector('#toggleAllMealsBtn') },
    ].map(({ name, el }) => {
      if (!el) return { name, missing: true };
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return {
        name,
        missing: false,
        height: Math.round(r.height),
        radius: parseFloat(cs.borderTopLeftRadius) || 0,
      };
    });

    return { chipLabels, chipMetrics, targets };
  });

  assert(
    JSON.stringify(result.chipLabels) === JSON.stringify(['最新日', '乳清', '高蛋白', '小魚乾', '燕麥']),
    `Expected 5 chips [最新日, 乳清, 高蛋白, 小魚乾, 燕麥], got ${JSON.stringify(result.chipLabels)}`
  );

  for (const c of result.chipMetrics) {
    assert(c.height <= 38, `Chip "${c.label}" height ${c.height}px > 38px`);
    assert(c.radius <= 14, `Chip "${c.label}" radius ${c.radius}px > 14px (must be rounded rect, not pill)`);
  }

  for (const t of result.targets) {
    assert(!t.missing, `Missing target ${t.name}`);
    assert(t.height <= 38, `Button "${t.name}" height ${t.height}px > 38px`);
    assert(t.radius <= 14, `Button "${t.name}" radius ${t.radius}px > 14px`);
  }
}
