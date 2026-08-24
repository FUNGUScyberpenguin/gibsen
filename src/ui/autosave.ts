/**
 * Autosave.
 *
 * There is no server, which is the point — an incident dropped on this tool
 * never leaves the machine. The cost of that promise is that a refresh, a
 * crash or a closed tab used to take an hour of transcription with it, and
 * losing work once is how a tool stops being used.
 *
 * `localStorage` keeps the bargain: it is the same machine, the same browser,
 * and nothing crosses a network. It is also small and can be switched off
 * entirely, so every path through here treats saving as a favour rather than a
 * guarantee — a failure is reported, never thrown.
 */

import type { Incident } from '../model/types';
import { parseIncident } from '../model/incident';

/** Bumped when a change would make an older payload unreadable. */
const KEY = 'gibsen.autosave.v1';
const DEBOUNCE_MS = 900;

export interface Restored {
  incident: Incident;
  savedAt: string;
}

export type SaveOutcome = 'saved' | 'too-large' | 'unavailable';

function storage(): Storage | null {
  try {
    const probe = window.localStorage;
    // Safari in private mode hands one over and then throws on write.
    probe.setItem('gibsen.probe', '1');
    probe.removeItem('gibsen.probe');
    return probe;
  } catch {
    return null;
  }
}

export class Autosave {
  private timer: number | null = null;
  private lastOutcome: SaveOutcome | null = null;

  constructor(private readonly onOutcome?: (outcome: SaveOutcome) => void) {}

  /** Queue a save. Called on every edit, so it coalesces. */
  schedule(incident: Incident): void {
    if (this.timer !== null) window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => {
      this.timer = null;
      this.saveNow(incident);
    }, DEBOUNCE_MS);
  }

  /** Write immediately — on unload, where a debounce would never fire. */
  saveNow(incident: Incident): SaveOutcome {
    const store = storage();
    if (!store) return this.report('unavailable');

    try {
      store.setItem(KEY, JSON.stringify({ savedAt: new Date().toISOString(), incident }));
      return this.report('saved');
    } catch {
      // Almost always the quota. Drop the stale copy rather than leaving a
      // half-written one that would restore as an older incident.
      try {
        store.removeItem(KEY);
      } catch {
        /* nothing left to try */
      }
      return this.report('too-large');
    }
  }

  private report(outcome: SaveOutcome): SaveOutcome {
    if (outcome !== this.lastOutcome) {
      this.lastOutcome = outcome;
      this.onOutcome?.(outcome);
    }
    return outcome;
  }

  /** Whatever was left behind last time, or null. Never throws. */
  restore(): Restored | null {
    const store = storage();
    if (!store) return null;

    let raw: string | null;
    try {
      raw = store.getItem(KEY);
    } catch {
      return null;
    }
    if (!raw) return null;

    try {
      const parsed = JSON.parse(raw) as { savedAt?: unknown; incident?: unknown };
      const incident = parseIncident(parsed.incident);
      if (!incident.nodes.length) return null;
      return { incident, savedAt: typeof parsed.savedAt === 'string' ? parsed.savedAt : '' };
    } catch {
      // A payload this version cannot read is worse than none: clear it so the
      // next save starts clean rather than failing the same way every load.
      try {
        store.removeItem(KEY);
      } catch {
        /* nothing left to try */
      }
      return null;
    }
  }

  clear(): void {
    if (this.timer !== null) {
      window.clearTimeout(this.timer);
      this.timer = null;
    }
    try {
      storage()?.removeItem(KEY);
    } catch {
      /* nothing left to try */
    }
  }
}
