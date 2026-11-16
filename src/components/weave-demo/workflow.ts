import { DEFAULT_SIZE, createFlow, edge, type Flow, type FlowEdge, type FlowNode, type XY } from "@/components/weave";
import { CATALOG, byKey, type CatalogItem } from "./catalog";
import type { PaletteTarget, StepData } from "./nodes";

const step = (id: string, key: string, label: string, x: number, y: number): FlowNode<StepData> => ({
  id,
  type: "step",
  position: { x, y },
  data: { key, label },
});

export function seedFlow() {
  return createFlow(
    [
      // A group frames nodes whose `parent` is its id; drag its title bar or collapse it.
      {
        id: "digest",
        type: "group",
        position: { x: -40, y: 260 },
        size: { w: 1060, h: 180 },
        data: { title: "Nightly digest" },
      },
      {
        id: "note",
        type: "note",
        position: { x: 0, y: -260 },
        data: {
          text: "## Lead routing\n- **Drag** from a port to connect\n- Double-click a node to edit it, or a note to write\n- Hover a connection to *insert* a step\n- `Tab` opens the node palette",
        },
      },
      step("hook", "webhook", "New signup", 0, 0),
      step("enrich", "ai", "Enrich lead", 360, 0),
      step("check", "if", "Is enterprise?", 720, -8),
      step("mail", "email", "Welcome email", 1080, -120),
      step("sales", "chat", "Notify sales", 1080, 100),
      step("join", "merge", "Combine", 1440, -16),
      step("log", "db", "Log result", 1800, 0),
      { ...step("cron", "schedule", "Every morning", 0, 320), parent: "digest" },
      { ...step("rows", "db", "Fetch new rows", 360, 320), parent: "digest" },
      { ...step("sum", "code", "Summarize", 720, 320), parent: "digest" },
      step("search", "http", "Search the web", 100, 160),
    ],
    [
      edge("hook", "out", "enrich", "in"),
      edge("enrich", "out", "check", "in"),
      edge("check", "true", "sales", "in"),
      edge("check", "false", "mail", "in"),
      edge("mail", "out", "join", "a"),
      edge("sales", "out", "join", "b"),
      edge("join", "out", "log", "in"),
      edge("cron", "out", "rows", "in"),
      edge("rows", "out", "sum", "in"),
      // Per-edge appearance: a dotted "tool" connection (className styles the edge's paths).
      {
        ...edge("search", "out", "enrich", "tools"),
        kind: "tool",
        label: "tool",
        labelAt: 0.3,
        className: "[stroke-dasharray:0.01_6] [stroke-linecap:round] [--weave-edge-width:2.5px]",
      },
    ],
  );
}

const GAP = 360;

/** Adds a sticky note in the middle of the view. */
export function addNote(flow: Flow) {
  const at = flow.el
    ? flow.screenToFlow({ x: flow.el.clientWidth / 2 - 120, y: flow.el.clientHeight / 2 - 60 })
    : { x: 0, y: 0 };
  const id = Math.random().toString(36).slice(2, 10);
  flow.add([
    { id, type: "note", position: freeSpot(flow, at), data: { text: "### Note\nDouble-click to write **markdown**." } },
  ]);
  flow.select([id]);
}

/** Nodes reachable from `start` along edges, excluding `stop` (cycle-safe). */
function downstream(flow: Flow, start: string, stop: string) {
  const { edges } = flow.get();
  const seen = new Set([start]);
  for (const id of seen) for (const e of edges) if (e.source === id && e.target !== stop) seen.add(e.target);
  return [...seen];
}

/** Moves `pos` down until a node-sized box there overlaps nothing. */
function freeSpot(flow: Flow, pos: XY): XY {
  const s = flow.get();
  const m = 24;
  const hits = (y: number) =>
    Object.values(s.nodes).some(({ id, position: p }) => {
      const z = s.sizes[id] ?? DEFAULT_SIZE;
      return pos.x < p.x + z.w + m && pos.x + 256 + m > p.x && y < p.y + z.h + m && y + 64 + m > p.y;
    });
  let y = pos.y;
  for (let i = 0; i < 50 && hits(y); i++) y += 100;
  return { x: pos.x, y };
}

