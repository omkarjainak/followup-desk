import type {
  CallRecord,
  ConsentGrant,
  DeclaredAction,
  ReasonCode,
} from "./types.js";

/**
 * The scope guard: given a call and a grant, decide allow or deny and say why.
 *
 * These are pure functions on purpose. The runtime wiring (see guard.ts wiring
 * section) is a thin shell; every decision rule lives here so it can be tested
 * without a browser and reused by the receipt log and peer-check.
 */

export interface CallRequest {
  /** Action id the peer is attempting, e.g. "checkout_demo_order". */
  action: string;
  /** The agent making the call. */
  agent: string;
  /** Parsed arguments, exactly as the runtime would pass them. */
  args: Record<string, unknown>;
  /** When the call happens; defaults to now. */
  now?: Date;
}

export interface GuardState {
  /** How many calls this grant has already allowed. */
  usedCalls: number;
}

export interface Decision {
  allowed: boolean;
  reasonCode: ReasonCode;
  /** Arguments after field-level redaction. Present even on denial for audit. */
  args: Record<string, unknown>;
  /** Which check produced the result. */
  check: string;
}

/**
 * Decide one call against one grant. Deny by default:
 * - the action must be on the grant's allowlist (never "*")
 * - the data fields must fit inside the allowData list (extras are dropped)
 * - the grant must not be expired or exhausted
 */
export function decide(
  request: CallRequest,
  grant: ConsentGrant,
  state: GuardState,
  actions: DeclaredAction[],
): Decision {
  const now = request.now ?? new Date();

  // Bounded use and expiry are checked first: a spent or expired grant covers
  // nothing, so the action check would be misleading.
  if (grant.expiresAt !== undefined && now > new Date(grant.expiresAt)) {
    return {
      allowed: false,
      reasonCode: "grant_expired",
      args: request.args,
      check: "expiry",
    };
  }
  if (grant.maxCalls !== undefined && state.usedCalls >= grant.maxCalls) {
    return {
      allowed: false,
      reasonCode: "grant_exhausted",
      args: request.args,
      check: "bounded-use",
    };
  }

  // An action the visitor never saw during inspection is not merely out of
  // scope: it was never part of the network being consented to.
  if (!actions.some((a) => a.id === request.action)) {
    return {
      allowed: false,
      reasonCode: "uninspected_peer",
      args: request.args,
      check: "inspection",
    };
  }

  // The action must be named on the grant. Wildcards never exist here because
  // the consent card does not produce them.
  if (!grant.allowActions.includes(request.action)) {
    return {
      allowed: false,
      reasonCode: "action_out_of_scope",
      args: request.args,
      check: "action-scope",
    };
  }

  // A side effect the visitor has not seen a confirmation for cannot slip
  // through on the argument check alone.
  const declared = actions.find((a) => a.id === request.action);
  if (declared && declared.effect === "irreversible" && !declared.confirm) {
    return {
      allowed: false,
      reasonCode: "confirm_required",
      args: request.args,
      check: "confirmation",
    };
  }

  // Field-level scope: anything outside allowData is dropped, not refused, so
  // a well-meaning peer still works while over-collection gets trimmed. A call
  // whose arguments contain no allowed fields at all is a denial.
  const { trimmed, dropped } = redactArgs(request.args, grant.allowData);
  if (Object.keys(trimmed).length === 0 && Object.keys(request.args).length > 0) {
    return {
      allowed: false,
      reasonCode: "data_out_of_scope",
      args: trimmed,
      check: "data-scope",
    };
  }

  return {
    allowed: true,
    reasonCode: "allowed",
    args: trimmed,
    check: dropped.length > 0 ? "data-scope-redacted" : "action-scope",
  };
}

/**
 * Keep only the fields the grant allows. Nested objects are walked one level of
 * dotted names at a time: "cart.items" matches { cart: { items } }.
 */
export function redactArgs(
  args: Record<string, unknown>,
  allowData: string[],
): { trimmed: Record<string, unknown>; dropped: string[] } {
  const trimmed: Record<string, unknown> = {};
  const dropped: string[] = [];

  for (const [key, value] of Object.entries(args)) {
    if (allowData.includes(key)) {
      trimmed[key] = value;
      continue;
    }
    // One level of nesting for dotted grants like "cart.items".
    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      const nested = value as Record<string, unknown>;
      const keptNested: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(nested)) {
        if (allowData.includes(`${key}.${k}`)) keptNested[k] = v;
        else dropped.push(`${key}.${k}`);
      }
      if (Object.keys(keptNested).length > 0) {
        trimmed[key] = keptNested;
        continue;
      }
    }
    dropped.push(key);
  }

  return { trimmed, dropped };
}

/** Append a decision to a receipt log. Returns the new log, never mutates. */
export function record(
  log: CallRecord[],
  entry: Omit<CallRecord, "ts"> & { ts?: string },
): CallRecord[] {
  return [...log, { ts: entry.ts ?? new Date().toISOString(), ...entry }];
}
