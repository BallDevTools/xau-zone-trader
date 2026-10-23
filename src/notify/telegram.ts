import { log } from '../util/log';

export interface Notifier {
  send(text: string): void;
}

export const silent: Notifier = { send() {} };

/** Fire-and-forget Telegram messages; never throws into trading code. */
export function telegram(token?: string, chatId?: string): Notifier {
  if (!token || !chatId) return silent;
  return {
    send(text) {
      fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
        signal: AbortSignal.timeout(10_000),
      })
        .then((r) => (r.ok ? undefined : log.warn({ status: r.status }, 'telegram send failed')))
        .catch((err) => log.warn({ err: (err as Error).message }, 'telegram send failed'));
    },
  };
}
