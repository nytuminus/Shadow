// Acende o "Bot Status Monitor" do Gather com o estado atual do Shadow.
import { sendGatherEvent } from './gather-webhook.js';

const WEBHOOK_URL = process.env.GATHER_WEBHOOK_URL || '';
const WEBHOOK_SECRET = process.env.GATHER_WEBHOOK_SECRET || '';

// Estados aceitos pelo objeto "Bot Status Monitor": off | on | question | alert | working
let lastState = null;

export async function setGatherStatus(state) {
  if (!WEBHOOK_URL || !WEBHOOK_SECRET) return;
  if (state === lastState) return; // evita bater no webhook à toa
  lastState = state;
  await sendGatherEvent(WEBHOOK_URL, WEBHOOK_SECRET, 'status.set', { state });
}

export const gatherStatusEnabled = !!(WEBHOOK_URL && WEBHOOK_SECRET);
