// =================================================================
// POST MELCloud TELEMETRY TIL HOME ASSISTANT WEBHOOK (v1.0.0)
// Valgfri flow-target styring kan aktiveres senere, men er slået fra
// i room mode hvor target_temperature.flow_heat ikke bruges.
// =================================================================

const SCRIPT_VERSION       = 'v1.0.0';

// --- DEVICES & VARIABLER -----------------------------------------
const HEATPUMP_DEVICE_ID     = '4d696a96-ea94-4d7d-b97f-027e86658a80';
const HEATPUMP_SETPOINT_CAP  = 'target_temperature.flow_heat';
const HEATPUMP_MODE_CAP      = 'operational_state';           // bruges til at tjekke “heating”
const OUTDOOR_AVG_VAR        = 'currentOutdoorTemp';
const TARGET_VAR_NAME        = 'temperature_data_target';     // JSON med { points:[{outdoor, avg_flow, avg_room, samples}, ...] }
const ENABLE_FLOW_TARGET_CONTROL = false;

// --- HOME ASSISTANT WEBHOOK --------------------------------------
const HA_WEBHOOK_URL         = 'http://homeassistant.local:8123/api/webhook/melcloud_homey';

// --- BEGRÆNSNINGER ------------------------------------------------
const SETPOINT_MIN = 25;
const SETPOINT_MAX = 60;

// --- HELPERS ------------------------------------------------------
function clamp(n, min, max){ return Math.min(max, Math.max(min, n)); }
function toOutdoorInt(x) { return parseInt(x, 10); }

async function getLogicVarByName(name) {
  const all = await Homey.logic.getVariables();
  const v = Object.values(all).find(v => v.name === name);
  if (!v) throw new Error(`Logic Variable '${name}' ikke fundet. Opret den manuelt.`);
  return v;
}

async function loadTargetData() {
  const v = await getLogicVarByName(TARGET_VAR_NAME);
  if (!v.value) return null;
  try {
    const obj = JSON.parse(v.value);
    if (!obj || !Array.isArray(obj.points)) return null;
    return obj;
  } catch {
    return null;
  }
}

async function setFlowTempIfDifferent(targetValue) {
  const hp = await Homey.devices.getDevice({ id: HEATPUMP_DEVICE_ID });
  if (!hp) throw new Error(`Varmepumpe med id ${HEATPUMP_DEVICE_ID} ikke fundet`);

  const current = hp.capabilitiesObj?.[HEATPUMP_SETPOINT_CAP]?.value;

  // Hvis device ikke har capability, stop tydeligt
  if (current === undefined) {
    throw new Error(`Capability '${HEATPUMP_SETPOINT_CAP}' findes ikke på device '${hp.name}'.`);
  }

  // Sammenlign numerisk (undgår "45" vs 45 issues)
  const curNum = Number(current);
  const tgtNum = Number(targetValue);

  if (Number.isFinite(curNum) && Number.isFinite(tgtNum) && curNum === tgtNum) {
    log(`✅ Fremløb allerede korrekt: ${tgtNum}°C`);
    return { sent:false, previous:curNum, current:curNum };
  }

  log(`🔧 Opdaterer fremløb: ${curNum}°C → ${tgtNum}°C`);
  await hp.setCapabilityValue(HEATPUMP_SETPOINT_CAP, tgtNum);
  return { sent:true, previous:curNum, current:tgtNum };
}

