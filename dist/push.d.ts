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

export { type DeviceKeys, type PushContent, generateDeviceKeys, isSealedPush, openPushPayload };
