/**
 * Academy presence (client side, framework-free so it can be unit tested).
 *
 * "Online" = the member did something in the Academy within academy_settings.online_window_minutes (default 5).
 * The server decides with its own clock: academy_touch() stamps last_seen_at = now() for the caller only, and
 * academy_stats() counts distinct members whose last_seen_at falls inside the window.
 *
 * The browser's job is to send a heartbeat only while the member is actually using the page:
 *   - one beat when the Academy opens (or the page is refreshed), so Online counts them right away;
 *   - after that, at most one beat per HEARTBEAT_MS, and only if there was real input (pointer, key, scroll,
 *     touch, focus) since the previous beat. A tab left open with nobody at it stops beating and drops off the
 *     count once the window passes, as does a closed browser or a dropped connection (no beats arrive);
 *   - nothing at all while the tab is hidden; coming back to the tab counts as activity and beats at once.
 * Each beat returns fresh stats. Pages that show the stats and see no beat for a minute (an idle viewer or a
 * visitor who isn't a member) fetch the stats instead, only while the tab is visible.
 */

export const HEARTBEAT_MS = 60_000;
/** How often an open, visible stats panel refreshes when no heartbeat has brought fresh numbers. */
export const STATS_REFRESH_MS = 60_000;

export type PresenceKind = "beat" | "stats";

export type PresenceDeps = {
  /** Sends a heartbeat ("beat", also returns stats) or a stats-only read. Resolves when done; may reject. */
  send: (kind: PresenceKind) => Promise<void>;
  visible: () => boolean;
  now: () => number;
  /** True while something on the page displays the stats. */
  wantsStats: () => boolean;
};

export type PresenceController = {
  /** Call on mount. Members beat straight away; others fetch stats if a panel is showing. */
  start: (member: boolean) => void;
  /** Real input from the member. Cheap: it only records a timestamp unless a beat is due. */
  activity: () => void;
  /** The tab became visible or hidden. */
  visibility: () => void;
  /** Periodic timer tick (every few seconds is fine; the controller enforces the spacing). */
  tick: () => void;
  /** Network came back. */
  online: () => void;
  /** Unmount: no more beats or stats reads until start() is called again. */
  stop: () => void;
  readonly state: { stopped: boolean; member: boolean; lastActivity: number; lastBeat: number; lastStats: number; inflight: boolean };
};

export function createPresence(deps: PresenceDeps): PresenceController {
  const state = { stopped: true, member: false, lastActivity: -Infinity, lastBeat: -Infinity, lastStats: -Infinity, inflight: false };

  const run = (kind: PresenceKind) => {
    if (state.inflight || state.stopped) return;
    state.inflight = true;
    const at = deps.now();
    // Record the attempt up front so a failing network can't turn into a tight retry loop.
    if (kind === "beat") state.lastBeat = at;
    state.lastStats = at;
    deps.send(kind).catch(() => {
      // Let the next real activity or tick retry a failed beat instead of waiting a full interval.
      if (kind === "beat") state.lastBeat = -Infinity;
    }).finally(() => { state.inflight = false; });
  };

  const beatDue = () => state.member && deps.visible() && state.lastActivity > state.lastBeat && deps.now() - state.lastBeat >= HEARTBEAT_MS;

  const maybeStats = () => {
    if (deps.visible() && deps.wantsStats() && deps.now() - state.lastStats >= STATS_REFRESH_MS) run("stats");
  };

  const activity = () => {
    state.lastActivity = deps.now();
    if (beatDue()) run("beat");
  };

  return {
    state,
    stop() { state.member = false; state.stopped = true; },
    start(member) {
      state.stopped = false;
      state.member = member;
      if (member) {
        state.lastBeat = -Infinity;
        activity(); // opening (or refreshing) the Academy is activity
      } else {
        maybeStats();
      }
    },
    activity,
    visibility() {
      if (deps.visible()) {
        if (state.member) activity();
        else maybeStats();
      }
    },
    tick() {
      if (!deps.visible()) return; // hidden tabs never beat or poll
      if (beatDue()) run("beat");
      else maybeStats();
    },
    online() {
      // Only re-announce a member who was actually active recently; an idle tab stays offline.
      if (state.member && deps.visible() && deps.now() - state.lastActivity < HEARTBEAT_MS) {
        state.lastBeat = -Infinity;
        run("beat");
      }
    },
  };
}
