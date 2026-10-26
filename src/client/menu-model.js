/**
 * The visible row set for one resolved target.
 *
 * Pure and React-free so the ordering can be unit-tested without a DOM; the
 * JSX shell in `menu.jsx` supplies the icon elements.
 *
 * The file-menu order follows Codex's file reference menu:
 *   open → open in <app> → open with → ─ → save as → copy… → reveal
 *
 * A link that resolves to a file is shown as a file menu first; its link
 * actions move below a separator so the common actions stay at the top.
 */
import { configureItems } from "./settings.js";
import { editorScheme } from "./actions.js";

export function buildItems(menu, t, icons = {}, platform = "", settings = {}) {
  // Settings and diagnostics live in Settings → 右键管理, not in the menu.
  return configureItems(buildBaseItems(menu, t, icons, platform, settings), settings);
}

function buildBaseItems(menu, t, icons, platform, settings) {
  const target = menu.target;
  const isLink = target.type === "link";
  const file = target.file;
  const hasFile = file !== undefined;
  const kind = hasFile ? file.kind : undefined;
  const fileName = hasFile ? file.name : target.name;
  const fileIcon = hasFile && icons.file !== undefined ? icons.file(fileName) : undefined;

  const linkItems = [];
  if (isLink) {
    if (target.scheme === "http:" || target.scheme === "https:") {
      linkItems.push({
        id: "open-link-sidebar",
        label: t("menu.openLinkSidebar"),
        icon: icons.sidebar,
        disabled: target.sidebarBrowser !== true
      });
      linkItems.push({
        id: "open-link-external",
        label: t("menu.openLinkExternal"),
        icon: icons.open
      });
    } else {
      linkItems.push({
        id: "open-link",
        label: t("menu.openLink"),
        icon: icons.open
      });
    }
    linkItems.push({ id: "copy-link", label: t("menu.copyLink"), icon: icons.link });
    linkItems.push({
      id: "copy-link-text",
      label: t("menu.copyLinkText"),
      icon: icons.copy,
      disabled: target.text === undefined || target.text === ""
    });
    linkItems.push({ id: "copy-markdown", label: t("menu.copyMarkdown"), icon: icons.code });
  }

  const headerKind =
    isLink && !hasFile
      ? "link"
      : kind === "directory"
        ? "folder"
        : "file";
  const items = [
    {
      id: "header",
      type: "label",
      text: `${t(`menu.header.${headerKind}`)} · ${hasFile ? file.name : target.name}`
    },
    { id: "sep-head", type: "separator" }
  ];

  // A plain hyperlink: link actions only.
  if (isLink && !hasFile) {
    items.push(...linkItems);
    return items;
  }

  const canPreview = kind !== "directory" || file.rowButton !== undefined;
  if (canPreview) {
    items.push({
      id: "preview",
      label: kind === "directory" ? t("menu.expand") : t("menu.preview"),
      icon: fileIcon
    });
  }

  if (menu.desktop === true) {
    const apps = Array.isArray(menu.apps) ? menu.apps : [];
    const defaultApp = apps.find(app => app.id === settings.defaultApplication) ?? apps.find((app) => app.default === true);
    const defaultName = defaultApp === undefined ? "" : shortAppName(defaultApp.name);
    const openDefaultLabel =
      kind === "directory"
        ? t("menu.openFolder")
        : defaultName === ""
          ? t("menu.openDefault")
          : t("menu.openInApp", { name: defaultName });

    items.push({
      id: "open-default",
      label: openDefaultLabel,
      icon: defaultApp === undefined ? icons.open : (icons.app?.(defaultApp) ?? icons.open)
    });
    if (file.line && apps.some(app => editorScheme(app))) items.push({ id: "open-location", label: t("menu.openLocation", { line: file.line }), icon: icons.code });

    // Codex shows the target picker as a submenu whenever there is more than
    // one app; a single app is already covered by the row above.
    if (apps.length > 1) {
      items.push({
        id: "open-with",
        label: t("menu.openWith"),
        icon: icons.link,
        submenu: apps.map((app) => ({
          id: `app:${app.id}`,
          label:
            app.id === defaultApp?.id
              ? t("menu.defaultApp", { name: shortAppName(app.name) })
              : shortAppName(app.name),
          icon: icons.app?.(app)
        }))
      });
    }

    items.push({ id: "sep-open", type: "separator" });
  }

  if (kind === "file") {
    items.push({ id: "save-as", label: t("menu.saveAs"), icon: icons.download });
  }

  items.push({ id: "copy-path", label: t("menu.copyPath"), icon: icons.copy });
  if (file.relativePath !== undefined && file.relativePath !== "") {
    items.push({ id: "copy-relative", label: t("menu.copyRelative"), icon: icons.copy });
  }
  items.push({ id: "copy-name", label: t("menu.copyName"), icon: icons.copy });
  if (file.line) items.push({ id: "copy-location", label: t("menu.copyLocation"), icon: icons.copy });
  if (kind === "file") {
    items.push({ id: "copy-contents", label: t("menu.copyContents"), icon: icons.code });
  }

  if (menu.desktop === true) {
    const revealKey =
      platform === "darwin"
        ? "menu.revealFinder"
        : platform === "linux"
          ? "menu.revealFileManager"
          : "menu.reveal";
    items.push({ id: "reveal", label: t(revealKey), icon: icons.browse });
  }

  // A file link keeps its link actions, but below the file actions.
  if (isLink && hasFile) {
    items.push({ id: "sep-link", type: "separator" });
    items.push(...linkItems);
  }

  if (menu.desktop === false && hasFile) {
    items.push({ id: "sep-nodesktop", type: "separator" });
    items.push({ id: "no-desktop", type: "label", text: t("menu.noDesktop") });
  }

  return items;
}

/** Codex shows short target labels such as "VS Code" rather than the full app name. */
function shortAppName(name) {
  const trimmed = String(name ?? "").trim();
  switch (trimmed.toLowerCase()) {
    case "visual studio code":
    case "microsoft visual studio code":
      return "VS Code";
    case "visual studio code - insiders":
    case "visual studio code insiders":
    case "microsoft visual studio code insiders":
      return "VS Code Insiders";
    default:
      return trimmed;
  }
}
