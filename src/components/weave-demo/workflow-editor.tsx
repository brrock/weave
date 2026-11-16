import { useCallback, useMemo, useState } from "react"
import { Gauge, Moon, Pencil, Play, Plus, Sun, Trash2, Workflow } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Command, CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandShortcut } from "@/components/ui/command"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import { Switch } from "@/components/ui/switch"
import { Controls, MiniMap, Weave, shallowArray, useStore, type Flow, type FlowEdge, type FlowNode } from "@/components/weave"
import { CATALOG, byKey, type CatalogItem, type Kind } from "./catalog"
import { DemoContext, nodeTypes, type PaletteTarget, type StepData } from "./nodes"
import { execute, placeNode, seedFlow, stress } from "./workflow"

const GROUPS: [Kind, string][] = [
  ["trigger", "Triggers"],
  ["action", "Actions"],
  ["logic", "Flow"],
]

export function WorkflowEditor() {
  const [flow] = useState(seedFlow)
  const [palette, setPalette] = useState<PaletteTarget | null>(null)
  const [details, setDetails] = useState<string | null>(null)
  const [running, setRunning] = useState(false)
  const [dark, setDark] = useState(() => document.documentElement.classList.contains("dark"))
  const nodeCount = useStore(flow, (s) => s.nodeIds.length)
  const edgeCount = useStore(flow, (s) => s.edges.length)

  const demo = useMemo(() => ({ openPalette: (t: PaletteTarget = {}) => setPalette(t), openDetails: setDetails }), [])
  const edgeToolbar = useCallback(
    (e: FlowEdge) => (
      <>
        <Button size="icon-xs" variant="ghost" className="pointer-coarse:size-9" aria-label="Insert node" onClick={() => setPalette({ between: e })}>
          <Plus />
        </Button>
        <Button size="icon-xs" variant="ghost" className="pointer-coarse:size-9" aria-label="Delete connection" onClick={() => flow.remove([], [e.id])}>
          <Trash2 />
        </Button>
      </>
    ),
    [flow],
  )

  const toggleTheme = () => setDark(document.documentElement.classList.toggle("dark"))
  const run = async () => {
    setRunning(true)
    await execute(flow)
    setRunning(false)
  }

  return (
    <DemoContext.Provider value={demo}>
      <div className="flex h-dvh flex-col bg-background text-foreground">
        <header className="flex h-14 shrink-0 items-center gap-2 border-b px-3 pt-[env(safe-area-inset-top)] sm:gap-3 sm:px-4">
          <div className="grid size-8 place-items-center rounded-lg bg-primary text-primary-foreground">
            <Workflow className="size-4" />
          </div>
          <div className="leading-tight">
            <div className="text-sm font-semibold">Lead routing</div>
            <div className="hidden text-xs text-muted-foreground sm:block">Weave · node editor</div>
          </div>
          <Badge variant="secondary" className="ml-2 hidden tabular-nums sm:inline-flex">
            {nodeCount} nodes · {edgeCount} links
          </Badge>
          <div className="ml-auto flex items-center gap-1.5">
            <Button variant="ghost" size="sm" aria-label="Add 500 nodes" onClick={() => stress(flow)}>
              <Gauge /> <span className="hidden sm:inline">Add 500</span>
            </Button>
            <Button variant="ghost" size="icon-sm" aria-label="Toggle theme" onClick={toggleTheme}>
              {dark ? <Sun /> : <Moon />}
            </Button>
            <Separator orientation="vertical" className="mx-1 h-5!" />
            <Button variant="outline" size="sm" aria-label="Add node" onClick={() => setPalette({})}>
              <Plus /> <span className="hidden sm:inline">Add node</span>
            </Button>
            <Button size="sm" onClick={run} disabled={running}>
              <Play className="fill-current" /> {running ? "Running…" : "Execute"}
            </Button>
          </div>
        </header>

        <Weave
          flow={flow}
          nodeTypes={nodeTypes}
          edgeToolbar={edgeToolbar}
          onConnectEnd={({ from }) => setPalette({ from })}
          onKeyDown={(e) => {
            if (e.key !== "Tab") return
            e.preventDefault()
            setPalette({})
          }}
          // Theme hook: runs light up green instead of the default --primary.
          className="flex-1 [--weave-edge-flow:var(--color-emerald-500)]"
        >
          <Controls />
          <SelectionBar flow={flow} onEdit={setDetails} />
          <MiniMap className="hidden md:block" nodeColor={minimapColor} />
          <div className="pointer-events-none absolute top-4 left-4 z-30 hidden text-xs text-muted-foreground lg:block">
            Drag to pan · ⌘/pinch to zoom · Shift-drag to select · ⌫ to delete
          </div>
        </Weave>
      </div>

      <Palette flow={flow} target={palette} onClose={() => setPalette(null)} />
      <Details flow={flow} id={details} onClose={() => setDetails(null)} />
    </DemoContext.Provider>
  )
}

/** Minimap fill: the node's catalog hue (tint classes look like "bg-violet-500/12 …"). */
const minimapColor = (n: FlowNode) =>
  n.type === "note" ? "--color-amber-400" : `--color-${/bg-(\w+)-500/.exec(byKey[n.data.key]?.tint ?? "")?.[1] ?? "neutral"}-500`

