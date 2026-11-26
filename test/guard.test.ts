import { describe, expect, it } from "vitest";
import { ScopeGuard, checkPlan, wrapActions, wrapConsent } from "../src/guard.js";
import type { ConsentGrant, DeclaredAction } from "../src/types.js";

const grant: ConsentGrant = {
  id: "grant-1",
  peerOrigin: "https://tours.example",
  networkUrl: "https://tours.example/tours.network.json",
  purpose: "book a tour",
  allowActions: ["book_tour"],
  allowData: ["name", "party.size"],
  maxCalls: 3,
  expiresAt: "2027-01-01T00:00:00.000Z",
  issuedAt: "2026-11-22T00:00:00.000Z",
};

const declared: DeclaredAction[] = [
  {
    id: "book_tour",
    toolName: "website_book_tour",
    agent: "site",
    effect: "write",
    confirm: true,
    dataFields: ["name", "party.size"],
    source: "actions.agentTools",
  },
  {
    id: "send_deal_email",
    toolName: "website_send_deal_email",
    agent: "site",
    effect: "irreversible",
    confirm: false,
    dataFields: ["email"],
    source: "actions.module",
  },
];

const now = () => new Date("2026-12-01T00:00:00.000Z");

const step = (name: string, args: Record<string, unknown>) => ({
  entry: { name, ref: `site:${name}` },
  args,
});

describe("checkPlan", () => {
  it("allows a plan that stays inside the grant and redacts the rest", () => {
    const v = checkPlan(
      [step("book_tour", { name: "Omkar", party: { size: 2 }, note: "window seat" })],
      { grant, declared, now },
      { usedCalls: 0 },
    );
    expect(v.allowed).toBe(true);
    expect(v.consumed).toBe(1);
    expect(v.plan[0].args).toEqual({ name: "Omkar", party: { size: 2 } });
    expect(v.records[0].decision).toBe("allowed");
    expect(v.records[0].check).toBe("data-scope-redacted");
  });

  it("refuses the whole plan when one step is out of scope", () => {
    const v = checkPlan(
      [step("book_tour", { name: "O" }), step("send_deal_email", { email: "x@y.z" })],
      { grant, declared, now },
      { usedCalls: 0 },
    );
    expect(v.allowed).toBe(false);
    expect(v.plan).toEqual([]);
    expect(v.consumed).toBe(0);
    // Receipts follow the runtime convention: one per step, in order. The
    // passing step never ran, so it is not_started; the hostile step is denied.
    expect(v.receipts[0].status).toBe("not_started");
    expect(v.receipts[1].status).toBe("denied");
    expect(v.receipts[1].reasonCode).toBe("action_out_of_scope");
  });

  it("refuses an action the network never declared", () => {
    const v = checkPlan(
      [step("exfiltrate", {})],
      { grant, declared, now },
      { usedCalls: 0 },
    );
    expect(v.receipts[0].reasonCode).toBe("uninspected_peer");
  });

  it("counts bounded use across a plan", () => {
    const v = checkPlan(
      [step("book_tour", { name: "A" }), step("book_tour", { name: "B" })],
      { grant, declared, now },
      { usedCalls: 2 },
    );
    expect(v.allowed).toBe(false);
    expect(v.receipts[1].reasonCode).toBe("grant_exhausted");
    expect(v.receipts[1].status).toBe("denied");
    expect(v.receipts.length).toBe(2);
  });

  it("refuses once the grant expires", () => {
    const v = checkPlan(
      [step("book_tour", { name: "A" })],
      { grant, declared, now: () => new Date("2027-06-01T00:00:00.000Z") },
      { usedCalls: 0 },
    );
    expect(v.receipts[0].reasonCode).toBe("grant_expired");
  });

  it("refuses an irreversible action that was never confirmed", () => {
    const wide: ConsentGrant = { ...grant, allowActions: ["book_tour", "send_deal_email"] };
    const v = checkPlan(
      [step("send_deal_email", { email: "x@y.z" })],
      { grant: wide, declared, now },
      { usedCalls: 0 },
    );
    expect(v.receipts[0].reasonCode).toBe("confirm_required");
    expect(v.receipts[0].message).toContain("never confirmed");
  });
});

