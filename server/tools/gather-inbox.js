// Manda cada mensagem nova das Salas pro objeto "Inbox" do Gather, como
// feed de atividade do escritório virtual.
import { sendGatherEvent } from './gather-webhook.js';

const WEBHOOK_URL = process.env.GATHER_INBOX_WEBHOOK_URL || '';
const WEBHOOK_SECRET = process.env.GATHER_INBOX_WEBHOOK_SECRET || '';

/** @param {{ id:string, text:string, url?:string }} item */
export async function addGatherInboxItem(item) {
  if (!WEBHOOK_URL || !WEBHOOK_SECRET) return;
  await sendGatherEvent(WEBHOOK_URL, WEBHOOK_SECRET, 'activity.add', {
    id: item.id,
    text: item.text.slice(0, 500),
    url: item.url,
  });
}

export const gatherInboxEnabled = !!(WEBHOOK_URL && WEBHOOK_SECRET);
