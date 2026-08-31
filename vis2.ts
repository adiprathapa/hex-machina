import { chromium } from 'playwright-core';
const S = `(() => {
  var el = document.querySelector('.familiar-panel');
  var b = el.getBoundingClientRect();
  var last = el.children[el.children.length-1].getBoundingClientRect();
  return { panelH:+b.height.toFixed(1), panelBottom:+b.bottom.toFixed(1), lastBottom:+last.bottom.toFixed(1), scrollH: el.scrollHeight, clientH: el.clientHeight };
})()`;
(async () => {
  const br = await chromium.launch({ headless: true, executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
  const ctx = await br.newContext({ viewport: { width: 2560, height: 1440 } });
  const p = await ctx.newPage();
  await p.goto('http://localhost:4321/', { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(1500);
  console.log('collapsed', JSON.stringify(await p.evaluate(S)));
  await p.evaluate(`document.querySelectorAll('.familiar-panel details').forEach(d => d.open = true)`);
  await p.waitForTimeout(600);
  console.log('expanded', JSON.stringify(await p.evaluate(S)));
  await p.screenshot({ path: '/private/tmp/shot-expanded.png' });
  await br.close();
})();
