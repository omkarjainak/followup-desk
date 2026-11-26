import { describe, expect, it } from "vitest";
import { buildGrant, defaultChoices, explainGrant } from "../src/grant.js";
import type { PeerProfile } from "../src/types.js";

const profile: PeerProfile = {
  url: "https://tours.example/tours.network.json",
  origin: "https://tours.example",
  name: "Harbor Tours",
  frontMan: "tours_assistant",
  agents: [{ name: "tours_assistant", description: "Books tours.", tools: [] }],
  actions: [
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
      id: "cancel_tour",
      toolName: "website_cancel_tour",
      agent: "site",
      effect: "irreversible",
      confirm: true,
      dataFields: ["name"],
      source: "actions.agentTools",
    },
  ],
  peers: { policy: "closed", allowed: ["https://tours.example"] },
  mcp: [],
  findings: [],
  label: { summary: "s", score: 100, can: [], cannot: [], sends: [], flags: [] },
};

const now = new Date("2026-11-22T12:00:00.000Z");

describe("defaultChoices", () => {
  it("grants nothing by default", () => {
    const d = defaultChoices();
    expect(d.allowActions).toEqual([]);
    expect(d.allowData).toEqual([]);
    expect(d.purpose).toBe("");
  });
});

describe("buildGrant", () => {
  it("builds a bounded, expiring, purpose-bound grant", () => {
    const { grant, errors } = buildGrant(
      profile,
      {
        allowActions: ["book_tour"],
        allowData: ["name", "party.size"],
        purpose: "book a tour",
        durationMinutes: 30,
        maxCalls: 5,
      },
      now,
    );
    expect(errors).toEqual([]);
    expect(grant).toBeDefined();
    expect(grant!.allowActions).toEqual(["book_tour"]);
    expect(grant!.allowData).toEqual(["name", "party.size"]);
    expect(grant!.purpose).toBe("book a tour");
    expect(grant!.maxCalls).toBe(5);
    expect(grant!.expiresAt).toBe("2026-11-22T12:30:00.000Z");
    expect(grant!.issuedAt).toBe(now.toISOString());
    expect(grant!.peerOrigin).toBe("https://tours.example");
  });

  it("refuses a grant with no actions", () => {
    const { grant, errors } = buildGrant(
      profile,
      { ...defaultChoices(), purpose: "look around" },
      now,
    );
    expect(grant).toBeUndefined();
    expect(errors.join(" ")).toMatch(/no actions/);
  });

  it("refuses an empty purpose", () => {
    const { errors } = buildGrant(
      profile,
      { ...defaultChoices(), allowActions: ["book_tour"], purpose: "   " },
      now,
    );
    expect(errors.join(" ")).toMatch(/purpose/);
  });

  it("refuses actions the network does not declare", () => {
    const { errors } = buildGrant(
      profile,
      { ...defaultChoices(), allowActions: ["send_email"], purpose: "p" },
      now,
    );
    expect(errors.join(" ")).toMatch(/send_email/);
  });

  it("refuses data fields the network does not declare", () => {
    const { errors } = buildGrant(
      profile,
      { ...defaultChoices(), allowActions: ["book_tour"], allowData: ["email"], purpose: "p" },
      now,
    );
    expect(errors.join(" ")).toMatch(/email/);
  });

  it("refuses a zero or negative lifetime", () => {
    const { errors } = buildGrant(
      profile,
      { ...defaultChoices(), allowActions: ["book_tour"], purpose: "p", durationMinutes: 0 },
      now,
    );
    expect(errors.join(" ")).toMatch(/Duration/);
  });

  it("refuses a maxCalls below one", () => {
    const { errors } = buildGrant(
      profile,
      { ...defaultChoices(), allowActions: ["book_tour"], purpose: "p", maxCalls: 0 },
      now,
    );
    expect(errors.join(" ")).toMatch(/Max calls/);
  });
});

describe("explainGrant", () => {
  it("summarizes scope, data, expiry and bounds", () => {
    const { grant } = buildGrant(
      profile,
      {
        allowActions: ["book_tour"],
        allowData: ["name"],
        purpose: "book a tour",
        durationMinutes: 30,
        maxCalls: 5,
      },
      now,
    );
    const line = explainGrant(grant!);
    expect(line).toContain("book a tour");
    expect(line).toContain("book_tour");
    expect(line).toContain("name");
    expect(line).toContain("5 calls");
  });

  it("says so when no data fields are granted", () => {
    const { grant } = buildGrant(
      profile,
      {
        allowActions: ["book_tour"],
        allowData: [],
        purpose: "p",
        durationMinutes: 10,
        maxCalls: 1,
      },
      now,
    );
    expect(explainGrant(grant!)).toContain("no data fields");
  });
});
