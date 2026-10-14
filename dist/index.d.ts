export { DeviceKeys, PushContent, generateDeviceKeys, isSealedPush, openPushPayload } from './push.js';

/** `Promotional` is accepted by the SMS channel only. */
type MessageType = "Verification" | "Transactional" | "Promotional" | "Notification";
type Channel = "Email" | "WhatsApp" | "Push" | "SMS";
/**
 * The built-in templates, or the name of a template created in the panel
 * (Email → Templates, or an SMS template for the SMS channel). A panel
 * template is filled from `payload.data`.
 */
type Template = "Otp" | "Custom" | "Notification" | (string & {});
interface SendInput {
    channel: Channel;
    type: MessageType;
    template: Template;
    /** The sender identity. Ignored by the SMS channel — pass `""`. */
    identity: string;
    payload: SendPayload;
}
interface SendPayload {
    /**
     * An email address for Email; a phone number with country code for
     * WhatsApp; an E.164 number (`+919876543210`) for SMS.
     */
    to?: string;
    otp?: string;
    /** Email: required. WhatsApp: optional — sent as a bold first line. */
    subject?: string;
    body?: string;
    /** Push: notification title. */
    title?: string;
    /**
     * Push: key/value pairs delivered to the app. Email or SMS with a panel
     * template: the values for its {{variables}}. Values must be strings.
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
    /**
     * SMS: send through this gateway (its id or label) instead of routing. It
     * must be one of the API key's SMS gateways.
     */
    gateway?: string;
    /**
     * SMS: sender override — an E.164 number or a 2–11 character sender ID.
     * Only together with `gateway`, and only when that gateway allows it.
     */
    sender?: string;
    /**
     * SMS: India DLT content template id (digits) for Custom bodies and the
     * default OTP text. Required for +91 numbers unless the panel template
     * carries one.
     */
    dlt_template_id?: string;
}
/** The server's answer: `{ success, message, data }`. */
interface SendResponse<T = unknown> {
    success: boolean;
    message: string;
    data: T;
}
/** `data` of a successful SMS send. The message is queued, not yet delivered. */
interface SmsSendData {
    /**
     * UUID of the queued message; webhook events (`sms.sent`, `sms.delivered`, `sms.failed`,
     * `sms.unknown` — the provider was called but did not answer, so it is not resent) carry it.
     */
    message_id: string;
    /** Billable parts. */
    segments: number;
    encoding: "gsm7" | "ucs2";
}
interface EnvValues {
    api_key: string;
    private_key: string;
    server_public_key: string;
}

/**
 * SMS helpers that mirror the server's checks for `channel: "SMS"`, so a
 * request the server would refuse fails before it is encrypted and sent.
 */
/** Longest body the server accepts, in segments (~1,530 GSM-7 / ~670 UCS-2 characters). */
declare const SMS_MAX_SEGMENTS = 10;
type SmsEncoding = "gsm7" | "ucs2";
interface SmsAnalysis {
    encoding: SmsEncoding;
    /** Septets (GSM-7) or UTF-16 code units (UCS-2). */
    units: number;
    /** Billable parts. */
    segments: number;
    /** Characters as a person would count them. */
    chars: number;
}
/**
 * Normalises a phone number to E.164 the way the server does: spaces,
 * dashes, dots and brackets are removed; the result must be `+` and 8–15
 * digits, not starting with 0. Returns `null` when it is not E.164.
 */
declare function normaliseE164(raw: string): string | null;
/** A sender override: an E.164 number, or a 2–11 character alphanumeric sender ID. */
declare function isValidSmsSender(s: string): boolean;
/** An India DLT template id: 6–30 digits. */
declare function isValidDltId(s: string): boolean;
/**
 * How the server will encode `text` and how many segments it takes: GSM-7
 * when every character is in the GSM alphabet (extension characters cost
 * two), otherwise UCS-2. 160/153 septets or 70/67 code units per part.
 */
declare function analyseSms(text: string): SmsAnalysis;

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

/**
 * The JSON body (before encryption) that `send` posts to `/sdk/send` for a
 * validated input. SMS sends only its own fields; the other channels pass
 * the payload through as they always have.
 */
declare function buildSendPayload(input: SendInput): Record<string, unknown>;
declare class CatzConnect {
    private http;
    /** SMS resolves to `{ success, message, data: { message_id, segments, encoding } }`. */
    send(input: SendInput & {
        channel: "SMS";
    }, env?: EnvValues): Promise<SendResponse<SmsSendData>>;
    send(input: SendInput, env?: EnvValues): Promise<any>;
}
declare const catzconnect: CatzConnect;

export { type Channel, type EnvValues, type MessageType, SMS_MAX_SEGMENTS, type SendInput, type SendPayload, type SendResponse, type SmsAnalysis, type SmsEncoding, type SmsSendData, type Template, analyseSms, buildSendPayload, catzconnect, computeUserHash, isValidDltId, isValidSmsSender, normaliseE164, verifyWebhookSignature };
