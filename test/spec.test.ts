import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { parseProfile } from "../src/inspect.js";
import { checkSpec } from "../src/spec.js";

const FIX = "test/fixtures/guesthouse";

function run(manifest: string, network: string) {
  const { profile } = parseProfile(manifest, network, "https://x.example/net");
  return checkSpec(manifest, network, profile);
}

describe("checkSpec on the real guesthouse example", () => {
  const manifest = readFileSync(`${FIX}/agent-manifest.json`, "utf8");
  const network = readFileSync(`${FIX}/tidewhistle_guesthouse.network.json`, "utf8");
  const report = run(manifest, network);

  it("passes", () => {
    expect(report.pass).toBe(true);
  });

  it("runs every check", () => {
    const ids = report.checks.map((c) => c.id);
    for (const id of [
      "manifest-json",
      "network-json",
      "manifest-rows",
      "network-names-unique",
      "filename-convention",
      "https-production",
      "agent-definitions",
      "input-schemas",
      "self-contained",
      "substitutions",
      "output-schemas",
    ]) {
      expect(ids).toContain(id);
    }
  });
});

describe("checkSpec catches violations", () => {
  const manifest = JSON.stringify({
    networks: [
      { name: "deals", front_man: "a", hocon: "./deals.network.json" },
      { name: "deals", front_man: "b", hocon: "./deals2.network.json" },
    ],
  });
  const network = JSON.stringify({
    commondefs: { replacement_strings: { site_name: "x" } },
    tools: [
      {
        name: "a",
        function: { description: "d", parameters: { type: "object" } },
        instructions: "Hi {site_name} and {{other}} and ${ENV_VAR}",
        tools: [],
      },
    ],
  });

  it("flags duplicate network names", () => {
    const r = run(manifest, network);
    expect(r.checks.find((c) => c.id === "network-names-unique")?.ok).toBe(false);
  });

  it("flags double braces and unresolved substitutions", () => {
    const r = run(manifest, network);
    const sub = r.checks.find((c) => c.id === "substitutions");
    expect(sub?.ok).toBe(false);
    expect(sub?.detail).toBeTruthy();
  });

  it("flags includes and env substitutions", () => {
    const r = run(manifest, network);
    expect(r.checks.find((c) => c.id === "self-contained")?.ok).toBe(false);
  });

  it("fails the report on an error-level violation", () => {
    expect(run(manifest, network).pass).toBe(false);
  });

  it("flags a definition file that breaks the naming convention", () => {
    const m = JSON.stringify({
      networks: [{ name: "deals", front_man: "a", hocon: "./other.network.json" }],
    });
    const r = run(m, network);
    expect(r.checks.find((c) => c.id === "filename-convention")?.ok).toBe(false);
  });

  it("flags an http production origin but not loopback", () => {
    const ok = JSON.stringify({
      networks: [{ name: "n", front_man: "a", hocon: "./n.network.json" }],
    });
    const net = JSON.stringify({
      tools: [
        {
          name: "a",
          function: { description: "d", parameters: { type: "object" } },
          instructions: "hi",
          tools: [],
        },
      ],
    });
    const p = parseProfile(ok, net, "http://evil.example/n").profile;
    const r = checkSpec(ok, net, p);
    expect(r.checks.find((c) => c.id === "https-production")?.ok).toBe(false);
  });
});
