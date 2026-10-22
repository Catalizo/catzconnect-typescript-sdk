import { EnvValues, SendInput, SendResponse, SmsSendData, VoiceSendData } from "./types";
import { CallsApi } from "./calls";
import { ManageApi, MessagesApi, OtpApi, PushApi, PushDevicesApi } from "./devapi";
/**
 * The JSON body (before encryption) that `send` posts to `/sdk/send` for a
 * validated input. SMS sends only its own fields; the other channels pass
 * the payload through as they always have.
 */
export declare function buildSendPayload(input: SendInput): Record<string, unknown>;
declare class CatzConnect {
    private http;
    private defaultLanguage?;
    /**
     * The `language` used by every `send()` that does not set one (`en`,
     * `de`, `ja`, `ar`, `hi`, or a BCP-47 tag such as `"de-DE"`). Pass
     * `undefined` to clear it. Throws for an unsupported language.
     */
    setDefaultLanguage(language: string | undefined): void;
    /**
     * Allow a plain `http://` `CATZCONNECT_BASE_URL` to a host other than
     * localhost / 127.0.0.1 / ::1 / 10.0.2.2 (same as
     * `CATZCONNECT_ALLOW_INSECURE_HTTP=1`). Default false: such a URL throws,
     * since the API key would be sent unencrypted.
     */
    setAllowInsecureHttp(allow: boolean): void;
    /** The default set with {@link setDefaultLanguage}, normalised (`"de"`), or `undefined`. */
    getDefaultLanguage(): string | undefined;
    /** Voice & Video calls: `create`, `token`, `get`, `end`. */
    readonly calls: CallsApi;
    /** Status and event timeline of sent messages: `get`, `list`. */
    readonly messages: MessagesApi;
    /** Hosted one-time codes: `start`, `verify`. */
    readonly otp: OtpApi;
    /** Management API (key with the management scope): templates, webhooks, suppressions, keys. */
    readonly manage: ManageApi;
    /** Push device registry with the publishable key: `register`, `unregister`, `opened`, `subscribeTopics`, `unsubscribeTopics`. */
    readonly pushDevices: PushDevicesApi;
    /** Push broadcasts / scheduled pushes and topic subscriptions (server key): `broadcast`, `cancel`, `subscribe`, `unsubscribe`, `topics`. */
    readonly push: PushApi;
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
export declare const catzconnect: CatzConnect;
export type { Channel, EnvValues, PushOptions, SendData, TrackingOverride, WhatsAppButton, WhatsAppHeader, WhatsAppMedia, WhatsAppOptions, MessageType, SendInput, SendPayload, SendResponse, SmsSendData, Template, VoiceSendData, } from "./types";
export { CallsApi, buildCreateCallPayload, buildCallTokenPayload, validateCallUserId, CALL_MAX_CALLEES, CALL_USER_ID_MAX, CALL_METADATA_MAX_BYTES, CALL_TOKEN_TTL_MIN, CALL_TOKEN_TTL_MAX, } from "./calls";
export type { Call, CallMode, CallParticipant, CallProvider, CallStatus, CallToken, CreateCallInput, EndCallResult, ParticipantState, } from "./calls";
export { CatzApiError, checkBaseUrl } from "./core/http";
export { verifyVoice, validateVoiceText, isValidVoiceLanguage, isValidVoiceName, parseVoiceRepeat, VOICE_MAX_CHARS, VOICE_MAX_REPEAT, } from "./utils/voice";
export { normaliseLanguage, isValidLanguage, SUPPORTED_LANGUAGES } from "./utils/language";
export type { Language } from "./utils/language";
export { analyseSms, normaliseE164, isValidSmsSender, isValidDltId, SMS_MAX_SEGMENTS, } from "./utils/sms";
export type { SmsAnalysis, SmsEncoding } from "./utils/sms";
export { verifyWebhookSignature } from "./core/webhook";
export { computeUserHash } from "./core/webhook";
export { generateDeviceKeys, openPushPayload, isSealedPush } from "./push";
export type { DeviceKeys, PushContent } from "./push";
export { ErrorCodes, isRetryableCode, MessagesApi, OtpApi, ManageApi, PushDevicesApi, PushApi, buildPushTopicChangePayload, pushTopics, buildListMessagesPayload, buildOtpStartPayload, buildOtpVerifyPayload, buildRegisterDevicePayload, validateReference, validateIdempotencyKey, } from "./devapi";
export type { ErrorCode, MessageChannel, MessageEvent, MessageStatus, MessageStatusName, ListMessagesInput, OtpChannel, OtpStartInput, OtpStartResult, OtpVerifyInput, OtpVerifyResult, TemplateInput, WebhookInput, KeyPolicy, CreateKeyInput, CreatedKey, SuppressionChannel, Suppression, SuppressionAddOptions, SuppressionRemoveInput, PushBroadcast, PushTopicChangeInput, PushPlatform, RegisterDeviceInput, PushDevicesOptions, } from "./devapi";
export { verifyWhatsAppOptions, verifyWhatsAppMedia, WHATSAPP_TEMPLATE_NAME } from "./utils/whatsapp";
export { WEBHOOK_EVENTS, parseWebhookEvent } from "./core/webhook";
export type { WebhookEvent, WebhookEventType } from "./core/webhook";
