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

/** Window-level pointer drag; ends on pointerup/cancel. Only one drag is active at a time. */
export function drag(move: (e: PointerEvent) => void, up?: (e: PointerEvent) => void) {
  cancelDrag();
  const detach = () => {
    removeEventListener("pointermove", move);
    removeEventListener("pointerup", end);
    removeEventListener("pointercancel", end);
    detachDrag = null;
  };
  const end = (e: PointerEvent) => {
    detach();
    up?.(e);
  };
  detachDrag = detach;
  addEventListener("pointermove", move);
  addEventListener("pointerup", end);
  addEventListener("pointercancel", end);
}

export type Flow = ReturnType<typeof createFlow>;

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

  const flow = {
    /** Grid size nodes snap to while dragging; 1 disables snapping. */
    snap: 20,
    events: {} as { onConnectEnd?: (e: ConnectEnd) => void },

    get: () => state,
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
      flow.updateNode(id, { selected: !state.nodes[id]?.selected });
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
        const p = state.nodes[id]?.position;
        const s = state.sizes[id] ?? DEFAULT_SIZE;
        return !!p && p.x < x1 && p.x + s.w > x0 && p.y < y1 && p.y + s.h > y0;
      });
      flow.select(hit, true);
    },

    // ---- dragging ----
    dragOrigins(): Record<string, XY> {
      return Object.fromEntries(selectedNodes().map((n) => [n.id, n.position]));
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
      if (nodes) flow.set({ nodes });
    },

    // ---- mutations ----
    add(newNodes: FlowNode[], newEdges: FlowEdge[] = []) {
      const nodes = { ...state.nodes };
      for (const n of newNodes) nodes[n.id] = n;
      flow.set({ nodes, nodeIds: [...state.nodeIds, ...newNodes.map((n) => n.id).filter((id) => !state.nodes[id])] });
      if (newEdges.length) flow.setEdges([...state.edges, ...newEdges]);
    },
    updateNode(id: string, patch: Partial<FlowNode>) {
      const n = state.nodes[id];
      if (n) flow.set({ nodes: { ...state.nodes, [id]: { ...n, ...patch } } });
    },
    updateNodeData(id: string, data: Record<string, unknown>) {
      const n = state.nodes[id];
      if (n) flow.updateNode(id, { data: { ...n.data, ...data } });
    },
    updateEdge(id: string, patch: Partial<FlowEdge>) {
      flow.set({ edges: state.edges.map((e) => (e.id === id ? { ...e, ...patch } : e)) });
    },
    setEdges(edges: FlowEdge[]) {
      flow.set({ edges, connected: connectedSet(edges) });
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
    remove(nodeIds: string[], edgeIds: string[] = []) {
      const dead = new Set(nodeIds),
        deadEdges = new Set(edgeIds);
      const nodes = { ...state.nodes };
      for (const id of nodeIds) delete nodes[id];
      flow.set({ nodes, nodeIds: state.nodeIds.filter((id) => !dead.has(id)) });
      flow.setEdges(state.edges.filter((e) => !deadEdges.has(e.id) && !dead.has(e.source) && !dead.has(e.target)));
    },
    removeSelected() {
      flow.remove(
        selectedNodes().map((n) => n.id),
        state.edges.filter((e) => e.selected).map((e) => e.id),
      );
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
        if (!n || node === from.node) continue;
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
          type: el.dataset.handleType as HandleType,
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
