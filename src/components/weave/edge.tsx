import { memo, useContext, useRef, useState } from "react";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ViewContext } from "./node";
import { THEME } from "./theme";
import {
  DEFAULT_SIZE,
  shownAs,
  useFlow,
  useFlowState,
  type FlowEdge,
  type HandleBox,
  type Side,
  type Size,
  type XY,
} from "./store";

const DIR: Record<Side, XY> = {
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
  top: { x: 0, y: -1 },
  bottom: { x: 0, y: 1 },
};
const OPPOSITE: Record<Side, Side> = { left: "right", right: "left", top: "bottom", bottom: "top" };

/** Cubic bezier leaving `a` and entering `b` along their handle sides; `at(t)` is the point at t ∈ [0, 1]. */
export function bezier(a: XY, as: Side, b: XY, bs: Side) {
  const k = Math.max(48, Math.hypot(b.x - a.x, b.y - a.y) * 0.45);
  const c1 = { x: a.x + DIR[as].x * k, y: a.y + DIR[as].y * k };
  const c2 = { x: b.x + DIR[bs].x * k, y: b.y + DIR[bs].y * k };
  const at = (t: number) => {
    const u = 1 - t;
    const [w0, w1, w2, w3] = [u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t];
    return { x: w0 * a.x + w1 * c1.x + w2 * c2.x + w3 * b.x, y: w0 * a.y + w1 * c1.y + w2 * c2.y + w3 * b.y };
  };
  return { c1, c2, d: `M${a.x},${a.y} C${c1.x},${c1.y} ${c2.x},${c2.y} ${b.x},${b.y}`, at, mid: at(0.5) };
}

const SVG = "pointer-events-none absolute top-0 left-0 overflow-visible";

/** Port estimate for a node that hasn't been measured yet (e.g. culled since it was added). */
export const guess = (type: "source" | "target", z: Size = DEFAULT_SIZE): HandleBox =>
  type === "source" ? { x: z.w, y: z.h / 2, side: "right", type } : { x: 0, y: z.h / 2, side: "left", type };

export const EdgeView = memo(function EdgeView({ edge }: { edge: FlowEdge }) {
  const flow = useFlow();
  const { edgeToolbar } = useContext(ViewContext);
  // Stable references only: the edge re-renders just when one of its endpoints moves or re-measures.
  // Endpoints inside a collapsed group attach to the group's side instead.
  const src = useFlowState((s) => shownAs(s, edge.source));
  const tgt = useFlowState((s) => shownAs(s, edge.target));
  const sp = useFlowState((s) => s.nodes[src]?.position);
  const tp = useFlowState((s) => s.nodes[tgt]?.position);
  const sm = useFlowState((s) => (src === edge.source ? s.handles[src]?.[edge.sourceHandle] : undefined));
  const tm = useFlowState((s) => (tgt === edge.target ? s.handles[tgt]?.[edge.targetHandle] : undefined));
  const sz = useFlowState((s) => (sm ? undefined : s.sizes[src]));
  const tz = useFlowState((s) => (tm ? undefined : s.sizes[tgt]));
  const [hover, setHover] = useState(false);
  const timer = useRef(0);
  const on = () => (clearTimeout(timer.current), setHover(true));
  const off = () => void (timer.current = window.setTimeout(() => setHover(false), 120));

  if (!sp || !tp || src === tgt) return null; // both ends folded into one group
  const sb = sm ?? guess("source", sz);
  const tb = tm ?? guess("target", tz);
  const { d, mid, at } = bezier(
    { x: sp.x + sb.x, y: sp.y + sb.y },
    sb.side,
    { x: tp.x + tb.x, y: tp.y + tb.y },
    tb.side,
  );
  const label = edge.label != null && edge.label !== false && at(edge.labelAt ?? 0.5);

  return (
    <>
      <svg className={SVG} width={1} height={1}>
        <path
          d={d}
          fill="none"
          stroke="transparent"
          strokeWidth={18}
          pointerEvents="stroke"
          className="cursor-pointer pointer-coarse:[stroke-width:32]"
          onPointerEnter={on}
          onPointerLeave={off}
          onPointerDown={(e) => {
            if (e.button !== 0) return;
            flow.el?.focus({ preventScroll: true });
            flow.selectEdge(edge.id, e.shiftKey);
          }}
        />
        <g
          data-edge-id={edge.id}
          data-kind={edge.kind}
          data-selected={edge.selected || undefined}
          data-animated={edge.animated || undefined}
          className={edge.className}
        >
          {edge.animated ? (
            <>
              {/* Faint track under the beads. */}
              <path
                d={d}
                fill="none"
                style={{ stroke: `color-mix(in oklch, ${THEME.edgeFlow} 30%, transparent)`, strokeWidth: 2 }}
              />
              <path d={d} fill="none" className="weave-flow" style={{ stroke: THEME.edgeFlow }} />
            </>
          ) : (
            <path
              d={d}
              fill="none"
              className="transition-[stroke]"
              style={{
                stroke: edge.selected ? THEME.edgeSelected : hover ? THEME.edgeHover : THEME.edge,
                strokeWidth: edge.selected ? THEME.edgeWidthSelected : THEME.edgeWidth,
              }}
            />
          )}
        </g>
      </svg>
      {label && (
        <div
          data-edge-label={edge.id}
          data-kind={edge.kind}
          className="pointer-events-none absolute -translate-1/2 rounded-md border bg-card px-1.5 py-0.5 text-[11px] leading-4 whitespace-nowrap text-muted-foreground shadow-xs"
          style={{ left: label.x, top: label.y }}
        >
          {edge.label}
        </div>
      )}
      {(hover || edge.selected) && (
        <div
          className="absolute z-20 flex -translate-1/2 items-center gap-1 rounded-lg border bg-card p-0.5 shadow-md animate-in fade-in-0 zoom-in-90"
          style={{ left: mid.x, top: mid.y }}
          onPointerEnter={on}
          onPointerLeave={off}
        >
          {edgeToolbar?.(edge) ?? (
            <Button
              size="icon-xs"
              variant="ghost"
              className="pointer-coarse:size-9"
              aria-label="Delete connection"
              onClick={() => flow.remove([], [edge.id])}
            >
              <Trash2 />
            </Button>
          )}
        </div>
      )}
    </>
  );
});

export function ConnectionLine() {
  const flow = useFlow();
  const c = useFlowState((s) => s.connection);
  const s = flow.get();
  const n = c && s.nodes[c.from.node];
  const h = c && s.handles[c.from.node]?.[c.from.handle];
  if (!c || !n || !h) return null;

  let b = c.to;
  let bs = OPPOSITE[h.side];
  const on = c.over && s.nodes[c.over.node];
  const oh = c.over && s.handles[c.over.node]?.[c.over.handle];
  if (on && oh) {
    b = { x: on.position.x + oh.x, y: on.position.y + oh.y };
    bs = oh.side;
  }
  const { d } = bezier({ x: n.position.x + h.x, y: n.position.y + h.y }, h.side, b, bs);
  return (
    <svg className={SVG} width={1} height={1}>
      <path
        d={d}
        fill="none"
        style={{ stroke: THEME.edgeSelected }}
        className={cn("[stroke-width:2]", !c.over && "[stroke-dasharray:6_5]")}
      />
    </svg>
  );
}
