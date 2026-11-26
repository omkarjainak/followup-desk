// Registers Follow-up Desk's operations with the agent runtime.

export const SITE_ACTIONS = [
  {
    name: "extract_actions",
    description: "Extract decisions, action items, owners and deadlines from meeting notes.",
    effect: "read",
    inputSchema: {
      type: "object",
      properties: {
        notes: { type: "string", description: "The meeting notes or transcript." },
      },
      required: ["notes"],
      additionalProperties: false,
    },
    execute: async (args) => ({
      decisions: [
        "Switch to weekly sprints instead of bi-weekly",
        "Move the Q3 review to Fridays",
      ],
      action_items: [
        { owner: "Omkar", action: "Draft the new sprint schedule", deadline: "2026-11-28" },
        { owner: "Priya", action: "Update the calendar invite", deadline: "2026-11-26" },
        { owner: "Team", action: "Review the new sprint cadence", deadline: "2026-12-01" },
      ],
      follow_ups: ["Q4 planning session", "Sprint retro format"],
    }),
  },
  {
    name: "draft_followup",
    description: "Draft a professional follow-up email with the meeting summary and action items.",
    effect: "write",
    inputSchema: {
      type: "object",
      properties: {
        summary: { type: "string", description: "Meeting summary." },
        actions: { type: "string", description: "Action items as text." },
      },
      required: ["summary", "actions"],
      additionalProperties: false,
    },
    execute: async (args) => ({
      to: "team@example.com",
      subject: "Follow-up: Q3 sprint planning — action items",
      body: "Hi team,\n\nThanks for joining the Q3 sprint planning session. Here's what we decided:\n\n1. Switch to weekly sprints (was bi-weekly)\n2. Move the Q3 review to Fridays\n\nAction items:\n- Omkar: Draft the new sprint schedule (by Nov 28)\n- Priya: Update the calendar invite (by Nov 26)\n- Team: Review the new sprint cadence (by Dec 1)\n\nFollow-ups: Q4 planning session, sprint retro format.\n\nBest,\nOmkar",
      note: "(demo) email not actually sent.",
    }),
  },
  {
    name: "track_commitment",
    description: "Record a commitment for follow-up tracking.",
    effect: "irreversible",
    inputSchema: {
      type: "object",
      properties: {
        commitment: { type: "string", description: "What was committed to." },
        owner: { type: "string", description: "Who committed." },
        due: { type: "string", description: "Due date." },
      },
      required: ["commitment", "owner", "due"],
      additionalProperties: false,
    },
    execute: async (args) => ({
      tracked: true,
      commitment: args.commitment,
      owner: args.owner,
      due: args.due,
      note: "(demo) tracked in browser storage.",
    }),
  },
];

export async function registerActions(actions) {
  for (const definition of SITE_ACTIONS) actions.register(definition);
}
