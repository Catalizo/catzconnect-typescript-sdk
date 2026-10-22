import { HttpClient } from "./core/http";
import { EnvValues, WhatsAppOptions } from "./types";
/**
 * Machine codes the API sends in `code` (on `CatzApiError.code`). Branch on
 * these rather than on the human sentence, which is translated.
 */
export declare const ErrorCodes: {
    readonly ORGANIZATION_SUSPENDED: "organization_suspended";
    readonly SENDING_PAUSED: "sending_paused";
    readonly FEATURE_NOT_IN_PLAN: "feature_not_in_plan";
    readonly PLAN_REQUIRED: "plan_required";
    readonly CHANNEL_LIMIT_REACHED: "channel_limit_reached";
    readonly DAILY_LIMIT_REACHED: "daily_limit_reached";
    readonly MONTHLY_LIMIT_REACHED: "monthly_limit_reached";
    readonly MINUTES_CAP_REACHED: "minutes_cap_reached";
    readonly KEY_EXPIRED: "key_expired";
    readonly IP_NOT_ALLOWED: "ip_not_allowed";
    readonly KEY_RATE_LIMITED: "key_rate_limited";
    readonly KEY_SEND_LIMIT: "key_send_limit";
    readonly NOT_ALLOWED_FOR_APP_KEYS: "not_allowed_for_app_keys";
    readonly NOT_ALLOWED_FOR_TEST_KEYS: "not_allowed_for_test_keys";
    readonly MANAGEMENT_SCOPE_REQUIRED: "management_scope_required";
    readonly WHATSAPP_INVALID_TEMPLATE: "whatsapp_invalid_template";
    readonly WHATSAPP_TEMPLATE_NOT_APPROVED: "whatsapp_template_not_approved";
    readonly WHATSAPP_TEMPLATE_LANGUAGE_REQUIRED: "whatsapp_template_language_required";
    readonly WHATSAPP_INVALID_TEMPLATE_PARAMS: "whatsapp_invalid_template_params";
    readonly WHATSAPP_INVALID_MEDIA: "whatsapp_invalid_media";
    readonly WHATSAPP_WINDOW_CLOSED: "whatsapp_window_closed";
    readonly IDEMPOTENCY_CONFLICT: "idempotency_conflict";
    readonly IDEMPOTENCY_IN_PROGRESS: "idempotency_in_progress";
    readonly INVALID_IDEMPOTENCY_KEY: "invalid_idempotency_key";
    readonly INVALID_REFERENCE: "invalid_reference";
    readonly MESSAGE_NOT_FOUND: "message_not_found";
    readonly OTP_INVALID: "otp_invalid";
    readonly OTP_EXPIRED: "otp_expired";
    readonly OTP_NOT_FOUND: "otp_not_found";
    readonly OTP_ALREADY_VERIFIED: "otp_already_verified";
    readonly OTP_ATTEMPTS_EXCEEDED: "otp_attempts_exceeded";
    readonly OTP_RESEND_COOLDOWN: "otp_resend_cooldown";
    readonly OTP_SEND_LIMIT: "otp_send_limit";
    readonly UNSUPPORTED_CHANNEL: "unsupported_channel";
    readonly UNKNOWN_OPERATION: "unknown_operation";
    readonly INVALID_REQUEST: "invalid_request";
    readonly NOT_FOUND: "not_found";
    readonly CONFLICT: "conflict";
    readonly INVALID_TOPIC: "invalid_topic";
    readonly TOPIC_EMAIL_ONLY: "topic_email_only";
    readonly RECIPIENT_SUPPRESSED: "recipient_suppressed";
    readonly WHATSAPP_OPTED_OUT: "whatsapp_opted_out";
    readonly NOT_CANCELABLE: "not_cancelable";
    readonly NOT_RESENDABLE: "not_resendable";
    readonly CONTENT_GONE: "content_gone";
};
export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];
/** True for refusals worth retrying later with the same request. */
export declare function isRetryableCode(code: string | undefined): boolean;
/** `reference` on send / otp.start: up to 128 characters, no control characters. */
export declare function validateReference(v: unknown): string | undefined;
/** An Idempotency-Key: 1–255 visible ASCII characters, no spaces. */
export declare function validateIdempotencyKey(v: unknown): string | undefined;
export type MessageChannel = "email" | "sms" | "whatsapp" | "push" | "voice";
/**
 * Normalised status: queued, deferred, sending, sent, delivered, read,
 * ringing, answered, completed, failed, undelivered, suppressed, bounced,
 * complained, unknown.
 */
