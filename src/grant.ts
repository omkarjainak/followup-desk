import type { ConsentGrant, PeerProfile } from "./types.js";

/**
 * The grant builder: turn a user's scope choices on the consent card into a
 * ConsentGrant. Deny by default carries all the way through here: the default
 * choice grants nothing, and building a grant with no actions is refused,
 * because a grant with no actions is a denial wearing a grant's clothes.
 */

export interface ScopeChoices {
  /** Action ids the visitor ticked. Empty means deny. */
  allowActions: string[];
  /** Data fields the visitor ticked. */
  allowData: string[];
  /** One host-bound purpose, matched exactly later. */
  purpose: string;
  /** Consent lifetime in minutes. */
  durationMinutes: number;
  /** Bounded use: maximum calls under this grant. */
  maxCalls: number;
}

/** Nothing is granted until the visitor ticks it. */
export function defaultChoices(): ScopeChoices {
  return {
    allowActions: [],
    allowData: [],
    purpose: "",
    durationMinutes: 30,
    maxCalls: 12,
  };
}

export interface BuildResult {
  grant?: ConsentGrant;
  errors: string[];
}

export function buildGrant(
  profile: PeerProfile,
  choices: ScopeChoices,
  now: Date = new Date(),
): BuildResult {
  const errors: string[] = [];

  const known = new Set(profile.actions.map((a) => a.id));
  for (const id of choices.allowActions) {
    if (!known.has(id)) {
      errors.push(`"${id}" is not an action this network declares.`);
    }
  }

  const knownFields = new Set(profile.actions.flatMap((a) => a.dataFields));
  for (const field of choices.allowData) {
    if (knownFields.size > 0 && !knownFields.has(field)) {
      errors.push(`"${field}" is not a data field this network declares.`);
    }
  }

  if (choices.allowActions.length === 0) {
    errors.push("Grant no actions? Press Deny instead: a grant with no actions covers nothing.");
  }
  if (choices.purpose.trim() === "") {
    errors.push("Name a purpose: the grant is matched to it exactly.");
  }
  if (!Number.isFinite(choices.durationMinutes) || choices.durationMinutes <= 0) {
    errors.push("Duration must be a positive number of minutes.");
  }
  if (!Number.isInteger(choices.maxCalls) || choices.maxCalls < 1) {
    errors.push("Max calls must be a whole number of at least 1.");
  }

  if (errors.length > 0) return { errors };

  const grant: ConsentGrant = {
    id: makeId(),
    peerOrigin: profile.origin,
    networkUrl: profile.url,
    purpose: choices.purpose.trim(),
    allowActions: [...choices.allowActions],
    allowData: [...choices.allowData],
    maxCalls: choices.maxCalls,
    expiresAt: new Date(now.getTime() + choices.durationMinutes * 60_000).toISOString(),
    issuedAt: now.toISOString(),
  };
  return { grant, errors: [] };
}

/** One-line human summary of a grant, shown under the card after granting. */
export function explainGrant(grant: ConsentGrant): string {
  const actions = grant.allowActions.join(", ");
  const data = grant.allowData.length > 0 ? grant.allowData.join(", ") : "no data fields";
  return (
    `Purpose "${grant.purpose}": may call ${actions}; may send ${data}; ` +
    `expires ${grant.expiresAt}; up to ${grant.maxCalls} calls.`
  );
}

function makeId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `grant-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
}
