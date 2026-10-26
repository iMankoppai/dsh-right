export const ACTION_IDS = ["preview", "open-default", "open-location", "open-with", "save-as", "copy-path", "copy-relative", "copy-location", "copy-name", "copy-contents", "reveal", "open-link-sidebar", "open-link-external", "open-link", "copy-link", "copy-link-text", "copy-markdown"];

/** Locale key suffix for each action's menu label. */
export const ACTION_LABELS = {
  preview: "preview",
  "open-default": "openDefault",
  "open-location": "openLocationSetting",
  "open-with": "openWith",
  "save-as": "saveAs",
  "copy-path": "copyPath",
  "copy-relative": "copyRelative",
  "copy-location": "copyLocation",
  "copy-name": "copyName",
  "copy-contents": "copyContents",
  reveal: "reveal",
  "open-link-sidebar": "openLinkSidebar",
  "open-link-external": "openLinkExternal",
  "open-link": "openLink",
  "copy-link": "copyLink",
  "copy-link-text": "copyLinkText",
  "copy-markdown": "copyMarkdown"
};

/** The menu groups separated by rules; reordering only applies inside one group. */
export const ACTION_GROUPS = [
  ["preview", "open-default", "open-location", "open-with"],
  ["save-as", "copy-path", "copy-relative", "copy-location", "copy-name", "copy-contents", "reveal"],
  ["open-link-sidebar", "open-link-external", "open-link", "copy-link", "copy-link-text", "copy-markdown"]
];

export const DEFAULT_SETTINGS = { compact: false, separator: "native", defaultApplication: "", hidden: [], order: ACTION_IDS };
export const SETTINGS_KEY = "dsh-right.settings.v1";

export function normalizeSettings(value = {}) {
  const unique = list => [...new Set((Array.isArray(list) ? list : []).filter(id => ACTION_IDS.includes(id)))];
  const order = unique(value?.order);
  return {
    compact: value?.compact === true,
    separator: ["forward", "backward"].includes(value?.separator) ? value.separator : "native",
    defaultApplication: typeof value?.defaultApplication === "string" ? value.defaultApplication.slice(0, 256) : "",
    hidden: unique(value?.hidden),
    order: [...order, ...ACTION_IDS.filter(id => !order.includes(id))]
  };
}
export function loadSettings(storage) {
  try { return normalizeSettings(JSON.parse((storage ?? window.localStorage).getItem(SETTINGS_KEY) ?? "{}")); }
  catch { return normalizeSettings(); }
}
export function saveSettings(value, storage) {
  const normalized = normalizeSettings(value);
  try { (storage ?? window.localStorage).setItem(SETTINGS_KEY, JSON.stringify(normalized)); return true; }
  catch { return false; }
}
export function formatPath(path, settings) {
  return settings?.separator === "forward" ? path.replace(/\\/g, "/")
    : settings?.separator === "backward" ? path.replace(/\//g, "\\") : path;
}
export function configureItems(items, settings) {
  const prefs = normalizeSettings(settings);
  const result = [];
  let group = [];
  const flush = () => {
    result.push(...group.filter(item => !prefs.hidden.includes(item.id)).sort((a, b) => prefs.order.indexOf(a.id) - prefs.order.indexOf(b.id)));
    group = [];
  };
  for (const item of items) {
    if (item.type) { flush(); result.push(item); } else group.push(item);
  }
  flush();
  const cleaned = [];
  for (const item of result) {
    if (item.type === "separator" && (!cleaned.length || cleaned.at(-1).type === "separator")) continue;
    cleaned.push(item);
  }
  while (cleaned.at(-1)?.type === "separator") cleaned.pop();
  return cleaned;
}
