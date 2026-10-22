// src/core/http.ts
var CatzApiError = class _CatzApiError extends Error {
  constructor(status, message, body, code) {
    super(message);
    this.name = "CatzApiError";
    this.status = status;
    this.code = code;
    this.body = body;
    try {
      const j = JSON.parse(body);
      if (j && typeof j === "object" && !Array.isArray(j)) this.details = j;
    } catch {
    }
  }
  /** Builds the error from a response body, reading `message` and `code` when it is JSON. */
  static from(status, body) {
    let message = `HTTP ${status}: ${body}`;
    let code;
    try {
      const j = JSON.parse(body);
      if (j && typeof j === "object") {
        if (typeof j.message === "string" && j.message !== "") message = j.message;
        if (typeof j.code === "string" && j.code !== "") code = j.code;
      }
    } catch {
    }
    return new _CatzApiError(status, message, body, code);
  }
};
var LOCAL_HOSTS = /* @__PURE__ */ new Set(["localhost", "127.0.0.1", "::1", "[::1]", "10.0.2.2"]);
function checkBaseUrl(raw, allowInsecure = false, what = "CATZCONNECT_BASE_URL") {
  const url = raw.trim().replace(/\/+$/, "");
  let u;
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
    `${what} uses plain ${scheme.slice(0, -1)}:// to ${u.hostname}: the API key and tokens would travel unencrypted. Use https://, or set CATZCONNECT_ALLOW_INSECURE_HTTP=1 / catzconnect.setAllowInsecureHttp(true) to allow it anyway.`
  );
}
function insecureHttpFromEnv() {
  const v = (typeof process !== "undefined" ? process.env?.CATZCONNECT_ALLOW_INSECURE_HTTP : void 0) ?? "";
  return ["1", "true", "yes"].includes(v.trim().toLowerCase());
}
var DEFAULT_BASE_URL = "https://api.catzconnect.com";
function baseUrlFromEnv() {
  const v = (typeof process !== "undefined" ? process.env?.CATZCONNECT_BASE_URL : void 0) ?? "";
  return v.trim() === "" ? DEFAULT_BASE_URL : v;
}
var HttpClient = class {
  constructor() {
    /** Allow a plain-http `CATZCONNECT_BASE_URL` to a non-local host (also `CATZCONNECT_ALLOW_INSECURE_HTTP=1`). */
    this.allowInsecureHttp = false;
  }
  baseUrl() {
    return checkBaseUrl(baseUrlFromEnv(), this.allowInsecureHttp || insecureHttpFromEnv());
  }
  /**
   * POSTs an encrypted body and returns the decoded JSON. Non-2xx answers,
   * and 2xx answers with `success: false`, throw a {@link CatzApiError}.
   */
  async request(path, body, env) {
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
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify(body)
    });
    const text = await res.text();
    if (!res.ok) {
      throw CatzApiError.from(res.status, text);
    }
    let json;
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
  async post(path, body, env, extraHeaders = {}) {
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
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify(body)
    });
    if (!res.ok) {
      const text = await res.text();
      throw new CatzApiError(res.status, `HTTP ${res.status}: ${text}`, text, CatzApiError.from(res.status, text).code);
    }
    return res.json();
  }
};
async function postPublic(path, body, baseUrl, allowInsecure = false) {
  const base = checkBaseUrl(baseUrl ?? baseUrlFromEnv(), allowInsecure || insecureHttpFromEnv());
  const res = await fetch(`${base}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body)
  });
  const text = await res.text();
  if (!res.ok) throw CatzApiError.from(res.status, text);
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new CatzApiError(res.status, `The server sent a response that is not JSON: ${text.slice(0, 200)}`, text);
  }
  if (json && typeof json === "object" && json.success === false) throw CatzApiError.from(res.status, text);
  return json;
}

export {
  CatzApiError,
  checkBaseUrl,
  HttpClient,
  postPublic
};
