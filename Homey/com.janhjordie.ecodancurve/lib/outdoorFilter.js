'use strict';

const MS_PER_MIN = 60 * 1000;

function createOutdoorSampleStore(maxSamples = 96) {
  return {
    samples: [],
    maxSamples,
    defrostCooldownUntil: 0,
    lastAcceptedOutdoor: null
  };
}

function pruneSamples(store, now, windowMs) {
  const cutoff = now - windowMs;
  store.samples = store.samples.filter((sample) => sample.at >= cutoff);
  if (store.samples.length > store.maxSamples) {
    store.samples = store.samples.slice(-store.maxSamples);
  }
}

function shouldSkipSample(store, sample, options = {}) {
  const now = sample.at;
  const maxDelta = Number(options.maxDeltaC);
  const defrost = Boolean(sample.defrost);

  if (defrost) {
    const cooldownMin = Number(options.defrostCooldownMin) || 15;
    store.defrostCooldownUntil = now + cooldownMin * MS_PER_MIN;
    return { skip: true, reason: 'defrost_active' };
  }

  if (now < store.defrostCooldownUntil) {
    return { skip: true, reason: 'defrost_cooldown' };
  }

  if (Number.isFinite(maxDelta) && store.lastAcceptedOutdoor != null) {
    const delta = Math.abs(sample.outdoor - store.lastAcceptedOutdoor);
    if (delta > maxDelta) {
      return { skip: true, reason: 'outdoor_spike' };
    }
  }

  return { skip: false };
}

function addOutdoorSample(store, sample, options = {}) {
  const outdoor = Number(sample.outdoor);
  const at = Number(sample.at) || Date.now();

  if (!Number.isFinite(outdoor)) {
    return { accepted: false, reason: 'invalid_outdoor' };
  }

  const windowMin = Number(options.avgWindowMin) || 15;
  pruneSamples(store, at, windowMin * MS_PER_MIN);

  const decision = shouldSkipSample(store, {
    outdoor,
    defrost: sample.defrost,
    at
  }, options);

  if (decision.skip) {
    return { accepted: false, reason: decision.reason };
  }

  store.samples.push({ outdoor, at });
  store.lastAcceptedOutdoor = outdoor;
  pruneSamples(store, at, windowMin * MS_PER_MIN);

  return { accepted: true };
}

function getFilteredOutdoor(store, options = {}) {
  const windowMin = Number(options.avgWindowMin) || 15;
  const now = Number(options.now) || Date.now();
  const windowMs = windowMin * MS_PER_MIN;

  pruneSamples(store, now, windowMs);

  if (!store.samples.length) {
    return {
      outdoor: store.lastAcceptedOutdoor,
      sampleCount: 0,
      stale: true
    };
  }

  const sum = store.samples.reduce((acc, item) => acc + item.outdoor, 0);
  const outdoor = sum / store.samples.length;

  return {
    outdoor: Math.round(outdoor * 10) / 10,
    sampleCount: store.samples.length,
    stale: false
  };
}

module.exports = {
  createOutdoorSampleStore,
  addOutdoorSample,
  getFilteredOutdoor
};
