import { memo, useContext, useRef, useState } from "react";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ViewContext } from "./node";
import { THEME } from "./theme";
import {
  DEFAULT_SIZE,
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

/** Cubic bezier leaving `a` and entering `b` along their handle sides; `mid` is the curve's t=0.5 point. */
export function bezier(a: XY, as: Side, b: XY, bs: Side) {
  const k = Math.max(48, Math.hypot(b.x - a.x, b.y - a.y) * 0.45);
  const c1 = { x: a.x + DIR[as].x * k, y: a.y + DIR[as].y * k };
  const c2 = { x: b.x + DIR[bs].x * k, y: b.y + DIR[bs].y * k };
  return {
    c1,
    c2,
    d: `M${a.x},${a.y} C${c1.x},${c1.y} ${c2.x},${c2.y} ${b.x},${b.y}`,
    mid: { x: (a.x + 3 * c1.x + 3 * c2.x + b.x) / 8, y: (a.y + 3 * c1.y + 3 * c2.y + b.y) / 8 },
  };
}

const SVG = "pointer-events-none absolute top-0 left-0 overflow-visible";

/** Port estimate for a node that hasn't been measured yet (e.g. culled since it was added). */
export const guess = (type: "source" | "target", z: Size = DEFAULT_SIZE): HandleBox =>
  type === "source" ? { x: z.w, y: z.h / 2, side: "right", type } : { x: 0, y: z.h / 2, side: "left", type };

export const EdgeView = memo(function EdgeView({ edge }: { edge: FlowEdge }) {
  const flow = useFlow();
  const { edgeToolbar } = useContext(ViewContext);
  // Stable references only: the edge re-renders just when one of its endpoints moves or re-measures.
  const sp = useFlowState((s) => s.nodes[edge.source]?.position);
  const tp = useFlowState((s) => s.nodes[edge.target]?.position);
  const sm = useFlowState((s) => s.handles[edge.source]?.[edge.sourceHandle]);
  const tm = useFlowState((s) => s.handles[edge.target]?.[edge.targetHandle]);
  const sz = useFlowState((s) => (sm ? undefined : s.sizes[edge.source]));
  const tz = useFlowState((s) => (tm ? undefined : s.sizes[edge.target]));
  const [hover, setHover] = useState(false);
  const timer = useRef(0);
  const on = () => (clearTimeout(timer.current), setHover(true));
  const off = () => void (timer.current = window.setTimeout(() => setHover(false), 120));

  if (!sp || !tp) return null;
  const sb = sm ?? guess("source", sz);
  const tb = tm ?? guess("target", tz);
  const { d, mid } = bezier({ x: sp.x + sb.x, y: sp.y + sb.y }, sb.side, { x: tp.x + tb.x, y: tp.y + tb.y }, tb.side);

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
        <path
          d={d}
          fill="none"
          style={{
            stroke: edge.animated
              ? THEME.edgeFlow
              : edge.selected
                ? THEME.edgeSelected
                : hover
                  ? THEME.edgeHover
                  : THEME.edge,
          }}
          className={cn(
            "transition-[stroke] [stroke-width:1.75]",
            edge.selected && "[stroke-width:2.5]",
            edge.animated && "weave-flow",
          )}
        />
      </svg>
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
