/* ---------- MENU / SQUAD SELECTION UI ---------- */
function buildTeamSelect(elId, isHome) {
  const el = document.getElementById(elId);
  const current = isHome ? state.homeTeam : state.awayTeam;
  el.innerHTML = TEAMS.map(t => `
    <div class="team-card ${t.id===current.id?'selected':''}" data-id="${t.id}">
      <div class="swatch" style="background:${t.primary};${t.primary==='#ffffff'?'border-color:#666':''}"></div>
      <div class="name">${t.name}</div>
    </div>`).join('');
  el.querySelectorAll('.team-card').forEach(card => {
    card.onclick = () => {
      el.querySelectorAll('.team-card').forEach(c => c.classList.remove('selected'));
      card.classList.add('selected');
      const team = TEAMS.find(t => t.id === card.dataset.id);
      if (isHome) {
        state.homeTeam = team;
        if (state.awayTeam.id === team.id) { state.awayTeam = TEAMS.find(t => t.id !== team.id); buildTeamSelect('away-select', false); }
      } else {
        state.awayTeam = team;
        if (state.homeTeam.id === team.id) { state.homeTeam = TEAMS.find(t => t.id !== team.id); buildTeamSelect('team-select', true); }
      }
    };
  });
}
function setupChips(id, key) {
  document.getElementById(id).querySelectorAll('.opt-chip').forEach(chip => {
    chip.onclick = () => {
      document.getElementById(id).querySelectorAll('.opt-chip').forEach(c => c.classList.remove('selected'));
      chip.classList.add('selected');
      state[key] = parseInt(chip.dataset.val, 10);
    };
  });
}
function buildPlayerGrid() {
  const grid = document.getElementById('player-grid');
  const need = state.teamSize;
  const gks = ALL_PLAYERS.filter(p => p.pos === 'GK');
  const others = ALL_PLAYERS.filter(p => p.pos !== 'GK');
  state.selectedPlayerIds = [gks[0].id, ...others.slice(0, need - 1).map(p => p.id)];
  grid.innerHTML = ALL_PLAYERS.map(p => {
    const sel = state.selectedPlayerIds.includes(p.id) ? 'selected' : '';
    return `<div class="player-pick ${sel}" data-id="${p.id}">
      <div class="p-name">${p.name}</div>
      <div class="p-stats">⚡${p.speed} 💪${p.power}</div>
      <span class="p-pos">${p.pos}</span>
    </div>`;
  }).join('');
  updatePickCount();
  grid.querySelectorAll('.player-pick').forEach(card => {
    card.onclick = () => {
      const id = parseInt(card.dataset.id, 10);
      const idx = state.selectedPlayerIds.indexOf(id);
      if (idx >= 0) { state.selectedPlayerIds.splice(idx, 1); card.classList.remove('selected'); }
      else if (state.selectedPlayerIds.length < need) { state.selectedPlayerIds.push(id); card.classList.add('selected'); }
      updatePickCount();
    };
  });
}
function updatePickCount() {
  const need = state.teamSize;
  const n = state.selectedPlayerIds.length;
  const hasGK = state.selectedPlayerIds.some(id => ALL_PLAYERS.find(x => x.id === id)?.pos === 'GK');
  document.getElementById('pick-count').textContent = `(${n}/${need})${hasGK ? '' : ' · need GK'}`;
  document.getElementById('btn-kickoff').disabled = n !== need || !hasGK;
}

buildTeamSelect('team-select', true);
buildTeamSelect('away-select', false);
setupChips('duration-opts', 'duration');
setupChips('size-opts', 'teamSize');

/* ---------- TACTICS UI (Phase 3, Step 16) ----------
   Pre-kickoff panel only (per-match set-piece/halftime tactical
   overlays were judged out of scope for this phase — see Known
   Limitations in the report). Reuses the same .opt-chip pattern as
   duration/size so it stays visually consistent with the existing UI. */
