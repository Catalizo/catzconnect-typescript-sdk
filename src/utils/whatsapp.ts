import type { WhatsAppOptions, WhatsAppMedia, TrackingOverride } from "../types";

/** Meta template names: lower-case letters, digits, underscores. */
export const WHATSAPP_TEMPLATE_NAME = /^[a-z0-9_]{1,512}$/;

const isHttps = (v: unknown) => typeof v === "string" && /^https:\/\/\S+$/.test(v) && v.length <= 2048;
const isMediaId = (v: unknown) => typeof v === "string" && /^\d{1,64}$/.test(v);

function checkMediaRef(kind: string, m: { link?: string; id?: string; filename?: string }, where: string) {
  const hasLink = m.link !== undefined && m.link !== null;
  const hasId = m.id !== undefined && m.id !== null;
  if (hasLink === hasId) throw new Error(`${where}: give exactly one of 'link' (https) or 'id' (Meta media id)`);
  if (hasLink && !isHttps(m.link)) throw new Error(`${where}.link must be an https:// URL`);
  if (hasId && !isMediaId(m.id)) throw new Error(`${where}.id must be a Meta media id (digits)`);
  if (m.filename !== undefined) {
    if (kind !== "document") throw new Error(`${where}.filename is for documents only`);
    if (typeof m.filename !== "string" || m.filename.length > 240 || /[\\/]/.test(m.filename)) {
      throw new Error(`${where}.filename must be up to 240 characters without slashes`);
    }
  }
}

/** A media message (`template: "Custom"` with `whatsapp.media`). */
export function verifyWhatsAppMedia(m: WhatsAppMedia) {
  if (!m || typeof m !== "object") throw new Error("'whatsapp.media' must be an object");
  if (!["image", "document", "video", "audio"].includes(m.type)) {
    throw new Error("'whatsapp.media.type' must be image, document, video or audio");
  }
  checkMediaRef(m.type, m, "'whatsapp.media'");
  if (m.caption !== undefined) {
    if (m.type === "audio") throw new Error("'whatsapp.media.caption' is not allowed for audio");
    if (typeof m.caption !== "string" || m.caption.length > 1024) throw new Error("'whatsapp.media.caption' is at most 1024 characters");
  }
}

function checkParam(v: unknown, where: string) {
  if (typeof v !== "string" || v.trim() === "" || v.length > 1024 || /[\n\t]/.test(v) || / {5,}/.test(v)) {
    throw new Error(`${where} must be non-empty text of up to 1024 characters without new lines, tabs or 5+ spaces in a row`);
  }
}

/** Template parameters (`template` = an approved Meta template name). */
export function verifyWhatsAppOptions(o: WhatsAppOptions | undefined) {
  if (o === undefined || o === null) return;
  if (typeof o !== "object") throw new Error("'whatsapp' must be an object");
  if (o.language !== undefined && (typeof o.language !== "string" || !/^[A-Za-z]{2,3}(_[A-Za-z0-9]{2,4})?$/.test(o.language))) {
    throw new Error("'whatsapp.language' must be a Meta language code such as en, en_US or es_419");
  }
  if (o.header !== undefined) {
    const h = o.header;
    if (h.type === "text") {
      if (typeof h.text !== "string" || h.text.trim() === "" || h.text.length > 60) throw new Error("'whatsapp.header.text' must be 1–60 characters");
    } else if (h.type === "image" || h.type === "video" || h.type === "document") {
      checkMediaRef(h.type, h, "'whatsapp.header'");
    } else if (h.type === "location") {
      if (typeof h.latitude !== "number" || typeof h.longitude !== "number") throw new Error("'whatsapp.header' location needs latitude and longitude");
    } else {
      throw new Error("'whatsapp.header.type' must be text, image, video, document or location");
    }
  }
  if (o.body !== undefined) {
    if (Array.isArray(o.body)) o.body.forEach((v, i) => checkParam(v, `'whatsapp.body[${i}]'`));
    else if (o.body && typeof o.body === "object") for (const [k, v] of Object.entries(o.body)) checkParam(v, `'whatsapp.body.${k}'`);
    else throw new Error("'whatsapp.body' must be an array or an object of strings");
  }
  if (o.buttons !== undefined) {
    if (!Array.isArray(o.buttons)) throw new Error("'whatsapp.buttons' must be an array");
    const seen = new Set<number>();
    for (const b of o.buttons) {
      if (!Number.isInteger(b.index) || b.index < 0 || b.index > 9) throw new Error("'whatsapp.buttons[].index' must be 0–9");
      if (seen.has(b.index)) throw new Error(`'whatsapp.buttons' lists index ${b.index} twice`);
      seen.add(b.index);
      if (b.type === "url") {
        if (typeof b.text !== "string" || b.text === "" || /\s/.test(b.text) || b.text.length > 2000) throw new Error("A url button needs 'text': the URL suffix without spaces");
      } else if (b.type === "quick_reply") {
        if (b.payload !== undefined && (typeof b.payload !== "string" || b.payload.length > 256)) throw new Error("A quick_reply 'payload' is at most 256 characters");
      } else if (b.type === "copy_code") {
        if (typeof b.code !== "string" || b.code === "" || b.code.length > 20) throw new Error("A copy_code button needs 'code' of up to 20 characters");
      } else if (b.type === "otp") {
        if (typeof b.code !== "string" || !/^[A-Za-z0-9]{1,15}$/.test(b.code)) throw new Error("An otp button needs 'code': up to 15 letters or digits");
      } else {
        throw new Error("'whatsapp.buttons[].type' must be url, quick_reply, copy_code or otp");
      }
    }
  }
  if (o.media !== undefined) verifyWhatsAppMedia(o.media);
}

/** `tracking` (Email only): booleans `opens` / `clicks`. */
export function verifyTracking(t: TrackingOverride | undefined, channel: string) {
  if (t === undefined || t === null) return;
  if (channel !== "Email") throw new Error("'tracking' applies to the Email channel only");
  if (typeof t !== "object") throw new Error("'tracking' must be an object { opens?, clicks? }");
  for (const k of Object.keys(t)) {
    if (k !== "opens" && k !== "clicks") throw new Error(`'tracking.${k}' is not a tracking option (opens, clicks)`);
    const v = (t as Record<string, unknown>)[k];
    if (v !== undefined && typeof v !== "boolean") throw new Error(`'tracking.${k}' must be true or false`);
  }
}
