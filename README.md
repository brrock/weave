# Weave

A clean-room node editor for React (n8n/React Flow-style), built on shadcn/ui and distributed as a **shadcn registry**: you install the source into your project, the same way you install shadcn components.

## Install

```bash
npx shadcn@latest add https://raw.githubusercontent.com/brrock/weave/main/public/r/weave.json       # the canvas library
npx shadcn@latest add https://raw.githubusercontent.com/brrock/weave/main/public/r/weave-demo.json  # optional: the n8n-style workflow editor block
```

This installs `components/weave/*`, the `button`/`tooltip` components it needs, and the `weave-flow` CSS utility.

```tsx
import { Controls, MiniMap, Weave, createFlow, edge, Handle, type NodeProps } from "@/components/weave"

function Step({ data, selected }: NodeProps<{ label: string }>) {
  return (
    <div className={selected ? "rounded-lg border bg-card p-3 ring-2 ring-ring" : "rounded-lg border bg-card p-3"}>
      {data.label}
      <Handle id="in" type="target" />
      <Handle id="out" type="source" />
    </div>
  )
}

const flow = createFlow(
  [{ id: "a", type: "step", position: { x: 0, y: 0 }, data: { label: "A" } },
   { id: "b", type: "step", position: { x: 300, y: 0 }, data: { label: "B" } }],
  [edge("a", "out", "b", "in")],
)

<Weave flow={flow} nodeTypes={{ step: Step }} className="h-dvh">
  <Controls />
  <MiniMap nodeColor={(n) => "--color-violet-500"} /> {/* any CSS colour or custom property */}
</Weave>
```

`flow` is the whole API: `add`, `remove`, `connect`, `updateNode(Data)`, `select`, `fitView`, `zoomAt`, `subscribe`/`get` for persistence. Use `useStore(flow, selector)` outside the canvas and `useFlowState(selector)` inside nodes.

## Develop

```bash
bun install
bun dev                  # demo app at :5173
bun test                 # store tests
bun run registry:build   # writes public/r/*.json from registry.json
bun run e2e              # browser tests against a running `bun dev` (URL=… to override)
```

The e2e suite needs Chromium: `bunx playwright install chromium`, or point `CHROME_PATH` at any Chrome binary. `e2e/edges.mjs` asserts the editor's tricky interactions: insert-into-edge spacing, no stacked placement, no stray text selection, multi-select narrowing, and minimap dragging.

The registry is served straight from this repo's `public/r/` via raw.githubusercontent.com. After changing anything under `src/components/weave*`, run `bun run registry:build` and commit `public/r/`. If you host it elsewhere, update the `weave.json` URL in `weave-demo`'s `registryDependencies`.

Keep `src/index.css`'s Weave block in sync with the `css` fields in `registry.json`: that's what `shadcn add` writes into consumers' CSS.

## Performance notes

- Pan and zoom write the transform straight to the DOM, so React never renders while you move the viewport.
- Nodes and edges outside the viewport (plus a 240px margin) are unmounted. With 500 nodes at 100% zoom, about 35 are mounted.
- Each node and edge subscribes only to its own slice of state, so dragging one node re-renders just that node and its edges.
- The minimap draws to a canvas at most once per frame.
- Measured in headless Chromium with all 512 nodes on screen: ~1.2ms of JS per drag event, ~1ms per pan event.
