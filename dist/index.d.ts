type MessageType = "Verification" | "Transactional" | "Notification";
type Channel = "Email" | "WhatsApp" | "Push";
type Template = "Otp" | "Custom" | "Notification";
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
    /** Push: key/value pairs delivered to the app. Values must be strings. */
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
}
interface EnvValues {
    api_key: string;
    private_key: string;
    server_public_key: string;
}

interface DeviceKeys {
    /** Send this to your backend with the FCM token; pass it as `device_key`. */
    publicKey: string;
    /** Keep this on the device only — secure storage, never your server. */
    privateKey: string;
}
/**
 * Generate this device's keypair. Do it once, store the private key in the
 * platform's secure storage, and send the public key to your backend along
 * with the FCM token.
 */
declare function generateDeviceKeys(): Promise<DeviceKeys>;
interface PushContent {
    title?: string;
    body: string;
    data: Record<string, string>;
    image?: string;
    link?: string;
}
/**
 * True when an FCM data message came from CatzConnect with sealed content.
 * Pass it the message's `data` object.
 */
declare function isSealedPush(data: Record<string, string> | undefined): boolean;
/**
 * Open a sealed notification. Pass the message's `data` object and this
 * device's keys; returns the readable title, body, data, image and link.
 *
 * Throws if the message was sealed to a different device — for example after
 * the app was reinstalled and generated new keys without telling the backend.
 */
declare function openPushPayload(data: Record<string, string>, keys: DeviceKeys): Promise<PushContent>;

declare class CatzConnect {
    private http;
    send(input: SendInput, env?: EnvValues): Promise<any>;
}
declare const catzconnect: CatzConnect;

export { type DeviceKeys, type PushContent, catzconnect, generateDeviceKeys, isSealedPush, openPushPayload };
