import { expect, test } from "bun:test";
import { createFlow, edge, isHidden, parseClip, shownAs, type FlowNode } from "./store";

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

test("copy/paste remaps ids, keeps inner edges and is one undo step", () => {
  const f = createFlow([n("a"), n("b", 400), n("c", 800)], [edge("a", "out", "b", "in"), edge("b", "out", "c", "in")]);
  f.select(["a", "b"]);
  const clip = parseClip(JSON.stringify(f.copy()))!;
  expect(clip.nodes.map((x) => x.id)).toEqual(["a", "b"]);
  expect(clip.edges.map((x) => x.id)).toEqual(["a:out->b:in"]); // b→c leaves the selection

  const ids = f.paste(clip, { x: 1000, y: 500 });
  expect(ids).toHaveLength(2);
  const [a2, b2] = ids.map((id) => f.get().nodes[id]!);
  expect([a2!.position, b2!.position]).toEqual([
    { x: 1000, y: 500 },
    { x: 1400, y: 500 },
  ]);
  expect(f.get().edges.at(-1)).toMatchObject({ source: a2!.id, target: b2!.id, id: `${a2!.id}:out->${b2!.id}:in` });
  expect(f.get().nodes.a?.selected).toBe(false); // the paste is the new selection
  f.undo();
  expect(f.get().nodeIds).toEqual(["a", "b", "c"]);

  expect(parseClip("not json")).toBeNull();
  expect(parseClip('{"nodes":[{"id":1}]}')).toBeNull();
  expect(parseClip('{"nodes":[]}')).toBeNull();
});

test("groups frame nodes, move them together, collapse and cascade", () => {
  const f = createFlow([n("a"), n("b", 400), n("c", 800)], [edge("a", "out", "b", "in"), edge("b", "out", "c", "in")]);
  const g = f.group(["a", "b"], "Pair")!;
  const frame = f.get().nodes[g]!;
  expect(f.get().nodeIds[0]).toBe(g); // drawn first, under its contents
  expect(frame).toMatchObject({ type: "group", data: { title: "Pair" }, selected: true });
  expect(frame.position.x).toBeLessThan(0);
  expect(frame.position.x + frame.size!.w).toBeGreaterThan(400 + 240);
  expect(f.get().nodes.a?.parent).toBe(g);

  // Dragging the frame drags its contents.
  f.moveNodes(f.dragOrigins(), 100, 0);
  expect([f.get().nodes.a?.position.x, f.get().nodes.b?.position.x, f.get().nodes.c?.position.x]).toEqual([
    100, 500, 800,
  ]);

  // Collapsing hides the contents; edges attach to the group.
  f.updateNodeData(g, { collapsed: true });
  expect(isHidden(f.get(), "a")).toBe(true);
  expect(shownAs(f.get(), "b")).toBe(g);
  expect(shownAs(f.get(), "c")).toBe("c");
  f.updateNodeData(g, { collapsed: false });

  // Dropping c inside the frame joins it; dropping a far away leaves it.
  f.set({ nodes: { ...f.get().nodes, c: { ...f.get().nodes.c!, position: { x: 200, y: 0 } } } });
  f.regroup(["c"]);
  expect(f.get().nodes.c?.parent).toBe(g);
  f.moveNodes({ a: { x: 100, y: 0 } }, 0, 2000);
  f.regroup(["a"]);
  expect(f.get().nodes.a?.parent).toBeUndefined();

  // Copy keeps membership; removing the group removes its contents.
  f.select([g]);
  const pasted = f.paste(f.copy());
  expect(pasted).toHaveLength(3);
  expect(pasted.slice(1).every((id) => f.get().nodes[id]?.parent === pasted[0])).toBe(true);
  f.remove([g]);
  expect(f.get().nodes.b).toBeUndefined();
  expect(f.get().nodes.a).toBeDefined();
  f.undo();
  f.ungroup(g); // keeps the contents
  expect(f.get().nodes[g]).toBeUndefined();
  expect(f.get().nodes.b?.parent).toBeUndefined();
});
