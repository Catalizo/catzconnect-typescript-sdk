import type { WhatsAppOptions, WhatsAppMedia, TrackingOverride } from "../types";
/** Meta template names: lower-case letters, digits, underscores. */
export declare const WHATSAPP_TEMPLATE_NAME: RegExp;
/** A media message (`template: "Custom"` with `whatsapp.media`). */
export declare function verifyWhatsAppMedia(m: WhatsAppMedia): void;
/** Template parameters (`template` = an approved Meta template name). */
export declare function verifyWhatsAppOptions(o: WhatsAppOptions | undefined): void;
/** `tracking` (Email only): booleans `opens` / `clicks`. */
export declare function verifyTracking(t: TrackingOverride | undefined, channel: string): void;