/** Adds a catalog node at the palette target and wires it up; returns the new node id. */
export function placeNode(flow: Flow, item: CatalogItem, { from, between }: PaletteTarget) {
  const s = flow.get();
  const id = Math.random().toString(36).slice(2, 10);
  const count = Object.values(s.nodes).filter((n) => n.data?.key === item.key).length;
  const label = count ? `${item.label} ${count + 1}` : item.label;
  // Align the new node's centre with the port it hangs off.
  const beside = (node: string, handle: string, dx: number) => {
    const p = s.nodes[node]?.position ?? { x: 0, y: 0 };
    const h = s.handles[node]?.[handle];
    return { x: p.x + dx, y: p.y + (h ? h.y - 32 : 0) };
  };

  let position = flow.el
    ? flow.screenToFlow({ x: flow.el.clientWidth / 2 - 128, y: flow.el.clientHeight / 2 - 32 })
    : { x: 0, y: 0 };
  const a = between && s.nodes[between.source],
    b = between && s.nodes[between.target];
  if (from && s.nodes[from.node]) {
    position = beside(from.node, from.handle, from.type === "source" ? GAP : -GAP);
  } else if (between && a && b) {
    // Make room like n8n: push the target's branch right when the gap can't fit another node.
    const shift = a.position.x + GAP * 2 - b.position.x;
    if (shift > 0) {
      const ids = downstream(flow, between.target, between.source);
      flow.moveNodes(Object.fromEntries(ids.flatMap((n) => (s.nodes[n] ? [[n, s.nodes[n].position]] : []))), shift, 0);
    }
    position = beside(between.source, between.sourceHandle, GAP);
  }

  const at = freeSpot(flow, position);
  flow.add([step(id, item.key, label, at.x, at.y)]);
  const input = item.inputs[0],
    output = item.outputs[0];
  if (from?.type === "source" && input) flow.connect(from, { node: id, handle: input, type: "target" });
  if (from?.type === "target" && output) flow.connect({ node: id, handle: output, type: "source" }, from);
  if (between && input && output) {
    flow.remove([], [between.id]);
    flow.connect(
      { node: between.source, handle: between.sourceHandle, type: "source" },
      { node: id, handle: input, type: "target" },
    );
    flow.connect(
      { node: id, handle: output, type: "source" },
      { node: between.target, handle: between.targetHandle, type: "target" },
    );
  }
  flow.select([id]);
  return id;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Simulated run: walks the graph from every trigger, lighting nodes and edges level by level. */
export async function execute(flow: Flow) {
  // Run state is transient: keep it out of undo history.
  const node = (id: string, data: Partial<StepData>) => flow.untracked(() => flow.updateNodeData(id, data));
  const link = (id: string, patch: Partial<FlowEdge>) => flow.untracked(() => flow.updateEdge(id, patch));
  const s = flow.get();
  const steps = Object.values(s.nodes).filter((n) => n.type === "step");
  steps.forEach((n) => node(n.id, { status: undefined }));
  for (const e of s.edges) if (e.kind !== "tool") link(e.id, { label: undefined });

  let frontier = steps.filter((n) => byKey[n.data.key]?.kind === "trigger").map((n) => n.id);
  const seen = new Set(frontier);
  const lit: string[] = [];
  while (frontier.length) {
    frontier.forEach((id) => node(id, { status: "running" }));
    await sleep(650);
    const next: string[] = [];
    for (const id of frontier) {
      const n = flow.get().nodes[id];
      if (!n) continue;
      node(id, { status: "success" });
      for (const e of flow.get().edges) {
        if (e.source !== id || (n.data.key === "if" && e.sourceHandle === "false")) continue;
        // Edge labels follow the edge in canvas space: show how many items passed along it.
        const items = n.data.key === "db" ? 12 : 1;
        link(e.id, { animated: true, label: `${items} item${items > 1 ? "s" : ""}` });
        lit.push(e.id);
        if (seen.has(e.target)) continue;
        seen.add(e.target);
        next.push(e.target);
      }
    }
    frontier = next;
  }
  await sleep(1500);
  lit.forEach((id) => link(id, { animated: false }));
}

/** Adds a rows×cols grid of chained nodes below the current graph. */
export function stress(flow: Flow, rows = 20, cols = 25) {
  const actions = CATALOG.filter((i) => i.kind === "action");
  const y0 = flow.get().nodeIds.length ? flow.bounds().y + flow.bounds().h + 200 : 0;
  const tag = Date.now().toString(36);
  const nodes: FlowNode[] = [];
  const edges = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const id = `${tag}-${r}-${c}`;
      const item = actions[(r + c) % actions.length]!;

      nodes.push(step(id, item.key, `${item.label} ${r * cols + c + 1}`, c * GAP, y0 + r * 120));
      if (c) edges.push(edge(`${tag}-${r}-${c - 1}`, "out", id, "in"));
    }
  }
  flow.add(nodes, edges);
  requestAnimationFrame(() => requestAnimationFrame(() => flow.fitView()));
}
