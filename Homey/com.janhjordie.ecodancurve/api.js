'use strict';

module.exports = {
  async evaluateAll({ homey }) {
    const evaluatedDevices = await homey.app.evaluateAllDevices('api');
    return { evaluatedDevices };
  },

  async probeHeatpump({ homey }) {
    return homey.app.probeHeatpump();
  }
};
