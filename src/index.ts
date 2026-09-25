import { HttpClient } from "./core/http";
import { encrypt } from "./core/crypto";
import { EnvValues, SendInput } from "./types";
import { verifyPayload } from "./core/payload";

class CatzConnect {
  private http = new HttpClient();

  async send(input: SendInput, env?: EnvValues) {
    verifyPayload(input);

    const finalPayload = {
      message_type: input.type,
      channel: input.channel,
      template: input.template,
      identity: input.identity,
      ...input.payload,
    };

    const enc = await encrypt(finalPayload, env);
    if (!enc) {
      throw new Error("Encryption failed");
    }

    try {
      const res = await this.http.post("/sdk/send", enc, env);

      return res;
    } catch (err: any) {
      throw new Error(
        `Failed to send ${input.type}.${input.channel}.${input.template}: ${err.message}`,
      );
    }
  }
}

export const catzconnect = new CatzConnect();

// Device-side helpers for end-to-end encrypted push. Used in the app that
// receives notifications, not on your server.
export { generateDeviceKeys, openPushPayload, isSealedPush } from "./push";
export type { DeviceKeys, PushContent } from "./push";
