import React from 'react';
import { createRoot } from 'react-dom/client';
import { PluginDialog } from '../src/client/dialogs.jsx';
import { MENU_CSS } from '../src/client/menu-styles.js';
import { normalizeSettings, loadSettings, saveSettings } from '../src/client/settings.js';
import { zh } from '../src/client/i18n.js';
const style = document.createElement('style'); style.textContent = MENU_CSS; document.head.append(style);
const root = createRoot(document.getElementById('root'));
window.results = [];
let seq = 0;
function App() {
  const [dialog, setDialog] = React.useState(null);
  const [settings, setSettings] = React.useState(loadSettings);
  const finish = value => { window.results.push(value); setDialog(null); };
  window.showDialog = (type, extra = {}) => setDialog({ type, id: ++seq, apps: [{ id: 'vscode', name: 'Visual Studio Code' }], ...extra });
  return <PluginDialog dialog={dialog} settings={settings} t={key => zh[key] ?? key} finish={finish}
    updateSettings={value => { const normalized = normalizeSettings(value); setSettings(normalized); saveSettings(normalized); finish('saved'); }} diagnose={() => {}} />;
}
root.render(<App />);
