import {
  memo,
  useLayoutEffect,
  useMemo,
  useRef,
  type HTMLAttributes,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from "react";
import { cn } from "@/lib/utils";
import { ConnectionLine, EdgeView } from "./edge";
import { NodeWrapper, ViewContext, type NodeTypes } from "./node";
import { NoteNode } from "./note";
import { GroupNode } from "./group";

import { THEME } from "./theme";
import {
  DEFAULT_SIZE,
  FlowContext,
  cancelDrag,
  drag,
  isHidden,
  parseClip,
  shownAs,
  shallowArray,
  useFlow,
  useFlowState,
  type ConnectEnd,
  type Flow,
  type FlowEdge,
  type FlowState,
  type XY,
} from "./store";

export interface WeaveProps extends Omit<HTMLAttributes<HTMLDivElement>, "onPointerDown"> {
  flow: Flow;
  /** Your node components by `node.type`. `note` and `group` are built in (override them by name). */

  nodeTypes: NodeTypes;

  /** Buttons shown on edge hover (or when selected, for touch); defaults to a delete button. */
  edgeToolbar?: (edge: FlowEdge) => ReactNode;
  /** A connection drag (or click) on a handle ended away from any compatible handle. */
  onConnectEnd?: (e: ConnectEnd) => void;
  fitViewOnInit?: boolean;
}

/**
 * Mouse: drag background or scroll to pan, pinch or ⌘/Ctrl+scroll to zoom, Shift-drag to box select.
 * Touch: one finger pans, two fingers pinch/pan, long-press then drag to box select.
 * Keys: Backspace/Delete removes the selection, ⌘A selects all, Esc clears, ⌘Z / ⇧⌘Z undo and redo,
 * ⌘C / ⌘X / ⌘V copy, cut and paste (at the pointer), ⌘D duplicates, ⌘G / ⇧⌘G group and ungroup.


 */
export function Weave({
  flow,
  nodeTypes,
  edgeToolbar,
  onConnectEnd,
  fitViewOnInit = true,
  className,
  children,
  onKeyDown,
  ...rest
}: WeaveProps) {
  const ref = useRef<HTMLDivElement>(null);
  // Built-in types; yours win on a name clash.
  const view = useMemo(
    () => ({ nodeTypes: { note: NoteNode, group: GroupNode, ...nodeTypes }, edgeToolbar }),
    [nodeTypes, edgeToolbar],
  );

  useLayoutEffect(() => {
    flow.events.onConnectEnd = onConnectEnd;
  });

  useLayoutEffect(() => {
    const el = ref.current!;
    flow.mount(el);
    const ro = new ResizeObserver(() => flow.set({ size: { w: el.clientWidth, h: el.clientHeight } }));
    ro.observe(el);
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) return flow.zoomAt(Math.exp(-e.deltaY * 0.01), e.clientX, e.clientY);
      const v = flow.get().viewport;
      flow.setViewport({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    // Safari reports trackpad pinch as gesture events (not ctrl+wheel) and would zoom the whole page.
    let gestureZoom = 1;
    const onGestureStart = (e: Event) => {
      e.preventDefault();
      gestureZoom = flow.get().viewport.zoom;
    };
    const onGestureChange = (e: Event) => {
      e.preventDefault();
      const g = e as Event & { scale: number; clientX: number; clientY: number };
      flow.zoomAt((gestureZoom * g.scale) / flow.get().viewport.zoom, g.clientX, g.clientY);
    };
    el.addEventListener("gesturestart", onGestureStart);
    el.addEventListener("gesturechange", onGestureChange);
    const stopPinch = pinchZoom(el, flow);
    const stopClipboard = clipboard(el, flow);
    // Two frames: let the first ResizeObserver pass measure nodes before fitting.
    if (fitViewOnInit) requestAnimationFrame(() => requestAnimationFrame(() => flow.fitView(false, 0.4)));
    return () => {
      ro.disconnect();
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("gesturestart", onGestureStart);
      el.removeEventListener("gesturechange", onGestureChange);
      stopPinch();
      stopClipboard();
      flow.mount(null);
    };
  }, [flow, fitViewOnInit]);

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget || e.button > 1) return;
    const root = e.currentTarget;
    root.focus({ preventScroll: true });
    const r = root.getBoundingClientRect();
    const a = { x: e.clientX - r.left, y: e.clientY - r.top };
    const v0 = flow.get().viewport;
    let mode = e.shiftKey && e.button === 0 ? "marquee" : "pan";
    let moved = false;
    // Touch has no Shift: hold still briefly, then drag to box select.
    const hold =
      e.pointerType === "touch" ? setTimeout(() => !moved && ((mode = "marquee"), navigator.vibrate?.(10)), 400) : 0;

    drag(
      (ev) => {
        if (!moved && Math.hypot(ev.clientX - e.clientX, ev.clientY - e.clientY) < 4) return;
        moved = true;
        if (mode === "marquee")
          return flow.set({ marquee: { a, b: { x: ev.clientX - r.left, y: ev.clientY - r.top } } });
        root.dataset.panning = "";
        flow.setViewport({ ...v0, x: v0.x + ev.clientX - e.clientX, y: v0.y + ev.clientY - e.clientY });
      },
      () => {
        clearTimeout(hold);
        delete root.dataset.panning;
        const m = flow.get().marquee;
        if (m) {
          flow.selectRect(flow.screenToFlow(m.a), flow.screenToFlow(m.b));
          flow.set({ marquee: null });
        } else if (!moved) flow.select([]);
      },
    );
  };

  const keyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    onKeyDown?.(e);
    if (e.defaultPrevented || (e.target as HTMLElement).closest("input,textarea,[contenteditable]")) return;
    const mod = e.metaKey || e.ctrlKey;
    const key = e.key.toLowerCase();
    if (e.key === "Backspace" || e.key === "Delete") flow.removeSelected();
    else if (e.key === "Escape") flow.select([]);
    else if (mod && key === "a") flow.select(flow.get().nodeIds);
    else if (mod && key === "z" && e.shiftKey) flow.redo();
    else if (mod && key === "z") flow.undo();
    else if (mod && key === "d") flow.duplicate();
    else if (mod && key === "g" && e.shiftKey) {
      const { nodes } = flow.get();
      flow.batch(() => Object.values(nodes).forEach((n) => n.selected && flow.ungroup(n.id)));
    } else if (mod && key === "g") flow.group();
    else return;
    e.preventDefault();
  };

  return (
    <FlowContext.Provider value={flow}>
      <ViewContext.Provider value={view}>
        <div
          ref={ref}
          tabIndex={0}
          data-weave=""
          {...rest}
          className={cn(
            "relative isolate cursor-grab touch-none overflow-hidden overscroll-none bg-background outline-none select-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-inset [-webkit-tap-highlight-color:transparent] [-webkit-touch-callout:none] data-panning:cursor-grabbing",
            className,
          )}
          onPointerDownCapture={(e) => {
            // A selection made elsewhere would otherwise ride along with every drag.
            const s = getSelection();
            if (s && !s.isCollapsed && !(e.target as Element).closest(EDITABLE)) s.removeAllRanges();
          }}
          // Stop native text selection (multi-click, drag-select) at the source; CSS user-select alone isn't enough in every browser.
          onMouseDown={(e) => !(e.target as Element).closest(EDITABLE) && e.preventDefault()}
          onPointerDown={onPointerDown}
          onKeyDown={keyDown}
        >
          <Background />
          <Transform>
            <Edges />
            <Nodes />
            <ConnectionLine />
          </Transform>
          <Marquee />
          {children}
        </div>
      </ViewContext.Provider>
    </FlowContext.Provider>
  );
}

