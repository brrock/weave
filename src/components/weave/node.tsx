import {
  createContext,
  memo,
  useContext,
  useLayoutEffect,
  useRef,
  type ComponentType,
  type HTMLAttributes,
  type PointerEvent,
  type ReactNode,
} from "react";
import { cn } from "@/lib/utils";
import { drag, useFlow, useFlowState, type FlowEdge, type HandleType, type Side } from "./store";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export interface NodeProps<D = any> {
  id: string;
  data: D;
  selected: boolean;
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type NodeTypes = Record<string, ComponentType<NodeProps<any>>>;

export const ViewContext = createContext<{ nodeTypes: NodeTypes; edgeToolbar?: (edge: FlowEdge) => ReactNode }>({
  nodeTypes: {},
});
const NodeIdContext = createContext("");
export const useNodeId = () => useContext(NodeIdContext);

const NO_DRAG = "button,input,textarea,select,a,[contenteditable],[data-nodrag],[data-handle-id]";

export const NodeWrapper = memo(function NodeWrapper({ id }: { id: string }) {
  const flow = useFlow();
  const node = useFlowState((s) => s.nodes[id]);
  const { nodeTypes } = useContext(ViewContext);
  const ref = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const el = ref.current!;
    const ro = new ResizeObserver(() => flow.measure(id, el));
    ro.observe(el);
    return () => ro.disconnect();
  }, [flow, id]);

  if (!node) return null;
  const onPointerDown = (e: PointerEvent) => {
    if (e.button !== 0 || (e.target as Element).closest(NO_DRAG)) return;
    flow.el?.focus({ preventScroll: true });
    const wasSelected = node.selected;
    if (e.shiftKey) flow.toggle(id);
    else if (!wasSelected) flow.select([id]);
    const origins = flow.dragOrigins();
    const start = flow.toFlow(e.clientX, e.clientY);
    let moved = false;
    drag(
      (ev) => {
        moved = true;
        const p = flow.toFlow(ev.clientX, ev.clientY);
        flow.moveNodes(origins, p.x - start.x, p.y - start.y);
      },
      // Clicking (not dragging) one node of a multi-selection narrows the selection to it.
      () => !moved && wasSelected && !e.shiftKey && flow.select([id]),
      flow.begin(), // the whole drag is one undo step
    );
  };

  const Body = nodeTypes[node.type] ?? DefaultNode;
  return (
    <div
      ref={ref}
      data-node-id={id}
      className="absolute top-0 left-0 cursor-default [contain:layout_style]"
      style={{
        transform: `translate(${node.position.x}px,${node.position.y}px)`,
        zIndex: node.selected ? 1 : undefined,
      }}
      onPointerDown={onPointerDown}
    >
      <NodeIdContext.Provider value={id}>
        <Body id={id} data={node.data} selected={!!node.selected} />
      </NodeIdContext.Provider>
    </div>
  );
});

const PLACE: Record<Side, string> = {
  left: "left-0 top-1/2",
  right: "left-full top-1/2",
  top: "left-1/2 top-0",
  bottom: "left-1/2 top-full",
};

export interface HandleProps extends HTMLAttributes<HTMLDivElement> {
  id: string;
  type: HandleType;
  side?: Side;
}

/**
 * A connection port. Place it inside a node; override position with `style` (e.g. `top: "30%"`).
 * Only position and hit area live here; the look comes from the `weave` CSS (`--weave-handle*` variables
 * and `data-type`/`data-side`/`data-connected`/`data-state`), so plain CSS or utilities restyle it.
 */
export function Handle({ id, type, side = type === "source" ? "right" : "left", className, ...rest }: HandleProps) {
  const node = useNodeId();
  const flow = useFlow();
  const connected = useFlowState((s) => s.connected.has(`${node}:${id}`));
  const state = useFlowState((s) => {
    const c = s.connection;
    if (!c) return undefined;
    if (c.over?.node === node && c.over.handle === id) return "over";
    return c.from.type !== type && c.from.node !== node ? "valid" : undefined;
  });
  return (
    <div
      data-handle-id={id}
      data-type={type}
      data-side={side}
      data-connected={connected}
      data-state={state}
      {...rest}
      className={cn(
        "group/handle absolute z-10 -translate-1/2 before:absolute before:-inset-2 before:content-[''] pointer-coarse:before:-inset-4",
        PLACE[side],
        className,
      )}

      onPointerDown={(e) => {
        if (e.button !== 0 || e.target !== e.currentTarget) return;
        flow.startConnection({ node, handle: id, type }, e.nativeEvent);
      }}
    />
  );
}

function DefaultNode({ data, selected }: NodeProps<{ label?: string }>) {
  return (
    <div className={cn("rounded-lg border bg-card px-4 py-2.5 text-sm shadow-sm", selected && "ring-2 ring-ring")}>
      {data?.label ?? "Node"}
      <Handle id="in" type="target" />
      <Handle id="out" type="source" />
    </div>
  );
}
