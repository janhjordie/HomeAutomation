const HA_WEBHOOK_URL = 'http://homeassistant.local:8123/api/webhook/deye_ev_start_easee';

async function sendWebhook() {
  const res = await fetch(HA_WEBHOOK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    // body er optional – men vi kan sende lidt info for logging senere
    body: JSON.stringify({
      source: 'homey',
      event: 'ev_start',
      ts: new Date().toISOString()
    })
  });

  if (!res.ok) {
    throw new Error(`HA webhook failed: ${res.status} ${res.statusText}`);
  }

  return true;
}

return await sendWebhook();