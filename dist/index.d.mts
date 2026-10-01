export { DeviceKeys, PushContent, generateDeviceKeys, isSealedPush, openPushPayload } from './push.mjs';

type MessageType = "Verification" | "Transactional" | "Notification";
type Channel = "Email" | "WhatsApp" | "Push";
/**
 * The built-in templates, or the name of an email template created in the
 * panel (Email → Templates). A panel template is filled from `payload.data`.
 */
type Template = "Otp" | "Custom" | "Notification" | (string & {});
interface SendInput {
    channel: Channel;
    type: MessageType;
    template: Template;
    identity: string;
    payload: SendPayload;
}
interface SendPayload {
    /** An email address for Email; a phone number with country code for WhatsApp. */
    to?: string;
    otp?: string;
    /** Email: required. WhatsApp: optional — sent as a bold first line. */
    subject?: string;
    body?: string;
    /** Push: notification title. */
    title?: string;
    /**
     * Push: key/value pairs delivered to the app. Email with a panel template:
     * the values for its {{variables}}. Values must be strings.
     */
    data?: Record<string, string>;
    /** Push: https URL of an image to show. */
    image?: string;
    /** Push: https URL to open when the notification is tapped. */
    link?: string;
    /**
     * Push: the device's public key from `generateDeviceKeys()`. When present,
     * the notification is sealed so only that device can read it — Google,
     * Apple and CatzConnect see ciphertext.
     */
    device_key?: string;
    /**
     * Push: send to every device your app registered for this user (with
     * `POST /push/register`) instead of one token in `to`. Give one of `to`
     * or `external_user_id`. Each device's registered key is used for
     * end-to-end encryption, so `device_key` is not allowed with it.
     */
    external_user_id?: string;
}
interface EnvValues {
    api_key: string;
    private_key: string;
    server_public_key: string;
}

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
declare function verifyWebhookSignature(rawBody: string | Uint8Array, header: string | null | undefined, secret: string, toleranceSeconds?: number, nowSeconds?: number): boolean;
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
declare function computeUserHash(externalUserId: string, identitySecret: string): string;

declare class CatzConnect {
    private http;
    send(input: SendInput, env?: EnvValues): Promise<any>;
}
declare const catzconnect: CatzConnect;

export { catzconnect, computeUserHash, verifyWebhookSignature };
