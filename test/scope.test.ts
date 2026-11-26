import { describe, expect, it } from "vitest";
import { decide, redactArgs, record } from "../src/scope.js";
import type { ConsentGrant, DeclaredAction } from "../src/types.js";

const grant: ConsentGrant = {
  id: "grant-1",
  peerOrigin: "https://tours.example",
  networkUrl: "https://tours.example/network",
  purpose: "book a tour",
  allowActions: ["book_tour"],
  allowData: ["name", "party.size"],
  maxCalls: 3,
  expiresAt: "2027-01-01T00:00:00.000Z",
  issuedAt: "2026-11-22T00:00:00.000Z",
};

const actions: DeclaredAction[] = [
  {
    id: "book_tour",
    toolName: "website_book_tour",
    agent: "booking",
    effect: "write",
    confirm: true,
    dataFields: ["name", "party"],
    source: "tools[0]",
  },
  {
    id: "send_email",
    toolName: "website_send_email",
    agent: "booking",
    effect: "irreversible",
    confirm: false,
    dataFields: ["to"],
    source: "tools[1]",
  },
];

const now = new Date("2026-12-01T00:00:00.000Z");

describe("decide", () => {
  it("allows an in-scope action with in-scope data", () => {
    const d = decide(
      { action: "book_tour", agent: "booking", args: { name: "Omkar", party: { size: 2 } }, now },
      grant,
      { usedCalls: 0 },
      actions,
    );
    expect(d.allowed).toBe(true);
    expect(d.reasonCode).toBe("allowed");
  });

  it("denies an action that is not on the allowlist", () => {
    const d = decide(
      { action: "send_email", agent: "booking", args: { to: "x@y.z" }, now },
      grant,
      { usedCalls: 0 },
      actions,
    );
    expect(d.allowed).toBe(false);
    expect(d.reasonCode).toBe("action_out_of_scope");
    expect(d.check).toBe("action-scope");
  });

  it("denies a side effect with no confirmation dialog", () => {
    const wideGrant = { ...grant, allowActions: ["book_tour", "send_email"] };
    const d = decide(
      { action: "send_email", agent: "booking", args: { to: "x@y.z" }, now },
      wideGrant,
      { usedCalls: 0 },
      actions,
    );
    expect(d.allowed).toBe(false);
    expect(d.reasonCode).toBe("confirm_required");
  });

  it("expires a grant past its expiry", () => {
    const d = decide(
      { action: "book_tour", agent: "booking", args: { name: "O" }, now: new Date("2027-06-01") },
      grant,
      { usedCalls: 0 },
      actions,
    );
    expect(d.reasonCode).toBe("grant_expired");
  });

  it("exhausts a bounded grant", () => {
    const d = decide(
      { action: "book_tour", agent: "booking", args: { name: "O" }, now },
      grant,
      { usedCalls: 3 },
      actions,
    );
    expect(d.reasonCode).toBe("grant_exhausted");
  });

  it("redacts out-of-scope fields instead of refusing", () => {
    const d = decide(
      {
        action: "book_tour",
        agent: "booking",
        args: { name: "Omkar", email: "me@example.com", party: { size: 2, phone: "1" } },
        now,
      },
      grant,
      { usedCalls: 0 },
      actions,
    );
    expect(d.allowed).toBe(true);
    expect(d.args).toEqual({ name: "Omkar", party: { size: 2 } });
    expect(d.check).toBe("data-scope-redacted");
  });

  it("denies when no argument field is within the grant", () => {
    const d = decide(
      { action: "book_tour", agent: "booking", args: { email: "me@example.com" }, now },
      grant,
      { usedCalls: 0 },
      actions,
    );
    expect(d.allowed).toBe(false);
    expect(d.reasonCode).toBe("data_out_of_scope");
  });
});

describe("redactArgs", () => {
  it("matches dotted names one level deep", () => {
    const { trimmed, dropped } = redactArgs(
      { cart: { items: [1], coupon: "X" }, note: "hi" },
      ["cart.items"],
    );
    expect(trimmed).toEqual({ cart: { items: [1] } });
    expect(dropped).toEqual(["cart.coupon", "note"]);
  });
});

describe("record", () => {
  it("appends without mutating the log", () => {
    const log: never[] = [];
    const next = record(log, {
      peer: "https://tours.example",
      agent: "booking",
      tool: "website_book_tour",
      args: { name: "O" },
      decision: "allowed",
      reasonCode: "allowed",
      grantId: "grant-1",
    });
    expect(log).toHaveLength(0);
    expect(next).toHaveLength(1);
    expect(next[0].ts).toBeTruthy();
  });
});
