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
export declare function verifyWebhookSignature(rawBody: string | Uint8Array, header: string | null | undefined, secret: string, toleranceSeconds?: number, nowSeconds?: number): boolean;
/** Every event a webhook can subscribe to. */
export declare const WEBHOOK_EVENTS: readonly ["email.sent", "email.failed", "email.bounced", "email.opened", "email.clicked", "email.received", "whatsapp.status", "whatsapp.inbound", "whatsapp.read", "push.sent", "push.failed", "sms.sent", "sms.delivered", "sms.failed", "sms.unknown", "call.ringing", "call.started", "call.ended", "call.missed", "call.declined", "call.canceled", "call.failed", "participant.joined", "participant.left", "voice.answered", "voice.completed", "voice.failed", "voice.unknown", "email.complained", "email.unsubscribed", "push.opened", "sms.inbound", "sms.opt_out", "whatsapp.opt_out"];
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
export declare function parseWebhookEvent<D = Record<string, unknown>>(rawBody: string | Uint8Array, header: string | null | undefined, secret: string, toleranceSeconds?: number, nowSeconds?: number): WebhookEvent<D>;
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
export declare function computeUserHash(externalUserId: string, identitySecret: string): string;
