#!/usr/bin/env node
import { parseProfile } from "./inspect.js";
import { checkSpec, type SpecReport } from "./spec.js";
import type { PeerProfile } from "./types.js";

/**
 * peer-check: inspect an agentic website and print its trust label.
 *
 * Usage:
 *   peer-check <url>            the site origin or a network URL
 *   peer-check <url> --json     machine-readable profile
 *
 * Exits non-zero when high-severity findings exist, so it drops into CI.
 */

const args = process.argv.slice(2);
const url = args.find((a) => !a.startsWith("--"));
const asJson = args.includes("--json");
const asSpec = args.includes("--spec");

const target: string = url ?? "";
if (!target) {
  console.error("usage: peer-check <url> [--json] [--spec] [--actions <file>]");
  console.error("  url: a network address (https://host/path/name) or a site root");
  console.error("  --spec: run the MVP spec conformance checks (§ citations included)");
  console.error("  --actions: declared action effects (JSON map) when the site publishes none");
  process.exit(2);
}

async function readLocal(path: string): Promise<string | null> {
  try {
    const { readFile } = await import("node:fs/promises");
    return await readFile(path, "utf8");
  } catch {
    return null;
  }
}

async function fetchText(u: string): Promise<string | null> {
  try {
    const res = await fetch(u, { headers: { accept: "application/json" } });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

async function main(): Promise<void> {
  // The spec's network-address convention (§3.2.1): the final path component
  // is the network name and the manifest lives in that URL's directory. A URL
  // with no final component inspects the site's first network. A name that
  // matches nothing fails rather than silently selecting another (§3.2.5).
  const base = target.replace(/\/$/, "");
  const isJson = base.endsWith(".json");
  const dirUrl = base.slice(0, base.lastIndexOf("/") + 1);
  const networkName = isJson ? "" : base.slice(base.lastIndexOf("/") + 1);
  const manifestUrl = isJson ? base : `${dirUrl}agent-manifest.json`;

  const manifestText = await fetchText(manifestUrl);
  if (manifestText === null) {
    console.error(`peer-check: could not fetch ${manifestUrl}`);
    process.exit(2);
  }

  let entry: { name?: unknown; hocon?: unknown } | undefined;
  let networkUrl = `${dirUrl}network.json`;
  try {
    const manifest = JSON.parse(manifestText) as {
      networks?: Array<{ name?: unknown; hocon?: unknown }>;
    };
    const networks = Array.isArray(manifest.networks) ? manifest.networks : [];
    if (networkName !== "") {
      entry = networks.find((n) => n.name === networkName);
      if (!entry) {
        const names = networks.map((n) => String(n.name)).join(", ") || "(none)";
        console.error(
          `peer-check: no network named "${networkName}" at ${manifestUrl}. Declared: ${names}`,
        );
        process.exit(2);
      }
    } else {
      entry = networks[0];
    }
    if (entry && typeof entry.hocon === "string") {
      networkUrl = new URL(entry.hocon, manifestUrl).toString();
    }
  } catch {
    // parseProfile reports the malformed manifest as a finding.
  }

  // Declared action effects live in code or an actions.json (§1.2). When the
  // publisher declares them, the side-effect checks can actually fire.
  let actionEffects: Record<string, { effect: string; confirm: boolean }> | undefined;
  const actionsRef = args.find((a, i) => args[i - 1] === "--actions");
  const actionsText = actionsRef
    ? await (actionsRef.startsWith("http") ? fetchText(actionsRef) : readLocal(actionsRef))
    : await fetchText(`${dirUrl}actions.json`);
  if (actionsText) {
    try {
      const parsed = JSON.parse(actionsText) as Record<string, { effect?: unknown; confirm?: unknown }>;
      actionEffects = {};
      for (const [id, meta] of Object.entries(parsed)) {
        if (meta && typeof meta === "object") {
          actionEffects[id] = {
            effect: String(meta.effect ?? "write"),
            confirm: meta.confirm === true,
          };
        }
      }
    } catch {
      console.error("peer-check: actions file is not valid JSON; continuing without it");
    }
  }

  const networkText = (await fetchText(networkUrl)) ?? "{}";
  const { profile, errors } = parseProfile(manifestText, networkText, networkUrl, {
    actionEffects,
  });

  const spec = asSpec ? checkSpec(manifestText, networkText, profile) : undefined;

  if (asJson) {
    console.log(JSON.stringify({ profile, errors, spec }, null, 2));
  } else {
    printLabel(profile);
    if (spec) printSpec(spec);
  }

  const high = profile.findings.filter((f) => f.severity === "high").length;
  const specErrors = spec ? spec.checks.filter((c) => !c.ok && c.severity === "error").length : 0;
  process.exit(high > 0 || specErrors > 0 ? 1 : 0);
}

function printSpec(spec: SpecReport): void {
  console.log(`\nspec conformance — ${spec.pass ? "PASS" : "FAIL"}`);
  for (const c of spec.checks) {
    const mark = c.ok ? "ok  " : c.severity === "error" ? "FAIL" : "warn";
    console.log(`  [${mark}] ${c.id}: ${c.requirement}`);
    if (c.detail) console.log(`         ${c.detail}`);
  }
}

function printLabel(profile: PeerProfile): void {
  const label = profile.label;
  console.log(`\n${profile.name}`);
  console.log(`${"=".repeat(Math.max(8, profile.name.length))}`);
  console.log(`network: ${profile.url}`);
  console.log(`\n${label.summary}`);
  console.log(`\nscore:   ${label.score}/100`);

  const rows: Array<[string, string[]]> = [
    ["can", label.can],
    ["cannot", label.cannot],
    ["sends", label.sends],
    ["flags", label.flags],
  ];
  for (const [title, items] of rows) {
    if (items.length === 0) continue;
    console.log(`\n${title}:`);
    for (const item of items) console.log(`  - ${item}`);
  }

  if (profile.findings.length > 0) {
    console.log(`\nfindings:`);
    for (const f of profile.findings) {
      console.log(`  [${f.severity}] ${f.rule}: ${f.message}`);
      console.log(`         evidence: ${f.source}`);
    }
  }
  console.log("");
}

main().catch((error: unknown) => {
  console.error(`peer-check: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(2);
});
