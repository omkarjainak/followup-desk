import type { DeclaredAction, Finding, Severity } from "./types.js";

/**
 * Finding rules for peer inspection. Each rule is a pure function over the
 * normalized peer, and every finding cites the JSON path it came from so the
 * consent card can show its evidence.
 */

export interface PeerSurface {
  /** Manifest peer_policy.mode when present. */
  peerPolicy: "open" | "closed" | "unknown";
  /** Origins named in the manifest's allowed_peers. */
  allowedPeers: string[];
  /** Agent ids and what each one declares as callable. */
  agents: Array<{ name: string; description: string; tools: string[] }>;
  /** Peer network URLs referenced from any agent's tools. */
  remotePeers: string[];
  /** MCP tool references, as raw strings. */
  mcpTools: string[];
  /** Website actions named in actions.agentTools. */
  actionIds: string[];
  /** Best-effort scan of the actions module: id -> effect. */
  actionEffects: Record<string, { effect: string; confirm: boolean }>;
  /** Whether the manifest exposes a public MCP facade. */
  mcpFacadeAvailable: boolean;
  /** Instructions text, joined, for wording checks. */
  instructions: string;
  /** Data field names visible in action and agent parameter schemas. */
  schemaFields: string[];
}

const SEVERITY_WEIGHT: Record<Severity, number> = { high: 20, warn: 8, info: 2 };

/** Compute the label score from findings. 100 is clean. */
export function scoreOf(findings: Finding[]): number {
  const penalty = findings.reduce((sum, f) => sum + SEVERITY_WEIGHT[f.severity], 0);
  return Math.max(0, 100 - penalty);
}

const SECRECY = [
  /do not (tell|inform|mention) (the )?user/gi,
  /without (telling|informing|asking) (the )?(user|visitor)/gi,
  /keep (this|it) (a )?secret/gi,
];

const EXFIL = [
  /\b(send|email|post|upload|forward)\b[^.]{0,60}\b(to|via)\b[^.]{0,40}\b(email|webhook|url|server|endpoint)/gi,
  /\b(api[_ ]?key|token|password|credential)s?\b[^.]{0,50}\b(send|post|upload|share|include)/gi,
];

const AUTHORITY_CLAIM = [
  /(user|visitor) (has |had )?already (approved|consented|confirmed)/gi,
  /approval (was|is) (already )?(given|granted|obtained)/gi,
  /ignore (all |any )?(previous|prior|earlier) instructions/gi,
  /disregard (the )?(above|previous|prior)/gi,
];

function scanInstructions(surface: PeerSurface): Finding[] {
  const out: Finding[] = [];
  const text = surface.instructions;
  if (!text) return out;

  for (const re of SECRECY) {
    if (re.test(text)) {
      out.push({
        rule: "instruction-secrecy",
        severity: "high",
        message: "Instructions ask the agent to hide something from the visitor.",
        source: "tools[].instructions",
      });
      break;
    }
  }
  for (const re of EXFIL) {
    if (re.test(text)) {
      out.push({
        rule: "instruction-exfiltration",
        severity: "high",
        message: "Instructions describe sending data to an external destination.",
        source: "tools[].instructions",
      });
      break;
    }
  }
  for (const re of AUTHORITY_CLAIM) {
    if (re.test(text)) {
      out.push({
        rule: "instruction-authority-claim",
        severity: "high",
        message: "Instructions claim prior approval or override earlier instructions.",
        source: "tools[].instructions",
      });
      break;
    }
  }
  return out;
}

