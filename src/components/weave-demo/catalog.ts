import { Braces, Clock, Database, GitBranch, Globe, Mail, Merge, MessageSquare, MousePointerClick, Shuffle, Sparkles, Timer, Webhook, type LucideIcon } from "lucide-react"

export type Kind = "trigger" | "action" | "logic"

export interface CatalogItem {
  key: string
  kind: Kind
  label: string
  description: string
  icon: LucideIcon
  tint: string
  inputs: string[]
  outputs: string[]
}

const one = { inputs: ["in"], outputs: ["out"] }

export const CATALOG: CatalogItem[] = [
  { key: "manual", kind: "trigger", label: "Manual trigger", description: "Runs when you click Execute", icon: MousePointerClick, tint: "bg-slate-500/12 text-slate-600 dark:text-slate-400", inputs: [], outputs: ["out"] },
  { key: "webhook", kind: "trigger", label: "Webhook", description: "Starts on an HTTP call", icon: Webhook, tint: "bg-violet-500/12 text-violet-600 dark:text-violet-400", inputs: [], outputs: ["out"] },
  { key: "schedule", kind: "trigger", label: "Schedule", description: "Runs on a cron interval", icon: Clock, tint: "bg-amber-500/12 text-amber-600 dark:text-amber-400", inputs: [], outputs: ["out"] },
  { key: "http", kind: "action", label: "HTTP request", description: "Call any REST endpoint", icon: Globe, tint: "bg-sky-500/12 text-sky-600 dark:text-sky-400", ...one },
  { key: "ai", kind: "action", label: "AI agent", description: "Reason over the input", icon: Sparkles, tint: "bg-fuchsia-500/12 text-fuchsia-600 dark:text-fuchsia-400", ...one },
  { key: "code", kind: "action", label: "Code", description: "Run custom JavaScript", icon: Braces, tint: "bg-orange-500/12 text-orange-600 dark:text-orange-400", ...one },
  { key: "db", kind: "action", label: "Database query", description: "Read or write rows", icon: Database, tint: "bg-blue-500/12 text-blue-600 dark:text-blue-400", ...one },
  { key: "email", kind: "action", label: "Send email", description: "Deliver a message", icon: Mail, tint: "bg-rose-500/12 text-rose-600 dark:text-rose-400", ...one },
  { key: "chat", kind: "action", label: "Chat message", description: "Post to a team channel", icon: MessageSquare, tint: "bg-emerald-500/12 text-emerald-600 dark:text-emerald-400", ...one },
  { key: "transform", kind: "action", label: "Transform", description: "Map and reshape fields", icon: Shuffle, tint: "bg-teal-500/12 text-teal-600 dark:text-teal-400", ...one },
  { key: "wait", kind: "action", label: "Wait", description: "Pause before continuing", icon: Timer, tint: "bg-lime-500/12 text-lime-600 dark:text-lime-400", ...one },
  { key: "if", kind: "logic", label: "If", description: "Route by a condition", icon: GitBranch, tint: "bg-indigo-500/12 text-indigo-600 dark:text-indigo-400", inputs: ["in"], outputs: ["true", "false"] },
  { key: "merge", kind: "logic", label: "Merge", description: "Join two branches", icon: Merge, tint: "bg-indigo-500/12 text-indigo-600 dark:text-indigo-400", inputs: ["a", "b"], outputs: ["out"] },
]

export const byKey: Record<string, CatalogItem> = Object.fromEntries(CATALOG.map((i) => [i.key, i]))
