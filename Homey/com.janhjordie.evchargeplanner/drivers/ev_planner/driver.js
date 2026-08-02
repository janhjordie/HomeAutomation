'use strict';

// BacklogTrace: EVC-006, EVC-008, EVC-009, EVC-010
const Homey = require('homey');

class EvPlannerDriver extends Homey.Driver {
  async onInit() {
    this.log('EV Planner driver initialized');
    this._registerFlowCards();

    const devices = await this.getDevices();
    this.log(`EV Planner driver: ${devices.length} enhed(er) indlæst`);
  }

  _getFlowCard(getterNames, cardId) {
    for (const getterName of getterNames) {
      const getter = this.homey.flow[getterName];
      if (typeof getter !== 'function') {
        continue;
      }

      try {
        return getter.call(this.homey.flow, cardId);
      } catch (error) {
        this.log(`Flow card getter ${getterName}('${cardId}') failed: ${error.message}`);
      }
    }

    throw new Error(`Flow card not found: ${cardId}`);
  }

  _registerFlowCards() {
    try {
      this._getFlowCard(['getDeviceConditionCard', 'getConditionCard'], 'should_charge')
        .registerRunListener(async (args) => args.device.getCapabilityValue('charge_now'));

      this._getFlowCard(['getDeviceConditionCard', 'getConditionCard'], 'force_charge_active')
        .registerRunListener(async (args) => args.device.getCapabilityValue('force_charge'));

      this._getFlowCard(['getDeviceConditionCard', 'getConditionCard'], 'night_charge_active')
        .registerRunListener(async (args) => {
          if (args.device.hasCapability('night_charge_enabled')) {
            return Boolean(args.device.getCapabilityValue('night_charge_enabled'));
          }
          return args.device.getSetting('night_charge_enabled') !== false;
        });

      this._getFlowCard(['getDeviceConditionCard', 'getConditionCard'], 'one_shot_active')
        .registerRunListener(async (args) => {
          if (args.device.hasCapability('one_shot_enabled')) {
            return Boolean(args.device.getCapabilityValue('one_shot_enabled'));
          }
          return Boolean(args.device.getSetting('one_shot_enabled'));
        });

      this._getFlowCard(['getDeviceActionCard', 'getActionCard'], 'force_charge_on')
        .registerRunListener(async (args) => {
          await args.device.setCapabilityValue('force_charge', true);
          await args.device.evaluateNow('flow_force_on');
        });

      this._getFlowCard(['getDeviceActionCard', 'getActionCard'], 'force_charge_off')
        .registerRunListener(async (args) => {
          await args.device.setCapabilityValue('force_charge', false);
          await args.device.evaluateNow('flow_force_off');
        });

      this._getFlowCard(['getDeviceActionCard', 'getActionCard'], 'start_one_shot')
        .registerRunListener(async (args) => {
          await args.device.enableOneShot({
            chargeHours: Number(args.hours) || 7,
            readyBy: args.ready_by || '09:30'
          });
          await args.device.evaluateNow('flow_one_shot_start');
        });

      this._getFlowCard(['getDeviceActionCard', 'getActionCard'], 'cancel_one_shot')
        .registerRunListener(async (args) => {
          await args.device.disableOneShot('flow_one_shot_cancel');
          await args.device.evaluateNow('flow_one_shot_cancel');
        });

      this._getFlowCard(['getDeviceActionCard', 'getActionCard'], 'recalculate_now')
        .registerRunListener(async (args) => {
          await args.device.evaluateNow('flow_recalculate');
        });
    } catch (error) {
      this.error('Flow card registration failed:', error.message);
    }
  }

  async onPairListDevices() {
    return this._listPairDevices();
  }

  _listPairDevices() {
    return [{
      name: 'EV Ladeplan',
      icon: '/drivers/ev_planner/assets/images/small.png',
      data: {
        id: `ev-planner-${Date.now()}`
      }
    }];
  }
}

module.exports = EvPlannerDriver;
