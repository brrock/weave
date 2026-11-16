import { expect, test } from "bun:test";
import { createFlow, edge, type FlowNode } from "./store";

const n = (id: string, x = 0, y = 0): FlowNode => ({ id, type: "step", position: { x, y }, data: {} });

test("connect validates direction, self-loops and duplicates", () => {
  const f = createFlow([n("a"), n("b", 400)]);
  const out = { node: "a", handle: "out", type: "source" as const };
  const inp = { node: "b", handle: "in", type: "target" as const };
  expect(f.connect(inp, out)?.id).toBe("a:out->b:in"); // reversed drag still yields source→target
  expect(f.connect(out, inp)).toBeNull();
  expect(f.connect(out, { ...out, handle: "x" })).toBeNull();
  expect(f.connect(out, { node: "a", handle: "in", type: "target" })).toBeNull();
  expect(f.get().connected.has("b:in")).toBe(true);
});

test("drag snaps to grid from origins and remove cascades edges", () => {
  const f = createFlow([n("a"), n("b", 400)], [edge("a", "out", "b", "in")]);
  f.select(["a"]);
  f.moveNodes(f.dragOrigins(), 27, 9);
  expect(f.get().nodes.a.position).toEqual({ x: 20, y: 0 });
  expect(f.get().nodes.b.position).toEqual({ x: 400, y: 0 });
  f.removeSelected();
  expect(f.get().nodeIds).toEqual(["b"]);
  expect(f.get().edges).toEqual([]);
  expect(f.get().connected.size).toBe(0);
});

test("selectRect and handleNear", () => {
  const f = createFlow([n("a"), n("b", 400), n("c", 0, 400)]);
  f.selectRect({ x: -10, y: -10 }, { x: 450, y: 50 });
  expect(f.get().nodeIds.filter((id) => f.get().nodes[id].selected)).toEqual(["a", "b"]);

  f.set({
    handles: {
      b: { in: { x: 0, y: 32, side: "left", type: "target" } },
      c: { in: { x: 0, y: 32, side: "left", type: "target" } },
    },
  });
  const from = { node: "a", handle: "out", type: "source" as const };
  expect(f.handleNear({ x: 390, y: 30 }, from)?.node).toBe("b"); // near the port
  expect(f.handleNear({ x: 150, y: 430 }, from)?.node).toBe("c"); // anywhere over the node
  expect(f.handleNear({ x: 200, y: 200 }, from)).toBeNull();
});

test("undo/redo records changes, coalesces batches and skips selection", () => {
  const f = createFlow([n("a"), n("b", 400)]);
  const a = { node: "a", handle: "out", type: "source" as const };
  const b = { node: "b", handle: "in", type: "target" as const };
  expect(f.canUndo).toBe(false);

  f.connect(a, b);
  f.updateNodeData("a", { label: "A" });
  f.select(["a"]); // selection is not a step
  const end = f.begin(); // a drag: many moves, one step
  for (let dx = 20; dx <= 200; dx += 20) f.moveNodes({ a: { x: 0, y: 0 } }, dx, 0);
  end();
  f.add([n("c", 0, 400)]);
  f.remove(["b"]);
  f.untracked(() => f.updateNodeData("a", { status: "running" }));

  const snap = () => ({ ids: f.get().nodeIds.join(), edges: f.get().edges.length, x: f.get().nodes.a?.position.x });
  expect(snap()).toEqual({ ids: "a,c", edges: 0, x: 200 });
  f.undo(); // remove b
  expect(snap()).toEqual({ ids: "a,b,c", edges: 1, x: 200 });
  expect(f.get().connected.has("b:in")).toBe(true);
  f.undo(); // add c
  f.undo(); // the whole drag
  expect(snap()).toEqual({ ids: "a,b", edges: 1, x: 0 });
  f.undo(); // data
  expect(f.get().nodes.a?.data).toEqual({});
  f.undo(); // connect
  expect(f.get().edges).toEqual([]);
  expect(f.canUndo).toBe(false);
  f.undo(); // nothing left: no-op

  f.redo();
  f.redo();
  f.redo();
  expect(snap()).toEqual({ ids: "a,b", edges: 1, x: 200 });
  f.updateNodeData("b", { label: "B" }); // a new change drops the redo stack
  expect(f.canRedo).toBe(false);
});
