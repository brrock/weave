import { createContext, useContext, useRef, useSyncExternalStore, type ReactNode } from "react";

export type XY = { x: number; y: number };
export type Side = "left" | "right" | "top" | "bottom";
export type HandleType = "source" | "target";
export type Viewport = XY & { zoom: number };
export type Size = { w: number; h: number };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export interface FlowNode<D = any> {
  id: string;
  type: string;
  position: XY;
  data: D;
  selected?: boolean;
  /** Explicit size for resizable nodes (notes, groups, or yours via <NodeResizer>); otherwise measured. */
  size?: Size;
  /** The group this node belongs to: it moves with the group and hides while the group is collapsed. */
  parent?: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export interface FlowEdge<D = any> {
  id: string;
  source: string;
  sourceHandle: string;
  target: string;
  targetHandle: string;
  selected?: boolean;
  /** Draws the edge as beads flowing from source to target (a solid line under reduced motion). */
  animated?: boolean;
  /** App-defined category, rendered as `data-kind` on the edge so CSS can style it (e.g. "tool"). */
  kind?: string;
  /** Classes for the edge's `<g>`: SVG stroke properties and `--weave-edge*` variables set here reach its paths. */
  className?: string;
  /** App data; Weave never reads it. */
  data?: D;
  /** Shown on the edge in canvas space (pans and zooms with it); keep it a string if you persist edges. */
  label?: ReactNode;
  /** Where the label sits along the edge, 0 (source) to 1 (target); default 0.5. */
  labelAt?: number;
}

/** Handle centre relative to its node's top-left, in flow units. */
export type HandleBox = XY & { side: Side; type: HandleType };
export type HandleRef = { node: string; handle: string; type: HandleType };
export type ConnectEnd = { from: HandleRef; position: XY };

export interface FlowState {
  nodes: Record<string, FlowNode>;
  /** Changes only on add/remove, so the node layer doesn't re-render on drag. */
  nodeIds: string[];
  edges: FlowEdge[];
  /** `${node}:${handle}` for every handle with at least one edge. */
  connected: Set<string>;
  sizes: Record<string, Size>;
  handles: Record<string, Record<string, HandleBox>>;
  viewport: Viewport;
  /** Container size in screen px (0 until mounted); drives viewport culling. */
  size: Size;
  connection: { from: HandleRef; to: XY; over: HandleRef | null } | null;
  /** Selection rectangle in container-relative screen pixels. */
  marquee: { a: XY; b: XY } | null;
}

export const MIN_ZOOM = 0.1;
export const MAX_ZOOM = 2.5;
export const DEFAULT_SIZE: Size = { w: 240, h: 64 };
/** Node types drawn behind edges and other nodes, and box-selected only when fully enclosed. */
export const BACKDROP = new Set(["note", "group"]);

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const connectedSet = (edges: FlowEdge[]) =>
  new Set(edges.flatMap((e) => [`${e.source}:${e.sourceHandle}`, `${e.target}:${e.targetHandle}`]));
const deselectEdges = (edges: FlowEdge[]) =>
  edges.some((e) => e.selected) ? edges.map((e) => (e.selected ? { ...e, selected: false } : e)) : edges;

export const edge = (source: string, sourceHandle: string, target: string, targetHandle: string): FlowEdge => ({
  id: `${source}:${sourceHandle}->${target}:${targetHandle}`,
  source,
  sourceHandle,
  target,
  targetHandle,
});

let detachDrag: (() => void) | null = null;

/** Abandon the active drag without running its `up` (e.g. when a second finger starts a pinch). */
export const cancelDrag = () => detachDrag?.();

/**
 * Window-level pointer drag; ends on pointerup/cancel. Only one drag is active at a time.
 * `done` runs however the drag ends, including when it is abandoned (e.g. by a pinch).
 */
export function drag(move: (e: PointerEvent) => void, up?: (e: PointerEvent) => void, done?: () => void) {
  cancelDrag();
  const detach = (e?: PointerEvent) => {
    removeEventListener("pointermove", move);
    removeEventListener("pointerup", end);
    removeEventListener("pointercancel", end);
    detachDrag = null;
    if (e) up?.(e);
    done?.();
  };
  const end = (e: PointerEvent) => detach(e);
  detachDrag = () => detach();
  addEventListener("pointermove", move);
  addEventListener("pointerup", end);
  addEventListener("pointercancel", end);
}

export type Flow = ReturnType<typeof createFlow>;

/** Nodes and the edges between them, as copied to the clipboard (JSON). */
export type Clip = { nodes: FlowNode[]; edges: FlowEdge[] };

/** Validates untrusted clip data (e.g. pasted text); returns null unless it is a usable clip. */
export function parseClip(text: string | undefined): Clip | null {
  let v: unknown;
  try {
    v = JSON.parse(text ?? "");
  } catch {
    return null;
  }
  const str = (x: unknown) => typeof x === "string";
  const num = (x: unknown) => typeof x === "number" && Number.isFinite(x);
  const o = v as Partial<Clip> | null;
  if (!Array.isArray(o?.nodes) || !o.nodes.length) return null;
  const nodesOk = o.nodes.every((n) => n && str(n.id) && str(n.type) && num(n.position?.x) && num(n.position?.y));
  const edges = Array.isArray(o.edges) ? o.edges : [];
  const edgesOk = edges.every(
    (e) => e && str(e.id) && str(e.source) && str(e.target) && str(e.sourceHandle) && str(e.targetHandle),
  );
  return nodesOk && edgesOk ? { nodes: o.nodes, edges } : null;
}

const uid = () => Math.random().toString(36).slice(2, 10);

/** A group frame around a bounding box: padding all round plus room for the title bar, snapped outwards. */
const FRAME = { pad: 40, head: 40 };

function frameAround(b: { x: number; y: number; w: number; h: number }, g = 20) {
  const { pad, head } = FRAME;

  const x = Math.floor((b.x - pad) / g) * g;
  const y = Math.floor((b.y - pad - head) / g) * g;
  return {
    position: { x, y },
    size: { w: Math.ceil((b.x + b.w + pad - x) / g) * g, h: Math.ceil((b.y + b.h + pad - y) / g) * g },
  };
}

/** The node an edge to `id` attaches to: `id` itself, or its outermost collapsed group. */
export function shownAs(s: FlowState, id: string) {
  let shown = id;
  // The depth cap guards against parent cycles in imported data.
  for (let p = s.nodes[id]?.parent, depth = 0; p && depth < 32; p = s.nodes[p]?.parent, depth++)
    if (s.nodes[p]?.data?.collapsed) shown = p;
  return shown;
}

/** Inside a collapsed group, so not drawn. */
export const isHidden = (s: FlowState, id: string) => shownAs(s, id) !== id;

/** The undoable part of the state. */
type Doc = Pick<FlowState, "nodes" | "nodeIds" | "edges">;
const HISTORY_LIMIT = 100;

export function createFlow(nodes: FlowNode[] = [], edges: FlowEdge[] = []) {
  let state: FlowState = {
    nodes: Object.fromEntries(nodes.map((n) => [n.id, n])),
    nodeIds: nodes.map((n) => n.id),
    edges,
    connected: connectedSet(edges),
    sizes: {},
    handles: {},
    viewport: { x: 0, y: 0, zoom: 1 },
    size: { w: 0, h: 0 },
    connection: null,
    marquee: null,
  };
  const listeners = new Set<() => void>();
  const pending = new Map<string, HTMLElement>();
  let el: HTMLElement | null = null;
  let frame = 0;
  // History: snapshots of the document before each change. A change is everything inside one batch.
  let past: Doc[] = [];
  let future: Doc[] = [];
  let depth = 0;
  let base: Doc | null = null;
  let dirty = false;
  let paused = 0;
  let stopLayout = () => {};

  const doc = (): Doc => ({ nodes: state.nodes, nodeIds: state.nodeIds, edges: state.edges });
  const restore = (d: Doc) => flow.set({ ...d, connected: connectedSet(d.edges) });
  /** Applies a document change, recording it for undo. */
  const commit = (patch: Partial<FlowState>) =>
    flow.batch(() => {
      dirty ||= !paused;
      flow.set(patch);
    });

  const flow = {
    /** Grid size nodes snap to while dragging; 1 disables snapping. */
    snap: 20,
    events: {} as { onConnectEnd?: (e: ConnectEnd) => void },

    get: () => state,
    /** Low-level state write; never recorded in history. */
    set(patch: Partial<FlowState>) {
      state = { ...state, ...patch };
      listeners.forEach((l) => l());
    },
    subscribe(l: () => void) {
      listeners.add(l);
      return () => void listeners.delete(l);
    },
    mount(node: HTMLElement | null) {
      el = node;
    },
    get el() {
      return el;
    },

    // ---- coordinates & viewport ----
    screenToFlow(p: XY): XY {
      const v = state.viewport;
      return { x: (p.x - v.x) / v.zoom, y: (p.y - v.y) / v.zoom };
    },
    toFlow(clientX: number, clientY: number): XY {
      const r = el!.getBoundingClientRect();
      return flow.screenToFlow({ x: clientX - r.left, y: clientY - r.top });
    },
    setViewport(v: Viewport, animate = false) {
      cancelAnimationFrame(frame);
      const to = { ...v, zoom: clamp(v.zoom, MIN_ZOOM, MAX_ZOOM) };
      if (!animate) {
        flow.set({ viewport: to });
        return;
      }
      const from = state.viewport;
      const t0 = performance.now();
      const step = (t: number) => {
        const k = Math.min(1, (t - t0) / 260);
        const e = 1 - (1 - k) ** 3;
        const lerp = (a: number, b: number) => a + (b - a) * e;
        flow.set({ viewport: { x: lerp(from.x, to.x), y: lerp(from.y, to.y), zoom: lerp(from.zoom, to.zoom) } });
        if (k < 1) frame = requestAnimationFrame(step);
      };
      frame = requestAnimationFrame(step);
    },
    /** Zoom by `factor`, keeping the given client point (default: centre) fixed. */
    zoomAt(factor: number, clientX?: number, clientY?: number, animate = false) {
      if (!el) return;
      const r = el.getBoundingClientRect();
      const v = state.viewport;
      const px = (clientX ?? r.left + r.width / 2) - r.left;
      const py = (clientY ?? r.top + r.height / 2) - r.top;
      const zoom = clamp(v.zoom * factor, MIN_ZOOM, MAX_ZOOM);
      const k = zoom / v.zoom;
      flow.setViewport({ zoom, x: px - (px - v.x) * k, y: py - (py - v.y) * k }, animate);
    },
    bounds(ids = state.nodeIds) {
      let x0 = Infinity,
        y0 = Infinity,
        x1 = -Infinity,
        y1 = -Infinity;
      for (const id of ids) {
        const p = state.nodes[id]?.position;
        if (!p) continue;
        const s = state.sizes[id] ?? DEFAULT_SIZE;
        x0 = Math.min(x0, p.x);
        y0 = Math.min(y0, p.y);
        x1 = Math.max(x1, p.x + s.w);
        y1 = Math.max(y1, p.y + s.h);
      }
      return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
    },
    /** Fit all nodes; `minZoom` keeps them legible on narrow screens (the graph's centre stays in view). */
    fitView(animate = true, minZoom = MIN_ZOOM) {
      if (!el || !state.nodeIds.length) return;
      const b = flow.bounds();
      const W = el.clientWidth,
        H = el.clientHeight;
      const pad = Math.min(80, W * 0.06, H * 0.06);
      const zoom = clamp(Math.min((W - pad * 2) / b.w, (H - pad * 2) / b.h), minZoom, 1.2);
      flow.setViewport({ zoom, x: W / 2 - (b.x + b.w / 2) * zoom, y: H / 2 - (b.y + b.h / 2) * zoom }, animate);
    },

    // ---- selection ----
    select(ids: string[], additive = false) {
      const want = new Set(ids);
      const nodes = { ...state.nodes };
      for (const id of state.nodeIds) {
        const n = nodes[id];
        if (!n) continue;
        const sel = want.has(id) || (additive && !!n.selected);
        if (!!n.selected !== sel) nodes[id] = { ...n, selected: sel };
      }
      flow.set({ nodes, edges: additive ? state.edges : deselectEdges(state.edges) });
    },
    toggle(id: string) {
      const n = state.nodes[id];
      if (n) flow.set({ nodes: { ...state.nodes, [id]: { ...n, selected: !n.selected } } });
    },
    selectEdge(id: string, additive = false) {
      if (!additive) flow.select([]);
      flow.set({ edges: state.edges.map((e) => (e.id === id ? { ...e, selected: !(additive && e.selected) } : e)) });
    },
    /** Select nodes intersecting a rectangle given in flow coordinates. */
    selectRect(a: XY, b: XY) {
      const x0 = Math.min(a.x, b.x),
        x1 = Math.max(a.x, b.x);
      const y0 = Math.min(a.y, b.y),
        y1 = Math.max(a.y, b.y);
      const hit = state.nodeIds.filter((id) => {
        const n = state.nodes[id];
        if (!n || isHidden(state, id)) return false;
        const { x, y } = n.position;
        const s = state.sizes[id] ?? DEFAULT_SIZE;
        if (BACKDROP.has(n.type)) return x >= x0 && x + s.w <= x1 && y >= y0 && y + s.h <= y1;
        return x < x1 && x + s.w > x0 && y < y1 && y + s.h > y0;
      });

      flow.select(hit, true);
    },

    // ---- dragging ----
    /** Start positions for dragging the selection (groups bring their contents). */
    dragOrigins(): Record<string, XY> {
      const ids = withDescendants(selectedNodes().map((n) => n.id));
      return Object.fromEntries(ids.flatMap((id) => (state.nodes[id] ? [[id, state.nodes[id].position]] : [])));
    },
    moveNodes(origins: Record<string, XY>, dx: number, dy: number) {
      const g = flow.snap;
      let nodes: FlowState["nodes"] | null = null;
      for (const [id, o] of Object.entries(origins)) {
        const n = state.nodes[id];
        if (!n) continue;
        const x = Math.round((o.x + dx) / g) * g;
        const y = Math.round((o.y + dy) / g) * g;
        if (x === n.position.x && y === n.position.y) continue;
        nodes ??= { ...state.nodes };
        nodes[id] = { ...n, position: { x, y } };
      }
      if (nodes) commit({ nodes });
    },

    // ---- mutations ----
    add(newNodes: FlowNode[], newEdges: FlowEdge[] = []) {
      const nodes = { ...state.nodes };
      for (const n of newNodes) nodes[n.id] = n;
      const nodeIds = [...state.nodeIds, ...newNodes.map((n) => n.id).filter((id) => !state.nodes[id])];
      const all = [...state.edges, ...newEdges];
      commit({ nodes, nodeIds, edges: all, connected: connectedSet(all) });
    },
    updateNode(id: string, patch: Partial<FlowNode>) {
      const n = state.nodes[id];
      if (n) commit({ nodes: { ...state.nodes, [id]: { ...n, ...patch } } });
    },
    updateNodeData(id: string, data: Record<string, unknown>) {
      const n = state.nodes[id];
      if (n) flow.updateNode(id, { data: { ...n.data, ...data } });
    },
    updateEdge(id: string, patch: Partial<FlowEdge>) {
      commit({ edges: state.edges.map((e) => (e.id === id ? { ...e, ...patch } : e)) });
    },
    setEdges(edges: FlowEdge[]) {
      commit({ edges, connected: connectedSet(edges) });
    },
    /** Connects two handles of opposite type on different nodes; returns null if invalid or duplicate. */
    connect(a: HandleRef, b: HandleRef): FlowEdge | null {
      if (a.type === b.type || a.node === b.node) return null;
      const [s, t] = a.type === "source" ? [a, b] : [b, a];
      const e = edge(s.node, s.handle, t.node, t.handle);
      if (state.edges.some((x) => x.id === e.id)) return null;
      flow.setEdges([...state.edges, e]);
      return e;
    },
    /** Removes nodes (with their group contents), edges, and every edge touching a removed node. */
    remove(nodeIds: string[], edgeIds: string[] = []) {
      const dead = new Set(withDescendants(nodeIds)),
        deadEdges = new Set(edgeIds);
      const nodes = { ...state.nodes };
      for (const id of dead) delete nodes[id];
      const edges = state.edges.filter((e) => !deadEdges.has(e.id) && !dead.has(e.source) && !dead.has(e.target));
      commit({ nodes, nodeIds: state.nodeIds.filter((id) => !dead.has(id)), edges, connected: connectedSet(edges) });
    },
    removeSelected() {
      flow.remove(
        selectedNodes().map((n) => n.id),
        state.edges.filter((e) => e.selected).map((e) => e.id),
      );
    },

    // ---- clipboard ----
    /** The given nodes (default: the selection) and the edges between them, ready for JSON. */
    copy(selection = selectedNodes().map((n) => n.id)): Clip {
      const ids = withDescendants(selection);
      const keep = new Set(ids);
      const strip = <T>(x: T): T => ({ ...x, selected: undefined });

      return {
        nodes: ids.flatMap((id) => (state.nodes[id] ? [strip(state.nodes[id])] : [])),
        edges: state.edges
          .filter((e) => keep.has(e.source) && keep.has(e.target))
          // React-node labels can't round-trip through JSON.
          .map((e) => strip(typeof e.label === "object" ? { ...e, label: undefined } : e)),
      };
    },
    /** Adds a clip with fresh ids, its top-left at `at` (default: offset from the original), and selects it. */
    paste(clip: Clip, at?: XY): string[] {
      const ids = new Map<string, string>();
      for (const n of clip.nodes) {
        let id = uid();
        while (state.nodes[id]) id = uid();
        ids.set(n.id, id);
      }
      const x0 = Math.min(...clip.nodes.map((n) => n.position.x));
      const y0 = Math.min(...clip.nodes.map((n) => n.position.y));
      const g = flow.snap;
      const dx = at ? at.x - x0 : 2 * Math.max(g, 20);
      const dy = at ? at.y - y0 : 2 * Math.max(g, 20);
      const nodes = clip.nodes.map((n) => ({
        ...n,
        id: ids.get(n.id)!,
        position: { x: Math.round((n.position.x + dx) / g) * g, y: Math.round((n.position.y + dy) / g) * g },
        selected: true,
        parent: n.parent && ids.get(n.parent),
      }));
      const edges = clip.edges.flatMap((e) => {
        const s = ids.get(e.source),
          t = ids.get(e.target);
        return s && t ? [{ ...e, ...edge(s, e.sourceHandle, t, e.targetHandle), selected: false }] : [];
      });
      flow.batch(() => {
        flow.select([]);
        flow.add(nodes, edges);
      });
      return [...ids.values()];
    },
    /** Pastes a copy of the selection next to it. */
    duplicate() {
      const clip = flow.copy();
      return clip.nodes.length ? flow.paste(clip) : [];
    },

    // ---- groups ----
    /** Frames the nodes (default: the selection) in a new group and returns its id. */
    group(ids = selectedNodes().map((n) => n.id), title = "Group"): string | null {
      const pick = new Set(ids);
      // Only the outermost picked nodes join; nested ones stay in their own groups.
      const members = ids.filter((id) => state.nodes[id] && !pick.has(state.nodes[id].parent ?? ""));
      const first = state.nodes[members[0] ?? ""];
      if (!first) return null;
      const { position, size } = frameAround(flow.bounds(withDescendants(members)));
      const id = uid();
      const nodes = { ...state.nodes };
      for (const m of members) nodes[m] = { ...nodes[m]!, parent: id, selected: false };
      nodes[id] = {
        id,
        type: "group",
        position,
        size,
        data: { title },
        parent: first.parent,
        selected: true,
      };
      // First in draw order, so the frame sits under notes it contains.
      commit({ nodes, nodeIds: [id, ...state.nodeIds] });
      return id;
    },
    /** Removes a group frame, keeping its contents (they move up to the group's own group, if any). */
    ungroup(id: string) {
      const g = state.nodes[id];
      if (g?.type !== "group") return;
      flow.batch(() => {
        const nodes = { ...state.nodes };
        for (const n of Object.values(nodes)) if (n.parent === id) nodes[n.id] = { ...n, parent: g.parent };
        commit({ nodes });
        flow.remove([id]);
      });
    },
    /** After a drop: puts each node into the innermost open group under its centre (or none). */
    regroup(ids: string[]) {
      const groups = state.nodeIds.flatMap((id) => {
        const n = state.nodes[id];
        return n?.type === "group" && !n.data?.collapsed && !isHidden(state, id) ? [n] : [];
      });
      let nodes: FlowState["nodes"] | null = null;
      for (const id of ids) {
        const n = state.nodes[id];
        if (!n || n.type === "group") continue;
        const z = state.sizes[id] ?? DEFAULT_SIZE;
        const c = { x: n.position.x + z.w / 2, y: n.position.y + z.h / 2 };
        let best: FlowNode | undefined;
        let area = Infinity;
        for (const gr of groups) {
          const s = gr.size ?? state.sizes[gr.id] ?? DEFAULT_SIZE;
          const inside =
            c.x > gr.position.x && c.x < gr.position.x + s.w && c.y > gr.position.y && c.y < gr.position.y + s.h;
          if (inside && s.w * s.h < area) [best, area] = [gr, s.w * s.h];
        }
        if (best?.id === n.parent) continue;
        nodes ??= { ...state.nodes };
        nodes[id] = { ...n, parent: best?.id };
      }
      if (nodes) commit({ nodes });
    },

    // ---- layout ----
    /**
     * Arranges nodes left to right in layers along their edges: each node sits right of everything feeding it,
     * level with the ports it hangs off (so port order is kept top to bottom). Notes stay put and open groups
     * refit around their contents. One undo step; resolves when the animation ends.
     */
    layout({ animate = true, gap = { x: 100, y: 40 } } = {}): Promise<void> {
      stopLayout();
      const ids = state.nodeIds.filter((id) => {
        const n = state.nodes[id];
        return !!n && !BACKDROP.has(n.type) && !isHidden(state, id);
      });
      if (!ids.length) return Promise.resolve();
      const at = (id: string) => state.nodes[id]!.position;
      const size = (id: string) => state.sizes[id] ?? state.nodes[id]?.size ?? DEFAULT_SIZE;
      const port = (id: string, handle: string) => state.handles[id]?.[handle]?.y ?? size(id).h / 2;
      const inLayout = new Set(ids);
      const outs = new Map(ids.map((id) => [id, [] as FlowEdge[]]));
      for (const e of state.edges)
        if (inLayout.has(e.source) && inLayout.has(e.target) && e.source !== e.target) outs.get(e.source)!.push(e);

      // Depth-first from the sources (then the leftmost nodes); an edge back into the current path closes a
      // cycle and is ignored.
      const fed = new Set([...outs.values()].flat().map((e) => e.target));
      const start = [...ids].sort((a, b) => +fed.has(a) - +fed.has(b) || at(a).x - at(b).x || at(a).y - at(b).y);

      const mark = new Map<string, "open" | "done">();
      const post: string[] = [];
      const ins = new Map(ids.map((id) => [id, [] as FlowEdge[]]));
      const visit = (id: string) => {
        mark.set(id, "open");
        for (const e of outs.get(id)!) {
          if (mark.get(e.target) === "open") continue;
          ins.get(e.target)!.push(e);
          if (!mark.has(e.target)) visit(e.target);
        }
        mark.set(id, "done");
        post.push(id);
      };
      for (const id of start) if (!mark.has(id)) visit(id);

      // Layer = longest path from a source (reverse post-order is topological).
      const rank = new Map<string, number>();
      for (const id of post.reverse()) rank.set(id, Math.max(0, ...ins.get(id)!.map((e) => rank.get(e.source)! + 1)));
      const layers: string[][] = [];
      for (const id of start) (layers[rank.get(id)!] ??= []).push(id);

      const y0 = Math.min(...ids.map((id) => at(id).y));
      const goal: Record<string, { position: XY; size?: Size }> = {};
      let x = Math.min(...ids.map((id) => at(id).x));
      for (const layer of layers) {
        // Where each node wants to be: level with the ports feeding it, on average.
        const want = new Map(
          layer.map((id) => {
            const ys = ins
              .get(id)!
              .map((e) => goal[e.source]!.position.y + port(e.source, e.sourceHandle) - port(id, e.targetHandle));
            return [id, ys.length ? ys.reduce((a, b) => a + b) / ys.length : y0];
          }),
        );
        layer.sort((a, b) => want.get(a)! - want.get(b)! || at(a).y - at(b).y);
        let bottom = -Infinity;
        let group: string | undefined;
        for (const id of layer) {
          // Leave room for a group frame's padding and title bar between nodes of different groups.
          const parent = state.nodes[id]!.parent;
          const y = Math.max(want.get(id)!, bottom + gap.y + (parent !== group ? 2 * FRAME.pad + FRAME.head : 0));
          goal[id] = { position: { x, y } };
          bottom = y + size(id).h;
          group = parent;
        }
        x += Math.max(...layer.map((id) => size(id).w)) + gap.x;
      }
      // Keep the first source where it was, so the graph doesn't jump (or run into notes around it).
      const anchor = start[0]!;
      const [dx, dy] = [at(anchor).x - goal[anchor]!.position.x, at(anchor).y - goal[anchor]!.position.y];
      const g = flow.snap;
      for (const k of Object.values(goal))
        k.position = { x: Math.round((k.position.x + dx) / g) * g, y: Math.round((k.position.y + dy) / g) * g };

      // shortcut: each open group refits to its own laid-out contents, so two groups can end up overlapping;
      // lay out group by group if that matters.
      for (const id of state.nodeIds) {
        const n = state.nodes[id];
        if (n?.type !== "group" || n.data?.collapsed || isHidden(state, id)) continue;
        const inside = withDescendants([id]).filter((c) => goal[c] && c !== id);
        if (!inside.length) continue;
        let [x1, y1, x2, y2] = [Infinity, Infinity, -Infinity, -Infinity];
        for (const c of inside) {
          const p = goal[c]!.position;
          const s = size(c);
          [x1, y1, x2, y2] = [Math.min(x1, p.x), Math.min(y1, p.y), Math.max(x2, p.x + s.w), Math.max(y2, p.y + s.h)];
        }
        goal[id] = frameAround({ x: x1, y: y1, w: x2 - x1, h: y2 - y1 });
      }

      const from = Object.fromEntries(Object.keys(goal).map((id) => [id, state.nodes[id]!]));
      const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
      const apply = (k: number) => {
        const nodes = { ...state.nodes };
        for (const [id, { position: p, size: s }] of Object.entries(goal)) {
          const n = nodes[id];
          const f = from[id]!;
          if (!n) continue;
          const position = { x: lerp(f.position.x, p.x, k), y: lerp(f.position.y, p.y, k) };
          const fs = f.size ?? size(id);
          nodes[id] = { ...n, position, ...(s && { size: { w: lerp(fs.w, s.w, k), h: lerp(fs.h, s.h, k) } }) };
        }
        commit({ nodes });
      };
      const end = flow.begin();
      return new Promise((resolve) => {
        let raf = 0;
        const finish = () => {
          stopLayout = () => {};
          if (raf) cancelAnimationFrame(raf);

          apply(1);
          end();
          resolve();
        };
        // shortcut: every frame re-renders every moving node, so big graphs jump straight to the result;
        // animate them by moving only on-screen nodes if that's ever needed.
        const big = Object.keys(goal).length > 250;
        if (!animate || big || typeof requestAnimationFrame === "undefined") return finish();

        stopLayout = finish; // a newer layout jumps this one to its end first
        const t0 = performance.now();
        const step = (t: number) => {
          const k = Math.min(1, (t - t0) / 320);
          if (k === 1) return finish();
          apply(1 - (1 - k) ** 3);
          raf = requestAnimationFrame(step);
        };
        raf = requestAnimationFrame(step);
      });
    },

    // ---- history ----

    /** Opens a batch: every change until the returned `end()` is one undo step (e.g. a whole drag). */
    begin() {
      if (!depth++) {
        base = doc();
        dirty = false;
      }
      let open = true;
      return () => {
        if (!open) return;
        open = false;
        if (--depth || !dirty || !base) return;
        past = [...past.slice(1 - HISTORY_LIMIT), base];
        future = [];
        flow.set({}); // canUndo changed
      };
    },
    /** Runs `fn` as one undo step. */
    batch<T>(fn: () => T): T {
      const end = flow.begin();
      try {
        return fn();
      } finally {
        end();
      }
    },
    /** Runs `fn` without recording its changes, for transient state such as run status or animated edges. */
    untracked<T>(fn: () => T): T {
      paused++;
      try {
        return fn();
      } finally {
        paused--;
      }
    },
    undo() {
      const d = past.at(-1);
      if (!d || depth) return;
      past = past.slice(0, -1);
      future = [...future, doc()];
      restore(d);
    },
    redo() {
      const d = future.at(-1);
      if (!d || depth) return;
      future = future.slice(0, -1);
      past = [...past, doc()];
      restore(d);
    },
    get canUndo() {
      return past.length > 0;
    },
    get canRedo() {
      return future.length > 0;
    },

    // ---- measuring (batched: one store update per frame of ResizeObserver callbacks) ----
    measure(id: string, node: HTMLElement) {
      pending.set(id, node);
      if (pending.size === 1) queueMicrotask(flush);
    },

    // ---- connecting ----
    startConnection(from: HandleRef, e: PointerEvent) {
      const radius = e.pointerType === "touch" ? 56 : 32;
      const update = (ev: PointerEvent) => {
        const to = flow.toFlow(ev.clientX, ev.clientY);
        flow.set({ connection: { from, to, over: flow.handleNear(to, from, radius) } });
      };
      update(e);
      drag(update, (ev) => {
        const over = state.connection?.over;
        flow.set({ connection: null });
        if (over) flow.connect(from, over);
        else flow.events.onConnectEnd?.({ from, position: flow.toFlow(ev.clientX, ev.clientY) });
      });
    },
    /** Nearest compatible handle within `radius` screen px, or on the node under the pointer. */
    handleNear(p: XY, from: HandleRef, radius = 32): HandleRef | null {
      let best: HandleRef | null = null;
      let bestD = Infinity;
      const r = radius / state.viewport.zoom;
      for (const node in state.handles) {
        const n = state.nodes[node];
        if (!n || node === from.node || isHidden(state, node)) continue;

        const s = state.sizes[node] ?? DEFAULT_SIZE;
        const inside =
          p.x >= n.position.x && p.x <= n.position.x + s.w && p.y >= n.position.y && p.y <= n.position.y + s.h;
        for (const [handle, h] of Object.entries(state.handles[node] ?? {})) {
          if (h.type === from.type) continue;
          const d = Math.hypot(n.position.x + h.x - p.x, n.position.y + h.y - p.y);
          if ((inside || d < r) && d < bestD) {
            bestD = d;
            best = { node, handle, type: h.type };
          }
        }
      }
      return best;
    },
  };

  const selectedNodes = () => state.nodeIds.flatMap((id) => (state.nodes[id]?.selected ? [state.nodes[id]] : []));
  /** `ids` plus everything inside them (groups, nested groups), in draw order. */
  const withDescendants = (ids: string[]) => {
    const all = new Set(ids);
    for (let grew = true; grew;) {
      grew = false;
      for (const id of state.nodeIds) {
        const p = state.nodes[id]?.parent;
        if (p && all.has(p) && !all.has(id)) {
          all.add(id);
          grew = true;
        }
      }
    }
    return state.nodeIds.filter((id) => all.has(id));
  };

  // Rounded to half a flow unit so re-measuring at another zoom yields identical values.
  const half = (v: number) => Math.round(v * 2) / 2;

  function flush() {
    const z = state.viewport.zoom;
    const sizes = { ...state.sizes };
    const handles = { ...state.handles };
    let changed = false;
    for (const [id, node] of pending) {
      if (!node.isConnected) continue;
      const w = node.offsetWidth,
        h = node.offsetHeight;
      const prev = state.sizes[id];
      if (!prev || prev.w !== w || prev.h !== h) {
        sizes[id] = { w, h };
        changed = true;
      }

      // Reuse unchanged boxes: edges select them by reference, so a remount (culling) doesn't re-render edges.
      const r = node.getBoundingClientRect();
      const old = state.handles[id] ?? {};
      const hs: Record<string, HandleBox> = {};
      let same = true;
      node.querySelectorAll<HTMLElement>("[data-handle-id]").forEach((el) => {
        const b = el.getBoundingClientRect();
        const box = {
          x: half((b.left + b.width / 2 - r.left) / z),
          y: half((b.top + b.height / 2 - r.top) / z),
          side: el.dataset.side as Side,
          type: el.dataset.type as HandleType,
        };
        const o = old[el.dataset.handleId!];
        const keep = o && o.x === box.x && o.y === box.y && o.side === box.side && o.type === box.type;
        hs[el.dataset.handleId!] = keep ? o : box;
        same &&= !!keep;
      });
      if (!same || Object.keys(hs).length !== Object.keys(old).length) {
        handles[id] = hs;
        changed = true;
      }
    }
    pending.clear();
    if (changed) flow.set({ sizes, handles });
  }

  return flow;
}

export const FlowContext = createContext<Flow | null>(null);

export function useFlow() {
  const flow = useContext(FlowContext);
  if (!flow) throw new Error("useFlow must be used inside <Weave>");
  return flow;
}

export const shallowArray = <T>(a: T[], b: T[]) => a.length === b.length && a.every((v, i) => v === b[i]);

/**
 * Subscribe to a slice of flow state. Without `isEqual` the selector must return stable values
 * (primitives or existing objects); with it, derived values are fine and re-render only when unequal.
 */
export function useStore<T>(flow: Flow, selector: (s: FlowState) => T, isEqual?: (a: T, b: T) => boolean): T {
  const last = useRef<{ v: T } | null>(null);
  return useSyncExternalStore(flow.subscribe, () => {
    const v = selector(flow.get());
    if (!isEqual) return v;
    if (last.current && isEqual(last.current.v, v)) return last.current.v;
    last.current = { v };
    return v;
  });
}

export function useFlowState<T>(selector: (s: FlowState) => T, isEqual?: (a: T, b: T) => boolean): T {
  return useStore(useFlow(), selector, isEqual);
}