const EDITABLE = "input,textarea,select,[contenteditable]";

/** ⌘C/⌘X/⌘V via native clipboard events (no permission prompts): the selection travels as JSON text. */
function clipboard(el: HTMLElement, flow: Flow) {
  let pointer: XY | null = null;
  const track = (e: globalThis.PointerEvent) => void (pointer = { x: e.clientX, y: e.clientY });
  const leave = () => void (pointer = null);
  const ours = (e: ClipboardEvent) => !(e.target as Element).closest(EDITABLE) && !!e.clipboardData;
  const copy = (e: ClipboardEvent) => {
    const clip = flow.copy();
    if (!ours(e) || !clip.nodes.length) return;
    e.preventDefault();
    e.clipboardData!.setData("text/plain", JSON.stringify(clip));
    if (e.type === "cut") flow.removeSelected();
  };
  const paste = (e: ClipboardEvent) => {
    const clip = ours(e) && parseClip(e.clipboardData!.getData("text/plain"));
    if (!clip) return;
    e.preventDefault();
    flow.paste(clip, pointer ? flow.toFlow(pointer.x, pointer.y) : undefined);
  };
  el.addEventListener("pointermove", track);
  el.addEventListener("pointerleave", leave);
  el.addEventListener("copy", copy);
  el.addEventListener("cut", copy);
  el.addEventListener("paste", paste);
  return () => {
    el.removeEventListener("pointermove", track);
    el.removeEventListener("pointerleave", leave);
    el.removeEventListener("copy", copy);
    el.removeEventListener("cut", copy);
    el.removeEventListener("paste", paste);
  };
}

