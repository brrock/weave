import { useState } from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { NodeResizer, type NodeProps } from "./node";
import { useFlow, useFlowState } from "./store";
import { THEME } from "./theme";

export type GroupData = { title: string; collapsed?: boolean };

/**
 * A frame around nodes (each has `parent` set to its id). Drag it by the title bar to move everything inside;
 * the chevron collapses it to the title bar, rerouting edges to its sides. Double-click the title to rename.
 */
export function GroupNode({ id, data, selected, size }: NodeProps<GroupData>) {
  const flow = useFlow();
  const [editing, setEditing] = useState(false);
  const count = useFlowState((s) => (data.collapsed ? s.nodeIds.filter((n) => s.nodes[n]?.parent === id).length : 0));
  const rename = (title: string) => {
    setEditing(false);
    if (title.trim() && title !== data.title) flow.updateNodeData(id, { title: title.trim() });
  };
  return (
    <div
      data-weave-group=""
      data-collapsed={data.collapsed || undefined}
      className={cn("relative rounded-xl border-2 border-dashed", selected ? "border-ring" : "border-border")}
      style={{ width: size?.w ?? 400, height: data.collapsed ? undefined : (size?.h ?? 240), background: THEME.group }}
    >
      <div
        className="pointer-events-auto flex h-9 cursor-grab items-center gap-1 px-1.5 text-sm font-medium text-muted-foreground active:cursor-grabbing"
        onDoubleClick={() => setEditing(true)}
      >
        <button
          aria-label={data.collapsed ? "Expand group" : "Collapse group"}
          aria-expanded={!data.collapsed}
          className="grid size-6 shrink-0 cursor-pointer place-items-center rounded-md hover:bg-muted pointer-coarse:size-9"
          onClick={() => {
            flow.select([id]); // nothing hidden stays selected
            flow.updateNodeData(id, { collapsed: !data.collapsed });
          }}
        >
          <ChevronRight className={cn("size-4 transition-transform", !data.collapsed && "rotate-90")} />
        </button>
        {editing ? (
          <input
            autoFocus
            aria-label="Group title"
            defaultValue={data.title}
            className="min-w-0 flex-1 bg-transparent text-foreground outline-none"
            onBlur={(e) => rename(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === "Escape") e.currentTarget.blur();
            }}
          />
        ) : (
          <span className="truncate">{data.title}</span>
        )}
        {data.collapsed && <span className="ml-auto shrink-0 pr-1.5 text-xs tabular-nums">{count} nodes</span>}
      </div>
      {selected && !data.collapsed && <NodeResizer minWidth={160} minHeight={80} />}
    </div>
  );
}
