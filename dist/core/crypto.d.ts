import { EnvValues } from "../types";
export declare function encrypt(payload: Record<string, unknown>, env?: EnvValues): Promise<{
    nonce: string;
    ciphertext: string;
} | undefined>;
/**
 * Opens a response that carries an encrypted `{nonce, ciphertext}` envelope
 * (at the top level or as `data`) with the same key as the request, and
 * merges the decrypted object in. A plain JSON response is returned as is —
 * which is what `/sdk/*` sends today.
 */
export declare function openResponse(res: any, env?: EnvValues): Promise<any>;
