import { chromium } from 'playwright-core';
(async () => {
  const b = await chromium.launch({ headless: true, executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
  const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
  await p.goto('http://localhost:4321/', { waitUntil: 'networkidle' });
  await p.waitForTimeout(2000);
  await p.evaluate(() => document.querySelectorAll('details').forEach(d => (d as HTMLDetailsElement).open = true));
  await p.waitForTimeout(400);
  await p.click('button[aria-label^="Inspect"]');
  await p.waitForTimeout(1000);
  await p.click('button[aria-label^="Propose"]');
  await p.waitForTimeout(1500);
  await p.evaluate(() => document.querySelectorAll('details').forEach(d => (d as HTMLDetailsElement).open = true));
  await p.waitForTimeout(400);
  await p.evaluate(() => (document.body as HTMLElement).focus());
  await p.keyboard.press('Home');

  const rows: any[] = [];
  for (let i = 0; i < 120; i++) {
    await p.keyboard.press('Tab');
    const info = await p.evaluate(() => {
      const el = document.activeElement as HTMLElement;
      if (!el || el === document.body) return null;
      const cs = getComputedStyle(el);
      const scrollable = el.scrollHeight > el.clientHeight + 2;
      if (!scrollable) return { skip: true, tag: el.tagName };
      return { tag: el.tagName, cls: el.className, aria: el.getAttribute('aria-label'),
        parentCls: el.parentElement?.className,
        scroll: `${el.scrollHeight}/${el.clientHeight}`,
        outline: `${cs.outlineWidth} ${cs.outlineStyle} ${cs.outlineColor}`, offset: cs.outlineOffset };
    });
    if (info === null) break;
    if ((info as any).skip) continue;
    rows.push({ stop: i + 1, ...info });
  }
  console.log(JSON.stringify(rows, null, 1));
  await b.close();
})();
