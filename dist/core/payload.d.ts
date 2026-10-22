import { SendInput } from "../types";
/** Email subscription topic keys: `[a-z0-9]` then up to 39 of `[a-z0-9_-]`. */
export declare const EMAIL_TOPIC_KEY: RegExp;
/** Push topic names: 1–64 of `A-Z a-z 0-9 _ . ~ -`. */
export declare const PUSH_TOPIC_NAME: RegExp;
/** RFC 3339 with a zone (or a valid Date) → the string sent. */
export declare function pushSendAt(v: unknown): string;
/** `topic` (email) and `push` (push options): where they apply and their shape. */
export declare function verifyTopicAndPush(input: SendInput): void;
export declare function verifyPayload(input: SendInput): void;