/** Two-finger pinch + pan. Runs in the capture phase so a second finger never starts a node drag. */
function pinchZoom(el: HTMLElement, flow: Flow) {
  const touches = new Map<number, XY>();
  let start: { mid: XY; dist: number; zoom: number; anchor: XY } | null = null;
  const local = () => {
    const [p, q] = [...touches.values()] as [XY, XY]; // only called with two touches down
    const r = el.getBoundingClientRect();
    return {
      mid: { x: (p.x + q.x) / 2 - r.left, y: (p.y + q.y) / 2 - r.top },
      dist: Math.hypot(p.x - q.x, p.y - q.y) || 1,
    };
  };
  const down = (e: globalThis.PointerEvent) => {
    if (e.pointerType !== "touch") return;
    touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (touches.size < 2) return;
    e.stopPropagation();
    if (start) return;
    cancelDrag();
    delete el.dataset.panning;
    flow.set({ connection: null, marquee: null });
    const { mid, dist } = local();
    start = { mid, dist, zoom: flow.get().viewport.zoom, anchor: flow.screenToFlow(mid) };
  };
  const move = (e: globalThis.PointerEvent) => {
    if (!touches.has(e.pointerId)) return;
    touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (!start || touches.size < 2) return;
    const { mid, dist } = local();
    const zoom = Math.min(2.5, Math.max(0.1, (start.zoom * dist) / start.dist));
    flow.setViewport({ zoom, x: mid.x - start.anchor.x * zoom, y: mid.y - start.anchor.y * zoom });
  };
  const up = (e: globalThis.PointerEvent) => {
    touches.delete(e.pointerId);
    if (touches.size < 2) start = null;
  };
  el.addEventListener("pointerdown", down, true);
  addEventListener("pointermove", move);
  addEventListener("pointerup", up);
  addEventListener("pointercancel", up);
  return () => {
    el.removeEventListener("pointerdown", down, true);
    removeEventListener("pointermove", move);
    removeEventListener("pointerup", up);
    removeEventListener("pointercancel", up);
  };
}

/** Runs `apply` on viewport changes, outside React: panning and zooming never re-render anything. */
function useViewportEffect(apply: (v: FlowState["viewport"]) => void) {
  const flow = useFlow();
  useLayoutEffect(() => {
    let last: FlowState["viewport"] | null = null;
    const run = () => {
      const v = flow.get().viewport;
      if (v !== last) apply((last = v));
    };
    run();
    return flow.subscribe(run);
  }, [flow, apply]);
}

