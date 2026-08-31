import { chromium } from 'playwright-core';
(async () => {
  const b = await chromium.launch({ headless: true, executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
  for (const vp of [{width:1280,height:720},{width:1440,height:900}]) {
    const p = await b.newPage({ viewport: vp });
    await p.goto('http://localhost:4321/', { waitUntil: 'networkidle' });
    await p.waitForTimeout(1500);
    const out = await p.evaluate(() => {
      const g = (sel: string) => {
        const e = document.querySelector(sel) as HTMLElement | null;
        if (!e) return { sel, missing: true };
        const r = e.getBoundingClientRect();
        const cs = getComputedStyle(e);
        return { sel, top: +r.top.toFixed(1), bottom: +r.bottom.toFixed(1), h: +r.height.toFixed(1),
          clientH: e.clientHeight, scrollH: e.scrollHeight, overflowY: cs.overflowY, text: (e.textContent||'').slice(0,60) };
      };
      const btns = Array.from(document.querySelectorAll('button')).map(e => {
        const r = e.getBoundingClientRect();
        return { cls: e.className, txt: (e.textContent||'').trim().slice(0,30), top:+r.top.toFixed(1), bottom:+r.bottom.toFixed(1), w:+r.width.toFixed(1) };
      });
      return { innerH: innerHeight, innerW: innerWidth, docScrollH: document.documentElement.scrollHeight,
        bodyOverflow: getComputedStyle(document.body).overflow,
        panels: ['.brief-panel','.familiar-panel','ol.quest-steps','blockquote.wish','button.primary','.agent-brief-prompt'].map(g),
        btns };
    });
    console.log(JSON.stringify({ vp, out }, null, 1));
    await p.screenshot({ path: `/private/tmp/skepvis/shot-${vp.width}.png` });
    await p.close();
  }
  await b.close();
})();
