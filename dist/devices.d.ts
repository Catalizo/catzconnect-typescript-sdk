export type PushPlatform = "ios" | "android" | "web";
export interface RegisterDeviceInput {
    /** The project's publishable key (`pk_push_…`, safe to ship in the app). */
    publishableKey: string;
    /** The FCM registration token. */
    token: string;
    platform: PushPlatform;
    externalUserId?: string;
    /** From your server: `computeUserHash(externalUserId, identitySecret)`. */
    userHash?: string;
    appVersion?: string;
    /** `generateDeviceKeys().publicKey`, for end-to-end encrypted push. */
    deviceKey?: string;
}
export interface PushDevicesOptions {
    /** Default: CATZCONNECT_BASE_URL or https://api.catzconnect.com. */
    baseUrl?: string;
    allowInsecureHttp?: boolean;
}
/** @internal */
export declare function checkToken(v: unknown): string;
export declare function buildRegisterDevicePayload(input: RegisterDeviceInput): Record<string, unknown>;
/**
 * Register app devices for push — `POST /push/register`, `/push/unregister`,
 * `/push/opened`. These use the project's publishable key (no API key), so
 * they can run in the app itself or on your server.
 */
export declare class PushDevicesApi {
    private options;
    constructor(options?: PushDevicesOptions);
    private post;
    /** Register or refresh a device. Resolves `{ device_id, created }`. */
    register(input: RegisterDeviceInput): Promise<{
        device_id: string;
        created: boolean;
    }>;
    /** Forget a token (sign-out, uninstall). Never fails for an unknown token. */
    unregister(publishableKey: string, deviceToken: string): Promise<{
        removed: boolean;
    }>;
    /**
     * Subscribe this registered device to push topics (1–20 names of
     * `A-Z a-z 0-9 _ . ~ -`). Fails with 404 when the token was not
     * registered first. Resolves `{ topics }`.
     */
    subscribeTopics(publishableKey: string, deviceToken: string, topics: string[]): Promise<{
        topics: string[];
    }>;
    /** Unsubscribe this registered device from push topics. */
    unsubscribeTopics(publishableKey: string, deviceToken: string, topics: string[]): Promise<{
        topics: string[];
    }>;
    /**
     * Report that a notification was opened; `messageId` is its `catz_id` data
     * field. Pass the device's FCM registration token whenever the app has it:
     * the open is then verified (only the device the notification was
     * delivered to can report it) and the first verified report fires the
     * `push.opened` webhook. Without a token the open is still recorded (as
     * in apps built before the token was sent) but no webhook fires.
     * Resolves `{ recorded, verified }`.
     */
    opened(publishableKey: string, messageId: string, deviceToken?: string): Promise<{
        recorded: boolean;
        verified?: boolean;
    }>;
}
/** 1–20 push topic names. */
export declare function pushTopics(v: unknown, max?: number): string[];
/** @internal */
export declare function pushTopic(t: unknown): string;
