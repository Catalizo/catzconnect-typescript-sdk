export { DeviceKeys, PushContent, generateDeviceKeys, isSealedPush, openPushPayload } from './push.js';

/** `Promotional` is accepted by the SMS channel only. */
type MessageType = "Verification" | "Transactional" | "Promotional" | "Notification";
/** `"Voice"` (phone call, text-to-speech) is also accepted as `"voice"`. */
type Channel = "Email" | "WhatsApp" | "Push" | "SMS" | "Voice";
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
    /** The sender identity. Ignored by the SMS and Voice channels — pass `""`. */
    identity: string;
    payload: SendPayload;
    /**
     * Language of the built-in (default) Otp/Verification templates: `en`,
     * `de`, `ja`, `ar` or `hi`. A BCP-47 tag such as `"de-DE"` is accepted
     * and sent as its primary subtag (`"de"`). Omitted → the server's default
     * (English). Panel templates are not affected. Voice `data.language`
     * still overrides the text-to-speech language; WhatsApp needs the
     * Authentication template approved in that language.
     */
    language?: string;
}
interface SendPayload {
    /**
     * An email address for Email; a phone number with country code for
     * WhatsApp; an E.164 number (`+919876543210`) for SMS and Voice.
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
     * Voice: `language` (e.g. `"en-US"`), `voice` (`"female"`, `"male"` or a
     * provider voice name), `repeat` (`"1"`–`"3"`), plus a panel template's
     * variables.
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
    /**
     * Voice: call through this phone provider (its id or label) instead of
     * routing. It must be one of the API key's call providers.
     */
    provider?: string;
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
/** `data` of a successful Voice send. The call is queued, not yet placed. */
interface VoiceSendData {
    /** UUID of the queued phone call; `voice.*` webhook events carry it. */
    message_id: string;
    [key: string]: unknown;
}
interface EnvValues {
    api_key: string;
    private_key: string;
    server_public_key: string;
}

/**
 * A refusal from the API: the HTTP status, the server's sentence, and its
 * `code` when it sent one (`plan_required`, `minutes_cap_reached`,
 * `engine_unavailable`, `too_many_participants`, `provider_not_allowed`, …).
 */
declare class CatzApiError extends Error {
    readonly status: number;
    readonly code?: string;
    readonly body: string;
    constructor(status: number, message: string, body: string, code?: string);
    /** Builds the error from a response body, reading `message` and `code` when it is JSON. */
    static from(status: number, body: string): CatzApiError;
}
declare class HttpClient {
    /**
     * POSTs an encrypted body and returns the decoded JSON. Non-2xx answers,
     * and 2xx answers with `success: false`, throw a {@link CatzApiError}.
     */
    request(path: string, body: {
        nonce: string;
        ciphertext: string;
    }, env?: EnvValues): Promise<any>;
    post(path: string, body: {
        nonce: string;
        ciphertext: string;
    }, env?: EnvValues): Promise<any>;
}

/**
 * Server-side Voice & Video calls: create a call from your backend, mint a
 * short-lived user token for the browser or app, read a call, end it.
 *
 * Every request uses the same API key, encryption and headers as `send()`.
 * The browser side lives in `catzconnect/call`.
 */
type CallMode = "audio" | "video";
type CallStatus = "ringing" | "active" | "ended" | "missed" | "declined" | "canceled" | "failed";
type ParticipantState = "invited" | "ringing" | "joined" | "left" | "declined" | "missed";
/** Most callees per call (the caller is the 50th participant). */
declare const CALL_MAX_CALLEES = 49;
/** Longest external user id. */
declare const CALL_USER_ID_MAX = 128;
/** Largest `metadata`, serialised as JSON (UTF-8 bytes). */
declare const CALL_METADATA_MAX_BYTES = 4096;
declare const CALL_TOKEN_TTL_MIN = 60;
declare const CALL_TOKEN_TTL_MAX = 86400;
interface CreateCallInput {
    /** `"audio"` or `"video"`. */
    mode: CallMode;
    /** The caller's external user id (your user id, up to 128 characters). */
    from: string;
    /** The callees' external user ids: 1–49, unique, not including `from`. */
    to: string[];
    /**
     * `"auto"` (default: the org's setting), `"catz"` (our peer-to-peer engine),
     * or a configured provider's id or label (it must be in the key's scope).
     */
    engine?: string;
    /** Ring the callees (WebSocket + push). Default true. */
    ring?: boolean;
    /** Your own JSON object, up to 4 KB; delivered with `incoming`. */
    metadata?: Record<string, unknown>;
    /** Participant cap for this call (caller included), 2–50. */
    maxParticipants?: number;
}
interface CallParticipant {
    user_id: string;
    role: "caller" | "callee";
    state: ParticipantState;
    joined_at?: string | null;
    left_at?: string | null;
    seconds?: number;
    connection?: "direct" | "relay" | "provider" | null;
}
interface CallProvider {
    /** Provider row id. */
    id: string;
    /** Its label in the panel. */
    label?: string | null;
    /** Registry name: `agora`, `livekit`, … */
    name: string;
}
interface Call {
    id: string;
    /** `"catz"` or a provider id. */
    engine: string;
    /** The configured provider when `engine` is not `catz` (null for catz). */
    provider?: CallProvider | null;
    mode: CallMode;
    status: CallStatus;
    room: string;
    participants: CallParticipant[];
    created_at: string;
    started_at?: string | null;
    ended_at?: string | null;
    duration_secs?: number | null;
    billed_minutes?: number | null;
    end_reason?: string | null;
    metadata?: Record<string, unknown> | null;
}
interface CallToken {
    /** `ct1.…` — give it to the browser/app; it never contains your API key. */
    token: string;
    expires_at: string | number;
    /** The signaling WebSocket URL to pass to `CatzCallClient({ url })`. */
    ws_url: string;
}
interface EndCallResult {
    success: boolean;
    message: string;
}
/** Throws unless `id` is a usable external user id: non-empty, ≤ 128 characters, no control characters. */
declare function validateCallUserId(id: unknown, field?: string): string;
/** The JSON body (before encryption) `calls.create` posts. Validates first, as the server does. */
declare function buildCreateCallPayload(input: CreateCallInput): Record<string, unknown>;
/** The JSON body `calls.token` posts. */
declare function buildCallTokenPayload(userId: string, ttlSeconds?: number): Record<string, unknown>;
/** `catzconnect.calls` — see {@link CreateCallInput}. */
declare class CallsApi {
    private http;
    constructor(http?: HttpClient);
    private post;
    /**
     * Creates a call and (unless `ring: false`) rings the callees. Then call
     * `calls.token(from)` and hand the token to the caller's client, which
     * joins with `client.join(call.id)`.
     */
    create(input: CreateCallInput, env?: EnvValues): Promise<Call>;
    /** Mints a user token for the browser/app client. `ttlSeconds` 60–86400, default 3600 on the server. */
    token(userId: string, ttlSeconds?: number, env?: EnvValues): Promise<CallToken>;
    /** Reads a call with its participants, duration, billed minutes and end reason. */
    get(callId: string, env?: EnvValues): Promise<Call>;
    /** Ends a call for everyone. */
    end(callId: string, reason?: string, env?: EnvValues): Promise<EndCallResult>;
}

/**
 * Phone calls (text-to-speech) through `send()` with `channel: "Voice"`.
 * These mirror the server's checks so a refused request fails before it is
 * encrypted and sent.
 */

/** Longest Custom text a phone call speaks. */
declare const VOICE_MAX_CHARS = 1000;
declare const VOICE_MAX_REPEAT = 3;
/** A BCP-47 style language tag such as `en-US`, `hi-IN`, `es-419` or `fr`. */
declare function isValidVoiceLanguage(s: string): boolean;
/** `female`, `male`, or a provider voice name such as `Polly.Joanna` or `en-US-Wavenet-F`. */
declare function isValidVoiceName(s: string): boolean;
/** Throws the server's error when a Custom text would be refused (empty, control characters, over 1,000 characters). */
declare function validateVoiceText(text: string): string;
/** `repeat` as the server reads it from `data`: a whole number 1–3. */
declare function parseVoiceRepeat(v: unknown): number;
/**
 * The server's checks for `channel: "Voice"`: an E.164 `to`; template `Otp`
 * with `otp` (up to 15 letters or digits, read out one by one), `Custom` with
 * `body` (≤ 1,000 characters), or the name of a Voice template from the
 * panel filled from `data`. `data.language` (e.g. `en-US`), `data.voice`
 * (`female`, `male` or a provider voice) and `data.repeat` (1–3) are
 * optional. `identity` is ignored.
 */
declare function verifyVoice(input: SendInput): void;

/** The languages the built-in (default) Otp/Verification templates come in. */
declare const SUPPORTED_LANGUAGES: readonly ["en", "de", "ja", "ar", "hi"];
type Language = (typeof SUPPORTED_LANGUAGES)[number];
/**
 * Normalises a `language` for `send()`: `"de"`, `"DE"`, `"de-DE"` and
 * `"de_DE"` all become `"de"` (the BCP-47 primary subtag). Throws when the
 * value is not a string or the language is not one of en, de, ja, ar, hi.
 */
declare function normaliseLanguage(value: unknown): Language;
/** `true` when {@link normaliseLanguage} accepts the value. */
declare function isValidLanguage(value: unknown): boolean;

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
    private defaultLanguage?;
    /**
     * The `language` used by every `send()` that does not set one (`en`,
     * `de`, `ja`, `ar`, `hi`, or a BCP-47 tag such as `"de-DE"`). Pass
     * `undefined` to clear it. Throws for an unsupported language.
     */
    setDefaultLanguage(language: string | undefined): void;
    /** The default set with {@link setDefaultLanguage}, normalised (`"de"`), or `undefined`. */
    getDefaultLanguage(): string | undefined;
    /** Voice & Video calls: `create`, `token`, `get`, `end`. */
    readonly calls: CallsApi;
    /** SMS resolves to `{ success, message, data: { message_id, segments, encoding } }`. */
    send(input: SendInput & {
        channel: "SMS";
    }, env?: EnvValues): Promise<SendResponse<SmsSendData>>;
    /** Voice resolves to `{ success, message, data: { message_id, … } }`. */
    send(input: SendInput & {
        channel: "Voice";
    }, env?: EnvValues): Promise<SendResponse<VoiceSendData>>;
    send(input: SendInput, env?: EnvValues): Promise<any>;
}
declare const catzconnect: CatzConnect;

export { CALL_MAX_CALLEES, CALL_METADATA_MAX_BYTES, CALL_TOKEN_TTL_MAX, CALL_TOKEN_TTL_MIN, CALL_USER_ID_MAX, type Call, type CallMode, type CallParticipant, type CallProvider, type CallStatus, type CallToken, CallsApi, CatzApiError, type Channel, type CreateCallInput, type EndCallResult, type EnvValues, type Language, type MessageType, type ParticipantState, SMS_MAX_SEGMENTS, SUPPORTED_LANGUAGES, type SendInput, type SendPayload, type SendResponse, type SmsAnalysis, type SmsEncoding, type SmsSendData, type Template, VOICE_MAX_CHARS, VOICE_MAX_REPEAT, type VoiceSendData, analyseSms, buildCallTokenPayload, buildCreateCallPayload, buildSendPayload, catzconnect, computeUserHash, isValidDltId, isValidLanguage, isValidSmsSender, isValidVoiceLanguage, isValidVoiceName, normaliseE164, normaliseLanguage, parseVoiceRepeat, validateCallUserId, validateVoiceText, verifyVoice, verifyWebhookSignature };