function Transform({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useViewportEffect(
    useMemo(() => (v) => void (ref.current!.style.transform = `translate(${v.x}px,${v.y}px) scale(${v.zoom})`), []),
  );
  return (
    <div ref={ref} className="absolute top-0 left-0 origin-top-left">
      {children}
    </div>
  );
}

function Background() {
  const ref = useRef<HTMLDivElement>(null);
  useViewportEffect(
    useMemo(
      () => (v) => {
        const gap = 20 * v.zoom;
        const s = ref.current!.style;
        s.backgroundImage = gap < 7 ? "none" : `radial-gradient(circle, ${THEME.dot} 1px, transparent 1.25px)`;
        s.backgroundSize = `${gap}px ${gap}px`;
        s.backgroundPosition = `${v.x - gap / 2}px ${v.y - gap / 2}px`;
      },
      [],
    ),
  );
  return <div ref={ref} className="pointer-events-none absolute inset-0" />;
}

// ---- viewport culling: only nodes/edges near the screen are mounted ----

const MARGIN = 240; // screen px kept mounted beyond each edge, so fast pans don't show pop-in

function viewRect(s: FlowState) {
  const { x, y, zoom } = s.viewport;
  return {
    x0: (-x - MARGIN) / zoom,
    y0: (-y - MARGIN) / zoom,
    x1: (s.size.w - x + MARGIN) / zoom,
    y1: (s.size.h - y + MARGIN) / zoom,
  };
}

function visibleNodeIds(s: FlowState) {
  const v = s.size.w ? viewRect(s) : null;
  return s.nodeIds.filter((id) => {
    const n = s.nodes[id];
    if (!n || isHidden(s, id)) return false;
    const z = s.sizes[id] ?? DEFAULT_SIZE;
    // Selected nodes stay mounted so dragging one off-screen keeps its state.
    return (
      !v ||
      n.selected ||
      (n.position.x < v.x1 && n.position.x + z.w > v.x0 && n.position.y < v.y1 && n.position.y + z.h > v.y0)
    );
  });
}

function visibleEdges(s: FlowState) {
  if (!s.size.w) return s.edges;
  const v = viewRect(s);
  return s.edges.filter((e) => {
    // Edges into a collapsed group attach to the group.
    const ia = shownAs(s, e.source),
      ib = shownAs(s, e.target);
    const a = s.nodes[ia],
      b = s.nodes[ib];
    if (!a || !b) return false;
    const za = s.sizes[ia] ?? DEFAULT_SIZE,
      zb = s.sizes[ib] ?? DEFAULT_SIZE;
    // Bounding box of both endpoint nodes, padded for bezier overshoot.
    const pad = 120;
    const x0 = Math.min(a.position.x, b.position.x) - pad,
      x1 = Math.max(a.position.x + za.w, b.position.x + zb.w) + pad;
    const y0 = Math.min(a.position.y, b.position.y) - pad,
      y1 = Math.max(a.position.y + za.h, b.position.y + zb.h) + pad;
    return x0 < v.x1 && x1 > v.x0 && y0 < v.y1 && y1 > v.y0;
  });
}

const Nodes = memo(function Nodes() {
  const ids = useFlowState(visibleNodeIds, shallowArray);
  return ids.map((id) => <NodeWrapper key={id} id={id} />);
});

const Edges = memo(function Edges() {
  const edges = useFlowState(visibleEdges, shallowArray);
  return edges.map((e) => <EdgeView key={e.id} edge={e} />);
});

function Marquee() {
  const m = useFlowState((s) => s.marquee);
  if (!m) return null;
  return (
    <div
      className="pointer-events-none absolute rounded-sm border border-primary/50 bg-primary/8"
      style={{
        left: Math.min(m.a.x, m.b.x),
        top: Math.min(m.a.y, m.b.y),
        width: Math.abs(m.a.x - m.b.x),
        height: Math.abs(m.a.y - m.b.y),
      }}
    />
  );
}
