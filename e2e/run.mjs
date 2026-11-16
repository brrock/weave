import { APP_URL, launch, shots as out } from "./browser.mjs";

const browser = await launch();
const page = await browser.newPage({
  viewport: { width: 1440, height: 860 },
  deviceScaleFactor: 2,
  colorScheme: "light",
});
const errors = [];
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
page.on("pageerror", (e) => errors.push(String(e)));

const log = (...a) => console.log(...a);
const center = async (sel) => {
  const b = await page.locator(sel).first().boundingBox();
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
};
const dragTo = async (from, to, steps = 12) => {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps });
  await page.mouse.up();
};
const count = () =>
  page.evaluate(() => ({
    nodes: document.querySelectorAll("[data-node-id]").length,
    edges: document.querySelectorAll("svg path[pointer-events=stroke]").length,
  }));

await page.goto(APP_URL);
await page.waitForTimeout(900);
log("initial", await count());
await page.screenshot({ path: out + "1-light.png" });

// Drag a node
const before = await page.locator('[data-node-id="sum"]').getAttribute("style");
const sumC = await center('[data-node-id="sum"] .text-sm');
await dragTo(sumC, { x: sumC.x + 80, y: sumC.y + 60 });
log("drag moved:", before !== (await page.locator('[data-node-id="sum"]').getAttribute("style")));

// Connect sum.out -> log.in by dragging between handles
await dragTo(
  await center('[data-node-id="sum"] [data-handle-id="out"]'),
  await center('[data-node-id="log"] .text-sm'),
  20,
);
log("after connect", await count());

// Hover an edge for its toolbar
const edgeBox = await page.evaluate(() => {
  const p = document.querySelector("svg path[pointer-events=stroke]");
  const l = p.getTotalLength(),
    pt = p.getPointAtLength(l / 2),
    m = p.getScreenCTM();
  return { x: pt.x * m.a + m.e, y: pt.y * m.d + m.f };
});
await page.mouse.move(edgeBox.x, edgeBox.y);
await page.waitForTimeout(250);
log("edge toolbar:", await page.locator('[aria-label="Insert node"]').count());
await page.screenshot({ path: out + "2-edge-hover.png" });

// Palette via Tab
await page.mouse.click(700, 760);
await page.keyboard.press("Tab");
await page.waitForTimeout(300);
await page.keyboard.type("http");
await page.screenshot({ path: out + "3-palette.png" });
await page.keyboard.press("Enter");
await page.waitForTimeout(400);
log("after palette add", await count());

// Box select + delete
await page.keyboard.down("Shift");
await dragTo({ x: 30, y: 640 }, { x: 1400, y: 820 });
await page.keyboard.up("Shift");
log(
  "selected after marquee:",
  await page.evaluate(() => document.querySelectorAll("[data-node-id][data-selected]").length),
);
await page.keyboard.press("Escape");

// Execute mid-run
await page.getByRole("button", { name: "Execute" }).click();
await page.waitForTimeout(1500);
await page.screenshot({ path: out + "4-running.png" });
await page.waitForTimeout(4000);

// Dark mode
await page.getByLabel("Toggle theme").click();
await page.waitForTimeout(300);
await page.screenshot({ path: out + "5-dark.png" });

// Stress: 500 more nodes, then time a drag
await page.getByRole("button", { name: "Add 500 nodes" }).click();
await page.waitForTimeout(1500);
log("after stress", await count());
await page.screenshot({ path: out + "6-stress.png" });
const stats = await page.evaluate(async () => {
  const el = document.querySelector("[data-node-id] .text-sm");
  const r = el.getBoundingClientRect();
  const opts = (x, y) => ({ clientX: x, clientY: y, bubbles: true, button: 0, pointerId: 1, isPrimary: true });
  el.dispatchEvent(new PointerEvent("pointerdown", opts(r.x + 5, r.y + 5)));
  const times = [];
  for (let i = 0; i < 60; i++) {
    const t = performance.now();
    window.dispatchEvent(new PointerEvent("pointermove", opts(r.x + 5 + i * 4, r.y + 5 + i * 2)));
    times.push(performance.now() - t);
    await new Promise((res) => requestAnimationFrame(() => res()));
  }
  window.dispatchEvent(new PointerEvent("pointerup", opts(0, 0)));
  times.sort((a, b) => a - b);
  return { median: times[30].toFixed(1), p95: times[57].toFixed(1) };
});
log("drag JS ms/event, 512 nodes all on screen:", stats);
const panStats = await page.evaluate(async () => {
  const root = document.querySelector("[data-weave]");
  const times = [];
  for (let i = 0; i < 60; i++) {
    const t = performance.now();
    root.dispatchEvent(
      new WheelEvent("wheel", { deltaX: 3, deltaY: 2, bubbles: true, cancelable: true, clientX: 600, clientY: 400 }),
    );
    times.push(performance.now() - t);
    await new Promise((res) => requestAnimationFrame(() => res()));
  }
  times.sort((a, b) => a - b);
  return { median: times[30].toFixed(1), p95: times[57].toFixed(1) };
});
log("pan JS ms/event:", panStats);

log("errors:", errors);
await browser.close();
