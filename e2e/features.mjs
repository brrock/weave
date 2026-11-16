// The editor features apps build on: edge appearance and labels, handle styling, notes, groups,
// clipboard, history and auto-layout.
import { APP_URL, launch, shots } from "./browser.mjs";

const b = await launch();
const errors = [];
let failed = 0;
const check = (name, ok, extra = "") => {
  console.log(ok ? "PASS" : "FAIL", name, extra);
  if (!ok) failed++;
};
const open = async (opts = {}) => {
  const p = await b.newPage({ viewport: { width: 1440, height: 860 }, colorScheme: "light", ...opts });
  p.on("pageerror", (e) => errors.push(String(e)));
  await p.goto(APP_URL);
  await p.waitForTimeout(800);
  return p;
};
const css = (p, sel, prop) => p.evaluate(([s, k]) => getComputedStyle(document.querySelector(s))[k], [sel, prop]);

// ---- per-edge appearance ----
let p = await open();
const tool = '[data-edge-id="search:out->enrich:tools"]';
check("edge kind is exposed as data-kind", (await p.locator(tool).getAttribute("data-kind")) === "tool");
check("edge className styles its paths", (await css(p, `${tool} path`, "strokeDasharray")) === "0.01px, 6px");
const rest = '[data-edge-id="hook:out->enrich:in"] path';
check(
  "default edge width is 1.75px",
  (await css(p, rest, "strokeWidth")) === "1.75px",
  await css(p, rest, "strokeWidth"),
);
await p.evaluate(() => document.documentElement.style.setProperty("--weave-edge-width", "1.25px"));
check("--weave-edge-width sets the width", (await css(p, rest, "strokeWidth")) === "1.25px");
await p.getByRole("button", { name: "Execute" }).click();
await p.waitForTimeout(900);
const flowing = '[data-edge-id="hook:out->enrich:in"][data-animated] path';
check("animated edge draws a track and beads", (await p.locator(flowing).count()) === 2);
check("beads are round dots every 14px", (await css(p, `${flowing}.weave-flow`, "strokeDasharray")) === "0.01px, 14px");
await p.screenshot({ path: shots + "f1-flow.png" });

// ---- edge labels ----
const labelOnPath = () =>
  p.evaluate(() => {
    const id = "hook:out->enrich:in";
    const l = document.querySelector(`[data-edge-label="${id}"]`).getBoundingClientRect();
    const path = document.querySelector(`[data-edge-id="${id}"] path`);
    const q = path.getPointAtLength(path.getTotalLength() / 2),
      m = path.getScreenCTM();
    return Math.hypot(l.x + l.width / 2 - (q.x * m.a + m.e), l.y + l.height / 2 - (q.y * m.d + m.f));
  });
check("label renders text", (await p.locator('[data-edge-label="hook:out->enrich:in"]').innerText()) === "1 item");
check("label sits on the edge midpoint", (await labelOnPath()) < 2, await labelOnPath());
await p.mouse.move(700, 600);
await p.mouse.wheel(-120, 80);
await p.keyboard.down("Meta");
await p.mouse.wheel(0, -60);
await p.keyboard.up("Meta");
await p.waitForTimeout(100);
check("label pans and zooms with the edge", (await labelOnPath()) < 2, await labelOnPath());
const at = (await p.locator('[data-edge-label="search:out->enrich:tools"]').boundingBox()).x;
const mid = await p.evaluate(() => {
  const path = document.querySelector('[data-edge-id="search:out->enrich:tools"] path');
  const q = path.getPointAtLength(path.getTotalLength() / 2),
    m = path.getScreenCTM();
  return q.x * m.a + m.e;
});
check("labelAt moves the label toward the source", at < mid);
await p.close();

p = await open({ reducedMotion: "reduce" });
await p.getByRole("button", { name: "Execute" }).click();
await p.waitForTimeout(900);
check("reduced motion draws a solid line", (await css(p, `${flowing}.weave-flow`, "strokeDasharray")) === "none");
await p.close();

check("no page errors", errors.length === 0, errors);
await b.close();
process.exit(failed ? 1 : 0);
