'use strict';

module.exports = {
  status: async ({ homey }) => homey.app.getMonitorStatus(),
  checkNow: async ({ homey }) => homey.app.runCheck('api'),
  async testPush({ homey }) {
    const { sendPushNotification } = require('./lib/pushNotification');
    const version = homey.manifest.version;
    const message = `Sensor Watch test — Homey push (v${version}).`;
    const logLines = [];
    const channel = await sendPushNotification(homey, message, (line) => logLines.push(line));
    return { channel, log: logLines };
  },
  async setDeviceEnabled({ homey, body }) {
    const id = body?.id || body?.ieeeAddress || body?.ieee;
    const enabled = body?.enabled !== false && body?.enabled !== 'false';
    const result = await homey.app.setDeviceEnabled(id, enabled);
    return result;
  }
};