function syncTacticsUI() {
  const sync = (id, val) => {
    document.getElementById(id).querySelectorAll('.opt-chip').forEach(c => {
      c.classList.toggle('selected', c.dataset.val === val);
    });
  };
  sync('formation-opts', state.homeTactics.formationId);
  sync('mentality-opts', state.homeTactics.mentality);
  sync('style-opts', state.homeTactics.style);
}
function setupTacticChips(id, key, evt) {
  document.getElementById(id).querySelectorAll('.opt-chip').forEach(chip => {
    chip.onclick = () => {
      document.getElementById(id).querySelectorAll('.opt-chip').forEach(c => c.classList.remove('selected'));
      chip.classList.add('selected');
      state.homeTactics[key] = chip.dataset.val;
      SettingsManager.current.tactics = { ...state.homeTactics };
      SettingsManager.persist();
      EventBus.emit(evt, { home: true, [key]: chip.dataset.val }); // Step 18: fires only on an actual user change, never per-frame
    };
  });
}
setupTacticChips('formation-opts', 'formationId', GameEvents.FORMATION_CHANGED);
setupTacticChips('mentality-opts', 'mentality', GameEvents.MENTALITY_CHANGED);
setupTacticChips('style-opts', 'style', GameEvents.STYLE_CHANGED);

/* ---------- IN-MATCH SQUAD/TACTICS PANEL (Phase 4, Steps 7, 11, 18) ----------
   One compact panel, two tabs, reusing the existing .opt-chip / .panel
   visual language. Positioned (see CSS) to never cover the joystick,
   action buttons, canvas, or scoreboard. Available during active play
   and at halftime — SubstitutionManager itself is what actually
   enforces when a substitution may go through. */
