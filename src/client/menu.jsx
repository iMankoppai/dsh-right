/**
 * The overlay occupant: the menu primitive at the captured pointer rect and
 * the transient toast. The row set itself comes from `menu-model.js`.
 */
import * as P from "@deepseek-ai/dsh-client-ui-primitives";
import * as React from "react";
import { buildItems } from "./menu-model.js";
import { PluginDialog } from "./dialogs.jsx";

/** Icon elements handed to the pure row builder. */
const ICONS = {
  file: (name) => <P.FileTypeIcon kind={P.classifyFileType(name)} size={16} />,
  sidebar: <P.IconPanelLeftOutlineRegular />,
  open: <P.IconRightUpOutlineRegular />,
  link: <P.IconLinkOutlineRegular />,
  copy: <P.IconCopyOutlineRegular />,
  code: <P.IconCodeOutlineRegular />,
  browse: <P.IconBrowseOutlineRegular />,
  download: <P.IconDownloadOutlineRegular />,
  app: (app) =>
    app?.icon === undefined ? undefined : <img className="dsh-right-app-icon" src={app.icon} alt="" />
};

/** The overlay occupant. */
export function FileContextMenu(props) {
  const { open, run, t, closeMenu, finishDialog, updateSettings, diagnose } = props;
  const state = React.useSyncExternalStore(open.subscribe, open.get, open.get);
  const menu = state.menu;
  const notice = state.notice;
  const children = [];

  if (notice !== null) {
    children.push(
      <P.Toast
        key={notice.id}
        text={notice.text}
        tone={notice.tone === "success" ? "success" : undefined}
        icon={notice.tone === "success" ? undefined : <P.IconWarningOutlineRegular />}
        onDone={() => {
          const current = open.get();
          if (current.notice === notice) open.set({ ...current, notice: null });
        }}
      />
    );
  }

  if (menu !== null) {
    const rect = menu.rect;
    children.push(
      <P.Menu
        key={`dsh-right-menu-${String(menu.seq)}`}
        open
        portal
        listClassName={`dsh-right-menu${state.settings?.compact ? " dsh-right-compact" : ""}`}
        align="start"
        anchor={null}
        getAnchorRect={() => ({
          left: rect.x,
          right: rect.x,
          top: rect.y,
          bottom: rect.y
        })}
        items={buildItems(menu, t, ICONS, document.documentElement.dataset.platform ?? "", state.settings)}
        onSelect={(id) => {
          void run(id);
        }}
        onClose={() => {
          const current = open.get();
          if (current.menu?.seq === menu.seq) closeMenu();
        }}
      />
    );
  }

  if (state.dialog) children.push(<PluginDialog key={`dialog-${state.dialog.id}`} dialog={state.dialog} settings={state.settings} t={t} finish={finishDialog} updateSettings={updateSettings} diagnose={diagnose} />);

  return children.length === 0 ? null : <>{children}</>;
}
