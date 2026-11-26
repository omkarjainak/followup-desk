import { decide, record } from "./scope.js";
import type { CallRecord, ConsentGrant, DeclaredAction, ReasonCode } from "./types.js";

/**
 * The scope guard: enforcement between a peer's ambitions and the visitor's
 * browser. Two layers, kept separate on purpose:
 *
 * - checkPlan is pure: one plan of tool calls against one grant, returning the
 *   allowed (redacted) plan, the refusals, and the receipts. Tested here,
 *   reused by the receipt feed and the demo.
 * - wrapActions / wrapConsent are thin shells that put checkPlan in front of
 *   the agentic-web runtime's action registry and consent hook.
 */

/** One step of an execution plan, as the runtime builds it. */
export interface PlanStep {
  entry: { name: string; ref?: string; effect?: string; description?: string };
  args: Record<string, unknown>;
}

/** The runtime's receipt shape, extended with our reason vocabulary. */
export interface Receipt {
  action: string;
  requestId: string;
  status: "denied" | "not_started";
  reasonCode?: ReasonCode;
  message?: string;
}

export interface PlanVerdict {
  /** True only when every step passes: a plan is one composition, not a buffet. */
  allowed: boolean;
  /** The plan to run: original steps with out-of-scope fields redacted. */
  plan: PlanStep[];
  /** One record per step that was checked. */
  records: CallRecord[];
  /** Receipts for the runtime when the plan is refused. */
  receipts: Receipt[];
  /** How many calls this plan would consume (0 when refused). */
  consumed: number;
}

export interface GuardState {
  usedCalls: number;
}

export interface GuardOptions {
  grant: ConsentGrant;
  /** What the peer declared, from the inspection. Unknown actions are refused. */
  declared: DeclaredAction[];
  /** Who is acting, for the receipt log. */
  agent?: string;
  now?: () => Date;
  onDecision?: (record: CallRecord) => void;
}

/**
 * Check every step of a plan against the grant. Deny by default, and atomic:
 * one out-of-scope step refuses the whole plan, because a plan is one
 * composition the visitor either trusts or does not.
 */
export function checkPlan(
  steps: PlanStep[],
  options: Omit<GuardOptions, "onDecision">,
  state: GuardState,
): PlanVerdict {
  const { grant, declared } = options;
  const agent = options.agent ?? "web-agent";
  const now = options.now ? options.now() : new Date();

  const records: CallRecord[] = [];
  const checked: PlanStep[] = [];
  const decisions: Array<{ step: PlanStep; requestId: string; allowed: boolean; args: Record<string, unknown>; reasonCode: ReasonCode }> = [];
  let used = state.usedCalls;

  // Every step is checked, even after one fails: the visitor deserves to see
  // all the problems in one pass, not one per retry.
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const decision = decide(
      { action: step.entry.name, agent, args: step.args, now },
      grant,
      { usedCalls: used },
      declared,
    );
    if (decision.allowed) used += 1;

    records.push({
      ts: now.toISOString(),
      peer: grant.peerOrigin,
      agent,
      tool: `website_${step.entry.name}`,
      args: decision.args,
      decision: decision.allowed ? "allowed" : "denied",
      reasonCode: decision.reasonCode,
      grantId: grant.id,
      check: decision.check,
    });
    decisions.push({
      step,
      requestId: `plan:${i}`,
      allowed: decision.allowed,
      args: decision.args,
      reasonCode: decision.reasonCode,
    });
  }

  const refused = decisions.some((d) => !d.allowed);

  // Receipts follow the runtime's own convention: one per step, in order. A
  // refused plan runs nothing, so its passing steps are "not_started".
  const receipts: Receipt[] = refused
    ? decisions.map((d) =>
        d.allowed
          ? { action: d.step.entry.name, requestId: d.requestId, status: "not_started" as const }
          : {
              action: d.step.entry.name,
              requestId: d.requestId,
              status: "denied" as const,
              reasonCode: d.reasonCode,
              message: refusalMessage(d.step.entry.name, d.reasonCode),
            },
      )
    : [];

  if (!refused) {
    for (const d of decisions) checked.push({ entry: d.step.entry, args: d.args });
  }

  return {
    allowed: !refused,
    plan: checked,
    records,
    receipts,
    consumed: refused ? 0 : checked.length,
  };
}

