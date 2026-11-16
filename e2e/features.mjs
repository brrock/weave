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

// ---- handles: positioned by the component, styled by CSS variables and data-* ----
p = await open();
const out = '[data-node-id="hook"] [data-handle-id="out"]';
check("handle exposes data-type", (await p.locator(out).getAttribute("data-type")) === "source");
check(
  "handle is a 12px ring by default",
  (await css(p, out, "width")) === "12px" && (await css(p, out, "borderRadius")) === "9999px",
);
check(
  "utilities on <Handle> override the look",
  (await css(p, '[data-node-id="enrich"] [data-handle-id="in"]', "width")) === "8px",
);
await p.evaluate(() => document.documentElement.style.setProperty("--weave-handle-size", "16px"));
check("--weave-handle-size resizes ports", (await css(p, out, "width")) === "16px");
await p.addStyleTag({ content: '[data-type="source"][data-connected="true"] { background: rgb(1, 2, 3) }' });
await p.waitForTimeout(300); // ports transition their colours
check("plain CSS on data-* restyles ports", (await css(p, out, "backgroundColor")) === "rgb(1, 2, 3)");
const box = await p.locator('[data-node-id="sum"] [data-handle-id="out"]').boundingBox();
const target = await p.locator('[data-node-id="log"] [data-handle-id="in"]').boundingBox();
await p.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
await p.mouse.down();
await p.mouse.move(target.x + 4, target.y + 4, { steps: 10 });
await p.waitForTimeout(300);
const over = await p.evaluate(() => {
  const h = document.querySelector('[data-node-id="log"] [data-handle-id="in"]');
  const primary = h.appendChild(document.createElement("i"));
  primary.style.color = "var(--primary)";
  return [h.dataset.state, getComputedStyle(h).backgroundColor, getComputedStyle(primary).color];
});
check("a port under a connection drag fills with --primary", over[0] === "over" && over[1] === over[2], over);
await p.mouse.up();
await p.close();

// ---- undo / redo ----
p = await open();
const pos = (id) => p.locator(`[data-node-id="${id}"]`).evaluate((el) => el.style.transform);
const undoBtn = p.getByLabel("Undo", { exact: true });
check("nothing to undo at first", await undoBtn.isDisabled());
await p.getByRole("button", { name: "Execute" }).click();
await p.waitForTimeout(400);
check("a run is not an undo step", await undoBtn.isDisabled());
const start = await pos("sum");
const grip = await p.locator('[data-node-id="sum"] .text-sm').first().boundingBox();
await p.mouse.move(grip.x + 5, grip.y + 5);
await p.mouse.down();
for (let i = 1; i <= 10; i++) await p.mouse.move(grip.x + 5 + i * 15, grip.y + 5 + i * 8);
await p.mouse.up();
const moved = await pos("sum");
await p.keyboard.press("ControlOrMeta+z");
check("⌘Z undoes a whole drag in one step", (await pos("sum")) === start && moved !== start);
await p.keyboard.press("ControlOrMeta+Shift+z");
check("⇧⌘Z redoes it", (await pos("sum")) === moved);
await p.keyboard.press("Backspace");
check("delete removes the node", (await p.locator('[data-node-id="sum"]').count()) === 0);
await undoBtn.click();
check(
  "Undo restores the node and its edge",
  (await p.locator('[data-node-id="sum"]').count()) === 1 &&
    (await p.locator('[data-edge-id="rows:out->sum:in"]').count()) === 1,
);
await p.close();

// ---- clipboard ----
p = await open();
await p.context().grantPermissions(["clipboard-read", "clipboard-write"]);
const count = () =>
  p.evaluate(() => [
    document.querySelectorAll("[data-node-id]").length,
    document.querySelectorAll("[data-edge-id]").length,
  ]);
const click = async (id, shift = false) => {
  const r = await p.locator(`[data-node-id="${id}"] .text-sm`).first().boundingBox();
  if (shift) await p.keyboard.down("Shift");
  await p.mouse.click(r.x + 5, r.y + 5);
  if (shift) await p.keyboard.up("Shift");
};
const [n0, e0] = await count();
await click("rows");
await click("sum", true);
await p.keyboard.press("ControlOrMeta+c");
const copied = await p.evaluate(() => navigator.clipboard.readText());
check(
  "⌘C puts the selection on the clipboard as JSON",
  JSON.parse(copied).nodes.length === 2 && JSON.parse(copied).edges.length === 1,
);
await p.mouse.move(900, 720);
await p.keyboard.press("ControlOrMeta+v");
await p.waitForTimeout(100);
const [n1, e1] = await count();
check("⌘V pastes nodes and the edge between them", n1 === n0 + 2 && e1 === e0 + 1, [n0, e0, n1, e1]);
const pasted = await p.evaluate(() => {
  const sel = [...document.querySelectorAll("[data-node-id]")].filter((n) => n.style.zIndex === "1");
  return sel.map((n) => [n.dataset.nodeId, n.getBoundingClientRect().left, n.getBoundingClientRect().top]);
});
check(
  "pasted nodes get new ids and the selection",
  pasted.length === 2 && pasted.every(([id]) => id !== "rows" && id !== "sum"),
  pasted,
);
const left = Math.min(...pasted.map((x) => x[1])),
  top = Math.min(...pasted.map((x) => x[2]));
check("paste lands at the pointer", Math.abs(left - 900) < 20 && Math.abs(top - 720) < 20, [left, top]);
await p.keyboard.press("ControlOrMeta+x");
check("⌘X cuts the selection", (await count())[0] === n0);
await p.keyboard.press("ControlOrMeta+z");
check("cut is undoable", (await count())[0] === n0 + 2);
await click("hook");
await p.keyboard.press("ControlOrMeta+d");
check("⌘D duplicates", (await count())[0] === n0 + 3);
await p.close();

check("no page errors", errors.length === 0, errors);

await b.close();
process.exit(failed ? 1 : 0);
