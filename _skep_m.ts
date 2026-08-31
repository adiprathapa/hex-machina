import { chromium } from "playwright-core";

const url = process.argv[2];
(async () => {
  const b = await chromium.launch({ headless: true, executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" });
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1" });
  const p = await ctx.newPage();
  await p.goto(url, { waitUntil: "networkidle" });
  await p.waitForTimeout(1500);
  const res = await p.evaluate(() => {
    const sel = "button, a, select, summary, input, [role=button], [tabindex]";
    const out: any[] = [];
    document.querySelectorAll<HTMLElement>(sel).forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) return;
      const cs = getComputedStyle(el);
      if (cs.visibility === "hidden" || cs.display === "none") return;
      out.push({
        tag: el.tagName,
        cls: el.className && typeof el.className === "string" ? el.className : "",
        text: (el.textContent || "").trim().slice(0, 40),
        h: Math.round(r.height * 100) / 100,
        minH: cs.minHeight,
      });
    });
    return {
      w: innerWidth,
      controlMinH: getComputedStyle(document.documentElement).getPropertyValue("--control-min-h"),
      overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      out,
    };
  });
  console.log("viewport innerWidth", res.w, "--control-min-h:", JSON.stringify(res.controlMinH), "overflow", res.overflow);
  const under = res.out.filter((o: any) => o.h < 44);
  console.log("TOTAL controls:", res.out.length, "UNDER 44:", under.length);
  for (const u of under) console.log("  ", u.h, u.tag, "|", u.cls, "|", u.text, "| minH:", u.minH);
  console.log("--- all heights ---");
  for (const o of res.out) console.log("  ", o.h, o.tag, "|", o.cls.slice(0,40), "|", o.text);
  await b.close();
})();