async function postToHA(payload) {
  if (!HA_WEBHOOK_URL) return { ok:false, reason:"No webhook URL configured" };

  if (typeof fetch !== 'function') {
    // I nyere HomeyScript findes fetch typisk. Hvis ikke: fail tydeligt.
    throw new Error("fetch() er ikke tilgængelig i HomeyScript miljøet. Kan ikke poste til HA.");
  }

  try {
    const res = await fetch(HA_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const text = await res.text().catch(() => "");
    log(`📤 Posted til HA webhook: ${res.status} ${res.statusText}${text ? " | " + text : ""}`);
    return { ok: res.ok, status: res.status, statusText: res.statusText };
  } catch (e) {
    log(`⚠️ Kunne ikke poste til HA: ${e.message}`);
    return { ok:false, error: e.message };
  }
}

// --- MAIN ---------------------------------------------------------
try {
  const runAt = new Date().toISOString();

  // 1) Hent varmepumpe og tjek driftsmode
  const hp = await Homey.devices.getDevice({ id: HEATPUMP_DEVICE_ID });
  if (!hp) throw new Error(`Varmepumpe med id ${HEATPUMP_DEVICE_ID} ikke fundet`);

  const opState = hp.capabilitiesObj?.[HEATPUMP_MODE_CAP]?.value ?? null;
  const onoff = hp.capabilitiesObj?.['onoff']?.value ?? null;
  const flowNow = hp.capabilitiesObj?.['measure_temperature.flow']?.value ?? null;
  const returnNow = hp.capabilitiesObj?.['measure_temperature.return']?.value ?? null;
  const tankNow = hp.capabilitiesObj?.['measure_temperature.tank_water']?.value ?? null;
  const powerNow = hp.capabilitiesObj?.['measure_power']?.value ?? null;
  const freqNow = hp.capabilitiesObj?.['measure_frequency']?.value ?? null;
  const flowTargetCurrent = hp.capabilitiesObj?.[HEATPUMP_SETPOINT_CAP]?.value ?? null;

  // Hvis ikke heating: post status og stop
  if (opState !== 'heating') {
    const payload = {
      ts: runAt,
      source: "homey",
      device: { id: hp.id, name: hp.name },
      status: "skipped_not_heating",
      opState,
      onoff,
      measurements: {
        flowNow, returnNow, tankNow, powerNow, freqNow,
        flowTargetCurrent
      }
    };
    await postToHA(payload);
    log(`⏸ Ikke heating (current: '${opState || 'ukendt'}') → springer setpoint over.`);
    return payload;
  }

  // 2) Udetemperatur (heltal)
  const outVar = await getLogicVarByName(OUTDOOR_AVG_VAR);
  const outdoorRaw = Number(outVar.value);
  if (!Number.isFinite(outdoorRaw)) throw new Error(`Ugyldig værdi i '${OUTDOOR_AVG_VAR}': ${outVar.value}`);
  const outDeg = toOutdoorInt(outdoorRaw);

  // 3) Room mode: post kun telemetri til HA, spring flow target over.
  if (!ENABLE_FLOW_TARGET_CONTROL) {
    const payload = {
      ts: runAt,
      source: "homey",
      device: { id: hp.id, name: hp.name },
      status: "telemetry_only",
      opState,
      outdoor: outDeg,
      measurements: {
        flowNow, returnNow, tankNow, powerNow, freqNow,
        flowTargetCurrent
      }
    };
    await postToHA(payload);
    log(`ℹ️ Room mode telemetry only | Ude: ${outDeg}°C | Flow nu: ${flowNow ?? 'ukendt'}°C`);
    return payload;
  }

  // 4) Hent temperature_data_target
  const targetData = await loadTargetData();
  if (!targetData || !targetData.points.length) {
    const payload = {
      ts: runAt,
      source: "homey",
      device: { id: hp.id, name: hp.name },
      status: "skipped_no_target_data",
      opState,
      outdoor: outDeg,
      measurements: {
        flowNow, returnNow, tankNow, powerNow, freqNow,
        flowTargetCurrent
      }
    };
    await postToHA(payload);
    log(`ℹ️ Ingen gyldige data i '${TARGET_VAR_NAME}' endnu → sætter ikke fremløb.`);
    return payload;
  }

  // 5) Find match for aktuel udendørsgrad
  const point = targetData.points.find(p => Number(p?.outdoor) === outDeg);
  if (!point || !Number.isFinite(point.avg_flow)) {
    const payload = {
      ts: runAt,
      source: "homey",
      device: { id: hp.id, name: hp.name },
      status: "skipped_no_match_for_outdoor",
      opState,
      outdoor: outDeg,
      measurements: {
        flowNow, returnNow, tankNow, powerNow, freqNow,
        flowTargetCurrent
      }
    };
    await postToHA(payload);
    log(`ℹ️ Intet match i '${TARGET_VAR_NAME}' for outdoor ${outDeg}°C (eller avg_flow=null) → sætter ikke fremløb.`);
    return payload;
  }

  // 6) Brug avg_flow direkte (kun clamp)
  const target = clamp(Number(point.avg_flow), SETPOINT_MIN, SETPOINT_MAX);

  // 7) Sæt kun hvis nødvendigt
  const result = await setFlowTempIfDifferent(target);

  // 8) Post til HA
  const payload = {
    ts: runAt,
    source: "homey",
    device: { id: hp.id, name: hp.name },
    status: result.sent ? "set_flow_target" : "no_change",
    opState,
    outdoor: outDeg,
    targetFlow: target,
    previousFlowTarget: result.previous,
    measurements: {
      flowNow, returnNow, tankNow, powerNow, freqNow,
      flowTargetCurrent
    }
  };

  await postToHA(payload);

  // 9) Log & return
  log(`🔥 Heating | Ude: ${outDeg}°C | Target: ${target}°C | Sent=${result.sent}`);
  return payload;

} catch (err) {
  log(`❌ Fejl: ${err.message}`);

  // prøv at poste fejl til HA (best effort)
  try {
    await (typeof fetch === 'function'
      ? fetch(HA_WEBHOOK_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ts: new Date().toISOString(),
            source: "homey",
            status: "error",
            error: err.message
          }),
        })
      : Promise.resolve()
    );
  } catch (_) {}

  throw err;
}