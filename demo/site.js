import { boot } from "./runtime/index.js";

const $ = (sel) => document.querySelector(sel);

const SAMPLE_NOTES = `Q3 Sprint Planning — Nov 22
Attendees: Omkar, Priya, Raj, Ananya

Omkar kicked off: we need to decide sprint cadence for Q4.

Discussion:
- Raj thinks weekly sprints are too fast, wants bi-weekly
- Ananya says daily standups are essential regardless of sprint length
- Priya: the Q3 review should move to Fridays so we have full-week data
- Omkar: let's try weekly for one sprint and evaluate

Decision: Switch to weekly sprints (was bi-weekly). Move Q3 review to Fridays.

Action items:
- Omkar to draft the new sprint schedule by Nov 28
- Priya to update the calendar invite by Nov 26
- Raj to review the new sprint cadence by Dec 1
- Ananya to set up daily standup bot by Nov 25

Follow-ups: Q4 planning session, sprint retro format change`;

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

function renderActions(data) {
  const el = $("#actions");
  el.innerHTML = "";
  if (data.decisions?.length) {
    const d = document.createElement("div");
    d.className = "decisions";
    d.innerHTML = "<h3>Decisions</h3>";
    const ul = document.createElement("ul");
    for (const dec of data.decisions) { const li = document.createElement("li"); li.textContent = dec; ul.append(li); }
    d.append(ul); el.append(d);
  }
  if (data.action_items?.length) {
    const a = document.createElement("div");
    a.className = "action-items";
    a.innerHTML = "<h3>Action items</h3>";
    const ul = document.createElement("ul");
    for (const item of data.action_items) {
      const li = document.createElement("li");
      li.innerHTML = `<strong>${escapeHtml(item.owner)}</strong>: ${escapeHtml(item.action)} <span class="deadline">by ${escapeHtml(item.deadline)}</span>`;
      ul.append(li);
    }
    a.append(ul); el.append(a);
  }
  if (data.follow_ups?.length) {
    const f = document.createElement("div");
    f.className = "followups";
    f.innerHTML = "<h3>Follow-ups</h3>";
    const ul = document.createElement("ul");
    for (const fu of data.follow_ups) { const li = document.createElement("li"); li.textContent = fu; ul.append(li); }
    f.append(ul); el.append(f);
  }
}

function renderEmail(data) {
  const el = $("#email");
  el.innerHTML = "";
  if (!data || !data.subject) { el.textContent = "No email drafted yet."; return; }
  const card = document.createElement("div");
  card.className = "email-card";
  card.innerHTML = `
    <div class="email-header">
      <div><strong>To:</strong> ${escapeHtml(data.to)}</div>
      <div><strong>Subject:</strong> ${escapeHtml(data.subject)}</div>
    </div>
    <pre class="email-body">${escapeHtml(data.body)}</pre>
    <div class="email-note">${escapeHtml(data.note || "")}</div>
  `;
  el.append(card);
}

function renderCommitments(data) {
  const el = $("#commitments");
  el.innerHTML = "";
  if (!data || !data.tracked) { el.textContent = "No commitments tracked yet."; return; }
  const card = document.createElement("div");
  card.className = "commitment-card";
  card.innerHTML = `
    <div class="commitment-header">Tracked</div>
    <div><strong>${escapeHtml(data.owner)}</strong>: ${escapeHtml(data.commitment)}</div>
    <div>Due: ${escapeHtml(data.due)}</div>
    <div class="commitment-note">${escapeHtml(data.note || "")}</div>
  `;
  el.append(card);
}

async function processMeeting() {
  const notes = $("#notes").value.trim();
  if (!notes) { alert("Paste some meeting notes first."); return; }
  $("#output").hidden = false;
  $("#actions").innerHTML = "<p>Extracting action items…</p>";
  $("#email").innerHTML = "<p>Drafting follow-up…</p>";
  $("#commitments").innerHTML = "<p>Tracking commitments…</p>";

  const mod = await import("./site-actions.js");
  const defs = mod.SITE_ACTIONS;
  const find = (name) => defs.find((d) => d.name === name);

  const extracted = await find("extract_actions").execute({ notes });
  const drafted = await find("draft_followup").execute({ summary: "Q3 sprint planning", actions: JSON.stringify(extracted.action_items) });
  const tracked = await find("track_commitment").execute({ commitment: extracted.action_items[0].action, owner: extracted.action_items[0].owner, due: extracted.action_items[0].deadline });

  renderActions(extracted);
  renderEmail(drafted);
  renderCommitments(tracked);
}

async function bootRuntime() {
  const status = document.querySelector("#agent-status");
  const siteBase = new URL("./", import.meta.url).href;
  try {
    const { boot } = await import("./runtime/index.js");
    const booted = await boot("#agent-app", {
      originUrl: siteBase,
      sandboxWorkerUrl: new URL("runtime/sandbox-worker.js", siteBase).href,
    });
    const engine = booted.engine;
    window.__followup = { engine };
    const needsKey = !engine.mockLLM && (!engine.byokKey || engine.byokKey === "demo");
    if (status) status.textContent = needsKey
      ? "Assistant needs your AI provider key. Add it in AI model settings below."
      : "Assistant connected. Type a message or load sample notes.";
    return engine;
  } catch (error) {
    console.error("Assistant startup failed", error);
    if (status) status.textContent = "The assistant could not load. You can still use the page directly.";
    return null;
  }
}

async function start() {
  $("#notes").value = SAMPLE_NOTES;
  await bootRuntime();
  $("#process").addEventListener("click", processMeeting);
  $("#sample").addEventListener("click", () => { $("#notes").value = SAMPLE_NOTES; });
}

start().catch((e) => console.error("start failed", e));