'use strict';

const Homey = require('homey');

class EcodanCurveDriver extends Homey.Driver {
  async onInit() {
    this.log('Ecodan curve driver initialized');

    try {
      const getters = ['getDeviceActionCard', 'getActionCard'];
      let recalculate = null;
      for (const getterName of getters) {
        const getter = this.homey.flow[getterName];
        if (typeof getter === 'function') {
          try {
            recalculate = getter.call(this.homey.flow, 'recalculate_now');
            break;
          } catch {
            // try next getter
          }
        }
      }
      if (!recalculate) {
        throw new Error('recalculate_now flow card not found');
      }
      recalculate.registerRunListener(async (args) => {
        await args.device.evaluateNow('flow_recalculate');
      });
    } catch (error) {
      this.error(`Flow registration failed: ${error.message}`);
    }
  }

  async onPairListDevices() {
    return [{
      name: 'Ecodan kurve',
      icon: '/icon.svg',
      data: {
        id: `ecodan-curve-${Date.now()}`
      }
    }];
  }
}

module.exports = EcodanCurveDriver;
