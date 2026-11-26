import { buildGrant, defaultChoices, explainGrant } from "../dist/grant.js";

/**
 * The consent card: render a peer profile, collect a scope, build a grant.
 *
 * The page is intentionally free of framework code. Everything here is DOM
 * over the same engine the CLI and the runtime guard use, so what the visitor
 * sees is what enforcement will enforce.
 */

const state = {
  profile: null,
  choices: defaultChoices(),
};

export function renderCard(root, profile, options = {}) {
  state.profile = profile;
  state.choices = defaultChoices();
  state.onGrant = options.onGrant;
  root.innerHTML = "";
  root.append(
    head(profile),
    summary(profile),
    section("What this network declares", labelGrid(profile)),
    section("Why the score is what it is", findings(profile)),
    section("What you are granting", scopePicker(profile)),
    section("Under what terms", terms()),
    actionRow(),
    output(),
  );
}

function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === "class") node.className = v;
    else if (k === "text") node.textContent = v;
    else node.setAttribute(k, v);
  }
  for (const child of children) node.append(child);
  return node;
}

function head(profile) {
  const score = profile.label.score;
  const color = score >= 90 ? "var(--ok)" : score >= 60 ? "var(--warn)" : "var(--danger)";
  const meter = el("div", { class: "score-meter" });
  const fill = el("span");
  fill.style.width = `${score}%`;
  fill.style.background = color;
  meter.append(fill);

  return el("div", { class: "card-head" }, [
    el("h2", { text: profile.name }),
    el("div", { class: "network", text: profile.url }),
    el("div", { class: "score-row" }, [
      meter,
      el("div", { class: "score-num", text: `${score} / 100` }),
    ]),
  ]);
}

function summary(profile) {
  const high = profile.findings.filter((f) => f.severity === "high").length;
  const level = high > 0 ? "high" : profile.label.score >= 90 ? "ok" : "warn";
  return el("div", { class: `summary ${level}`, text: profile.label.summary });
}

function section(title, body) {
  return el("div", { class: "section" }, [el("h3", { text: title }), body]);
}

function labelGrid(profile) {
  const grid = el("div", { class: "label-grid" });
  for (const [title, items] of [
    ["It can", profile.label.can],
    ["It cannot", profile.label.cannot],
    ["Data it would receive", profile.label.sends],
    ["Flags", profile.label.flags],
  ]) {
    const list = el("ul");
    for (const item of items.length ? items : ["nothing noted"]) {
      list.append(el("li", { text: item }));
    }
    grid.append(el("div", {}, [el("h3", { text: title }), list]));
  }
  return grid;
}

function findings(profile) {
  const wrap = el("div", { class: "findings" });
  if (profile.findings.length === 0) {
    wrap.append(el("div", { class: "finding" }, [el("div", { class: "msg", text: "No findings." })]));
    return wrap;
  }
  for (const f of profile.findings) {
    wrap.append(
      el("div", { class: "finding" }, [
        el("span", { class: `sev ${f.severity}`, text: f.severity }),
        el("div", { class: "msg" }, [
          document.createTextNode(f.message),
          el("span", { class: "evidence", text: `evidence: ${f.source}` }),
        ]),
      ]),
    );
  }
  return wrap;
}

function scopePicker(profile) {
  const wrap = el("div", { class: "scope-list" });
  if (profile.actions.length === 0) {
    wrap.append(el("div", { text: "This network declares no website actions." }));
    return wrap;
  }
  for (const action of profile.actions) {
    const box = el("input", { type: "checkbox" });
    box.addEventListener("change", () => {
      if (box.checked) state.choices.allowActions.push(action.id);
      else {
        const i = state.choices.allowActions.indexOf(action.id);
        if (i >= 0) state.choices.allowActions.splice(i, 1);
      }
    });
    wrap.append(
      el("label", { class: "scope-item" }, [
        box,
        el("span", { class: "name", text: action.toolName }),
        el("span", { class: `effect ${action.effect}`, text: action.effect }),
      ]),
    );
  }

  const fields = [...new Set(profile.actions.flatMap((a) => a.dataFields))];
  if (fields.length > 0) {
    wrap.append(el("h3", { text: "Data fields this action may receive" }));
    for (const field of fields) {
      const box = el("input", { type: "checkbox" });
      box.addEventListener("change", () => {
        if (box.checked) state.choices.allowData.push(field);
        else {
          const i = state.choices.allowData.indexOf(field);
          if (i >= 0) state.choices.allowData.splice(i, 1);
        }
      });
      wrap.append(el("label", { class: "scope-item" }, [box, el("span", { text: field })]));
    }
  }
  return wrap;
}

function terms() {
  const purpose = el("input", { type: "text", placeholder: "e.g. book a tour for two" });
  purpose.addEventListener("input", () => (state.choices.purpose = purpose.value));

  const duration = el("select");
  for (const [label, minutes] of [
    ["5 minutes", 5],
    ["30 minutes", 30],
    ["1 hour", 60],
  ]) {
    const opt = el("option", { value: String(minutes), text: label });
    if (minutes === 30) opt.selected = true;
    duration.append(opt);
  }
  duration.addEventListener("change", () => (state.choices.durationMinutes = Number(duration.value)));

  const calls = el("input", { type: "number", min: "1", value: "12" });
  calls.addEventListener("input", () => (state.choices.maxCalls = Number(calls.value)));

  const grid = el("div", { class: "terms" }, [
    el("div", { class: "full" }, [el("label", { text: "Purpose (matched exactly)" }), purpose]),
    el("div", {}, [el("label", { text: "Consent lasts" }), duration]),
    el("div", {}, [el("label", { text: "Maximum calls" }), calls]),
  ]);
  return grid;
}

function actionRow() {
  const deny = el("button", { class: "btn deny", text: "Deny" });
  const grant = el("button", { class: "btn grant", text: "Grant this scope" });
  deny.addEventListener("click", () => showGrant(null, []));
  grant.addEventListener("click", () => {
    const { grant: g, errors } = buildGrant(state.profile, state.choices);
    showGrant(g ?? null, errors);
    if (g && typeof state.onGrant === "function") state.onGrant(g);
  });
  return el("div", { class: "actions-row" }, [deny, grant]);
}

function output() {
  return el("div", { id: "peering-output" });
}

function showGrant(grant, errors) {
  const out = document.getElementById("peering-output");
  out.innerHTML = "";

  if (errors.length > 0) {
    const list = el("ul");
    for (const e of errors) list.append(el("li", { text: e }));
    out.append(el("div", { class: "errors" }, [el("strong", { text: "Not granted yet." }), list]));
    return;
  }

  if (grant === null) {
    out.append(
      el("div", { class: "errors", text: "Denied. Nothing runs, and the peer is told nothing about you." }),
    );
    return;
  }

  const pre = el("pre", { text: JSON.stringify(grant, null, 2) });
  out.append(
    el("div", { class: "granted" }, [
      el("strong", { text: "Granted." }),
      el("div", { text: explainGrant(grant) }),
      pre,
    ]),
  );
}
