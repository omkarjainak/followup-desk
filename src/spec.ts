import type { PeerProfile } from "./types.js";

/**
 * Spec conformance checks for published agentic-web artifacts.
 *
 * The Stage One gate of the Open Agentic Web Challenge is pass/fail on
 * conformance, and the organizers' own validation tool is still forthcoming.
 * These checks cite the MVP profile (§ references below) and fail closed: a
 * check that cannot run is a failed check, never a silent pass.
 */

export interface SpecCheck {
  id: string;
  ok: boolean;
  severity: "error" | "warn";
  /** The requirement, with its spec section. */
  requirement: string;
  detail?: string;
}

export interface SpecReport {
  pass: boolean;
  checks: SpecCheck[];
}

interface RawManifest {
  networks?: unknown;
  peer_policy?: unknown;
  allowed_peers?: unknown;
}

interface RawNetwork {
  tools?: unknown;
  commondefs?: unknown;
  metadata?: unknown;
}

export function checkSpec(
  manifestText: string,
  networkText: string,
  profile: PeerProfile,
): SpecReport {
  const checks: SpecCheck[] = [];
  const add = (c: SpecCheck) => checks.push(c);

  // Parse: the artifacts must be JSON (§3.3 manifest, §2 network).
  let manifest: RawManifest = {};
  let network: RawNetwork = {};
  let manifestOk = true;
  let networkOk = true;
  try {
    manifest = JSON.parse(manifestText) as RawManifest;
  } catch {
    manifestOk = false;
  }
  try {
    network = JSON.parse(networkText) as RawNetwork;
  } catch {
    networkOk = false;
  }
  add({
    id: "manifest-json",
    ok: manifestOk,
    severity: "error",
    requirement: "§3.3 the site publishes agent-manifest.json as JSON",
  });
  add({
    id: "network-json",
    ok: networkOk,
    severity: "error",
    requirement: "§2 the resolved network definition is JSON (valid HOCON serialization)",
  });

  if (manifestOk) {
    // Manifest rows: networks with name, front_man and hocon (§3.3).
    const nets = Array.isArray(manifest.networks) ? manifest.networks : [];
    const rowsOk =
      nets.length > 0 &&
      nets.every(
        (n) =>
          n !== null &&
          typeof n === "object" &&
          typeof (n as { name?: unknown }).name === "string" &&
          typeof (n as { front_man?: unknown }).front_man === "string" &&
          typeof (n as { hocon?: unknown }).hocon === "string",
      );
    add({
      id: "manifest-rows",
      ok: rowsOk,
      severity: "error",
      requirement: "§3.3 every network names itself, its front agent, and its resolved definition",
    });

    // Names must be unique and the published file follows the naming
    // convention <network>.network.json (§3.2.5, §3.3).
    const names = nets.map((n) => String((n as { name?: unknown }).name ?? ""));
    add({
      id: "network-names-unique",
      ok: new Set(names).size === names.length && names.every((n) => n.length > 0),
      severity: "error",
      requirement: "§3.2.5 network names are unique and non-empty; peers select them exactly",
    });
    const conventionOk = nets.every((n) => {
      const hocon = String((n as { hocon?: unknown }).hocon ?? "");
      const name = String((n as { name?: unknown }).name ?? "");
      return hocon.split("/").pop() === `${name}.network.json`;
    });
    add({
      id: "filename-convention",
      ok: conventionOk,
      severity: "warn",
      requirement: "§3.3 the definition file is named <network>.network.json",
    });

    // HTTPS in production; loopback HTTP is local development only (§3.3).
    const isLoopback = profile.origin.includes("127.0.0.1") || profile.origin.includes("localhost");
    add({
      id: "https-production",
      ok: profile.origin.startsWith("https://") || isLoopback,
      severity: "warn",
      requirement: "§3.3 production deployments use HTTPS; loopback HTTP is development only",
      detail: profile.origin,
    });
  }

  if (networkOk) {
    // §2.1: agents have unique names, function descriptions, instructions and
    // an explicit tools list; inputs are JSON-Schema-compatible.
    const tools = Array.isArray(network.tools) ? network.tools : [];
    const agents = tools.filter((t) => t !== null && typeof t === "object") as Array<
      Record<string, unknown>
    >;
    const shapeOk =
      agents.length > 0 &&
      agents.every((a) => {
        const fn = (a.function ?? {}) as Record<string, unknown>;
        return (
          typeof a.name === "string" &&
          typeof fn.description === "string" &&
          typeof a.instructions === "string" &&
          Array.isArray(a.tools)
        );
      });
    add({
      id: "agent-definitions",
      ok: shapeOk,
      severity: "error",
      requirement:
        "§2.1 each agent has a unique name, function description, instructions, and an explicit tools list",
    });

    const schemasOk = agents.every((a) => {
      const fn = (a.function ?? {}) as Record<string, unknown>;
      const p = fn.parameters as Record<string, unknown> | undefined;
      return p !== undefined && typeof p === "object" && p.type === "object";
    });
    add({
      id: "input-schemas",
      ok: schemasOk,
      severity: "error",
      requirement: "§2.1 callable agents expose JSON Schema-compatible inputs (type: object)",
    });

    // §2 MUST NOT depend on local includes or environment substitutions.
    const raw = networkText;
    const leaks = /\$include|\$env|\$\{[A-Za-z_]/.exec(raw);
    add({
      id: "self-contained",
      ok: !leaks,
      severity: "error",
      requirement: "§2 the published definition has no local includes or environment substitutions",
      detail: leaks ? `found ${leaks[0]}` : undefined,
    });

    // §2: substitutions come from commondefs.replacement_strings and use
    // single braces; the browser expands once, so nested {{...}} leaves
    // literal braces in prompts.
    const defs = (network.commondefs ?? {}) as { replacement_strings?: unknown };
    const known = new Set(
      Object.keys(
        (defs.replacement_strings ?? {}) as Record<string, unknown>,
      ),
    );
    const double = /\{\{[^}]*\}\}/.exec(raw);
    const used = [...raw.matchAll(/\{([A-Za-z0-9_]+)\}/g)].map((m) => m[1]);
    const unresolved = used.filter((u) => !known.has(u));
    add({
      id: "substitutions",
      ok: !double && unresolved.length === 0,
      severity: "error",
      requirement:
        "§2 text uses {placeholder} substitution from commondefs.replacement_strings, expanded once",
      detail: double
        ? `double braces ${double[0]} leave literal braces in prompts`
        : unresolved.length
          ? `unresolved: ${[...new Set(unresolved)].join(", ")}`
          : undefined,
    });

    // §2.1 SHOULD: structured outputs declare schemas.
    const outputsOk = agents.every((a) => {
      const fn = (a.function ?? {}) as Record<string, unknown>;
      return fn.outputSchema !== undefined || fn.output_schema !== undefined;
    });
    add({
      id: "output-schemas",
      ok: outputsOk,
      severity: "warn",
      requirement: "§2.1 structured outputs SHOULD declare schemas",
    });
  }

  return {
    pass: checks.every((c) => c.ok || c.severity === "warn"),
    checks,
  };
}