export type MessageStatusName = "queued" | "deferred" | "sending" | "sent" | "delivered" | "read" | "ringing" | "answered" | "completed" | "failed" | "undelivered" | "suppressed" | "bounced" | "complained" | "unknown";
export interface MessageEvent {
    type: string;
    at: string;
    detail?: string;
}
export interface MessageStatus {
    message_id: string;
    channel: MessageChannel;
    status: MessageStatusName | string;
    /** The channel's own word (`Sent`, `Accepted`, `NoAnswer`…). */
    provider_status: string;
    /** Email or phone in full; push tokens only by their last 8 characters. */
    to: string;
    template: string | null;
    reference: string | null;
    key_id: string | null;
    /** Sent with a test (sandbox) key. */
    test: boolean;
    error: string | null;
    created_at: string;
    updated_at: string;
    /** Push: the broadcast / topic / scheduled send it was part of. */
    broadcast_id?: string;
    /** Resent from the panel: the original message's id (the original's timeline has a `resent` event). */
    resent_from?: string;
    /** Present on `messages.get`, oldest first. */
    events?: MessageEvent[];
}
export interface ListMessagesInput {
    recipient?: string;
    reference?: string;
    /** The deliveries of one push broadcast (`data.broadcast_id` of a send with `push`). */
    broadcastId?: string;
    channel?: MessageChannel;
    /** 1–100, default 20. */
    limit?: number;
    /** The previous page's `next_before`. */
    before?: string;
}
export declare function buildListMessagesPayload(input: ListMessagesInput): Record<string, unknown>;
/** `catzconnect.messages` — status and history of sent messages. */
export declare class MessagesApi {
    private http;
    constructor(http?: HttpClient);
    /** One message by the `message_id` a send returned, with its event timeline. */
    get(messageId: string, env?: EnvValues): Promise<MessageStatus>;
    /** Recent messages to a recipient and/or with a `reference`, newest first. */
    list(input: ListMessagesInput, env?: EnvValues): Promise<{
        messages: MessageStatus[];
        next_before: string | null;
    }>;
}
export type OtpChannel = "Email" | "SMS" | "WhatsApp" | "Voice";
export interface OtpStartInput {
    channel: OtpChannel | Lowercase<OtpChannel>;
    to: string;
    /** Sending mailbox (Email) or number (WhatsApp); not used by SMS / Voice. */
    identity?: string;
    /** `Otp` (default) or one of your templates; `{{otp}}` is the code. */
    template?: string;
    language?: string;
    /** 4–10 digits (6). */
    codeLength?: number;
    /** 60–3600 s (600). */
    ttlSeconds?: number;
    /** 1–10 wrong codes allowed (5). */
    maxAttempts?: number;
    /** 10–3600 s between sends to one person (30). */
    resendCooldownSeconds?: number;
    gateway?: string;
    sender?: string;
    dltTemplateId?: string;
    provider?: string;
    whatsapp?: WhatsAppOptions;
    /** Extra template variables. */
    data?: Record<string, string>;
    reference?: string;
}
export interface OtpStartResult {
    verification_id: string;
    channel: string;
    to: string;
    status: "pending";
    expires_at: string;
    resend_available_at: string;
    attempts_remaining: number;
    sends_remaining: number;
    message_id: string | null;
    test: boolean;
    /** Test keys only: the code, since nothing is delivered. */
    code?: string;
}
export interface OtpVerifyInput {
    verificationId?: string;
    channel?: OtpChannel | Lowercase<OtpChannel>;
    to?: string;
    code: string;
}
export interface OtpVerifyResult {
    verified: true;
    verification_id: string;
    verified_at: string;
    test: boolean;
}
export declare function buildOtpStartPayload(input: OtpStartInput): Record<string, unknown>;
export declare function buildOtpVerifyPayload(input: OtpVerifyInput): Record<string, unknown>;
/**
 * `catzconnect.otp` — hosted one-time codes: the server makes the code,
 * sends it and checks it. Refusals are `CatzApiError` with `code`
 * `otp_invalid` (`details.attempts_remaining`), `otp_expired`,
 * `otp_attempts_exceeded`, `otp_resend_cooldown` (`details.retry_after`),
 * `otp_send_limit`, `otp_not_found`, `otp_already_verified`.
 */
