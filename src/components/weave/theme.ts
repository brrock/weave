/**
 * Weave's themable colours. Everything else uses shadcn tokens directly (card, border, primary, ring…).
 *
 * Set any `--weave-*` variable on `:root`, a theme class, or a single canvas to override it. Defaults
 * are resolved where they're used (not declared on :root), so a nested shadcn theme recolours Weave too.
 */
export const THEME = {
  /** Background dot grid. */
  dot: "var(--weave-dot, color-mix(in oklch, var(--muted-foreground) 35%, transparent))",
  /** Resting connection. */
  edge: "var(--weave-edge, color-mix(in oklch, var(--muted-foreground) 45%, transparent))",
  /** Hovered connection. */
  edgeHover: "var(--weave-edge-hover, color-mix(in oklch, var(--foreground) 70%, transparent))",
  /** Selected connection and the line drawn while connecting. */
  edgeSelected: "var(--weave-edge-selected, var(--primary))",
  /** Animated (`edge.animated`) connection. */
  edgeFlow: "var(--weave-edge-flow, var(--primary))",
  /** Connection stroke width, resting and selected. */
  edgeWidth: "var(--weave-edge-width, 1.75px)",
  edgeWidthSelected: "var(--weave-edge-width-selected, 2.5px)",
};
// Also: --weave-handle (port outline) is applied as a class in node.tsx, defaulting to muted-foreground at 60%.
