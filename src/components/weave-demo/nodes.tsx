import { createContext, useContext } from "react";
import { CircleAlert, CircleCheck, LoaderCircle, Plus, Zap } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Handle,
  type FlowEdge,
  type HandleRef,
  type HandleType,
  type NodeProps,
  type NodeTypes,
} from "@/components/weave";
import { byKey } from "./catalog";

export type StepData = { key: string; label: string; status?: "running" | "success" | "error"; disabled?: boolean };

/** Where a node picked from the palette goes: after/before a handle, or spliced into an edge. */
export type PaletteTarget = { from?: HandleRef; between?: FlowEdge };

export const DemoContext = createContext({
  openPalette: (_target: PaletteTarget = {}) => {},
  openDetails: (_id: string) => {},
});

const pct = (i: number, n: number) => `${((i + 1) / (n + 1)) * 100}%`;

function Ports({ node, ids, type }: { node: string; ids: string[]; type: HandleType }) {
  const { openPalette } = useContext(DemoContext);
  return ids.map((h, i) => (
    <Handle
      key={h}
      id={h}
      type={type}
      style={{ top: pct(i, ids.length) }}
      className={type === "target" ? "h-4 w-2 rounded-[3px]" : undefined}
    >
      {ids.length > 1 && (
        <span
          className={cn(
            "pointer-events-none absolute top-1/2 -translate-y-1/2 text-[10px] font-medium text-muted-foreground",
            type === "source" ? "right-full mr-2.5" : "left-full ml-2.5",
          )}
        >
          {h}
        </span>
      )}
      {type === "source" && (
        // n8n-style stub: unconnected outputs offer a "+" that opens the palette.
        <div className="absolute top-1/2 left-full hidden -translate-y-1/2 items-center group-data-[connected=false]/handle:flex">
          <div className="h-px w-7 bg-muted-foreground/40" />
          <button
            aria-label={`Add node after ${h}`}
            className="grid size-5 cursor-pointer place-items-center pointer-coarse:size-8 rounded-md border bg-card text-muted-foreground shadow-xs transition hover:border-primary hover:text-foreground"
            onClick={() => openPalette({ from: { node, handle: h, type: "source" } })}
          >
            <Plus className="size-3" />
          </button>
        </div>
      )}
    </Handle>
  ));
}

const STATUS = {
  running: <LoaderCircle className="size-4 animate-spin text-sky-500" />,
  success: <CircleCheck className="size-4 text-emerald-500" />,
  error: <CircleAlert className="size-4 text-destructive" />,
};

function StepNode({ id, data, selected }: NodeProps<StepData>) {
  const { openDetails } = useContext(DemoContext);
  const item = byKey[data.key];
  if (!item) return null;
  const Icon = item.icon;

  const multi = item.inputs.length > 1 || item.outputs.length > 1;
  return (
    <div
      onDoubleClick={() => openDetails(id)}
      className={cn(
        "relative flex w-64 items-center gap-3 rounded-xl border bg-card p-3 pr-4 text-card-foreground shadow-sm transition-[box-shadow,border-color,opacity,filter] hover:shadow-md",
        item.kind === "trigger" && "rounded-l-[2rem] pl-4",
        multi && "min-h-20",
        selected && "border-primary/50 ring-4 ring-primary/10",
        data.status === "running" && "weave-running",
        data.status === "success" && "border-emerald-500/50",
        data.disabled && "opacity-50 grayscale",
      )}
    >
      {item.kind === "trigger" && (
        <Zap className="absolute top-1/2 -left-2.5 size-4 -translate-y-1/2 fill-amber-400 text-amber-500" />
      )}
      <div className={cn("grid size-10 shrink-0 place-items-center rounded-lg", item.tint)}>
        <Icon className="size-5" />
      </div>
      <div className={cn("min-w-0 flex-1", item.outputs.length > 1 && "mr-6", item.inputs.length > 1 && "ml-4")}>
        <div className="truncate text-sm leading-tight font-medium">{data.label}</div>
        <div className="truncate text-xs text-muted-foreground">{item.description}</div>
      </div>
      {data.status && STATUS[data.status]}
      <Ports node={id} ids={item.inputs} type="target" />
      <Ports node={id} ids={item.outputs} type="source" />
    </div>
  );
}

function NoteNode({ data, selected }: NodeProps<{ text: string }>) {
  return (
    <div
      className={cn(
        "w-64 rounded-xl border border-amber-300/70 bg-amber-50 p-4 text-sm text-amber-950 shadow-sm dark:border-amber-400/20 dark:bg-amber-400/10 dark:text-amber-100",
        selected && "ring-4 ring-amber-400/25",
      )}
    >
      <div className="mb-1.5 text-[11px] font-semibold tracking-wider uppercase opacity-60">Note</div>
      <p className="leading-relaxed whitespace-pre-wrap">{data.text}</p>
    </div>
  );
}

export const nodeTypes: NodeTypes = { step: StepNode, note: NoteNode };
