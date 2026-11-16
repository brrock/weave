import { useLayoutEffect, useRef, type PointerEvent, type ReactNode } from "react";
import { Maximize, Minus, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { bezier, guess } from "./edge";
import { THEME } from "./theme";
import { DEFAULT_SIZE, drag, useFlow, useFlowState, type FlowNode } from "./store";

const PANEL = "absolute z-30 rounded-xl border bg-card/85 shadow-sm backdrop-blur-md";
const BOTTOM = "bottom-[max(1rem,env(safe-area-inset-bottom))]";

function ControlButton({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            className="pointer-coarse:size-9"
            aria-label={label}
            onClick={onClick}
          />
        }
      >
        {children}
      </TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  );
}

export function Controls({ className }: { className?: string }) {
  const flow = useFlow();
  const zoom = useFlowState((s) => s.viewport.zoom);
  return (
    <div className={cn(PANEL, BOTTOM, "left-4 flex flex-col items-center gap-0.5 p-1", className)}>
      <ControlButton label="Zoom in" onClick={() => flow.zoomAt(1.25, undefined, undefined, true)}>
        <Plus />
      </ControlButton>
      <ControlButton label="Zoom out" onClick={() => flow.zoomAt(0.8, undefined, undefined, true)}>
        <Minus />
      </ControlButton>
      <ControlButton label="Fit view" onClick={() => flow.fitView()}>
        <Maximize />
      </ControlButton>
      <ControlButton label="Reset zoom" onClick={() => flow.zoomAt(1 / zoom, undefined, undefined, true)}>
        <span className="text-[10px] font-medium tabular-nums">{Math.round(zoom * 100)}%</span>
      </ControlButton>
    </div>
  );
}

export interface MiniMapProps {
  className?: string;
  width?: number;
  height?: number;
  /** Fill per node: any CSS colour, or a custom property name like "--color-violet-500". */
  nodeColor?: (node: FlowNode) => string | undefined;
}

