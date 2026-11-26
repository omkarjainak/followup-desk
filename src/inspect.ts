import { analyze, labelOf, schemaFieldsOf } from "./rules.js";
import type { DeclaredAgent, DeclaredAction, PeerProfile } from "./types.js";
import type { PeerSurface } from "./rules.js";

/**
 * Parse a peer's published JSON into a PeerProfile: normalize, analyze, label.
 *
 * Both inputs are untrusted text fetched from the peer's origin. Parsing is
 * total: any shape error degrades to "unknown" and becomes a finding, never a
 * crash, because a hostile manifest must not break the consent card.
 */

export interface RawManifest {
  brand?: unknown;
  networks?: unknown;
  allowed_peers?: unknown;
  peer_policy?: unknown;
  agent_mcp?: unknown;
  actions?: unknown;
}

export interface RawNetwork {
  metadata?: unknown;
  tools?: unknown;
  llm_config?: unknown;
}

export interface InspectOptions {
  /**
   * Declared site-action effects, e.g. from a published actions.json or the
   * site's own registration module. Effects live in code, so JSON inspection
   * only sees them when the publisher declares them. Rules that need them
   * (like side-effect-without-confirmation) fire only on known effects.
   */
  actionEffects?: Record<string, { effect: string; confirm: boolean }>;
}

export function parseProfile(
  manifestText: string,
  networkText: string,
  networkUrl: string,
  options: InspectOptions = {},
): { profile: PeerProfile; errors: string[] } {
  const errors: string[] = [];

  let manifest: RawManifest = {};
  let network: RawNetwork = {};
  try {
    manifest = JSON.parse(manifestText) as RawManifest;
  } catch {
    errors.push("agent-manifest.json is not valid JSON");
  }
  try {
    network = JSON.parse(networkText) as RawNetwork;
  } catch {
    errors.push("network json is not valid JSON");
  }

  const surface = normalize(manifest, network, errors, options.actionEffects ?? {});
  const findings = analyze(surface);
  for (const e of errors) {
    findings.push({
      rule: "unparseable",
      severity: "high",
      message: e,
      source: "peer JSON",
    });
  }

  const profile: PeerProfile = {
    url: networkUrl,
    origin: originOf(networkUrl),
    name: firstString(manifest.brand) ?? firstString(network.metadata) ?? "(unnamed)",
    frontMan: frontManOf(manifest),
    agents: surface.agents.map((a) => ({
      name: a.name,
      description: a.description,
      tools: a.tools,
      source: "tools[]",
    })) as DeclaredAgent[],
    actions: surface.actionIds.map(
      (id): DeclaredAction => ({
        id,
        toolName: `website_${id}`,
        agent: "site",
        effect: (surface.actionEffects[id]?.effect as DeclaredAction["effect"]) ?? "write",
        confirm: surface.actionEffects[id]?.confirm ?? false,
        dataFields: surface.schemaFields,
        source: "actions.agentTools",
      }),
    ),
    peers: {
      policy: surface.peerPolicy,
      allowed: surface.allowedPeers,
    },
    mcp: surface.mcpTools.map((t) => ({ server: t, tools: [t], source: "tools[].tools" })),
    findings,
    label: labelOf(surface, findings),
  };

  return { profile, errors };
}

function normalize(
  manifest: RawManifest,
  network: RawNetwork,
  errors: string[],
  actionEffects: Record<string, { effect: string; confirm: boolean }>,
): PeerSurface {
  // networks[] in the manifest, tools[] in the network. Both may be hostile.
  const rawAgents = Array.isArray(network.tools) ? network.tools : [];
  const agents: PeerSurface["agents"] = [];
  const remotePeers: string[] = [];
  const mcpTools: string[] = [];
  const schemaFields: string[] = [];
  const instructions: string[] = [];

  for (const raw of rawAgents) {
    if (raw === null || typeof raw !== "object") continue;
    const a = raw as Record<string, unknown>;
    const name = typeof a.name === "string" ? a.name : "(unnamed agent)";
    const fn = (a.function ?? {}) as Record<string, unknown>;
    const description = typeof fn.description === "string" ? fn.description : "";
    const tools = Array.isArray(a.tools) ? a.tools.filter((t): t is string => typeof t === "string") : [];

    for (const t of tools) {
      if (/^https?:\/\//i.test(t)) remotePeers.push(t);
      else if (t.includes("/") && !isLocalName(t)) mcpTools.push(t);
    }
    if (typeof a.instructions === "string") instructions.push(a.instructions);
    schemaFields.push(...schemaFieldsOf(fn.parameters));
    agents.push({ name, description, tools });
  }

  const allowedPeers = Array.isArray(manifest.allowed_peers)
    ? manifest.allowed_peers.filter((p): p is string => typeof p === "string")
    : [];
  const policyRaw = manifest.peer_policy as { mode?: unknown } | undefined;
  const mode = policyRaw && typeof policyRaw === "object" ? policyRaw.mode : undefined;
  const peerPolicy: PeerSurface["peerPolicy"] =
    mode === "open" ? "open" : mode === "closed" ? "closed" : "unknown";
  if (mode === undefined) errors.push("peer_policy.mode is missing");

  const actionsRaw = manifest.actions as { agentTools?: unknown; module?: unknown } | undefined;
  const actionIds =
    actionsRaw && Array.isArray(actionsRaw.agentTools)
      ? actionsRaw.agentTools.filter((t): t is string => typeof t === "string")
      : [];

  const mcpRaw = manifest.agent_mcp as { available?: unknown } | undefined;
  const mcpFacadeAvailable = Boolean(mcpRaw && mcpRaw.available === true);

  return {
    peerPolicy,
    allowedPeers,
    agents,
    remotePeers,
    mcpTools,
    actionIds,
    actionEffects,
    mcpFacadeAvailable,
    instructions: instructions.join("\n"),
    schemaFields: [...new Set(schemaFields)],
  };
}

function isLocalName(t: string): boolean {
  return /^[a-z0-9_-]+$/i.test(t);
}

function originOf(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return url;
  }
}

function frontManOf(manifest: RawManifest): string {
  const networks = manifest.networks;
  if (Array.isArray(networks) && networks.length > 0) {
    const first = networks[0] as Record<string, unknown>;
    if (typeof first.front_man === "string") return first.front_man;
  }
  return "";
}

function firstString(v: unknown): string | undefined {
  if (typeof v === "string") return v;
  if (v !== null && typeof v === "object") {
    const o = v as Record<string, unknown>;
    if (typeof o.description === "string") return o.description;
  }
  return undefined;
}