function refusalMessage(action: string, code: ReasonCode): string {
  const prose: Record<ReasonCode, string> = {
    allowed: "",
    action_out_of_scope: `${action} is outside the granted scope. Nothing ran.`,
    data_out_of_scope: `${action} only carries data outside the granted scope. Nothing ran.`,
    grant_expired: `The consent for ${action} has expired. Nothing ran.`,
    grant_exhausted: `The consent for ${action} has been used up. Nothing ran.`,
    confirm_required: `${action} is irreversible and was never confirmed by the visitor.`,
    uninspected_peer: `${action} was not part of the network you consented to.`,
    nested_peer_denied: `Contact with ${action} needs its own consent card.`,
  };
  return `Peering refused: ${prose[code]}`;
}

/**
 * A live guard: carries its state and receipt log, and wraps the runtime.
 */
export class ScopeGuard {
  readonly grant: ConsentGrant;
  readonly declared: DeclaredAction[];
  readonly receipts: CallRecord[] = [];
  private used = 0;
  private readonly now: () => Date;
  private readonly onDecision?: (record: CallRecord) => void;

  constructor(options: GuardOptions) {
    this.grant = options.grant;
    this.declared = options.declared;
    this.now = options.now ?? (() => new Date());
    this.onDecision = options.onDecision;
    this.agentName = options.agent ?? "web-agent";
  }

  private readonly agentName: string;

  /** Check one plan. Records land in the log either way. */
  check(steps: PlanStep[]): PlanVerdict {
    const verdict = checkPlan(
      steps,
      { grant: this.grant, declared: this.declared, agent: this.agentName, now: this.now },
      { usedCalls: this.used },
    );
    for (const rec of verdict.records) {
      this.receipts.push(rec);
      this.onDecision?.(rec);
    }
    if (verdict.allowed) this.used += verdict.consumed;
    return verdict;
  }

  /** Remaining calls under this grant, or null when unbounded. */
  remaining(): number | null {
    return this.grant.maxCalls === undefined ? null : Math.max(0, this.grant.maxCalls - this.used);
  }

  /** Record a refused contact (a nested peer) in the log. */
  denyContact(origin: string): CallRecord {
    const rec: CallRecord = {
      ts: this.now().toISOString(),
      peer: origin || "(unknown origin)",
      agent: this.agentName,
      tool: "peer_contact",
      args: {},
      decision: "denied",
      reasonCode: "nested_peer_denied",
      grantId: this.grant.id,
      check: "consent",
    };
    this.receipts.push(rec);
    this.onDecision?.(rec);
    return rec;
  }
}

/**
 * Wrap a runtime action registry (the engine's `actions`). Only agent-issued
 * plans are gated: a plan built with { kind: "action" } comes from a model tool
 * call, while the human clicking their own page's buttons produces CRUSE
 * components and is not subject to the peer grant.
 */
export function wrapActions<T extends { prepare: (...args: never[]) => unknown; execute: (...args: never[]) => Promise<unknown> }>(
  actions: T,
  guard: ScopeGuard,
): T {
  const originalPrepare = actions.prepare.bind(actions) as (component: unknown, values?: unknown) => PlanStep[];
  const originalExecute = actions.execute.bind(actions) as (
    plan: PlanStep[],
    confirm: (items: unknown[]) => Promise<boolean>,
    invocationId: string,
  ) => Promise<unknown>;

  const origins = new WeakMap<object, "agent" | "ui">();

  actions.prepare = function (component: unknown, values?: unknown) {
    const plan = originalPrepare(component, values);
    origins.set(plan, (component as { kind?: string } | null)?.kind === "action" ? "agent" : "ui");
    return plan;
  } as unknown as T["prepare"];

  actions.execute = (async function (
    plan: PlanStep[],
    confirm: (items: unknown[]) => Promise<boolean>,
    invocationId: string,
  ) {
    if (origins.get(plan as unknown as object) !== "agent") {
      return originalExecute(plan, confirm, invocationId);
    }
    const verdict = guard.check(plan);
    if (!verdict.allowed) return verdict.receipts;
    return originalExecute(verdict.plan, confirm, invocationId);
  } as unknown) as T["execute"];

  return actions;
}

/**
 * Wrap the engine's consent hook: every third-party contact must be the peer
 * the visitor granted. Anything else is a nested peer and needs its own card.
 */
export function wrapConsent<T extends { requestConsent: (info: unknown) => Promise<unknown> }>(
  engine: T,
  guard: ScopeGuard,
): T {
  const original = engine.requestConsent.bind(engine) as (info: { peerOrigin?: string }) => Promise<unknown>;
  engine.requestConsent = (async (info: { peerOrigin?: string }) => {
    const origin = info?.peerOrigin ?? "";
    if (origin !== guard.grant.peerOrigin) {
      guard.denyContact(origin);
      return "decline";
    }
    return original(info);
  }) as T["requestConsent"];
  return engine;
}

export { record };
