import * as React from "react";
import { ACTION_IDS, ACTION_LABELS, DEFAULT_SETTINGS, normalizeSettings } from "./settings.js";

/** Native modal supplies focus containment, Escape handling, and background isolation. */
function Modal({ title, onClose, restoreFocus, closeLabel, children }) {
  const ref = React.useRef(null);
  React.useLayoutEffect(() => {
    const previous = restoreFocus ?? document.activeElement;
    const dialog = ref.current;
    dialog.showModal();
    return () => {
      dialog.close();
      if (previous?.isConnected) previous.focus?.({ preventScroll: true });
    };
  }, []);
  return <dialog ref={ref} className="dsh-right-dialog" aria-labelledby="dsh-right-dialog-title"
    onCancel={event => { event.preventDefault(); onClose(null); }}>
    <header><h2 id="dsh-right-dialog-title">{title}</h2><button type="button" aria-label={closeLabel} onClick={() => onClose(null)}>×</button></header>
    {children}
  </dialog>;
}

function Settings({ settings, apps, t, onSave, onClose }) {
  const [value, setValue] = React.useState(() => normalizeSettings(settings));
  const patch = update => setValue(current => ({ ...current, ...update }));
  const move = (index, direction) => {
    const order = [...value.order];
    [order[index], order[index + direction]] = [order[index + direction], order[index]];
    patch({ order });
  };
  return <>
    <div className="dsh-right-dialog-body">
      <label className="dsh-right-field"><input type="checkbox" checked={value.compact} onChange={event => patch({ compact: event.target.checked })} />{t("settings.compact")}</label>
      <label className="dsh-right-field">{t("settings.separator")}<select aria-label={t("settings.separator")} value={value.separator} onChange={event => patch({ separator: event.target.value })}>
        <option value="native">{t("settings.native")}</option><option value="forward">/</option><option value="backward">\</option>
      </select></label>
      <label className="dsh-right-field">{t("settings.application")}<select aria-label={t("settings.application")} value={value.defaultApplication} onChange={event => patch({ defaultApplication: event.target.value })}>
        <option value="">{t("settings.systemDefault")}</option>
        {value.defaultApplication && !apps.some(app => app.id === value.defaultApplication) && <option value={value.defaultApplication}>{value.defaultApplication}</option>}
        {apps.map(app => <option key={app.id} value={app.id}>{app.name}</option>)}
      </select></label>
      {apps.length === 0 && <p className="dsh-right-hint">{t("settings.noApps")}</p>}
      <h3>{t("settings.actions")}</h3><p className="dsh-right-hint">{t("settings.orderHint")}</p>
      <div className="dsh-right-action-list">{value.order.filter(id => ACTION_IDS.includes(id)).map((id, index) => <div key={id} className="dsh-right-setting-row">
        <label><input type="checkbox" checked={!value.hidden.includes(id)} onChange={event => patch({ hidden: event.target.checked ? value.hidden.filter(item => item !== id) : [...value.hidden, id] })} />{t(`menu.${ACTION_LABELS[id]}`)}</label>
        <button type="button" disabled={index === 0} aria-label={`${t("settings.moveUp")} · ${t(`menu.${ACTION_LABELS[id]}`)}`} onClick={() => move(index, -1)}>↑</button>
        <button type="button" disabled={index === value.order.length - 1} aria-label={`${t("settings.moveDown")} · ${t(`menu.${ACTION_LABELS[id]}`)}`} onClick={() => move(index, 1)}>↓</button>
      </div>)}</div>
    </div>
    <footer><button type="button" onClick={() => setValue(normalizeSettings(DEFAULT_SETTINGS))}>{t("settings.reset")}</button><span /><button type="button" onClick={() => onClose(null)}>{t("dialog.cancel")}</button><button type="button" className="dsh-right-primary" onClick={() => onSave(value)}>{t("settings.save")}</button></footer>
  </>;
}

export function PluginDialog({ dialog, settings, t, finish, updateSettings, diagnose }) {
  if (!dialog) return null;
  const title = t(dialog.type === "settings" ? "menu.settings" : dialog.type === "diagnostics" ? "menu.diagnostics" : dialog.type === "choices" ? "dialog.chooseFile" : "dialog.conflict");
  return <Modal key={dialog.id} title={title} onClose={finish} restoreFocus={dialog.restoreFocus} closeLabel={t("dialog.close")}>
    {dialog.type === "settings" && <Settings settings={settings} apps={dialog.apps} t={t} onSave={updateSettings} onClose={finish} />}
    {dialog.type === "choices" && <><div className="dsh-right-dialog-body"><p>{t("dialog.chooseHint")}</p><div className="dsh-right-choices">{dialog.choices.map(choice => <button type="button" key={choice.path} onClick={() => finish(choice.path)}>{choice.path}</button>)}</div></div><footer><button type="button" onClick={() => finish(null)}>{t("dialog.cancel")}</button></footer></>}
    {dialog.type === "conflict" && <><div className="dsh-right-dialog-body"><p>{t("dialog.conflictHint")}</p><p className="dsh-right-path">{dialog.path}</p></div><footer><button type="button" onClick={() => finish(null)}>{t("dialog.cancel")}</button><button type="button" onClick={() => finish("rename")}>{t("dialog.rename")}</button><button type="button" onClick={() => finish("replace")}>{t("dialog.replace")}</button></footer></>}
    {dialog.type === "diagnostics" && <><div className="dsh-right-dialog-body" aria-live="polite">{dialog.loading ? <p>{t("diagnostics.loading")}</p> : <>
      <p>{t(dialog.probe.available && dialog.probe.version >= 2 ? "diagnostics.ready" : dialog.probe.code === "unauthorized" || dialog.probe.code === "permission-denied" ? "notice.unauthorized" : "diagnostics.restart")}</p>
      <dl>{[["host", dialog.probe.available], ["safeSave", dialog.probe.capabilities?.includes("exclusive-save")], ["editorLocation", dialog.probe.capabilities?.includes("editor-location")], ["desktop", dialog.desktop], ["files", dialog.files], ["picker", dialog.picker], ["browser", dialog.browser]].map(([key, available]) => <React.Fragment key={key}><dt>{t(`diagnostics.${key}`)}</dt><dd>{t(available ? "diagnostics.available" : "diagnostics.unavailable")}</dd></React.Fragment>)}</dl>
      <p className="dsh-right-hint">{t("diagnostics.version")} {dialog.probe.pluginVersion ?? "—"}</p>
      <p className="dsh-right-hint">{t("diagnostics.nativeHint")}</p>
    </>}</div><footer><button type="button" disabled={dialog.loading} onClick={() => { void diagnose(); }}>{t("diagnostics.refresh")}</button><button type="button" onClick={() => finish(null)}>{t("dialog.close")}</button></footer></>}
  </Modal>;
}
