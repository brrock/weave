// Regressions for the edge cases seen in the screen recording.
import { APP_URL, launch, shots as out } from "./browser.mjs";
const b = await launch();
const p = await b.newPage({ viewport: { width: 1440, height: 860 }, deviceScaleFactor: 2, colorScheme: "dark" });
const errors = [];
p.on("pageerror", (e) => errors.push(String(e)));
await p.goto(APP_URL);
await p.waitForTimeout(800);
let failed = 0;
const check = (name, ok, extra = "") => {
  console.log(ok ? "PASS" : "FAIL", name, extra);
  if (!ok) failed++;
};
const c = async (s) => {
  const r = await p.locator(s).first().boundingBox();
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
};
const overlaps = () =>
  p.evaluate(() => {
    const rs = [...document.querySelectorAll("[data-node-id]:not([data-type=group]):not([data-type=note])")].map(
      (n) => [n.dataset.nodeId, n.firstElementChild.getBoundingClientRect()],
    );
    const out = [];
    for (let i = 0; i < rs.length; i++)
      for (let j = i + 1; j < rs.length; j++) {
        const [a, A] = rs[i],
          [bb, B] = rs[j];
        if (A.left < B.right && A.right > B.left && A.top < B.bottom && A.bottom > B.top) out.push(`${a}×${bb}`);
      }
    return out;
  });
const pick = async (q) => {
  await p.keyboard.type(q);
  await p.waitForTimeout(150);
  await p.keyboard.press("Enter");
  await p.waitForTimeout(400);
};
const selection = () => p.evaluate(() => getSelection().toString());

// 1. Insert into a short edge: neighbours make room, nothing overlaps
const mid = await p.evaluate(() => {
  const all = [...document.querySelectorAll("svg path[pointer-events=stroke]")];
  const pts = all.map((pp) => {
    const l = pp.getTotalLength(),
      q = pp.getPointAtLength(l / 2),
      m = pp.getScreenCTM();
    return { x: q.x * m.a + m.e, y: q.y * m.d + m.f };
  });
  return pts[0]; // hook -> enrich
});
await p.mouse.move(mid.x, mid.y);
await p.waitForTimeout(200);
await p.getByLabel("Insert node").click();
await p.waitForTimeout(250);
await pick("AI agent");
check("insert into edge leaves no overlaps", (await overlaps()).length === 0, await overlaps());

// 2. Drag backwards from an input to empty space, add a trigger: must not land on the existing trigger
await p.keyboard.press("Escape");
const input = await c('[data-node-id="rows"] [data-handle-id="in"]');
await p.mouse.move(input.x, input.y);
await p.mouse.down();
await p.mouse.move(input.x - 150, input.y + 140, { steps: 8 });
await p.mouse.up();
await p.waitForTimeout(300);
await pick("Schedule");
check("node added before an input leaves no overlaps", (await overlaps()).length === 0, await overlaps());

// 3. Add node from header (viewport centre) repeatedly: never stacks
for (let i = 0; i < 3; i++) {
  await p.getByLabel("Add node", { exact: true }).click();
  await p.waitForTimeout(250);
  await pick("Wait");
}
check("repeated Add node never stacks", (await overlaps()).length === 0, await overlaps());

// 4. Text selection: header selection is cleared by a canvas drag; rapid clicks on nodes never select text
await p.mouse.move(60, 30);
await p.mouse.down();
await p.mouse.move(400, 40, { steps: 5 });
await p.mouse.up();
const n = await c('[data-node-id="sum"] .text-sm');
await p.mouse.move(n.x, n.y);
await p.mouse.down();
await p.mouse.move(n.x + 40, n.y + 20, { steps: 4 });
await p.mouse.up();
check("canvas drag clears stale text selection", (await selection()) === "", JSON.stringify(await selection()));
for (let i = 0; i < 4; i++) await p.mouse.click(n.x + 40, n.y + 20, { clickCount: i + 1, delay: 10 });
await p.mouse.click(700, 120, { clickCount: 3 });
check("multi-clicks select no text", (await selection()) === "", JSON.stringify(await selection()));

// 5. Click (no drag) on one node of a multi-selection narrows to it
const a = await c('[data-node-id="mail"] .text-sm'),
  bb = await c('[data-node-id="sales"] .text-sm');
await p.mouse.click(a.x, a.y);
await p.keyboard.down("Shift");
await p.mouse.click(bb.x, bb.y);
await p.keyboard.up("Shift");
const before = await p.getByText(/selected$/).innerText();
await p.mouse.click(a.x, a.y);
await p.waitForTimeout(100);
check(
  "click narrows multi-selection",
  before.startsWith("2") && (await p.getByText(/selected$/).innerText()).startsWith("1"),
  `${before} -> ${await p.getByText(/selected$/).innerText()}`,
);

// 6. Minimap: dragging the viewport window pans relatively (no jump on grab)
await p.locator('[aria-label="Fit view"]').click();
await p.waitForTimeout(400);
await p.locator('[aria-label="Zoom in"]').click();
await p.locator('[aria-label="Zoom in"]').click();
await p.waitForTimeout(400);
const mm = await p.locator('canvas[aria-label="Minimap"]').boundingBox();
const vp0 = await p.evaluate(() => document.querySelector("[data-weave] > div:nth-child(2)").style.transform);
await p.mouse.move(mm.x + mm.width / 2, mm.y + mm.height / 2);
await p.mouse.down();
await p.mouse.up();
const vp1 = await p.evaluate(() => document.querySelector("[data-weave] > div:nth-child(2)").style.transform);
check("grabbing minimap viewport doesn't jump", vp0 === vp1, `${vp0} vs ${vp1}`);
await p.screenshot({ path: out + "7-after-edits.png" });
await p.locator('canvas[aria-label="Minimap"]').screenshot({ path: out + "8-minimap.png" });

check("no page errors", errors.length === 0, errors);
await b.close();
process.exit(failed ? 1 : 0);
