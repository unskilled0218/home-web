import { sendMagicPacket } from './wol.js';

function report(logError, message) {
  try { logError(message); } catch { /* Diagnostics must never change wake behavior. */ }
}

export async function executeWakeRequest({ device, port, markWake, audit, send = sendMagicPacket, logError = console.error }) {
  let dispatch;
  try {
    dispatch = await send({ macAddress: device.macAddress, broadcastAddress: device.broadcastAddress, ipAddress: device.ipAddress, port });
  } catch (error) {
    try { audit('failed', String(error.message).slice(0, 240)); }
    catch { report(logError, 'Unable to persist a failed wake attempt.'); }
    return { sent: false };
  }

  try {
    markWake();
    audit('sent', `${dispatch.sent}/${dispatch.attempted} Moonlight-compatible UDP datagrams sent`);
  } catch { report(logError, 'Wake packet was dispatched, but its audit record could not be persisted.'); }
  return { sent: true, dispatch };
}
