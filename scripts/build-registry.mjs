// Builds the shadcn registry for one channel.
// Usage: node scripts/build-registry.mjs [baseUrl] [outDir] [version]
//   baseUrl  where this channel's JSON is served (default: local dev server)
//   version  label stamped into each item's meta, e.g. "nightly" or "v0.2.0"
import { execFileSync } from "node:child_process"
import { readFileSync, rmSync, writeFileSync } from "node:fs"

const [base = "http://localhost:5173/r", out = "public/r", version = "dev"] = process.argv.slice(2)
const commit = process.env.GITHUB_SHA ?? execFileSync("git", ["rev-parse", "HEAD"]).toString().trim()

const registry = JSON.parse(readFileSync("registry.json", "utf8"))
for (const item of registry.items) {
  // Items in this registry reference each other via "{{base}}", so a channel only ever pulls its own files.
  item.registryDependencies = item.registryDependencies?.map((d) => d.replace("{{base}}", base.replace(/\/$/, "")))
  item.meta = { ...item.meta, version, commit }
}

const tmp = "registry.build.json"
writeFileSync(tmp, JSON.stringify(registry, null, 2))
try {
  execFileSync("node_modules/.bin/shadcn", ["build", tmp, "-o", out], { stdio: "inherit" })
} finally {
  rmSync(tmp)
}
