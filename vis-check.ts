import { chromium } from 'playwright-core';

const sizes = [[2560,1440],[1920,1080],[1440,900],[1280,720]];

const SCRIPT = `(() => {
  var out = { vw: innerWidth, vh: innerHeight };
  function grab(sel) {
    var el = document.querySelector(sel);
    if (!el) return null;
    var b = el.getBoundingClientRect();
    var cs = getComputedStyle(el);
    var kids = [];
    for (var i=0;i<el.children.length;i++){
      var c = el.children[i]; var cb = c.getBoundingClientRect();
      kids.push({ tag: c.tagName.toLowerCase(), cls: String(c.className), top:+cb.top.toFixed(1), bottom:+cb.bottom.toFixed(1), h:+cb.height.toFixed(1), mt: getComputedStyle(c).marginTop });
    }
    return { top:+b.top.toFixed(1), bottom:+b.bottom.toFixed(1), h:+b.height.toFixed(1), scrollH: el.scrollHeight, clientH: el.clientHeight, overflowY: cs.overflowY, display: cs.display, kids: kids };
  }
  out.familiar = grab('.familiar-panel');
  out.brief = grab('.brief-panel');
  var c = document.querySelector('.canvas-panel');
  if (c) { var cb = c.getBoundingClientRect(); out.canvas = { h:+cb.height.toFixed(1), w:+cb.width.toFixed(1), top:+cb.top.toFixed(1) }; }
  var sv = document.querySelector('.spell-canvas');
  if (sv) { var sb = sv.getBoundingClientRect(); out.spell = { h:+sb.height.toFixed(1), w:+sb.width.toFixed(1) }; }
  return out;
})()`;

(async () => {
  const b = await chromium.launch({ headless: true, executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
  for (const [w,h] of sizes) {
    const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
    const p = await ctx.newPage();
    await p.goto('http://localhost:4321/', { waitUntil: 'networkidle' });
    await p.waitForTimeout(1500);
    const r = await p.evaluate(SCRIPT);
    console.log('=== ' + w + 'x' + h + ' ===');
    console.log(JSON.stringify(r, null, 1));
    await p.screenshot({ path: '/private/tmp/shot-' + w + 'x' + h + '.png' });
    await ctx.close();
  }
  await b.close();
})();
