// Theming: shadcn tokens and --weave-* overrides reach every part of the canvas, including nested themes.
import { APP_URL, launch, shots } from "./browser.mjs";
const b = await launch();
const p = await b.newPage({ viewport: { width: 1440, height: 860 }, deviceScaleFactor: 2, colorScheme: "light" });
const errors = [];
p.on("pageerror", (e) => errors.push(String(e)));
await p.goto(APP_URL);
await p.waitForTimeout(800);
let failed = 0;
const check = (name, ok, extra = "") => {
  console.log(ok ? "PASS" : "FAIL", name, extra);
  if (!ok) failed++;
};
// The visible edge path follows its invisible hit-area path. Colours transition, so let that settle first.
const stroke = async () => (
  await p.waitForTimeout(300),
  p.evaluate(() => getComputedStyle(document.querySelector("svg path[pointer-events=stroke] + path")).stroke)
);
const nudge = async () => {
  await p.mouse.move(700, 150);
  await p.mouse.wheel(1, 0);
  await p.waitForTimeout(120);
};
// Count minimap pixels close to an RGB colour.
const minimapHits = (rgb) =>
  p.evaluate(([r, g, bl]) => {
    const c = document.querySelector('canvas[aria-label="Minimap"]');
    const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
    let n = 0;
    for (let i = 0; i < d.length; i += 4)
      if (Math.abs(d[i] - r) < 40 && Math.abs(d[i + 1] - g) < 40 && Math.abs(d[i + 2] - bl) < 40 && d[i + 3] > 200) n++;
    return n;
  }, rgb);

// 1. --weave-edge on :root restyles resting edges and the minimap's connections
await p.evaluate(() => document.documentElement.style.setProperty("--weave-edge", "rgb(0, 128, 255)"));
check("--weave-edge on :root", (await stroke()) === "rgb(0, 128, 255)", await stroke());
await nudge();
check("minimap follows --weave-edge", (await minimapHits([0, 128, 255])) > 20);

// 2. A theme scoped to the canvas (nested shadcn theme) recolours selection + minimap
await p.evaluate(() => document.querySelector("[data-weave]").style.setProperty("--primary", "rgb(220, 20, 60)"));
const mid = await p.evaluate(() => {
  const pp = document.querySelector("svg path[pointer-events=stroke]"),
    q = pp.getPointAtLength(pp.getTotalLength() / 2),
    m = pp.getScreenCTM();
  return { x: q.x * m.a + m.e, y: q.y * m.d + m.f };
});
await p.mouse.click(mid.x, mid.y);
check("nested --primary colours the selected edge", (await stroke()) === "rgb(220, 20, 60)", await stroke());
await nudge();
check("minimap viewport follows nested --primary", (await minimapHits([220, 20, 60])) > 20);

// 3. Ports
await p.evaluate(() => document.documentElement.style.setProperty("--weave-handle", "rgb(255, 140, 0)"));
await p.waitForTimeout(300);
const port = await p.evaluate(() => getComputedStyle(document.querySelector("[data-handle-id]")).borderTopColor);
check("--weave-handle colours ports", port === "rgb(255, 140, 0)", port);

// 4. Dark mode still flips tokens (card colour changes)
const card = () => p.evaluate(() => getComputedStyle(document.querySelector("[data-node-id] > *")).backgroundColor);
const light = await card();
await p.getByLabel("Toggle theme").click();
await p.waitForTimeout(200);
check("dark mode flips node surfaces", light !== (await card()), `${light} -> ${await card()}`);
await p.screenshot({ path: shots + "9-themed.png" });

check("no page errors", errors.length === 0, errors);
await b.close();
process.exit(failed ? 1 : 0);