/** Floating actions for the selection: touch has no Delete key or reliable double-click. */
function SelectionBar({ flow, onEdit }: { flow: Flow; onEdit: (id: string) => void }) {
  const nodes = useStore(flow, (s) => s.nodeIds.filter((id) => s.nodes[id]?.selected), shallowArray)
  const edges = useStore(flow, (s) => s.edges.filter((e) => e.selected), shallowArray)
  const total = nodes.length + edges.length
  if (!total) return null
  const only = nodes.length === 1 ? nodes[0] : undefined
  const editable = only && flow.get().nodes[only]?.type === "step"
  return (
    <div className="absolute bottom-[max(1rem,env(safe-area-inset-bottom))] left-1/2 z-30 flex -translate-x-1/2 items-center gap-1 rounded-xl border bg-card/90 p-1 pl-3 shadow-lg backdrop-blur-md animate-in fade-in-0 slide-in-from-bottom-2">
      <span className="mr-1 text-xs whitespace-nowrap text-muted-foreground tabular-nums">{total} selected</span>
      {editable && (
        <Button variant="ghost" size="sm" className="pointer-coarse:h-9" onClick={() => onEdit(only)}>

          <Pencil /> Edit
        </Button>
      )}
      <Button variant="ghost" size="sm" className="text-destructive pointer-coarse:h-9" onClick={() => flow.removeSelected()}>
        <Trash2 /> Delete
      </Button>
    </div>
  )
}

/** Name matches outrank description matches (cmdk orders groups by their best item). */
const rank = (value: string, search: string, keywords: string[] = []) => {
  const q = search.toLowerCase()
  return value.toLowerCase().includes(q) ? 1 : keywords.join(" ").toLowerCase().includes(q) ? 0.5 : 0
}

function Palette({ flow, target, onClose }: { flow: Flow; target: PaletteTarget | null; onClose: () => void }) {
  const [query, setQuery] = useState("")
  // Coming from an output (or splicing an edge) needs a node with an input; from an input, one with an output.
  const needsInput = target?.from?.type === "source" || !!target?.between
  const items = CATALOG.filter((i) => (needsInput ? i.inputs.length : true) && (target?.from?.type === "target" ? i.outputs.length : true))
  // cmdk ranks items within a group but doesn't reorder groups, so search results go in one flat group.
  const groups: [string, CatalogItem[]][] = query
    ? [["Results", items]]
    : GROUPS.map(([kind, heading]) => [heading, items.filter((i) => i.kind === kind)])
  const close = () => {
    setQuery("")
    onClose()
  }

  return (
    <CommandDialog open={!!target} onOpenChange={(o) => !o && close()} title="Add node" description="Search for a node to add">
      <Command filter={rank}>
        <CommandInput placeholder="Search nodes…" value={query} onValueChange={setQuery} />
        <CommandList>
          <CommandEmpty>No nodes found.</CommandEmpty>
          {groups.map(
            ([heading, group]) =>
              group.length > 0 && (
                <CommandGroup key={heading} heading={heading}>
                  {group.map((item) => (
                    <CommandItem
                      key={item.key}
                      value={item.label}
                      keywords={[item.description]}
                      onSelect={() => {
                        placeNode(flow, item, target ?? {})
                        close()
                        requestAnimationFrame(() => flow.el?.focus())
                      }}
                    >
                      <div className={`grid size-7 place-items-center rounded-md ${item.tint}`}>
                        <item.icon className="size-4" />
                      </div>
                      <div className="flex flex-col">
                        <span>{item.label}</span>
                        <span className="text-xs text-muted-foreground">{item.description}</span>
                      </div>
                      {item.outputs.length > 1 && <CommandShortcut>{item.outputs.length} outputs</CommandShortcut>}
                    </CommandItem>
                  ))}
                </CommandGroup>
              ),
          )}
        </CommandList>
      </Command>
    </CommandDialog>
  )
}

function Details({ flow, id, onClose }: { flow: Flow; id: string | null; onClose: () => void }) {
  const node = useStore(flow, (s) => (id ? s.nodes[id] : undefined))
  const data = node?.data as StepData | undefined
  const item = data && byKey[data.key]
  return (
    <Dialog open={!!item} onOpenChange={(o) => !o && onClose()}>
      {item && data && (
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <div className="flex items-center gap-3">
              <div className={`grid size-10 place-items-center rounded-lg ${item.tint}`}>
                <item.icon className="size-5" />
              </div>
              <div>
                <DialogTitle>{data.label}</DialogTitle>
                <DialogDescription>{item.description}</DialogDescription>
              </div>
            </div>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid gap-2">
              <Label htmlFor="node-name">Name</Label>
              <Input id="node-name" value={data.label} onChange={(e) => flow.updateNodeData(id!, { label: e.target.value })} />
            </div>
            <div className="flex items-center justify-between rounded-lg border p-3">
              <div>
                <Label htmlFor="node-disabled">Disable node</Label>
                <p className="text-xs text-muted-foreground">Skipped visually, kept in the graph.</p>
              </div>
              <Switch id="node-disabled" checked={!!data.disabled} onCheckedChange={(v) => flow.updateNodeData(id!, { disabled: v })} />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="destructive"
              onClick={() => {
                flow.remove([id!])
                onClose()
              }}
            >
              <Trash2 /> Delete
            </Button>
            <Button onClick={onClose}>Done</Button>
          </DialogFooter>
        </DialogContent>
      )}
    </Dialog>
  )
}
