# Weave

A clean-room node editor for React (n8n/React Flow-style), built on shadcn/ui and distributed as a **shadcn registry**: you install the source into your project, the same way you install shadcn components.

## Install

```bash
npx shadcn@latest add https://raw.githubusercontent.com/brrock/weave/registry/stable/weave.json       # the canvas library
npx shadcn@latest add https://raw.githubusercontent.com/brrock/weave/registry/stable/weave-demo.json  # optional: n8n-style workflow editor block
```

### Channels

Swap `stable` in the URL for the channel you want:

| Channel | URL segment                  | Updated                        |
| ------- | ---------------------------- | ------------------------------ |
| Stable  | `stable`                     | each published GitHub release  |
| Nightly | `nightly`                    | every commit to `main`         |
| Pinned  | a release tag, e.g. `v0.1.0` | never (frozen at that release) |

A channel's items only depend on that same channel, so `weave-demo` from nightly pulls nightly `weave`. Each item's `meta` records the `version` and `commit` it was built from. Allow about 5 minutes after a publish for GitHub's raw-file cache to refresh.

This installs `components/weave/*`, the `button`/`tooltip` components it needs, and Weave's CSS: the port styles and the `weave-flow` utility (the flowing-edge beads).

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

`flow` is the whole API: `add`, `remove`, `connect`, `updateNode(Data)`, `updateEdge`, `select`, `fitView`, `zoomAt`, `subscribe`/`get` for persistence. Use `useStore(flow, selector)` outside the canvas and `useFlowState(selector)` inside nodes.

## Undo and redo

Every document change made through `flow` (`add`, `remove`, `connect`, `moveNodes`, `updateNode(Data)`, `updateEdge`, `setEdges`, and the clipboard, group and layout helpers below) is recorded; selection, viewport and `flow.set` are not. ⌘/Ctrl+Z undoes and ⇧⌘/Ctrl+Z redoes while the canvas has focus, and a node drag is a single step.

| API                             | Does                                                                         |
| ------------------------------- | ---------------------------------------------------------------------------- |
| `flow.undo()` / `flow.redo()`   | step back / forward (the last 100 steps are kept)                            |
| `flow.canUndo` / `flow.canRedo` | whether there is a step; read with `useStore(flow, () => flow.canUndo)`      |
| `flow.batch(fn)`                | runs `fn` as one step, e.g. a node insert that also rewires edges            |
| `flow.begin()`                  | opens a batch and returns `end()`, for steps that span events (custom drags) |
| `flow.untracked(fn)`            | runs `fn` without recording it, for transient state such as run status       |

```tsx
flow.batch(() => {
  flow.add([node]);
  flow.connect(from, to);
});
flow.untracked(() => flow.updateNodeData(id, { status: "running" }));
```

## Edges

An edge is plain data; these optional fields control how it looks:

| Field       | Does                                                                                                       |
| ----------- | ---------------------------------------------------------------------------------------------------------- |
| `animated`  | draws beads flowing source → target over a faint track (a solid line under `prefers-reduced-motion`)       |
| `kind`      | app-defined category, rendered as `data-kind` on the edge's `<g>` so CSS can target it                     |
| `className` | classes for the edge's `<g>`; SVG stroke properties and `--weave-edge*` variables set here reach its paths |
| `data`      | anything your app needs; Weave never reads it                                                              |
| `label`     | shown on the edge in canvas space, so it pans and zooms with it: a string or any React node                |
| `labelAt`   | where the label sits along the edge, `0` (source) to `1` (target); default `0.5`                           |

```tsx
// A dotted "tool" connection, a little heavier than the rest.
{ ...edge("search", "out", "agent", "tools"), kind: "tool", className: "[stroke-dasharray:0.01_6] [stroke-linecap:round] [--weave-edge-width:2.5px]" }
flow.updateEdge(id, { animated: true, label: "stream · 14 values" }) // data is flowing
```

Each edge renders as `<g data-edge-id data-kind data-selected data-animated>` around its visible path(s), so plain CSS works too: `[data-kind="tool"] path { stroke-dasharray: 2 4 }`. Labels render as `<div data-edge-label="<edge id>" data-kind>` (card surface, muted text); they ignore the pointer so hovering one still reaches the edge. Keep labels strings if you persist or copy edges.

## Handles

`<Handle>` only positions the port (and widens its hit area); its look is plain CSS in `@layer components` with zero specificity, so a class on the handle or any app stylesheet wins without `!important`. Restyle through the variables below or the handle's attributes:

| Attribute        | Values                                                         |
| ---------------- | -------------------------------------------------------------- |
| `data-handle-id` | the handle's `id`                                              |
| `data-type`      | `source` or `target`                                           |
| `data-side`      | `left`, `right`, `top` or `bottom`                             |
| `data-connected` | `true` when at least one edge uses it                          |
| `data-state`     | `valid` (a connection drag could end here) or `over` (it will) |

```css
.port {
  width: 11px;
  height: 11px;
  border-width: 1.5px;
} /* <Handle className="port" … /> */
[data-type="source"][data-connected="true"] {
  --weave-handle-fill: var(--weave-handle);
}
```

## Theming

Weave uses your shadcn theme as-is. Surfaces, borders, focus rings, selection and the minimap all read `--background`, `--card`, `--border`, `--primary`, `--muted-foreground`, `--ring` and `--radius`, so light/dark mode and custom themes apply automatically. That includes themes scoped to a subtree, such as a `.theme-blue` wrapper.

To restyle the canvas itself, set any of these variables on `:root`, on a theme class, or on one `<Weave className="…">`:

| Variable                      | Styles                                           | Default                     |
| ----------------------------- | ------------------------------------------------ | --------------------------- |
| `--weave-dot`                 | background dot grid                              | `--muted-foreground` at 35% |
| `--weave-edge`                | resting connections (canvas and minimap)         | `--muted-foreground` at 45% |
| `--weave-edge-hover`          | hovered connection                               | `--foreground` at 70%       |
| `--weave-edge-selected`       | selected connection, in-progress connection line | `--primary`                 |
| `--weave-edge-flow`           | animated connections (`edge.animated`)           | `--primary`                 |
| `--weave-edge-width`          | resting and hovered connection stroke width      | `1.75px`                    |
| `--weave-edge-width-selected` | selected connection stroke width                 | `2.5px`                     |
| `--weave-handle`              | port outlines                                    | `--muted-foreground` at 60% |

```tsx
<Weave className="[--weave-edge-flow:var(--color-emerald-500)]" … />
```
