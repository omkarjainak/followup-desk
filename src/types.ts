/**
 * Core types for Peering: a consent gateway between agentic websites.
 *
 * The model follows one rule: what a peer says about itself (PeerInfo) is
 * untrusted input; what we compute from its published JSON (PeerProfile) is the
 * basis for consent; what the user actually grants (ConsentGrant) is the only
 * authority enforcement consults.
 */

/** Where a tool or capability in a peer network comes from. */
export type PeerEntryKind =
  | "local" // another agent inside the same network
  | "remote" // a peer agent network, referenced by URL
  | "mcp" // an MCP or WebMCP tool descriptor
  | "website" // a website_* action registered by the host page
  | "rest"; // a REST endpoint

/** The side effect a declared action can have. Mirrors the runtime's effect field. */
export type ActionEffect = "read" | "write" | "irreversible";

/** One capability as declared by a peer network's published JSON. */
export interface DeclaredAction {
  /** Stable action id, e.g. "checkout_demo_order". */
  id: string;
  /** Which tool name the model calls, e.g. "website_checkout_demo_order". */
  toolName: string;
  /** The agent that declares it. */
  agent: string;
  effect: ActionEffect;
  /** Whether the runtime gates it behind a confirmation dialog. */
  confirm: boolean;
  /** Data fields the action arguments may include, when derivable from schema. */
  dataFields: string[];
  /** Where this was found, e.g. "tools[2].actions.agentTools[0]". */
  source: string;
}

/** A single agent definition inside a peer network. */
export interface DeclaredAgent {
  name: string;
  description: string;
  /** Tool references as written: local agent names, peer URLs, MCP descriptors. */
  tools: string[];
  source: string;
}

/** Everything a peer network's published JSON lets us compute. */
export interface PeerProfile {
  /** The network URL that was inspected. */
  url: string;
  origin: string;
  /** Manifest name and entry agent, when present. */
  name: string;
  frontMan: string;
  agents: DeclaredAgent[];
  actions: DeclaredAction[];
  peers: {
    /** The manifest's peer_policy.mode: closed means allowlist-only. */
    policy: "open" | "closed" | "unknown";
    allowed: string[];
  };
  mcp: Array<{ server: string; tools: string[]; source: string }>;
  findings: Finding[];
  label: Label;
}

export type Severity = "info" | "warn" | "high";

/** One computed observation about a peer, always citing its evidence. */
export interface Finding {
  /** Stable rule id, e.g. "side-effect-without-confirmation". */
  rule: string;
  severity: Severity;
  message: string;
  /** The JSON path the finding was derived from, shown to the user. */
  source: string;
}

/** The human-readable trust label rendered on the consent card. */
export interface Label {
  summary: string;
  /** 0-100, derived from findings; presentation only, never authority. */
  score: number;
  can: string[];
  cannot: string[];
  sends: string[];
  flags: string[];
}

/**
 * The only authority enforcement consults. Issued by the visitor through the
 * consent card. Deny by default: an empty allowActions means nothing runs.
 */
export interface ConsentGrant {
  id: string;
  peerOrigin: string;
  networkUrl: string;
  /** One host-bound purpose, matched exactly, never by prefix. */
  purpose: string;
  /** Allowlisted action ids. Never "*". */
  allowActions: string[];
  /** Allowlisted data fields that may leave the browser. */
  allowData: string[];
  /** Bounded use: maximum tool invocations under this grant. */
  maxCalls?: number;
  /** Instant expiry. */
  expiresAt?: string;
  issuedAt: string;
}

/** Every decision the guard makes lands here, append-only. */
export interface CallRecord {
  ts: string;
  peer: string;
  agent: string;
  tool: string;
  /** Arguments after redaction, never the raw args. */
  args: unknown;
  decision: "allowed" | "denied";
  reasonCode: ReasonCode;
  grantId: string;
  /** Which check produced the decision, e.g. "action-scope". */
  check?: string;
}

/**
 * Why a call was refused. Kept to one vocabulary so receipts, the UI feed and
 * peer-check output all speak the same language.
 */
export type ReasonCode =
  | "allowed"
  | "action_out_of_scope"
  | "data_out_of_scope"
  | "grant_expired"
  | "grant_exhausted"
  | "confirm_required"
  | "uninspected_peer"
  | "nested_peer_denied";