/** Canvas minimap: redraws at most once per frame, outside React, whatever the node count. */
export function MiniMap({ className, width = 200, height = 140, nodeColor }: MiniMapProps) {
  const flow = useFlow();
  const ref = useRef<HTMLCanvasElement>(null);
  const colorRef = useRef(nodeColor);
  colorRef.current = nodeColor;
  // Flow→minimap mapping from the last draw (minimap px = (flow - origin) * k); pointer handling inverts it.
  const map = useRef({ x0: 0, y0: 0, k: 1 });

  useLayoutEffect(() => {
    const canvas = ref.current!;
    const ctx = canvas.getContext("2d")!;
    let raf = 0;
    let seen: unknown[] = [];

    const draw = (force = false) => {
      raf = 0;
      const s = flow.get();
      const deps = [s.nodes, s.sizes, s.handles, s.edges, s.viewport, s.size];
      if (!force && deps.every((d, i) => d === seen[i])) return;
      seen = deps;
      const dpr = devicePixelRatio || 1;
      if (canvas.width !== width * dpr) {
        canvas.width = width * dpr;
        canvas.height = height * dpr;
      }

      const vp = s.viewport;
      const view = { x: -vp.x / vp.zoom, y: -vp.y / vp.zoom, w: s.size.w / vp.zoom, h: s.size.h / vp.zoom };
      // Fit the graph, not graph ∪ viewport: panning away shouldn't shrink the map to specks.
      const b = s.nodeIds.length ? flow.bounds() : view;
      const pad = 12;
      const k = Math.min((width - pad * 2) / Math.max(b.w, 1), (height - pad * 2) / Math.max(b.h, 1));
      const m = (map.current = { x0: b.x + b.w / 2 - width / 2 / k, y0: b.y + b.h / 2 - height / 2 / k, k });

      // Let CSS resolve colours (var() fallbacks, color-mix, nested themes) into something canvas accepts.
      const css = getComputedStyle(canvas);
      const resolve = (c: string) => {
        canvas.style.color = c.startsWith("--") ? `var(${c}, var(--muted-foreground))` : c;
        return css.color;
      };
      const primary = resolve("--primary");
      ctx.setTransform(dpr * k, 0, 0, dpr * k, -m.x0 * dpr * k, -m.y0 * dpr * k);
      ctx.clearRect(m.x0, m.y0, width / k, height / k);

      // Edges first, as faint curves between ports.
      ctx.beginPath();
      for (const e of s.edges) {
        const a = s.nodes[e.source],
          t = s.nodes[e.target];
        if (!a || !t) continue;
        const sb = s.handles[e.source]?.[e.sourceHandle] ?? guess("source", s.sizes[e.source]);
        const tb = s.handles[e.target]?.[e.targetHandle] ?? guess("target", s.sizes[e.target]);
        const p = { x: a.position.x + sb.x, y: a.position.y + sb.y },
          q = { x: t.position.x + tb.x, y: t.position.y + tb.y };
        const { c1, c2 } = bezier(p, sb.side, q, tb.side);
        ctx.moveTo(p.x, p.y);
        ctx.bezierCurveTo(c1.x, c1.y, c2.x, c2.y, q.x, q.y);
      }
      ctx.strokeStyle = resolve(THEME.edge);
      ctx.lineWidth = 1.25 / k;
      ctx.stroke();

      // Nodes, batched by colour: one path + fill per distinct colour.
      const groups = new Map<string, Path2D>();
      const selected = new Path2D();
      const r = 3 / k;
      for (const id of s.nodeIds) {
        const n = s.nodes[id];
        if (!n) continue;
        const z = s.sizes[id] ?? DEFAULT_SIZE;

        const c = colorRef.current?.(n) ?? "--muted-foreground";
        if (!groups.has(c)) groups.set(c, new Path2D());
        groups.get(c)!.roundRect(n.position.x, n.position.y, z.w, z.h, r);
        if (n.selected) selected.roundRect(n.position.x, n.position.y, z.w, z.h, r);
      }
      ctx.globalAlpha = colorRef.current ? 0.85 : 0.5;
      for (const [c, path] of groups) {
        ctx.fillStyle = resolve(c);
        ctx.fill(path);
      }
      ctx.globalAlpha = 1;
      ctx.strokeStyle = primary;
      ctx.lineWidth = 2 / k;
      ctx.stroke(selected);

      // Dim what's off-screen, then outline the viewport.
      ctx.globalAlpha = 0.5;
      ctx.fillStyle = resolve("--background");
      ctx.beginPath();
      ctx.rect(m.x0, m.y0, width / k, height / k);
      ctx.rect(view.x, view.y, view.w, view.h);
      ctx.fill("evenodd");
      ctx.globalAlpha = 0.7;
      ctx.strokeStyle = primary;
      ctx.lineWidth = 1.5 / k;
      ctx.beginPath();
      ctx.roundRect(view.x, view.y, view.w, view.h, 4 / k);
      ctx.stroke();
      ctx.globalAlpha = 1;
    };

    const schedule = () => void (raf ||= requestAnimationFrame(() => draw()));
    const unsubscribe = flow.subscribe(schedule);
    // Theme switches change CSS variables without touching the store.
    const theme = new MutationObserver(() => draw(true));
    theme.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "style", "data-theme"] });
    draw(true);
    return () => {
      unsubscribe();
      theme.disconnect();
      cancelAnimationFrame(raf);
    };
  }, [flow, width, height]);

  const onPointerDown = (e: PointerEvent<HTMLCanvasElement>) => {
    // Freeze the mapping at drag start so the map doesn't shift under the cursor as bounds change.
    const m = { ...map.current };
    const r = e.currentTarget.getBoundingClientRect();
    const toFlow = (ev: { clientX: number; clientY: number }) => ({
      x: m.x0 + (ev.clientX - r.left) / m.k,
      y: m.y0 + (ev.clientY - r.top) / m.k,
    });
    const s = flow.get();
    const v = s.viewport;
    const p = toFlow(e);
    const view = { x: -v.x / v.zoom, y: -v.y / v.zoom, w: s.size.w / v.zoom, h: s.size.h / v.zoom };
    const inside = p.x >= view.x && p.x <= view.x + view.w && p.y >= view.y && p.y <= view.y + view.h;
    // Grab the viewport window and drag it; clicking elsewhere centres there first.
    const grab = inside ? { x: p.x - view.x - view.w / 2, y: p.y - view.y - view.h / 2 } : { x: 0, y: 0 };
    const center = (ev: { clientX: number; clientY: number }) => {
      const q = toFlow(ev);
      const { viewport: cur, size } = flow.get();
      flow.setViewport({
        ...cur,
        x: size.w / 2 - (q.x - grab.x) * cur.zoom,
        y: size.h / 2 - (q.y - grab.y) * cur.zoom,
      });
    };
    center(e);
    drag(center);
  };

  return (
    <div className={cn(PANEL, BOTTOM, "right-4 overflow-hidden", className)}>
      <canvas
        ref={ref}
        style={{ width, height }}
        className="block cursor-grab touch-none active:cursor-grabbing"
        onPointerDown={onPointerDown}
        aria-label="Minimap"
      />
    </div>
  );
}
