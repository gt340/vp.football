/* ---------- INIT ---------- */
SettingsManager.load();
state.homeTactics = { ...SettingsManager.current.tactics };
syncTacticsUI();
resize();
if (window.speechSynthesis) window.speechSynthesis.getVoices();
