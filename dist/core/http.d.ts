import { EnvValues } from "../types";
/**
 * A refusal from the API: the HTTP status, the server's sentence, and its
 * `code` when it sent one (`plan_required`, `minutes_cap_reached`,
 * `engine_unavailable`, `too_many_participants`, `provider_not_allowed`, …).
 */
export declare class CatzApiError extends Error {
    readonly status: number;
    readonly code?: string;
    readonly body: string;
    /**
     * The JSON refusal when the body was JSON (`{success, message, code, …}`),
     * with extra fields such as `attempts_remaining` (otp_invalid) or
     * `retry_after` (otp_resend_cooldown).
     */
    readonly details?: Record<string, unknown>;
    constructor(status: number, message: string, body: string, code?: string);
    /** Builds the error from a response body, reading `message` and `code` when it is JSON. */
    static from(status: number, body: string): CatzApiError;
}
/**
 * Checks an API base URL: `https://` always; plain `http://` (or `ws://` for
 * the call signaling URL) only for localhost / 127.0.0.1 / ::1 / 10.0.2.2,
 * or when `allowInsecure` is set. Returns the URL without trailing slashes;
 * throws otherwise, so an API key is never sent in clear text by mistake.
 */
export declare function checkBaseUrl(raw: string, allowInsecure?: boolean, what?: string): string;
/** `CATZCONNECT_ALLOW_INSECURE_HTTP` set to 1/true/yes. */
export declare function insecureHttpFromEnv(): boolean;
/** The API used when `CATZCONNECT_BASE_URL` is unset or blank. */
export declare const DEFAULT_BASE_URL = "https://api.catzconnect.com";
/**
 * `CATZCONNECT_BASE_URL`, or {@link DEFAULT_BASE_URL} when it is unset or
 * blank (an empty line in a `.env` file means "not set", as in the Go and
 * Dart SDKs — it used to fail as an invalid URL).
 */
export declare function baseUrlFromEnv(): string;
export declare class HttpClient {
    /** Allow a plain-http `CATZCONNECT_BASE_URL` to a non-local host (also `CATZCONNECT_ALLOW_INSECURE_HTTP=1`). */
    allowInsecureHttp: boolean;
    private baseUrl;
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
    }, env?: EnvValues, extraHeaders?: Record<string, string>): Promise<any>;
}
/**
 * POSTs plain JSON with no API key (the public push device endpoints, which
 * authenticate with the project's publishable key). Same error handling as
 * {@link HttpClient.request}.
 */
export declare function postPublic(path: string, body: Record<string, unknown>, baseUrl?: string, allowInsecure?: boolean): Promise<any>;
