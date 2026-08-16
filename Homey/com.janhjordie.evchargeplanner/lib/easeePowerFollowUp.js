'use strict';

const POLL_INTERVAL_MS = 5000;
const MAX_SESSION_MS = 60000;
const TAIL_AFTER_CHANGE_MS = 10000;
const STABLE_STOP_MS = 10000;

class EaseePowerFollowUp {
  constructor({ scheduleTimeout, clearTimeout, pollFn, log = () => {} }) {
    this._scheduleTimeout = scheduleTimeout;
    this._clearTimeout = clearTimeout;
    this._pollFn = pollFn;
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

  start(reason = 'action') {
    this.stop();

    const startedAt = Date.now();
    this._session = {
      reason,
      startedAt,
      endAt: startedAt + MAX_SESSION_MS,
      lastPowerW: null,
      lastChangeAt: startedAt,
      pollCount: 0
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
        session.startedAt + MAX_SESSION_MS + TAIL_AFTER_CHANGE_MS
      );
    }

    const stableFor = now - session.lastChangeAt;
    const timedOut = now >= session.endAt;
    const stableEnough = stableFor >= STABLE_STOP_MS && session.pollCount > 1;

    if (stableEnough || timedOut) {
      this._log(
        `Easee power follow-up færdig (${session.reason}): ${powerW}W, `
        + `${session.pollCount} polls, ${timedOut ? 'timeout' : 'stabil'}`
      );
      this.stop();
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
  TAIL_AFTER_CHANGE_MS,
  STABLE_STOP_MS,
  EaseePowerFollowUp
};
