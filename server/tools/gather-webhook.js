// Cliente genérico para os Smart Objects do Gather (webhooks assinados).
// Protocolo: Standard Webhooks v1 (HMAC-SHA256 sobre `${id}.${timestamp}.${body}`)
// — o mesmo que o @gathertown/webhook-object-sdk usa por baixo dos panos,
// reimplementado aqui na mão para não precisar da dependência extra.
import { createHmac, randomUUID } from 'node:crypto';

function sign(secret, id, timestampSeconds, body) {
  const key = Buffer.from(secret.replace(/^whsec_/, ''), 'base64');
  const signedContent = `${id}.${timestampSeconds}.${body}`;
  return `v1,${createHmac('sha256', key).update(signedContent, 'utf8').digest('base64')}`;
}

/** Manda um evento pra um Smart Object do Gather (ex.: "status.set", "activity.add"). */
export async function sendGatherEvent(url, secret, type, data) {
  if (!url || !secret) return;
  const body = JSON.stringify({ type, timestamp: new Date().toISOString(), data });
  const webhookId = randomUUID();
  const timestampSeconds = Math.floor(Date.now() / 1000);

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'webhook-id': webhookId,
        'webhook-timestamp': String(timestampSeconds),
        'webhook-signature': sign(secret, webhookId, timestampSeconds, body),
      },
      body,
    });
    if (!res.ok) {
      console.error(`[gather] ${type} falhou:`, res.status, await res.text().catch(() => ''));
    }
  } catch (err) {
    console.error(`[gather] ${type} erro:`, err?.message || err);
  }
}