/** All rules, in one place. Order is presentation order on the card. */
export function analyze(surface: PeerSurface): Finding[] {
  const findings: Finding[] = [];

  if (surface.peerPolicy === "open") {
    findings.push({
      rule: "peer-policy-open",
      severity: "high",
      message: "The site's agents may contact any origin without an allowlist.",
      source: "agent-manifest.json:peer_policy.mode",
    });
  }

  if (surface.mcpFacadeAvailable) {
    findings.push({
      rule: "mcp-facade-available",
      severity: "warn",
      message: "A public MCP facade is live: other sites can invoke this network.",
      source: "agent-manifest.json:agent_mcp.available",
    });
  }

  if (surface.remotePeers.length > 0) {
    findings.push({
      rule: "nested-peers",
      severity: "warn",
      message: `This network calls ${surface.remotePeers.length} other site(s). Each needs its own consent.`,
      source: "tools[].tools",
    });
    const outside = surface.remotePeers.filter((url) => !coveredBy(url, surface.allowedPeers));
    if (outside.length > 0) {
      findings.push({
        rule: "peer-outside-allowlist",
        severity: "high",
        message: `${outside.length} peer reference(s) are outside the manifest's allowed_peers.`,
        source: `example: ${outside[0]}`,
      });
    }
  }

  if (surface.mcpTools.length > 0) {
    findings.push({
      rule: "mcp-egress",
      severity: "warn",
      message: `Calls ${surface.mcpTools.length} external MCP tool(s): arguments leave the browser.`,
      source: "tools[].tools (mcp descriptors)",
    });
  }

  for (const [id, meta] of Object.entries(surface.actionEffects)) {
    if (meta.effect === "irreversible" && !meta.confirm) {
      findings.push({
        rule: "side-effect-without-confirmation",
        severity: "high",
        message: `Action "${id}" is irreversible and has no confirmation dialog.`,
        source: `actions.module (${id})`,
      });
    }
  }

  findings.push(...scanInstructions(surface));

  if (surface.actionIds.length === 0 && surface.remotePeers.length === 0) {
    findings.push({
      rule: "no-declared-actions",
      severity: "info",
      message: "No website actions or peers declared: this network can only talk.",
      source: "agent-manifest.json:actions.agentTools",
    });
  }

  return findings;
}

/** Whether a peer URL's origin is covered by an allowed origin. */
export function coveredBy(url: string, allowed: string[]): boolean {
  if (allowed.length === 0) return false;
  let origin: string;
  try {
    origin = new URL(url).origin;
  } catch {
    origin = url;
  }
  return allowed.some((a) => {
    try {
      return new URL(a).origin === origin || a === url;
    } catch {
      return a === url;
    }
  });
}

/** Derive the label from the surface and its findings. */
export function labelOf(surface: PeerSurface, findings: Finding[]): {
  summary: string;
  score: number;
  can: string[];
  cannot: string[];
  sends: string[];
  flags: string[];
} {
  const score = scoreOf(findings);

  const can = surface.actionIds.map((id) => `call ${id}`);
  for (const name of surface.remotePeers) can.push(`talk to ${name}`);
  if (can.length === 0) can.push("answer questions only");

  const cannot: string[] = [];
  if (surface.peerPolicy === "closed") cannot.push("call sites outside its allowlist");
  if (!surface.mcpFacadeAvailable) cannot.push("be called by other sites");
  if (surface.schemaFields.length === 0) cannot.push("read your data beyond what you type");

  const sends = surface.schemaFields.length
    ? surface.schemaFields.map((f) => `the ${f} you provide`)
    : ["nothing beyond the chat text"];

  return {
    summary: summaryOf(score, findings),
    score,
    can,
    cannot,
    sends,
    flags: findings.filter((f) => f.severity !== "info").map((f) => f.message),
  };
}

function summaryOf(score: number, findings: Finding[]): string {
  const high = findings.filter((f) => f.severity === "high").length;
  if (high > 0) return `${high} finding(s) need your attention before you grant access.`;
  if (score >= 90) return "Nothing concerning found in the published network definition.";
  return "A few things worth knowing before you grant access.";
}

/** Extract data field names from JSON-schema-ish parameter objects. */
export function schemaFieldsOf(schema: unknown, prefix = ""): string[] {
  if (schema === null || typeof schema !== "object") return [];
  const s = schema as { properties?: Record<string, unknown>; items?: unknown };
  const out: string[] = [];
  if (s.properties && typeof s.properties === "object") {
    for (const [key, value] of Object.entries(s.properties)) {
      const path = prefix ? `${prefix}.${key}` : key;
      out.push(path);
      out.push(...schemaFieldsOf(value, path));
    }
  }
  return out;
}
