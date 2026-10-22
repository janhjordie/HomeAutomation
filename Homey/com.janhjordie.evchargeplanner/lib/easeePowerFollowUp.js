'use strict';

const POLL_INTERVAL_MS = 5000;
const MAX_SESSION_MS = 60000;
const START_GRACE_MS = 120000;
const TAIL_AFTER_CHANGE_MS = 10000;
const STABLE_STOP_MS = 10000;
const ACTIVE_POWER_THRESHOLD_W = 100;

class EaseePowerFollowUp {
  constructor({ scheduleTimeout, clearTimeout, pollFn, onComplete = null, log = () => {} }) {
    this._scheduleTimeout = scheduleTimeout;
    this._clearTimeout = clearTimeout;
    this._pollFn = pollFn;
    this._onComplete = onComplete;
    this._log = log;
    this._timerId = null;
    this._session = null;
  }

  stop() {
    if (this._timerId != null) {
      this._clearTimeout(this._timerId);
      this._timerId = null;
    }
    this._session = null;
  }

  start(reason = 'action', options = {}) {
    this.stop();

    const startedAt = Date.now();
    const maxSessionMs = options.maxSessionMs
      ?? (options.recoverDesiredCharge ? START_GRACE_MS : MAX_SESSION_MS);
    this._session = {
      reason,
      startedAt,
      endAt: startedAt + maxSessionMs,
      maxSessionMs,
      lastPowerW: null,
      lastChangeAt: startedAt,
      pollCount: 0,
      recoverDesiredCharge: Boolean(options.recoverDesiredCharge)
    };

    this._pollNow();
  }

  async _pollNow() {
    const session = this._session;
    if (!session) {
      return;
    }

    session.pollCount += 1;

    try {
      const powerW = await this._pollFn();
      this._handlePollResult(Number.isFinite(powerW) ? Math.round(powerW) : 0);
    } catch (error) {
      this._log(`Easee power follow-up poll fejlede: ${error.message}`);
      this._scheduleNext();
    }
  }

  _handlePollResult(powerW) {
    const session = this._session;
    if (!session) {
      return;
    }

    const now = Date.now();

    if (session.lastPowerW !== powerW) {
      session.lastPowerW = powerW;
      session.lastChangeAt = now;
      session.endAt = Math.min(
        Math.max(session.endAt, now + TAIL_AFTER_CHANGE_MS),
        session.startedAt + session.maxSessionMs + TAIL_AFTER_CHANGE_MS
      );
    }

    const stableFor = now - session.lastChangeAt;
    const timedOut = now >= session.endAt;
    const waitingForStartGrace = session.recoverDesiredCharge
      && powerW <= ACTIVE_POWER_THRESHOLD_W
      && now < session.startedAt + START_GRACE_MS;
    const stableEnough = stableFor >= STABLE_STOP_MS
      && session.pollCount > 1
      && !waitingForStartGrace;

    if (stableEnough || timedOut) {
      this._log(
        `Easee power follow-up færdig (${session.reason}): ${powerW}W, `
        + `${session.pollCount} polls, ${timedOut ? 'timeout' : 'stabil'}`
      );
      const completedSession = { ...session };
      this.stop();
      if (typeof this._onComplete === 'function') {
        try {
          this._onComplete(powerW, completedSession);
        } catch (error) {
          this._log(`Easee power follow-up onComplete fejlede: ${error.message}`);
        }
      }
      return;
    }

    this._scheduleNext();
  }

  _scheduleNext() {
    const session = this._session;
    if (!session) {
      return;
    }

    if (Date.now() >= session.endAt) {
      this._handlePollResult(session.lastPowerW ?? 0);
      return;
    }

    this._timerId = this._scheduleTimeout(() => {
      this._pollNow();
    }, POLL_INTERVAL_MS);
  }
}

module.exports = {
  POLL_INTERVAL_MS,
  MAX_SESSION_MS,
  START_GRACE_MS,
  TAIL_AFTER_CHANGE_MS,
  STABLE_STOP_MS,
  EaseePowerFollowUp
};
