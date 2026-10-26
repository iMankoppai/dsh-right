import * as React from "react";
import {
  ACTION_GROUPS,
  ACTION_LABELS,
  DEFAULT_SETTINGS,
  normalizeSettings
} from "./settings.js";

/**
 * The standalone Settings → 右键管理 page.
 *
 * It edits the same browser-local settings object the in-menu dialog uses, so
 * a change here is visible on the next right-click without editing a config
 * file. Each toggle commits immediately; the menu dialog remains available
 * for the same fields when the user is already looking at a file.
 */
export function SettingsPage({ t, settingsStore, applySettings, getApps, getDiagnostics }) {
  const state = React.useSyncExternalStore(
    settingsStore.subscribe,
    settingsStore.get,
    settingsStore.get
  );
  const settings = normalizeSettings(state.settings);
  const apps = (typeof getApps === "function" ? getApps() : []) ?? [];
  const [status, setStatus] = React.useState("");
  const statusTimer = React.useRef(0);
  const [diagnostics, setDiagnostics] = React.useState(null);
  const [diagnosticsBusy, setDiagnosticsBusy] = React.useState(false);

  React.useEffect(() => () => window.clearTimeout(statusTimer.current), []);
  const runDiagnostics = React.useCallback(async () => {
    if (typeof getDiagnostics !== "function") return;
    setDiagnosticsBusy(true);
    try {
      setDiagnostics(await getDiagnostics());
    } finally {
      setDiagnosticsBusy(false);
    }
  }, [getDiagnostics]);
  React.useEffect(() => {
    void runDiagnostics();
  }, []);

  const commit = (next) => {
    const persisted = applySettings(next);
    setStatus(t(persisted ? "settingsPage.saved" : "settingsPage.saveFailed"));
    window.clearTimeout(statusTimer.current);
    statusTimer.current = window.setTimeout(() => setStatus(""), 2500);
  };

  const toggle = (id, visible) => {
    commit({
      ...settings,
      hidden: visible
        ? settings.hidden.filter((item) => item !== id)
        : [...new Set([...settings.hidden, id])]
    });
  };

  const move = (id, direction, group) => {
    const ordered = settings.order.filter((item) => group.includes(item));
    const at = ordered.indexOf(id);
    const other = ordered[at + direction];
    if (at < 0 || other === undefined) return;
    const order = [...settings.order];
    const a = order.indexOf(id);
    const b = order.indexOf(other);
    [order[a], order[b]] = [order[b], order[a]];
    commit({ ...settings, order });
  };

  const probe = diagnostics?.probe ?? {};
  const diagnosticsStatusKey =
    probe.available && probe.version >= 2
      ? "diagnostics.ready"
      : probe.code === "unauthorized" || probe.code === "permission-denied"
        ? "notice.unauthorized"
        : "diagnostics.restart";
  const diagnosticsRows = diagnostics
    ? [
        ["host", probe.available === true],
        ["safeSave", probe.capabilities?.includes("exclusive-save") === true],
        ["editorLocation", probe.capabilities?.includes("editor-location") === true],
        ["desktop", diagnostics.desktop === true],
        ["files", diagnostics.files === true],
        ["picker", diagnostics.picker === true],
        ["browser", diagnostics.browser === true]
      ]
    : [];

  return (
    <div className="dsh-right-manage">
      <header>
        <div className="dsh-right-manage-heading">
          <h2>{t("settingsPage.title")}</h2>
          <span className="dsh-right-manage-status" role="status" aria-live="polite">
            {status}
          </span>
        </div>
        <p className="dsh-right-manage-description">{t("settingsPage.description")}</p>
      </header>

      <section className="dsh-right-manage-section">
        <h3>{t("settingsPage.actions")}</h3>
        <p className="dsh-right-manage-hint">{t("settingsPage.orderHint")}</p>
        {ACTION_GROUPS.map((group, groupIndex) => {
          const items = settings.order.filter((id) => group.includes(id));
          return (
            <div className="dsh-right-manage-group" key={`group-${groupIndex}`}>
              {items.map((id, index) => {
                const visible = !settings.hidden.includes(id);
                const label = t(`menu.${ACTION_LABELS[id]}`);
                return (
                  <div className="dsh-right-manage-row" key={id}>
                    <label className="dsh-right-manage-check">
                      <input
                        type="checkbox"
                        checked={visible}
                        onChange={(event) => toggle(id, event.target.checked)}
                      />
                      <span>{label}</span>
                    </label>
                    <div className="dsh-right-manage-order">
                      <button
                        type="button"
                        disabled={index === 0}
                        aria-label={`${t("settings.moveUp")} · ${label}`}
                        onClick={() => move(id, -1, group)}
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        disabled={index === items.length - 1}
                        aria-label={`${t("settings.moveDown")} · ${label}`}
                        onClick={() => move(id, 1, group)}
                      >
                        ↓
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          );
        })}
      </section>

      <section className="dsh-right-manage-section">
        <h3>{t("settingsPage.appearance")}</h3>
        <label className="dsh-right-manage-row dsh-right-manage-field">
          <input
            type="checkbox"
            checked={settings.compact}
            onChange={(event) => commit({ ...settings, compact: event.target.checked })}
          />
          <span>{t("settings.compact")}</span>
        </label>
        <label className="dsh-right-manage-row dsh-right-manage-field">
          <span>{t("settings.separator")}</span>
          <select
            value={settings.separator}
            onChange={(event) => commit({ ...settings, separator: event.target.value })}
          >
            <option value="native">{t("settings.native")}</option>
            <option value="forward">/</option>
            <option value="backward">\</option>
          </select>
        </label>
        <label className="dsh-right-manage-row dsh-right-manage-field">
          <span>{t("settings.application")}</span>
          <select
            value={settings.defaultApplication}
            onChange={(event) => commit({ ...settings, defaultApplication: event.target.value })}
          >
            <option value="">{t("settings.systemDefault")}</option>
            {settings.defaultApplication &&
              !apps.some((app) => app.id === settings.defaultApplication) && (
                <option value={settings.defaultApplication}>{settings.defaultApplication}</option>
              )}
            {apps.map((app) => (
              <option key={app.id} value={app.id}>
                {app.name}
              </option>
            ))}
          </select>
        </label>
        {apps.length === 0 && <p className="dsh-right-manage-hint">{t("settingsPage.appsHint")}</p>}
      </section>

      <section className="dsh-right-manage-section">
        <h3>{t("settingsPage.diagnostics")}</h3>
        <p className="dsh-right-manage-hint">{t("settingsPage.diagnosticsHint")}</p>
        {diagnosticsBusy && <p className="dsh-right-manage-hint">{t("diagnostics.loading")}</p>}
        {!diagnosticsBusy && diagnostics && (
          <>
            <p className="dsh-right-manage-hint">{t(diagnosticsStatusKey)}</p>
            <dl className="dsh-right-manage-diagnostics">
              {diagnosticsRows.map(([key, available]) => (
                <React.Fragment key={key}>
                  <dt>{t(`diagnostics.${key}`)}</dt>
                  <dd>{t(available ? "diagnostics.available" : "diagnostics.unavailable")}</dd>
                </React.Fragment>
              ))}
            </dl>
            <p className="dsh-right-manage-hint">
              {t("diagnostics.version")} {probe.pluginVersion ?? "—"}
            </p>
          </>
        )}
        <button
          type="button"
          className="dsh-right-manage-action"
          disabled={diagnosticsBusy}
          onClick={() => void runDiagnostics()}
        >
          {t(diagnostics ? "diagnostics.refresh" : "settingsPage.runDiagnostics")}
        </button>
      </section>

      <footer className="dsh-right-manage-footer">
        <button type="button" onClick={() => commit(DEFAULT_SETTINGS)}>
          {t("settings.reset")}
        </button>
      </footer>
    </div>
  );
}