export declare class OtpApi {
    private http;
    constructor(http?: HttpClient);
    /** Send a code (again: a resend replaces the code, after the cooldown). */
    start(input: OtpStartInput, env?: EnvValues): Promise<OtpStartResult>;
    /** Check a code. Resolves only when it is correct. */
    verify(input: OtpVerifyInput, env?: EnvValues): Promise<OtpVerifyResult>;
}
export interface TemplateInput {
    id?: string;
    name: string;
    channel?: "Email" | "SMS" | "Voice";
    subject?: string;
    body: string;
    dlt_template_id?: string;
}
export interface WebhookInput {
    id?: string;
    url: string;
    events: string[];
    description?: string;
    key_id?: string;
    is_enabled?: boolean;
    rotate_secret?: boolean;
}
export interface KeyPolicy {
    expires_at?: string | null;
    ip_allowlist?: string[];
    rate_per_minute?: number | null;
    sends_per_hour?: number | null;
}
export interface CreateKeyInput {
    name: string;
    /** `server` (default) or `test` (sandbox). */
    kind?: "server" | "test";
    /** Channel names (`Email`, `SMS`, `WhatsApp`, `Push`, `Voice`, `Calls`) or use `channel_ids`. */
    channels?: string[];
    channel_ids?: string[];
    user_ids?: string[];
    whatsapp_account_ids?: string[];
    push_project_ids?: string[];
    sms_gateway_ids?: string[];
    call_provider_ids?: string[];
    policy?: KeyPolicy;
}
/** The secrets of a created or rotated key: shown only in this answer. */
export interface CreatedKey {
    id: string;
    name: string;
    kind?: string;
    api_key: string;
    /** Set on create, and on rotate with `rotateEte`. */
    private_key?: string;
    server_public_key?: string;
    api_key_short: string;
}
/**
 * One suppression list per channel: `email` (address), `sms` / `whatsapp` /
 * `voice` (E.164 number), `push` (your app's `external_user_id`).
 */
export type SuppressionChannel = "email" | "sms" | "whatsapp" | "voice" | "push" | (string & {});
export interface Suppression {
    id: string;
    channel: SuppressionChannel;
    /** Email: the subscription topic it is limited to; `null` = every topic. */
    topic: string | null;
    /** `(erased)` for a person erased under GDPR (still suppressed). */
    address: string;
    reason: string;
    detail: string | null;
    expires_at: string | null;
    permanent: boolean;
    created_at: string;
}
export interface SuppressionAddOptions {
    detail?: string;
    /** Email only: suppress just this subscription topic. */
    topic?: string;
}
export interface SuppressionRemoveInput {
    /** The entry's id (from `list`), or `channel` + `address`. */
    id?: string;
    address?: string;
    /** Needed for numbers and user ids (they exist on several channels). */
    channel?: SuppressionChannel;
    /** Email: only this topic's entry; default every entry of the address on the channel. */
    topic?: string;
}
/**
 * `catzconnect.manage` — templates, webhooks, suppressions and API keys of
 * your organization. Needs a live server key with the management scope
 * (panel → API keys) on a plan with the management API.
 */
