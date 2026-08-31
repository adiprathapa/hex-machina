import { chromium } from 'playwright-core';
const EXE = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const SCRIPT = `(() => {
  var out = { vp: [innerWidth, innerHeight] };
  function pick(sel) {
    var el = document.querySelector(sel);
    if (!el) return null;
    var bb = el.getBoundingClientRect();
    var kids = Array.prototype.map.call(el.children, function(c) {
      var k = c.getBoundingClientRect();
      return { cls: String(c.className).slice(0,45), tag: c.tagName, top: +k.top.toFixed(1), bottom: +k.bottom.toFixed(1), h: +k.height.toFixed(1) };
    });
    var last = kids[kids.length-1];
    var cs = getComputedStyle(el);
    return { h: +bb.height.toFixed(1), top: +bb.top.toFixed(1), bottom: +bb.bottom.toFixed(1), scrollH: el.scrollHeight, display: cs.display, flexDir: cs.flexDirection, overflowY: cs.overflowY, kids: kids, tailGap: last ? +(bb.bottom - last.bottom).toFixed(1) : null };
  }
  out.familiar = pick('.familiar-panel');
  out.brief = pick('.brief-panel');
  var tc = document.querySelector('.familiar-panel .tool-console');
  out.toolConsole = tc ? { bottom: +tc.getBoundingClientRect().bottom.toFixed(1), open: tc.open } : null;
  var ctl = document.querySelector('.brief-panel .controls');
  var wish = document.querySelector('.brief-panel .wish');
  out.controlsBottom = ctl ? +ctl.getBoundingClientRect().bottom.toFixed(1) : null;
  out.wishTop = wish ? +wish.getBoundingClientRect().top.toFixed(1) : null;
  out.wishMarginTop = wish ? getComputedStyle(wish).marginTop : null;
  out.docScrollH = document.documentElement.scrollHeight;
  var cv = document.querySelector('.canvas-panel');
  out.canvas = cv ? { h: +cv.getBoundingClientRect().height.toFixed(1), w: +cv.getBoundingClientRect().width.toFixed(1) } : null;
  return out;
})()`;
(async () => {
  const b = await chromium.launch({ headless: true, executablePath: EXE });
  for (const vp of [{width:2560,height:1440},{width:1920,height:1080},{width:1440,height:900},{width:1280,height:720}]) {
    const p = await b.newPage({ viewport: vp, deviceScaleFactor: 1 });
    await p.goto('http://localhost:4321/', { waitUntil: 'networkidle' });
    await p.waitForTimeout(2500);
    const r = await p.evaluate(SCRIPT);
    console.log('=== ' + vp.width + 'x' + vp.height);
    console.log(JSON.stringify(r, null, 1));
    await p.screenshot({ path: '/private/tmp/skep-' + vp.width + '.png' });
    await p.close();
  }
  await b.close();
})();
