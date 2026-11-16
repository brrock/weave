import { DEFAULT_SIZE, createFlow, edge, type Flow, type FlowNode, type XY } from "@/components/weave";
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
      {
        id: "note",
        type: "note",
        position: { x: 0, y: -260 },
        data: {
          text: "Drag from a port to connect.\nDouble-click a node to edit it.\nHover a connection to insert a step.\nTab opens the node palette.",
        },
      },
      step("hook", "webhook", "New signup", 0, 0),
      step("enrich", "ai", "Enrich lead", 360, 0),
      step("check", "if", "Is enterprise?", 720, -8),
      step("mail", "email", "Welcome email", 1080, -120),
      step("sales", "chat", "Notify sales", 1080, 100),
      step("join", "merge", "Combine", 1440, -16),
      step("log", "db", "Log result", 1800, 0),
      step("cron", "schedule", "Every morning", 0, 320),
      step("rows", "db", "Fetch new rows", 360, 320),
      step("sum", "code", "Summarize", 720, 320),
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
    ],
  );
}

const GAP = 360;

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
  const s = flow.get();
  const steps = Object.values(s.nodes).filter((n) => n.type === "step");
  steps.forEach((n) => flow.updateNodeData(n.id, { status: undefined }));
  let frontier = steps.filter((n) => byKey[n.data.key]?.kind === "trigger").map((n) => n.id);
  const seen = new Set(frontier);
  const lit: string[] = [];
  while (frontier.length) {
    frontier.forEach((id) => flow.updateNodeData(id, { status: "running" }));
    await sleep(650);
    const next: string[] = [];
    for (const id of frontier) {
      const n = flow.get().nodes[id];
      if (!n) continue;
      flow.updateNodeData(id, { status: "success" });
      for (const e of flow.get().edges) {
        if (e.source !== id || (n.data.key === "if" && e.sourceHandle === "false")) continue;
        flow.updateEdge(e.id, { animated: true });
        lit.push(e.id);
        if (seen.has(e.target)) continue;
        seen.add(e.target);
        next.push(e.target);
      }
    }
    frontier = next;
  }
  await sleep(1500);
  lit.forEach((id) => flow.updateEdge(id, { animated: false }));
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
