/** Stable identity shared by both halves of the plugin. */
export const PLUGIN_ID = "dsh-right";
export const PLUGIN_VERSION = "0.2.3";

/** Locale dictionary namespace. */
export const LOCALE_NS = "dsh-right";

/** Prefix every host route lives under. */
export const ROUTE_BASE = "/dsh-right";

/** Overlay order: above the sidebar and chat, below modal dialogs. */
export const OVERLAY_ORDER = 400;

/** Request bodies on these routes are tiny JSON objects. */
export const MAX_BODY_BYTES = 64 * 1024;

/** Text copied by "copy file contents" is capped at 1 MiB. */
export const MAX_READ_BYTES = 1024 * 1024;

/** Raw bytes served for "save as" are capped so a huge file cannot exhaust memory. */
export const MAX_RAW_BYTES = 64 * 1024 * 1024;

/** Paths longer than this are not offered a menu. */
export const MAX_PATH_LENGTH = 4096;
