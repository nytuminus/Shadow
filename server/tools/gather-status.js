// Acende o "Bot Status Monitor" do Gather com o estado atual do Shadow.
// Protocolo: Standard Webhooks v1 (HMAC-SHA256 sobre `${id}.${timestamp}.${body}`),
// o mesmo usado pelo @gathertown/webhook-object-sdk — reimplementado aqui sem a
// dependência extra, já que é só isto que o SDK faz por baixo dos panos.
import { createHmac, randomUUID } from 'node:crypto';

const WEBHOOK_URL = process.env.GATHER_WEBHOOK_URL || '';
const WEBHOOK_SECRET = process.env.GATHER_WEBHOOK_SECRET || '';
const ENABLED = !!(WEBHOOK_URL && WEBHOOK_SECRET);

// Estados aceitos pelo objeto "Bot Status Monitor": off | on | question | alert | working
let lastState = null;

function sign(id, timestampSeconds, body) {
  const key = Buffer.from(WEBHOOK_SECRET.replace(/^whsec_/, ''), 'base64');
  const signedContent = `${id}.${timestampSeconds}.${body}`;
  const signature = createHmac('sha256', key).update(signedContent, 'utf8').digest('base64');
  return `v1,${signature}`;
}

export async function setGatherStatus(state) {
  if (!ENABLED) return;
  if (state === lastState) return; // evita bater no webhook à toa
  lastState = state;

  const body = JSON.stringify({
    type: 'status.set',
    timestamp: new Date().toISOString(),
    data: { state },
  });
  const webhookId = randomUUID();
  const timestampSeconds = Math.floor(Date.now() / 1000);

  try {
    const res = await fetch(WEBHOOK_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'webhook-id': webhookId,
        'webhook-timestamp': String(timestampSeconds),
        'webhook-signature': sign(webhookId, timestampSeconds, body),
      },
      body,
    });
    if (!res.ok) {
      console.error('[gather] status.set falhou:', res.status, await res.text().catch(() => ''));
    }
  } catch (err) {
    console.error('[gather] status.set erro:', err?.message || err);
  }
}

export const gatherStatusEnabled = ENABLED;
