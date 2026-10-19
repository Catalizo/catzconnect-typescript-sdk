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

  constructor(status: number, message: string, body: string, code?: string) {
    super(message);
    this.name = "CatzApiError";
    this.status = status;
    this.code = code;
    this.body = body;
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

export class HttpClient {
  /**
   * POSTs an encrypted body and returns the decoded JSON. Non-2xx answers,
   * and 2xx answers with `success: false`, throw a {@link CatzApiError}.
   */
  async request(
    path: string,
    body: { nonce: string; ciphertext: string },
    env?: EnvValues,
  ): Promise<any> {
    const baseURL = (process.env.CATZCONNECT_BASE_URL ?? "https://api.catzconnect.com").trim().replace(/\/+$/, "");
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
  ) {
    // A trailing slash would produce //sdk/send; a key from a .env file may end in a newline.
    const baseURL = (process.env.CATZCONNECT_BASE_URL ?? "https://api.catzconnect.com").trim().replace(/\/+$/, "");

    const apiKey = (env ? env.api_key : process.env.CATZCONNECT_API_KEY)?.trim();
    if (!apiKey) {
      throw new Error("Missing API key in environment");
    }

    const res = await fetch(`${baseURL}${path}`, {
      method: "POST",
      headers: {
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