let mpSelectedOutgoingId = null;
function openMatchPanel() {
  state.tacticalPanelOpen = true;
  document.getElementById('match-panel').classList.remove('hidden');
  syncInMatchTacticsUI();
  renderBenchPanel();
  EventBus.emit(GameEvents.TACTICAL_PANEL_OPENED, {});
}
function closeMatchPanel() {
  state.tacticalPanelOpen = false;
  document.getElementById('match-panel').classList.add('hidden');
  mpSelectedOutgoingId = null;
  EventBus.emit(GameEvents.TACTICAL_PANEL_CLOSED, {});
}
document.getElementById('match-menu-toggle').onclick = () => {
  if (document.getElementById('match-panel').classList.contains('hidden')) openMatchPanel();
  else closeMatchPanel();
};
document.getElementById('match-panel-close').onclick = closeMatchPanel;
document.getElementById('match-panel').querySelectorAll('.mp-tab').forEach(tab => {
  tab.onclick = () => {
    document.getElementById('match-panel').querySelectorAll('.mp-tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    const showBench = tab.dataset.tab === 'bench';
    document.getElementById('mp-tactics').classList.toggle('hidden', showBench);
    document.getElementById('mp-bench').classList.toggle('hidden', !showBench);
    if (showBench) renderBenchPanel();
  };
});
function syncInMatchTacticsUI() {
  const sync = (id, val) => document.getElementById(id).querySelectorAll('.opt-chip').forEach(c => c.classList.toggle('selected', c.dataset.val === val));
  sync('im-formation-opts', state.homeTactics.formationId);
  sync('im-mentality-opts', state.homeTactics.mentality);
  sync('im-style-opts', state.homeTactics.style);
}
function setupInMatchTacticChips(id, key, evt, label) {
  document.getElementById(id).querySelectorAll('.opt-chip').forEach(chip => {
    chip.onclick = () => {
      document.getElementById(id).querySelectorAll('.opt-chip').forEach(c => c.classList.remove('selected'));
      chip.classList.add('selected');
      state.homeTactics[key] = chip.dataset.val;
      SettingsManager.current.tactics = { ...state.homeTactics };
      SettingsManager.persist();
      if (key === 'formationId' && state.homePlayers.length) TacticalSystem.assignRoles(state.homePlayers, true); // Step 10, 18
      EventBus.emit(evt, { home: true, [key]: chip.dataset.val });
      if (state.running) { // Step 10/20: a genuine in-match change, not just the pre-kickoff default
        EventBus.emit(GameEvents.IN_MATCH_TACTIC_CHANGED, { key, value: chip.dataset.val });
        showRulesBanner(label.toUpperCase() + ' CHANGED', '#38bdf8', 1300);
        showCommentary(`${label} change from the home bench.`, 1800);
      }
    };
  });
}
setupInMatchTacticChips('im-formation-opts', 'formationId', GameEvents.FORMATION_CHANGED, 'Formation');
setupInMatchTacticChips('im-mentality-opts', 'mentality', GameEvents.MENTALITY_CHANGED, 'Mentality');
setupInMatchTacticChips('im-style-opts', 'style', GameEvents.STYLE_CHANGED, 'Style');

function mpPlayerRow(p, isOutgoingCandidate) {
  const tier = StaminaSystem.tier(p);
  const tierColor = { HIGH: '#22c55e', MEDIUM: '#facc15', LOW: '#fb923c', CRITICAL: '#ef4444' }[tier];
  const disabled = p.discipline.sentOff;
  const selected = p.id === mpSelectedOutgoingId;
  const row = document.createElement('div');
  row.className = 'mp-row' + (selected ? ' selected' : '') + (disabled ? ' disabled' : '');
  row.innerHTML = `<span class="mp-name">${p.name} <span style="color:#8b9bb4">(${p.role || p.pos})</span></span>
    <div class="mp-stamina-bar"><div class="mp-stamina-fill" style="width:${Math.max(0, p.squadStatus.stamina)}%;background:${tierColor}"></div></div>`;
  row.dataset.id = p.id;
  return row;
}
function renderBenchPanel() {
  const gate = SubstitutionManager.canSubstitute(true);
  const used = state.substitutionsUsed.home, max = SQUAD_CONFIG.maxSubstitutions;
  document.getElementById('mp-sub-count').textContent = `Substitutions used: ${used}/${max}` + (gate.ok ? '' : ` — unavailable (${gate.reason})`);
  const onPitchEl = document.getElementById('mp-onpitch-list');
  const benchEl = document.getElementById('mp-bench-list');
  onPitchEl.innerHTML = ''; benchEl.innerHTML = '';
  const outgoing = state.homePlayers.find(p => p.id === mpSelectedOutgoingId);
  state.homePlayers.forEach(p => {
    const row = mpPlayerRow(p);
    if (!p.discipline.sentOff) row.onclick = () => { mpSelectedOutgoingId = (mpSelectedOutgoingId === p.id ? null : p.id); renderBenchPanel(); };
    onPitchEl.appendChild(row);
  });
  state.homeBench.forEach(p => {
    const row = mpPlayerRow(p);
    const gkMismatch = outgoing && outgoing.isGK && p.pos !== 'GK';
    if (p.discipline.sentOff || gkMismatch || !outgoing || !gate.ok) row.classList.add('disabled');
    else row.onclick = () => {
      const result = SubstitutionManager.request(true, outgoing.id, p.id);
      mpSelectedOutgoingId = null;
      renderBenchPanel();
      if (!result.ok) showRulesBanner('SUB NOT ALLOWED', '#ef4444', 1400);
    };
    benchEl.appendChild(row);
  });
}
// Keep the toggle button visible only while it's meaningful (matches
// the existing #controls.active pattern used for the joystick/buttons).
EventBus.on('stateChange', ({ to }) => {
  document.getElementById('match-menu-toggle').classList.toggle('active', to === GameStates.PLAYING || to === GameStates.HALFTIME);
  if (to !== GameStates.PLAYING && to !== GameStates.HALFTIME) closeMatchPanel();
});
EventBus.on(GameEvents.PLAYER_SUBSTITUTED_ON, () => { if (state.tacticalPanelOpen) renderBenchPanel(); });

document.getElementById('btn-to-players').onclick = () => {
  AudioManager.ensure();
  if (!Game.state.transition(GameStates.SQUAD_SELECTION)) return;
  document.getElementById('menu-screen').classList.add('hidden');
  document.getElementById('players-screen').classList.remove('hidden');
  buildPlayerGrid();
};
document.getElementById('btn-back-menu').onclick = () => {
  Game.state.transition(GameStates.MENU);
  document.getElementById('players-screen').classList.add('hidden');
  document.getElementById('menu-screen').classList.remove('hidden');
};
document.getElementById('btn-kickoff').onclick = () => {
  const hasGK = state.selectedPlayerIds.some(id => ALL_PLAYERS.find(x => x.id === id)?.pos === 'GK');
  if (state.selectedPlayerIds.length !== state.teamSize || !hasGK) return; // guard: invalid squad config
  if (!Game.state.transition(GameStates.PRE_MATCH)) return;
  startMatch();
};
document.getElementById('btn-replay').onclick = () => {
  if (!Game.state.transition(GameStates.PRE_MATCH)) return;
  document.getElementById('result-screen').classList.add('hidden');
  startMatch();
};
document.getElementById('btn-menu').onclick = () => {
  Game.state.transition(GameStates.MENU);
  document.getElementById('result-screen').classList.add('hidden');
  document.getElementById('menu-screen').classList.remove('hidden');
  document.getElementById('hud').classList.add('hidden');
  document.getElementById('controls').classList.remove('active');
  document.getElementById('selected-info').classList.add('hidden');
  state.running = false;
  AudioManager.cancelSpeech();
};

