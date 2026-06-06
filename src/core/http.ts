import { EnvValues } from "../types";

export class HttpClient {
  async post(
    path: string,
    body: {
      nonce: string;
      ciphertext: string;
    },
    env?: EnvValues,
  ) {
    const baseURL = process.env.CATZCONNECT_BASE_URL ?? "https://api.catzconnect.com";

    const apiKey = env ? env.api_key : process.env.CATZCONNECT_API_KEY;
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
      throw new Error(`HTTP ${res.status}: ${text}`);
    }

    return res.json();
  }
}