describe("ScopeGuard", () => {
  it("carries state and a receipt log across plans", () => {
    const seen: string[] = [];
    const guard = new ScopeGuard({
      grant,
      declared,
      now,
      onDecision: (r) => seen.push(r.decision),
    });

    const first = guard.check([step("book_tour", { name: "A" })]);
    expect(first.allowed).toBe(true);
    expect(guard.remaining()).toBe(2);

    guard.check([step("book_tour", { name: "B" })]);
    guard.check([step("book_tour", { name: "C" })]);
    expect(guard.remaining()).toBe(0);

    const fourth = guard.check([step("book_tour", { name: "D" })]);
    expect(fourth.allowed).toBe(false);
    expect(fourth.receipts[0].reasonCode).toBe("grant_exhausted");

    expect(guard.receipts.length).toBe(4);
    expect(seen).toEqual(["allowed", "allowed", "allowed", "denied"]);
  });
});

describe("wrapActions", () => {
  function fakeRegistry() {
    const executed: unknown[] = [];
    return {
      executed,
      prepare(component: { kind?: string; action?: string; arguments?: Record<string, unknown> }) {
        return [step(component.action ?? "book_tour", component.arguments ?? {})];
      },
      async execute(plan: unknown[], confirm: (items: unknown[]) => Promise<boolean>) {
        await confirm(plan);
        executed.push(plan);
        return [{ status: "succeeded" }];
      },
    };
  }

  it("gates agent-issued plans and passes the redacted plan through", async () => {
    const registry = wrapActions(fakeRegistry(), new ScopeGuard({ grant, declared, now }));
    const plan = registry.prepare({
      kind: "action",
      action: "book_tour",
      arguments: { name: "O", email: "x@y.z" },
    });
    const result = (await registry.execute(plan, async () => true, "run-1")) as Array<{ status: string }>;
    expect(result[0].status).toBe("succeeded");
    expect(registry.executed.length).toBe(1);
    expect((registry.executed[0] as Array<{ args: Record<string, unknown> }>)[0].args).toEqual({ name: "O" });
  });

  it("returns denial receipts instead of executing a hostile plan", async () => {
    const registry = wrapActions(fakeRegistry(), new ScopeGuard({ grant, declared, now }));
    const plan = registry.prepare({ kind: "action", action: "send_deal_email", arguments: { email: "x" } });
    const result = (await registry.execute(plan, async () => true, "run-2")) as Array<{ status: string }>;
    expect(result[0].status).toBe("denied");
    expect(registry.executed.length).toBe(0);
  });

  it("does not gate plans from the human clicking their own page", async () => {
    const registry = wrapActions(fakeRegistry(), new ScopeGuard({ grant, declared, now }));
    const plan = registry.prepare({ kind: "cruse", action: "send_deal_email", arguments: { email: "x" } });
    const result = (await registry.execute(plan, async () => true, "run-3")) as Array<{ status: string }>;
    expect(result[0].status).toBe("succeeded");
    expect(registry.executed.length).toBe(1);
  });
});

describe("wrapConsent", () => {
  it("declines contact with any origin but the granted peer", async () => {
    const guard = new ScopeGuard({ grant, declared, now });
    const engine = wrapConsent(
      {
        calls: [] as string[],
        async requestConsent(info: { peerOrigin?: string }) {
          this.calls.push(info.peerOrigin ?? "");
          return "approve";
        },
      },
      guard,
    );

    expect(await engine.requestConsent({ peerOrigin: "https://evil.example" })).toBe("decline");
    expect(engine.calls).toEqual([]);
    expect(guard.receipts[0].reasonCode).toBe("nested_peer_denied");

    expect(await engine.requestConsent({ peerOrigin: "https://tours.example" })).toBe("approve");
    expect(engine.calls).toEqual(["https://tours.example"]);
  });
});
