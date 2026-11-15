import { APP_URL, launch, shots as out } from "./browser.mjs"
const browser = await launch()
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, hasTouch: true, isMobile: true, colorScheme: "dark" })
const page = await ctx.newPage()
const errors = []
page.on("pageerror", (e) => errors.push(String(e)))
page.on("console", (m) => m.type() === "error" && errors.push(m.text()))
await page.goto(APP_URL)
await page.waitForTimeout(900)
await page.screenshot({ path: out + "m1.png" })

const cdp = await ctx.newCDPSession(page)
const touch = (type, pts) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: pts.map(([x, y], id) => ({ x, y, id })) })
const zoom = () => page.evaluate(() => Number(document.querySelector('[aria-label="Reset zoom"]').textContent.replace("%", "")))
const z0 = await zoom()
// Pinch out from 100px apart to 260px apart, centred on the canvas
await touch("touchStart", [[145, 450], [245, 450]])
for (let i = 1; i <= 10; i++) await touch("touchMove", [[145 - i * 8, 450], [245 + i * 8, 450]])
await touch("touchEnd", [])
await page.waitForTimeout(100)
console.log("pinch zoom", z0, "->", await zoom())

// Tap a node -> selection bar
const box = await page.locator('[data-node-id] .text-sm').first().boundingBox()
await page.touchscreen.tap(box.x + 10, box.y + 5)
await page.waitForTimeout(250)
console.log("selection bar:", await page.getByText(/selected$/).count())
await page.screenshot({ path: out + "m2-selected.png" })

// Long-press empty canvas then drag -> marquee
const [ex, ey] = await page.evaluate(() => {
  const root = document.querySelector("[data-weave]")
  for (let y = 700; y > 100; y -= 20) for (let x = 100; x < 300; x += 20) if (document.elementFromPoint(x, y) === root) return [x, y]
})
await touch("touchStart", [[ex, ey]])
await page.waitForTimeout(500)
for (let i = 1; i <= 8; i++) await touch("touchMove", [[ex + i * 20, ey - i * 40]])
const marquee = await page.evaluate(() => !!document.querySelector(".bg-primary\\/8"))
await touch("touchEnd", [])
console.log("long-press marquee:", marquee)

// Stress + culling
await page.getByRole("button", { name: "Add 500 nodes" }).click()
await page.waitForTimeout(1200)
await page.locator('[aria-label="Reset zoom"]').click()
await page.waitForTimeout(500)
console.log("mounted nodes at 100% zoom:", await page.locator("[data-node-id]").count(), "of", await page.evaluate(() => document.querySelector(".tabular-nums")?.textContent))
await page.screenshot({ path: out + "m3-stress.png" })
console.log("errors:", errors)
await browser.close()