export declare class ManageApi {
    private http;
    constructor(http?: HttpClient);
    private call;
    readonly templates: {
        list: (channel?: "Email" | "SMS" | "Voice", env?: EnvValues) => Promise<any>;
        get: (idOrName: {
            id?: string;
            name?: string;
            channel?: string;
        }, env?: EnvValues) => Promise<any>;
        save: (t: TemplateInput, env?: EnvValues) => Promise<any>;
        delete: (id: string, env?: EnvValues) => Promise<any>;
        /** A language version (`de`, `pt-BR`) of a template. */
        saveVariant: (v: {
            template_id: string;
            language: string;
            subject?: string;
            body: string;
            dlt_template_id?: string;
        }, env?: EnvValues) => Promise<any>;
        deleteVariant: (templateId: string, language: string, env?: EnvValues) => Promise<any>;
    };
    readonly webhooks: {
        list: (env?: EnvValues) => Promise<any>;
        /** Create (no `id`; the answer has the signing `secret`, once) or update. */
        save: (w: WebhookInput, env?: EnvValues) => Promise<any>;
        delete: (id: string, env?: EnvValues) => Promise<any>;
    };
    readonly suppressions: {
        list: (q?: {
            channel?: SuppressionChannel;
            topic?: string;
            q?: string;
            limit?: number;
            offset?: number;
        }, env?: EnvValues) => Promise<{
            suppressions: Suppression[];
            total: number;
        }>;
        /** `detail` as a string, or `{ detail?, topic? }` (topic: email only). */
        add: (channel: SuppressionChannel, address: string, options?: string | SuppressionAddOptions, env?: EnvValues) => Promise<any>;
        /** `remove("a@b.co")`, `remove("+15550100", "sms")` or `remove({ id })` / `remove({ channel, address, topic })`. */
        remove: (target: string | SuppressionRemoveInput, channel?: SuppressionChannel, env?: EnvValues) => Promise<any>;
    };
    readonly keys: {
        list: (env?: EnvValues) => Promise<any>;
        create: (k: CreateKeyInput, env?: EnvValues) => Promise<CreatedKey>;
        rotate: (id: string, rotateEte?: boolean, env?: EnvValues) => Promise<CreatedKey>;
        revoke: (id: string, env?: EnvValues) => Promise<any>;
        /** Replaces the whole policy (omitted fields are cleared). */
        setPolicy: (id: string, policy: KeyPolicy, env?: EnvValues) => Promise<any>;
    };
}
export { PushDevicesApi, buildRegisterDevicePayload, pushTopics } from "./devices";
export type { PushPlatform, RegisterDeviceInput, PushDevicesOptions } from "./devices";
export interface PushBroadcast {
    id: string;
    push_project_id: string;
    project_label: string;
    firebase_project: string;
    key_id: string | null;
    audience: "all" | "topic" | "token" | "user";
    topic: string | null;
    external_user_id: string | null;
    title_hint: string | null;
    send_at: string;
    /** scheduled → dispatching → completed | canceled | failed */
    status: "scheduled" | "dispatching" | "completed" | "canceled" | "failed" | (string & {});
    queued: number;
    skipped: number;
    over_quota: number;
    error: string | null;
    error_code: string | null;
    started_at: string | null;
    completed_at: string | null;
    canceled_at: string | null;
    created_at: string;
}
export interface PushTopicChangeInput {
    /** The Firebase project id (the send's `identity`). */
    identity: string;
    topic: string;
    /** FCM tokens of devices registered with `/push/register` (≤ 1000). */
    tokens?: string[];
    /** Or every registered device of this user. */
    externalUserId?: string;
}
export declare function buildPushTopicChangePayload(input: PushTopicChangeInput): Record<string, unknown>;
/**
 * `catzconnect.push` — broadcasts / scheduled pushes created by `send()`
 * with `payload.push`, and push topic subscriptions, from your server
 * (server key with the Push channel; app and test keys are refused).
 */
export declare class PushApi {
    private http;
    constructor(http?: HttpClient);
    /** Status and counters of a broadcast or scheduled push. */
    broadcast(broadcastId: string, env?: EnvValues): Promise<PushBroadcast>;
    /** Stop one that has not finished (`not_cancelable` once it has). Devices already queued still get it. */
    cancel(broadcastId: string, env?: EnvValues): Promise<{
        broadcast_id: string;
        status: "canceled";
    }>;
    /** Subscribe registered devices to a topic. Resolves `{ topic, devices }` (devices matched). */
    subscribe(input: PushTopicChangeInput, env?: EnvValues): Promise<{
        topic: string;
        devices: number;
    }>;
    unsubscribe(input: PushTopicChangeInput, env?: EnvValues): Promise<{
        topic: string;
        devices: number;
    }>;
    /** A project's topics with their subscribed devices. */
    topics(identity: string, env?: EnvValues): Promise<{
        topics: {
            topic: string;
            devices: number;
            last_subscribed_at: string;
        }[];
    }>;
}
