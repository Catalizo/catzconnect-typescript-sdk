import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Verify a webhook's `Catz-Signature` header.
 *
 * The header is `t=<unix seconds>,v1=<hex HMAC-SHA256>`; the MAC is taken
 * over `"<t>.<raw body>"` with the webhook's signing secret (`whsec_…`) as
 * the key. Pass the body exactly as received — before any JSON parsing —
 * and the secret as shown in the panel.
 *
 * Returns false for a missing or malformed header, a timestamp further than
 * `toleranceSeconds` (default 300) from now, or a signature that does not
 * match. The comparison is constant-time.
 */
export function verifyWebhookSignature(
  rawBody: string | Uint8Array,
  header: string | null | undefined,
  secret: string,
  toleranceSeconds = 300,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): boolean {
  if (!header || !secret) return false;

  let t: string | undefined;
  const v1: string[] = [];
  for (const part of header.split(",")) {
    const i = part.indexOf("=");
    if (i <= 0) continue;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    if (k === "t") t = v;
    else if (k === "v1") v1.push(v);
  }

  if (!t || !/^\d+$/.test(t) || v1.length === 0) return false;
  if (toleranceSeconds > 0 && Math.abs(nowSeconds - Number(t)) > toleranceSeconds) return false;

  const body = typeof rawBody === "string" ? Buffer.from(rawBody, "utf8") : Buffer.from(rawBody);
  const expected = createHmac("sha256", secret)
    .update(`${t}.`)
    .update(body)
    .digest();

  return v1.some((sig) => {
    if (!/^[0-9a-fA-F]{64}$/.test(sig)) return false;
    return timingSafeEqual(expected, Buffer.from(sig, "hex"));
  });
}

/** Every event a webhook can subscribe to. */
export const WEBHOOK_EVENTS = [
  "email.sent",
  "email.failed",
  "email.bounced",
  "email.opened",
  "email.clicked",
  "email.received",
  "whatsapp.status",
  "whatsapp.inbound",
  "whatsapp.read",
  "push.sent",
  "push.failed",
  "sms.sent",
  "sms.delivered",
  "sms.failed",
  "sms.unknown",
  "call.ringing",
  "call.started",
  "call.ended",
  "call.missed",
  "call.declined",
  "call.canceled",
  "call.failed",
  "participant.joined",
  "participant.left",
  "voice.answered",
  "voice.completed",
  "voice.failed",
  "voice.unknown",
  "email.complained",
  "email.unsubscribed",
  "push.opened",
  "sms.inbound",
  "sms.opt_out",
  "whatsapp.opt_out",
] as const;
export type WebhookEventType = (typeof WEBHOOK_EVENTS)[number] | (string & {});

/** A webhook delivery's body. `test` is true for events of test (sandbox) keys. */
export interface WebhookEvent<D = Record<string, unknown>> {
  id: string;
  type: WebhookEventType;
  created_at: string;
  organization_id: string;
  test: boolean;
  data: D;
}

/**
 * Verify the `Catz-Signature` header and parse the body. Throws when the
 * signature does not match (or is too old) or the body is not an event.
 */
export function parseWebhookEvent<D = Record<string, unknown>>(
  rawBody: string | Uint8Array,
  header: string | null | undefined,
  secret: string,
  toleranceSeconds = 300,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): WebhookEvent<D> {
  if (!verifyWebhookSignature(rawBody, header, secret, toleranceSeconds, nowSeconds)) {
    throw new Error("Invalid webhook signature");
  }
  const text = typeof rawBody === "string" ? rawBody : Buffer.from(rawBody).toString("utf8");
  let j: any;
  try {
    j = JSON.parse(text);
  } catch {
    throw new Error("The webhook body is not JSON");
  }
  if (!j || typeof j !== "object" || typeof j.type !== "string" || typeof j.id !== "string") {
    throw new Error("The webhook body is not a Catz Connect event");
  }
  return { ...j, test: j.test === true || j?.data?.test === true, data: (j.data ?? {}) as D };
}

/**
 * The `user_hash` for `POST /push/register`: hex HMAC-SHA256 of the
 * `external_user_id`, keyed with the push project's identity secret
 * (`pis_…`, Push → Projects in the panel).
 *
 * Compute it on your server and hand it to your app with the user id. The
 * identity secret must never ship inside the app — anyone holding it could
 * register their device as any of your users. Without a valid hash, the
 * device is registered with no user.
 */
export function computeUserHash(externalUserId: string, identitySecret: string): string {
  if (!identitySecret) throw new Error("computeUserHash: identity secret is required");
  return createHmac("sha256", identitySecret).update(externalUserId, "utf8").digest("hex");
}
