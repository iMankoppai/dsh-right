/**
 * Menu styling.
 *
 * The primitives' `Menu` has a compact mode (11px labels, 24px rows) meant
 * for dense chrome menus. This plugin is a reading-surface menu, so it opts
 * out of compact and scales with the user's "会话内容字号" setting
 * (`--dsh-content-font-size`, set on <body> by the theme/layout plugin).
 *
 * The class is only on this plugin's menu root, so DSH's own menus keep their
 * look.
 */
import { NAV_ICON_MASK_URL } from "./nav-icon.js";

export const MENU_CSS = `
[role="menu"].dsh-right-menu {
  min-width: 220px;
  max-width: min(480px, calc(100vw - 16px));
  max-height: calc(100dvh - 16px);
  overflow-y: auto;
  overflow-wrap: anywhere;
}

[role="menu"].dsh-right-menu [role="menuitem"] {
  /* 12px at the default 14px content size; still follows the DSH setting. */
  font-size: calc(var(--dsh-content-font-size, 14px) - 2px);
  line-height: 1.45;
  min-height: 34px;
  padding: 6px 10px;
  gap: 8px;
}

[role="menu"].dsh-right-menu [role="menuitem"] svg {
  width: 15px;
  height: 15px;
}

[role="menu"].dsh-right-menu [role="menuitem"] > span:first-child:has(> svg),
[role="menu"].dsh-right-menu [role="menuitem"] > span:first-child:has(> img) {
  width: 15px;
  height: 15px;
}

[role="menu"].dsh-right-menu img.dsh-right-app-icon {
  display: block;
  width: 15px;
  height: 15px;
  object-fit: contain;
  border-radius: 3px;
}

[role="menu"].dsh-right-menu > [role="presentation"] > [role="presentation"] {
  padding: 5px 10px;
  font-size: calc(var(--dsh-content-font-size, 14px) - 3px);
  line-height: 1.4;
}

[role="menu"].dsh-right-menu [role="separator"] {
  margin: 4px 2px;
}

[role="menu"].dsh-right-menu.dsh-right-compact [role="menuitem"] {
  min-height: 26px;
  padding: 3px 8px;
}
.dsh-right-dialog {
  color-scheme: light dark;
  color: CanvasText;
  background: Canvas;
  width: min(560px, calc(100vw - 32px));
  max-height: calc(100dvh - 40px);
  padding: 0;
  border: 1px solid color-mix(in srgb, CanvasText 22%, transparent);
  border-radius: 12px;
  box-shadow: 0 16px 64px #0004;
  font: 14px/1.5 system-ui, sans-serif;
}
.dsh-right-dialog::backdrop { background: #0006; }
.dsh-right-dialog header, .dsh-right-dialog footer {
  display: flex; align-items: center; gap: 8px; padding: 14px 18px;
}
.dsh-right-dialog header { justify-content: space-between; }
.dsh-right-dialog h2 { font-size: 17px; font-weight: 600; margin: 0; }
.dsh-right-dialog h3 { font-size: 14px; margin: 20px 0 4px; }
.dsh-right-dialog footer { justify-content: flex-end; border-top: 1px solid color-mix(in srgb, CanvasText 15%, transparent); }
.dsh-right-dialog footer span { flex: 1; }
.dsh-right-dialog button, .dsh-right-dialog select {
  font: inherit; color: inherit; border: 1px solid color-mix(in srgb, CanvasText 25%, transparent);
  background: color-mix(in srgb, CanvasText 5%, Canvas); border-radius: 6px; padding: 5px 10px; cursor: pointer;
}
.dsh-right-dialog button:disabled { opacity: .4; cursor: default; }
.dsh-right-dialog button:hover:not(:disabled) { background: color-mix(in srgb, CanvasText 12%, Canvas); }
.dsh-right-dialog :focus-visible { outline: 2px solid Highlight; outline-offset: 2px; }
.dsh-right-dialog .dsh-right-primary { background: Highlight; color: HighlightText; }
.dsh-right-dialog-body { padding: 0 18px 16px; overflow-wrap: anywhere; }
.dsh-right-dialog .dsh-right-field { display: flex; align-items: center; gap: 10px; margin: 10px 0; }
.dsh-right-dialog select { margin-left: auto; max-width: 65%; }
.dsh-right-dialog input[type="checkbox"] { margin-right: 8px; accent-color: Highlight; }
.dsh-right-hint { color: color-mix(in srgb, CanvasText 65%, Canvas); font-size: 12px; }
.dsh-right-action-list { max-height: 36dvh; overflow: auto; padding: 4px; }
.dsh-right-setting-row { display: flex; gap: 5px; align-items: center; min-height: 38px; }
.dsh-right-setting-row label { flex: 1; }
.dsh-right-setting-row button { padding: 2px 9px; }
.dsh-right-choices { display: grid; gap: 8px; }
.dsh-right-choices button { text-align: left; overflow-wrap: anywhere; }
.dsh-right-dialog dl { display: grid; grid-template-columns: 1fr auto; gap: 8px 20px; }
.dsh-right-dialog dd { margin: 0; }
.dsh-right-path { font-family: ui-monospace, monospace; }

/* Settings nav: the shell has no per-section icon option, so swap the
   fallback gear for a pointer glyph once the nav row is marked. */
button[data-dsh-right-nav] > svg {
  display: none;
}
button[data-dsh-right-nav]::before {
  content: "";
  flex: none;
  width: 16px;
  height: 16px;
  background-color: currentColor;
  -webkit-mask: url("${NAV_ICON_MASK_URL}") center / 16px 16px no-repeat;
  mask: url("${NAV_ICON_MASK_URL}") center / 16px 16px no-repeat;
}

/* Settings → 右键管理 page */
.dsh-right-manage {
  display: flex;
  flex-direction: column;
  gap: 24px;
  max-width: 720px;
  color: var(--dsw-alias-label-primary, CanvasText);
  font-size: 14px;
  line-height: 1.5;
}
.dsh-right-manage-heading {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
}
.dsh-right-manage header h2 {
  margin: 0;
  font-size: 20px;
  line-height: 28px;
  font-weight: 600;
}
.dsh-right-manage-description {
  margin: 6px 0 0;
  color: var(--dsw-alias-label-secondary, GrayText);
  font-size: 13px;
  line-height: 20px;
}
.dsh-right-manage-section h3 {
  margin: 0 0 4px;
  font-size: 14px;
  line-height: 22px;
  font-weight: 600;
}
.dsh-right-manage-hint {
  margin: 2px 0 8px;
  color: var(--dsw-alias-label-tertiary, GrayText);
  font-size: 12px;
  line-height: 18px;
}
.dsh-right-manage-group {
  border-top: .5px solid var(--dsw-alias-border-l2, rgba(127, 127, 127, .25));
}
.dsh-right-manage-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  min-height: 40px;
  border-bottom: .5px solid var(--dsw-alias-border-l2, rgba(127, 127, 127, .25));
}
.dsh-right-manage-check {
  display: flex;
  align-items: center;
  gap: 10px;
  flex: 1;
  min-width: 0;
  cursor: pointer;
}
.dsh-right-manage-check span {
  overflow-wrap: anywhere;
}
.dsh-right-manage-order {
  display: flex;
  flex: none;
  gap: 4px;
}
.dsh-right-manage-order button,
.dsh-right-manage-footer button,
.dsh-right-manage-action {
  min-width: 28px;
  height: 26px;
  padding: 0 8px;
  color: inherit;
  font: inherit;
  line-height: 24px;
  background: var(--dsw-alias-bg-layer-1, transparent);
  border: .5px solid var(--dsw-alias-border-l3, rgba(127, 127, 127, .4));
  border-radius: var(--dsw-radius-sm, 6px);
  cursor: pointer;
}
.dsh-right-manage-order button:hover:not(:disabled),
.dsh-right-manage-footer button:hover:not(:disabled),
.dsh-right-manage-action:hover:not(:disabled) {
  background: var(--dsw-alias-interactive-bg-hover, rgba(127, 127, 127, .12));
}
.dsh-right-manage-order button:disabled {
  opacity: .35;
  cursor: default;
}
.dsh-right-manage-field {
  gap: 12px;
}
.dsh-right-manage-field select {
  max-width: 60%;
  margin-left: auto;
  padding: 4px 8px;
  color: inherit;
  font: inherit;
  background: var(--dsw-alias-bg-layer-1, Canvas);
  border: .5px solid var(--dsw-alias-border-l3, rgba(127, 127, 127, .4));
  border-radius: var(--dsw-radius-sm, 6px);
}
.dsh-right-manage input[type="checkbox"] {
  width: 15px;
  height: 15px;
  margin: 0;
  accent-color: var(--dsw-alias-brand-primary, Highlight);
}
.dsh-right-manage-diagnostics {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 8px 20px;
  margin: 8px 0;
  font-size: 13px;
}
.dsh-right-manage-diagnostics dt {
  color: var(--dsw-alias-label-secondary, GrayText);
}
.dsh-right-manage-diagnostics dd {
  margin: 0;
}
.dsh-right-manage-action {
  margin-top: 10px;
}
.dsh-right-manage-footer {
  display: flex;
  align-items: center;
  gap: 12px;
}
.dsh-right-manage-status {
  color: var(--dsw-alias-label-secondary, GrayText);
  font-size: 12px;
}
`;
