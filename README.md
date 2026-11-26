# Follow-up Desk

Meeting notes to action items, follow-up emails, and commitment tracking. Runs
entirely in your browser on your own key. No server, no subscription.

## The problem

Meetings waste time. Follow-ups get lost. Action items have no owners. People
forget commitments. A plain meeting-notes page doesn't solve this — it just
stores text.

## What it does

Paste messy meeting notes. The agent extracts:

- **Decisions** — what was agreed
- **Action items** — who does what, by when
- **Follow-ups** — topics to revisit

Then it drafts a professional follow-up email and tracks every commitment so
nothing falls through the cracks.

## The agentic web angle

The site's agent can call peer sites — a calendar site to check availability, a
task tracker to create tasks, an email site to send the follow-up — each behind a
consent card. You control which peers the agent calls and what data it sends.
All compose behind the open-agentic-web runtime, running entirely in your
browser on your own key.

## Quickstart

```bash
npm install
npm run build
python3 -m http.server 8096 --directory ./demo
```

Open http://127.0.0.1:8096. Click "Process meeting" to see the demo, or paste
your own notes.

## The demo

The demo runs the runtime's deterministic mock model — no API key needed. The
mock drives the agent loop: extract actions, draft follow-up, track commitment.

Sample output:

```
Decisions
- Switch to weekly sprints instead of bi-weekly
- Move the Q3 review to Fridays

Action items
- Omkar: Draft the new sprint schedule (by Nov 28)
- Priya: Update the calendar invite (by Nov 26)
- Team: Review the new sprint cadence (by Dec 1)

Follow-up email
To: team@example.com
Subject: Follow-up: Q3 sprint planning — action items
Hi team,
Thanks for joining the Q3 sprint planning session. Here's what we decided:
...
```

## Development

```bash
npm install
npm test          # vitest
npm run typecheck
npm run build
```

Node.js 22.19 or newer.

## License

MIT
