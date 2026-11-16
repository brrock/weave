import { useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { NodeResizer, type NodeProps } from "./node";
import { useFlow } from "./store";
import { THEME } from "./theme";

export type NoteData = { text: string };

/** Sticky note: markdown-ish text, double-click to edit, resizable when selected. Drawn behind other nodes. */
export function NoteNode({ id, data, selected, size }: NodeProps<NoteData>) {
  const flow = useFlow();
  const [editing, setEditing] = useState(false);
  const commit = (text: string) => {
    setEditing(false);
    if (text !== data.text) flow.updateNodeData(id, { text });
  };
  return (
    <div
      data-weave-note=""
      className={cn(
        "relative flex flex-col overflow-hidden rounded-lg border p-3 text-sm text-card-foreground shadow-sm",
        selected && "ring-2 ring-ring",
      )}
      style={{ width: size?.w ?? 240, height: size?.h, minHeight: size ? undefined : 80, background: THEME.note }}
      onDoubleClick={() => setEditing(true)}
    >
      {editing ? (
        <textarea
          autoFocus
          aria-label="Note text"
          defaultValue={data.text}
          className="min-h-16 flex-1 resize-none bg-transparent font-mono text-xs leading-relaxed outline-none"
          onBlur={(e) => commit(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape" || (e.key === "Enter" && (e.metaKey || e.ctrlKey))) e.currentTarget.blur();
          }}
        />
      ) : (
        <Markdown text={data.text} />
      )}
      {selected && <NodeResizer />}
    </div>
  );
}

// **bold**, *italic* / _italic_, `code` and [links](https://…); split() keeps the matches at odd indices.
const INLINE = /(\*\*[^*]+\*\*|\*[^*\s][^*]*\*|_[^_\s][^_]*_|`[^`]+`|\[[^\]]+\]\([^)\s]+\))/;

function inline(text: string): ReactNode[] {
  return text.split(INLINE).map((part, i) => {
    if (i % 2 === 0) return part;
    if (part.startsWith("**")) return <strong key={i}>{part.slice(2, -2)}</strong>;
    if (part.startsWith("`"))
      return (
        <code key={i} className="rounded bg-muted px-1 font-mono text-[0.9em]">
          {part.slice(1, -1)}
        </code>
      );
    const link = /^\[(.+)\]\((.+)\)$/.exec(part);
    if (link) {
      const [, label, href = ""] = link;
      // Only web links: note text may come from a clipboard or an agent.
      return /^https?:\/\//.test(href) ? (
        <a key={i} href={href} target="_blank" rel="noreferrer" className="underline underline-offset-2">
          {label}
        </a>
      ) : (
        label
      );
    }
    return <em key={i}>{part.slice(1, -1)}</em>;
  });
}

/** Renders `# headings`, `- lists` and inline markdown; everything else is a paragraph per line. */
export function Markdown({ text }: { text: string }) {
  const blocks: ReactNode[] = [];
  let items: ReactNode[] = [];
  const endList = () => {
    if (items.length)
      blocks.push(
        <ul key={blocks.length} className="list-disc pl-4">
          {items}
        </ul>,
      );
    items = [];
  };
  for (const line of text.split("\n")) {
    const item = /^\s*[-*]\s+(.*)/.exec(line);
    if (item) {
      items.push(<li key={items.length}>{inline(item[1] ?? "")}</li>);
      continue;
    }
    endList();
    const heading = /^(#{1,3})\s+(.*)/.exec(line);
    if (heading)
      blocks.push(
        <p key={blocks.length} className={cn("font-semibold", heading[1] === "#" && "text-base")}>
          {inline(heading[2] ?? "")}
        </p>,
      );
    else if (line.trim()) blocks.push(<p key={blocks.length}>{inline(line)}</p>);
  }
  endList();
  return <div className="space-y-1.5 leading-relaxed [overflow-wrap:anywhere]">{blocks}</div>;
}
