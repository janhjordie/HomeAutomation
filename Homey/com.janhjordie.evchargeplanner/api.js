'use strict';

// BacklogTrace: EVC-013
module.exports = {
  async validationSummary({ homey }) {
    return homey.app.getValidationSummary();
  },

  async evaluateAll({ homey }) {
    const evaluatedDevices = await homey.app.evaluateAllDevices('api');
    return { evaluatedDevices };
  },

  async createDevice({ homey, body }) {
    const name = String(body?.name || '').trim() || undefined;
    const dataId = String(body?.dataId || '').trim() || `ev-planner-${Date.now()}`;
    const device = await homey.app.createPlannerDevice(name, dataId);
    return {
      id: device.data?.id || dataId,
      name: device.name || name
    };
  }
};
