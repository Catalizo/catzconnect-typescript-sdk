import { EnvValues } from "../types";

/**
 * A refusal from the API: the HTTP status, the server's sentence, and its
 * `code` when it sent one (`plan_required`, `minutes_cap_reached`,
 * `engine_unavailable`, `too_many_participants`, `provider_not_allowed`, …).
 */
export class CatzApiError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly body: string;
  /**
   * The JSON refusal when the body was JSON (`{success, message, code, …}`),
   * with extra fields such as `attempts_remaining` (otp_invalid) or
   * `retry_after` (otp_resend_cooldown).
   */
  readonly details?: Record<string, unknown>;

  constructor(status: number, message: string, body: string, code?: string) {
    super(message);
    this.name = "CatzApiError";
    this.status = status;
    this.code = code;
    this.body = body;
    try {
      const j = JSON.parse(body);
      if (j && typeof j === "object" && !Array.isArray(j)) this.details = j;
    } catch {
      // not JSON
    }
  }

  /** Builds the error from a response body, reading `message` and `code` when it is JSON. */
  static from(status: number, body: string): CatzApiError {
    let message = `HTTP ${status}: ${body}`;
    let code: string | undefined;
    try {
      const j = JSON.parse(body);
      if (j && typeof j === "object") {
        if (typeof j.message === "string" && j.message !== "") message = j.message;
        if (typeof j.code === "string" && j.code !== "") code = j.code;
      }
    } catch {
      // not JSON: keep the raw text
    }
    return new CatzApiError(status, message, body, code);
  }
}

/** Hosts that never leave the machine (10.0.2.2 is the Android emulator's host). */
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]", "10.0.2.2"]);

/**
 * Checks an API base URL: `https://` always; plain `http://` (or `ws://` for
 * the call signaling URL) only for localhost / 127.0.0.1 / ::1 / 10.0.2.2,
 * or when `allowInsecure` is set. Returns the URL without trailing slashes;
 * throws otherwise, so an API key is never sent in clear text by mistake.
 */
export function checkBaseUrl(raw: string, allowInsecure = false, what = "CATZCONNECT_BASE_URL"): string {
  const url = raw.trim().replace(/\/+$/, "");
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw new Error(`${what} is not a valid URL: ${JSON.stringify(url)}`);
  }
  const scheme = u.protocol.toLowerCase();
  if (scheme === "https:" || scheme === "wss:") return url;
  if (scheme !== "http:" && scheme !== "ws:") {
    throw new Error(`${what} must start with https:// (got ${JSON.stringify(u.protocol)})`);
  }
  if (allowInsecure || LOCAL_HOSTS.has(u.hostname.toLowerCase())) return url;
  throw new Error(
    `${what} uses plain ${scheme.slice(0, -1)}:// to ${u.hostname}: the API key and tokens would travel unencrypted. ` +
      `Use https://, or set CATZCONNECT_ALLOW_INSECURE_HTTP=1 / catzconnect.setAllowInsecureHttp(true) to allow it anyway.`,
  );
}

/** `CATZCONNECT_ALLOW_INSECURE_HTTP` set to 1/true/yes. */
export function insecureHttpFromEnv(): boolean {
  const v = (typeof process !== "undefined" ? process.env?.CATZCONNECT_ALLOW_INSECURE_HTTP : undefined) ?? "";
  return ["1", "true", "yes"].includes(v.trim().toLowerCase());
}

/** The API used when `CATZCONNECT_BASE_URL` is unset or blank. */
export const DEFAULT_BASE_URL = "https://api.catzconnect.com";

/**
 * `CATZCONNECT_BASE_URL`, or {@link DEFAULT_BASE_URL} when it is unset or
 * blank (an empty line in a `.env` file means "not set", as in the Go and
 * Dart SDKs — it used to fail as an invalid URL).
 */
export function baseUrlFromEnv(): string {
  const v = (typeof process !== "undefined" ? process.env?.CATZCONNECT_BASE_URL : undefined) ?? "";
  return v.trim() === "" ? DEFAULT_BASE_URL : v;
}

export class HttpClient {
  /** Allow a plain-http `CATZCONNECT_BASE_URL` to a non-local host (also `CATZCONNECT_ALLOW_INSECURE_HTTP=1`). */
  allowInsecureHttp = false;

  private baseUrl(): string {
    return checkBaseUrl(baseUrlFromEnv(), this.allowInsecureHttp || insecureHttpFromEnv());
  }

  /**
   * POSTs an encrypted body and returns the decoded JSON. Non-2xx answers,
   * and 2xx answers with `success: false`, throw a {@link CatzApiError}.
   */
  async request(
    path: string,
    body: { nonce: string; ciphertext: string },
    env?: EnvValues,
  ): Promise<any> {
    const baseURL = this.baseUrl();
    const apiKey = (env ? env.api_key : process.env.CATZCONNECT_API_KEY)?.trim();
    if (!apiKey) {
      throw new Error("Missing API key in environment");
    }

    const res = await fetch(`${baseURL}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    });

    const text = await res.text();
    if (!res.ok) {
      throw CatzApiError.from(res.status, text);
    }
    let json: any;
    try {
      json = JSON.parse(text);
    } catch {
      throw new CatzApiError(res.status, `The server sent a response that is not JSON: ${text.slice(0, 200)}`, text);
    }
    if (json && typeof json === "object" && json.success === false) {
      throw CatzApiError.from(res.status, text);
    }
    return json;
  }

  async post(
    path: string,
    body: {
      nonce: string;
      ciphertext: string;
    },
    env?: EnvValues,
    extraHeaders: Record<string, string> = {},
  ) {
    // A trailing slash would produce //sdk/send; a key from a .env file may end in a newline.
    const baseURL = this.baseUrl();

    const apiKey = (env ? env.api_key : process.env.CATZCONNECT_API_KEY)?.trim();
    if (!apiKey) {
      throw new Error("Missing API key in environment");
    }

    const res = await fetch(`${baseURL}${path}`, {
      method: "POST",
      headers: {
        ...extraHeaders,
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text();
      // Message unchanged ("HTTP <status>: <body>"); status and the server's
      // `code` are available on the error too.
      throw new CatzApiError(res.status, `HTTP ${res.status}: ${text}`, text, CatzApiError.from(res.status, text).code);
    }

    return res.json();
  }
}

/**
 * POSTs plain JSON with no API key (the public push device endpoints, which
 * authenticate with the project's publishable key). Same error handling as
 * {@link HttpClient.request}.
 */
export async function postPublic(path: string, body: Record<string, unknown>, baseUrl?: string, allowInsecure = false): Promise<any> {
  const base = checkBaseUrl(baseUrl ?? baseUrlFromEnv(), allowInsecure || insecureHttpFromEnv());
  const res = await fetch(`${base}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw CatzApiError.from(res.status, text);
  let json: any;
  try {
    json = JSON.parse(text);
  } catch {
    throw new CatzApiError(res.status, `The server sent a response that is not JSON: ${text.slice(0, 200)}`, text);
  }
  if (json && typeof json === "object" && json.success === false) throw CatzApiError.from(res.status, text);
  return json;
}
