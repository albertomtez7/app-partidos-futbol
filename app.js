const MIN_LEVEL = 0;
const MAX_LEVEL = 10;
const DEFAULT_LEVEL = 5;
const RESULT_WEIGHT = 0.8;
const GOAL_WEIGHT = 0.1;
const MVP_WEIGHT = 0.1;
const GOALKEEPER_BONUS_WEIGHT = 0.1;
const BALANCE_TOLERANCE = 0.4;
const SUPABASE_URL = "https://rumvrsonnxujcxbrizyb.supabase.co";
const SUPABASE_KEY = "sb_publishable_vhH6ilTt_-KHGC8TKrwqnQ_pYhC-ntf";
const SUPABASE_REST_URL = `${SUPABASE_URL}/rest/v1`;

const GROUPS = {
  tejares:     { id: "tejares",     name: "Tejares",     teamSize: 5,  password: "gamodebengala2025" },
  constantina: { id: "constantina", name: "Constantina", teamSize: 7,  password: "lospinos2026" },
};

let currentGroup = null;

const state = { players: [], matches: [] };
normalizeState();
let selectedIds = new Set();
let currentTeams = null;
let goalkeeperIds = { white: null, black: null };
let pendingMatches = [];
let goalkeeperSelectedIds = new Set(); // ids marcados como portero en inscripcion

function saveCurrentTeamsLocal() {
  if (!currentGroup) return;
  const key = `currentTeams_${currentGroup.id}`;
  if (currentTeams) {
    localStorage.setItem(key, JSON.stringify({ currentTeams, goalkeeperIds }));
  } else {
    localStorage.removeItem(key);
  }
}

function loadCurrentTeamsLocal() {
  if (!currentGroup) return;
  const key = `currentTeams_${currentGroup.id}`;
  const saved = localStorage.getItem(key);
  if (saved) {
    const parsed = JSON.parse(saved);
    currentTeams = parsed.currentTeams;
    goalkeeperIds = parsed.goalkeeperIds || { white: null, black: null };
  }
}

const els = {
  groupSelector:   document.querySelector("#groupSelector"),
  appRoot:         document.querySelector("#appRoot"),
  groupEyebrow:    document.querySelector("#groupEyebrow"),
  groupTitle:      document.querySelector("#groupTitle"),
  changeGroupBtn:  document.querySelector("#changeGroupBtn"),
  pitchSection:    document.querySelector("#pitchSection"),
  playerForm:      document.querySelector("#playerForm"),
  playerName:      document.querySelector("#playerName"),
  playerLevel:     document.querySelector("#playerLevel"),
  playersList:     document.querySelector("#playersList"),
  playerCount:     document.querySelector("#playerCount"),
  signupList:      document.querySelector("#signupList"),
  selectedCount:   document.querySelector("#selectedCount"),
  makeTeamsBtn:    document.querySelector("#makeTeamsBtn"),
  clearSignupBtn:  document.querySelector("#clearSignupBtn"),
  teamsArea:       document.querySelector("#teamsArea"),
  whiteTeam:       document.querySelector("#whiteTeam"),
  blackTeam:       document.querySelector("#blackTeam"),
  whiteAvg:        document.querySelector("#whiteAvg"),
  blackAvg:        document.querySelector("#blackAvg"),
  resultForm:      document.querySelector("#resultForm"),
  whiteScore:      document.querySelector("#whiteScore"),
  blackScore:      document.querySelector("#blackScore"),
  mvpSelect:       document.querySelector("#mvpSelect"),
  goalInputs:      document.querySelector("#goalInputs"),
  rankingList:     document.querySelector("#rankingList"),
  historyList:     document.querySelector("#historyList"),
  matchCount:      document.querySelector("#matchCount"),
  importBtn:       document.querySelector("#importBtn"),
  selectedCount:   document.querySelector("#selectedCount"),
  pendingArea:     document.querySelector("#pendingArea"),
  toast:           document.querySelector("#toast"),
};

// ── Group selector ──────────────────────────────────────────────
document.querySelector("#btnTejares").addEventListener("click", () => askPassword("tejares"));
document.querySelector("#btnConstantina").addEventListener("click", () => askPassword("constantina"));

function askPassword(groupId) {
  const group = GROUPS[groupId];
  const input = prompt(`Contraseña para ${group.name}:`);
  if (input === null) return; // cancelled
  if (input === group.password) {
    selectGroup(groupId);
  } else {
    alert("Contraseña incorrecta. Inténtalo de nuevo.");
  }
}
els.changeGroupBtn.addEventListener("click", () => {
  localStorage.removeItem("selectedGroup");
  els.appRoot.hidden = true;
  els.groupSelector.style.display = "flex";
  state.players = [];
  state.matches = [];
  currentTeams = null;
  selectedIds.clear();
});

function selectGroup(groupId) {
  currentGroup = GROUPS[groupId];
  localStorage.setItem("selectedGroup", groupId);
  els.groupSelector.style.display = "none";
  els.appRoot.hidden = false;
  els.groupEyebrow.textContent = "Futbol amigos";
  els.groupTitle.textContent = `${currentGroup.name} · ${currentGroup.teamSize}v${currentGroup.teamSize}`;
  // Update selectedCount label
  els.selectedCount.textContent = `0 (mín. ${currentGroup.teamSize * 2})`;
  renderAll();
  syncFromSupabase(false);
}

// ── Tab switching + pitch visibility ────────────────────────────
document.querySelectorAll(".tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".tab, .panel").forEach((el) => el.classList.remove("active"));
    tab.classList.add("active");
    document.querySelector(`#${tab.dataset.tab}`).classList.add("active");
    els.pitchSection.style.display = tab.dataset.tab === "match" ? "" : "none";
  });
});
// Hide pitch on load (players tab is active by default)
els.pitchSection.style.display = "none";

// ── Player form ──────────────────────────────────────────────────
els.playerForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const name = els.playerName.value.trim();
  const level = clamp(Number(els.playerLevel.value), MIN_LEVEL, MAX_LEVEL);
  if (!name) return;
  setFormBusy(els.playerForm, true);
  try {
    await createRemotePlayer({ name, level, initialLevel: level,
      stats: { played: 0, wins: 0, losses: 0, draws: 0, goals: 0, mvps: 0 } });
    await syncFromSupabase(false);
    els.playerForm.reset();
    els.playerLevel.value = DEFAULT_LEVEL;
    showToast("Jugador añadido");
  } catch (error) {
    showToast(`No se pudo guardar: ${error.message}`);
  } finally {
    setFormBusy(els.playerForm, false);
  }
});

// ── Make teams ───────────────────────────────────────────────────
els.makeTeamsBtn.addEventListener("click", async () => {
  const minPlayers = currentGroup.teamSize * 2;
  const players = state.players.filter((player) => selectedIds.has(player.id));
  if (players.length < minPlayers) {
    showToast(`Selecciona al menos ${minPlayers} jugadores`);
    return;
  }

  const generatedTeams = makeBalancedTeams(players);
  // Assign goalkeepers from selection
  const gkList = [...goalkeeperSelectedIds].filter(id => players.some(p => p.id === id));
  const newGkIds = { white: null, black: null };
  if (gkList.length === 2) {
    // Assign one to each team
    const inWhite = generatedTeams.white.find(p => p.id === gkList[0]);
    newGkIds.white = inWhite ? gkList[0] : (generatedTeams.white.find(p => p.id === gkList[1]) ? gkList[1] : null);
    newGkIds.black = newGkIds.white === gkList[0] ? gkList[1] : gkList[0];
    // Validate one per team
    const wInBlack = generatedTeams.black.find(p => p.id === newGkIds.white);
    if (wInBlack) { newGkIds.black = newGkIds.white; newGkIds.white = null; }
  } else if (gkList.length === 1) {
    // Assign randomly to one team
    const inWhite = generatedTeams.white.find(p => p.id === gkList[0]);
    const inBlack = generatedTeams.black.find(p => p.id === gkList[0]);
    if (inWhite) newGkIds.white = gkList[0];
    else if (inBlack) newGkIds.black = gkList[0];
  }
  try {
    await createRemoteTeamDraft(generatedTeams);
    currentTeams = generatedTeams;
    goalkeeperIds = newGkIds;
    saveCurrentTeamsLocal();
    renderTeams();
    showToast("Equipos generados");
  } catch (error) {
    currentTeams = null;
    renderTeams();
    showToast(`No se pudieron guardar los equipos: ${error.message}`);
  }
});

els.clearSignupBtn.addEventListener("click", () => {
  selectedIds.clear();
  currentTeams = null;
  goalkeeperIds = { white: null, black: null };
  saveCurrentTeamsLocal();
  renderAll();
});

// ── Result form ──────────────────────────────────────────────────
els.resultForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!currentTeams) return;
  const whiteScore = Math.max(0, Number(els.whiteScore.value) || 0);
  const blackScore = Math.max(0, Number(els.blackScore.value) || 0);
  const goalsByPlayer = {};
  document.querySelectorAll("[data-goals-player]").forEach((input) => {
    goalsByPlayer[input.dataset.goalsPlayer] = Math.max(0, Number(input.value) || 0);
  });
  const whitePlayerGoals = currentTeams.white.reduce((sum, p) => sum + (goalsByPlayer[p.id] || 0), 0);
  const blackPlayerGoals = currentTeams.black.reduce((sum, p) => sum + (goalsByPlayer[p.id] || 0), 0);
  if (whitePlayerGoals !== whiteScore || blackPlayerGoals !== blackScore) {
    showToast("Los goles de cada equipo deben coincidir con el marcador");
    return;
  }
  setFormBusy(els.resultForm, true);
  const previousState = cloneState(state);
  const match = saveMatch(whiteScore, blackScore, goalsByPlayer, els.mvpSelect.value);
  try {
    await createRemoteMatch(match);
    selectedIds.clear();
    currentTeams = null;
    goalkeeperIds = { white: null, black: null };
    els.whiteScore.value = 0;
    els.blackScore.value = 0;
    await syncFromSupabase(false);
    showToast("Partido guardado");
  } catch (error) {
    state.players = previousState.players;
    state.matches = previousState.matches;
    renderAll();
    showToast(`No se pudo guardar el partido: ${error.message}`);
  } finally {
    setFormBusy(els.resultForm, false);
  }
});

els.importBtn.addEventListener("click", () => syncFromSupabase(true));

// ── State helpers ────────────────────────────────────────────────
function normalizeState() {
  let changed = false;
  state.players.forEach((player) => {
    if (!player.stats) {
      player.stats = { played: 0, wins: 0, losses: 0, draws: 0, goals: 0, mvps: 0 };
      changed = true;
    }
    if (player.level > MAX_LEVEL) { player.level = Number((player.level / 10).toFixed(1)); changed = true; }
    if (player.initialLevel > MAX_LEVEL) { player.initialLevel = Number((player.initialLevel / 10).toFixed(1)); changed = true; }
    player.level = clamp(player.level, MIN_LEVEL, MAX_LEVEL);
    player.initialLevel = clamp(player.initialLevel ?? player.level, MIN_LEVEL, MAX_LEVEL);
  });
  if (changed) renderAll();
}

// ── Supabase ─────────────────────────────────────────────────────
async function syncFromSupabase(showMessage = true) {
  if (!currentGroup) return;
  try {
    const groupFilter = `group_id=eq.${currentGroup.id}`;
    const [remotePlayers, remoteMatches, remoteMatchPlayers] = await Promise.all([
      supabaseRequest(`players?select=*&${groupFilter}&order=name.asc`),
      supabaseRequest(`matches?select=*&${groupFilter}&order=created_at.desc`),
      supabaseRequest("match_players?select=*&order=id.asc"),
    ]);
    state.players = remotePlayers.map(mapRemotePlayer);
    state.matches = mapRemoteMatches(remoteMatches, remoteMatchPlayers);
    selectedIds = new Set([...selectedIds].filter((id) => state.players.some((p) => p.id === id)));
    currentTeams = null;
    await loadPendingMatchesRemote();
    saveAndRender(showMessage ? "Datos actualizados desde Supabase" : "");
  } catch (error) {
    showToast(`No se pudo cargar Supabase: ${error.message}`);
  }
}

async function supabaseRequest(path, options = {}) {
  const response = await fetch(`${SUPABASE_REST_URL}/${path}`, {
    ...options,
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      "Content-Type": "application/json",
      ...options.headers,
    },
  });
  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || `Supabase ${response.status}`);
  }
  if (response.status === 204) return null;
  const text = await response.text();
  if (!text) return null;
  return JSON.parse(text);
}

async function createRemotePlayer(player) {
  const [savedPlayer] = await supabaseRequest("players?select=*", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({
      name: player.name,
      level: player.level,
      initial_level: player.initialLevel,
      group_id: currentGroup.id,
    }),
  });
  return savedPlayer;
}

async function deleteRemotePlayer(playerId) {
  await supabaseRequest(`players?id=eq.${encodeURIComponent(playerId)}`, {
    method: "DELETE",
    headers: { Prefer: "return=minimal" },
  });
}

async function updateRemotePlayerManual(player) {
  await supabaseRequest(`players?id=eq.${encodeURIComponent(player.id)}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ name: player.name, level: player.level, initial_level: player.level }),
  });
}

async function createRemoteTeamDraft(teams) {
  await supabaseRequest("team_drafts", {
    method: "POST",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({
      white_player_ids: teams.white.map((p) => p.id),
      black_player_ids: teams.black.map((p) => p.id),
      group_id: currentGroup.id,
    }),
  });
}

async function createRemoteMatch(match) {
  const [savedMatch] = await supabaseRequest("matches?select=*", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({
      white_score: match.whiteScore,
      black_score: match.blackScore,
      winner: match.winner,
      group_id: currentGroup.id,
      white_avg: match.whiteAvg,
      black_avg: match.blackAvg,
    }),
  });
  const matchPlayers = match.players.map((player) => ({
    match_id: savedMatch.id,
    player_id: player.id,
    player_name: player.name,
    team: player.team,
    level_before: player.levelBefore,
    level_after: player.levelAfter,
    goals: player.goals,
    mvp: player.mvp,
    delta: player.delta,
  }));
  await supabaseRequest("match_players", {
    method: "POST",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify(matchPlayers),
  });
  await Promise.all(match.players.map((p) => updateRemotePlayerAfterMatch(p)));
}

async function deleteRemoteMatch(matchId) {
  await supabaseRequest(`match_players?match_id=eq.${encodeURIComponent(matchId)}`, {
    method: "DELETE", headers: { Prefer: "return=minimal" },
  });
  await supabaseRequest(`matches?id=eq.${encodeURIComponent(matchId)}`, {
    method: "DELETE", headers: { Prefer: "return=minimal" },
  });
}

async function updateRemoteMatch(match) {
  await supabaseRequest(`matches?id=eq.${encodeURIComponent(match.id)}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ white_score: match.whiteScore, black_score: match.blackScore, winner: match.winner, white_avg: match.whiteAvg, black_avg: match.blackAvg }),
  });
  await supabaseRequest(`match_players?match_id=eq.${encodeURIComponent(match.id)}`, {
    method: "DELETE", headers: { Prefer: "return=minimal" },
  });
  const matchPlayers = match.players.map((p) => ({
    match_id: match.id, player_id: p.id, player_name: p.name, team: p.team,
    level_before: p.levelBefore, level_after: p.levelAfter, goals: p.goals, mvp: p.mvp, delta: p.delta,
  }));
  await supabaseRequest("match_players", {
    method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify(matchPlayers),
  });
  await Promise.all(match.players.map((p) => updateRemotePlayerAfterMatch(p)));
}

async function updateRemotePlayerAfterMatch(matchPlayer) {
  const stored = state.players.find((p) => p.id === matchPlayer.id);
  if (!stored) return;
  await supabaseRequest(`players?id=eq.${encodeURIComponent(matchPlayer.id)}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({
      level: stored.level, played: stored.stats.played, wins: stored.stats.wins,
      losses: stored.stats.losses, draws: stored.stats.draws, goals: stored.stats.goals, mvps: stored.stats.mvps,
    }),
  });
}

function mapRemotePlayer(row) {
  return {
    id: row.id, name: row.name, level: Number(row.level), initialLevel: Number(row.initial_level),
    stats: { played: row.played, wins: row.wins, losses: row.losses, draws: row.draws, goals: row.goals, mvps: row.mvps },
  };
}

function mapRemoteMatches(matches, matchPlayers) {
  const playersByMatch = new Map();
  matchPlayers.forEach((row) => {
    if (!playersByMatch.has(row.match_id)) playersByMatch.set(row.match_id, []);
    playersByMatch.get(row.match_id).push({
      id: row.player_id, name: row.player_name, team: row.team,
      levelBefore: Number(row.level_before), levelAfter: Number(row.level_after),
      goals: row.goals, mvp: row.mvp, delta: Number(row.delta),
    });
  });
  return matches.map((match) => {
    const players = playersByMatch.get(match.id) || [];
    return {
      id: match.id, date: match.created_at, whiteScore: match.white_score,
      blackScore: match.black_score, winner: match.winner,
      whiteAvg: match.white_avg !== null ? Number(match.white_avg) : null,
      blackAvg: match.black_avg !== null ? Number(match.black_avg) : null,
      whiteIds: players.filter((p) => p.team === "white").map((p) => p.id),
      blackIds: players.filter((p) => p.team === "black").map((p) => p.id),
      players,
    };
  });
}

function recalculateAllPlayersFromHistory() {
  state.players.forEach((player) => {
    player.level = player.initialLevel;
    player.stats = { played: 0, wins: 0, losses: 0, draws: 0, goals: 0, mvps: 0 };
  });
  const sorted = [...state.matches].sort((a, b) => new Date(a.date) - new Date(b.date));
  sorted.forEach((match) => {
    const whiteIds = new Set(match.players.filter((p) => p.team === "white").map((p) => p.id));
    // Use stored avgs if available, otherwise recalculate from current levels
    const whiteAvg = match.whiteAvg !== null && match.whiteAvg !== undefined
      ? match.whiteAvg
      : avgLevelById([...whiteIds]);
    const blackAvg = match.blackAvg !== null && match.blackAvg !== undefined
      ? match.blackAvg
      : avgLevelById([...match.players.filter((p) => p.team === "black").map((p) => p.id)]);
    match.players.forEach((mp) => {
      const stored = state.players.find((p) => p.id === mp.id);
      if (!stored) return;
      const team = mp.team;
      const rivalTeamAvg = team === "white" ? blackAvg : whiteAvg;
      const playerTeamAvg = team === "white" ? whiteAvg : blackAvg;
      const delta = calculateRatingDelta({
        team, winner: match.winner, goals: mp.goals, isMvp: mp.mvp,
        isGoalkeeper: mp.goalkeeper || false, goalkeeperBonus: mp.goalkeeperBonus || false,
        playerTeamAvg, rivalTeamAvg,
      });
      mp.levelBefore = stored.level;
      stored.level = clamp(Number((stored.level + delta).toFixed(2)), MIN_LEVEL, MAX_LEVEL);
      mp.levelAfter = stored.level;
      mp.delta = delta;
      stored.stats.played += 1;
      stored.stats.goals += mp.goals || 0;
      if (mp.mvp) stored.stats.mvps += 1;
      if (match.winner === "draw") stored.stats.draws += 1;
      else if (match.winner === team) stored.stats.wins += 1;
      else stored.stats.losses += 1;
    });
  });
}

function avgLevelById(ids) {
  const players = ids.map((id) => state.players.find((p) => p.id === id)).filter(Boolean);
  return players.length ? players.reduce((sum, p) => sum + p.level, 0) / players.length : 0;
}

// ── Render ───────────────────────────────────────────────────────
function saveAndRender(message) {
  renderAll();
  if (message) showToast(message);
}

function renderAll() {
  renderPlayers();
  renderSignup();
  renderTeams();
  renderRanking();
  renderHistory();
  renderPending();
}

function renderPlayers() {
  if (!currentGroup) return;
  els.playerCount.textContent = `${state.players.length} jugadores`;
  els.playersList.innerHTML = "";
  if (!state.players.length) {
    els.playersList.append(emptyRow("Añade jugadores para empezar."));
    return;
  }
  [...state.players].sort((a, b) => a.name.localeCompare(b.name, "es")).forEach((player) => {
    const row = document.createElement("article");
    row.className = "row";
    row.innerHTML = `
      <div style="flex:1;min-width:0">
        <div class="row-title" id="view-${player.id}">
          <strong>${escapeHtml(player.name)}</strong><span class="pill">${player.level.toFixed(1)}</span>
        </div>
        <div class="meta">${player.stats.played} PJ · ${player.stats.wins} V · ${player.stats.draws} E · ${player.stats.losses} D · ${player.stats.goals} goles · ${player.stats.mvps} MVP</div>
        <div id="edit-${player.id}" style="display:none;gap:6px;margin-top:6px" class="edit-row">
          <input type="text" value="${escapeHtml(player.name)}" style="flex:1;min-width:0;min-height:36px;padding:0 8px" />
          <input type="number" min="0" max="10" step="0.1" value="${player.level.toFixed(1)}" style="width:70px;min-height:36px;padding:0 8px" />
          <button class="small save-btn" type="button">✓</button>
          <button class="small secondary cancel-btn" type="button">✕</button>
        </div>
      </div>
      <div style="display:flex;gap:6px;align-items:center">
        <button class="secondary small edit-btn" type="button">Editar</button>
        <button class="secondary small delete-btn" type="button">Borrar</button>
      </div>
    `;
    const viewEl = row.querySelector(`#view-${player.id}`);
    const editEl = row.querySelector(`#edit-${player.id}`);
    const editBtn = row.querySelector(".edit-btn");
    const deleteBtn = row.querySelector(".delete-btn");
    const saveBtn = row.querySelector(".save-btn");
    const cancelBtn = row.querySelector(".cancel-btn");
    const nameInput = editEl.querySelector("input[type=text]");
    const levelInput = editEl.querySelector("input[type=number]");

    editBtn.addEventListener("click", () => {
      viewEl.style.display = "none"; editEl.style.display = "flex"; editBtn.style.display = "none";
    });
    cancelBtn.addEventListener("click", () => {
      viewEl.style.display = ""; editEl.style.display = "none"; editBtn.style.display = "";
    });
    saveBtn.addEventListener("click", async () => {
      const newName = nameInput.value.trim();
      const newLevel = clamp(Number(levelInput.value), MIN_LEVEL, MAX_LEVEL);
      if (!newName) return;
      saveBtn.disabled = true;
      try {
        player.name = newName; player.level = newLevel; player.initialLevel = newLevel;
        await updateRemotePlayerManual(player);
        renderPlayers();
        showToast("Jugador actualizado");
      } catch (error) {
        showToast(`No se pudo actualizar: ${error.message}`);
        saveBtn.disabled = false;
      }
    });
    deleteBtn.addEventListener("click", async () => {
      try {
        await deleteRemotePlayer(player.id);
        state.players = state.players.filter((item) => item.id !== player.id);
        selectedIds.delete(player.id);
        currentTeams = null;
        renderAll();
        showToast("Jugador borrado");
      } catch (error) {
        showToast(`No se pudo borrar: ${error.message}`);
      }
    });
    els.playersList.append(row);
  });
}

function renderSignup() {
  if (!currentGroup) return;
  const minPlayers = currentGroup.teamSize * 2;
  els.selectedCount.textContent = `${selectedIds.size} (mín. ${minPlayers})`;
  els.signupList.innerHTML = "";
  // Sticky counter banner
  const stickyCounter = document.createElement("div");
  stickyCounter.style.cssText = "position:sticky;top:60px;z-index:2;background:var(--grass);color:white;padding:6px 12px;border-radius:var(--radius);margin-bottom:8px;display:flex;justify-content:space-between;align-items:center;font-weight:700;font-size:14px";
  const gkCount = [...goalkeeperSelectedIds].filter(id => selectedIds.has(id)).length;
  stickyCounter.innerHTML = `<span>✅ ${selectedIds.size} jugadores</span><span>🧤 ${gkCount} portero${gkCount !== 1 ? "s" : ""}</span>`;
  els.signupList.append(stickyCounter);
  if (!state.players.length) {
    els.signupList.append(emptyRow("No hay jugadores disponibles."));
    return;
  }
  [...state.players].sort((a, b) => a.name.localeCompare(b.name, "es")).forEach((player) => {
    const isSelected = selectedIds.has(player.id);
    const isGk = goalkeeperSelectedIds.has(player.id);
    const row = document.createElement("div");
    row.className = "row";
    row.style.cssText = "display:flex;align-items:center;gap:10px";
    row.innerHTML = `
      <div style="flex:1;min-width:0">
        <strong>${escapeHtml(player.name)}</strong>
        <div class="meta">Nivel ${player.level.toFixed(1)}</div>
      </div>
      <label style="display:flex;align-items:center;gap:4px;font-size:12px;color:var(--muted);cursor:pointer;flex-shrink:0">
        <input class="gk-check" type="checkbox" ${isGk ? "checked" : ""} ${!isSelected ? "disabled" : ""} style="width:16px;height:16px;accent-color:var(--grass)" />
        🧤
      </label>
      <input class="player-check" type="checkbox" ${isSelected ? "checked" : ""} style="width:24px;height:24px;accent-color:var(--grass);flex-shrink:0" />
    `;
    const playerCheck = row.querySelector(".player-check");
    const gkCheck = row.querySelector(".gk-check");
    playerCheck.addEventListener("change", () => {
      if (playerCheck.checked) {
        selectedIds.add(player.id);
      } else {
        selectedIds.delete(player.id);
        goalkeeperSelectedIds.delete(player.id);
      }
      currentTeams = null;
      renderSignup();
      renderTeams();
    });
    gkCheck.addEventListener("change", () => {
      if (gkCheck.checked) {
        if (goalkeeperSelectedIds.size >= 2) {
          gkCheck.checked = false;
          showToast("Solo puede haber 2 porteros");
          return;
        }
        goalkeeperSelectedIds.add(player.id);
      } else {
        goalkeeperSelectedIds.delete(player.id);
      }
    });
    els.signupList.append(row);
  });
}

function makeBalancedTeams(players) {
  const shuffled = shuffle(players);
  const size = Math.floor(players.length / 2); // one team may have one extra player
  let best = null;
  const combos = combinations(shuffled, size);
  const previousMatch = state.matches[0] || null;
  const sameTenAsPrevious = previousMatch ? samePlayerSet(players, previousMatch) : false;
  const evaluated = [];
  combos.forEach((white) => {
    const whiteIds = new Set(white.map((p) => p.id));
    const black = shuffled.filter((p) => !whiteIds.has(p.id));
    const diff = Math.abs(teamLevel(white) - teamLevel(black));
    const repeatScore = previousMatch ? calculateRepeatScore(white, black, previousMatch) : { totalRepeatedMates: 0, maxRepeatedMates: 0 };
    evaluated.push({ white, black, diff, repeatScore });
  });
  const candidates = sameTenAsPrevious
    ? evaluated.filter((c) => c.repeatScore.maxRepeatedMates <= size - 2)
    : evaluated;
  const pool = candidates.length ? candidates : evaluated;
  pool.forEach((candidate) => {
    if (!best || candidate.diff < best.diff - BALANCE_TOLERANCE ||
      (Math.abs(candidate.diff - best.diff) <= BALANCE_TOLERANCE && candidate.repeatScore.totalRepeatedMates < best.repeatScore.totalRepeatedMates) ||
      (Math.abs(candidate.diff - best.diff) <= BALANCE_TOLERANCE && candidate.repeatScore.totalRepeatedMates === best.repeatScore.totalRepeatedMates && Math.random() > 0.5)
    ) { best = candidate; }
  });
  return best;
}

function samePlayerSet(players, match) {
  const currentIds = new Set(players.map((p) => p.id));
  const previousIds = new Set([...(match.whiteIds || []), ...(match.blackIds || [])]);
  if (currentIds.size !== previousIds.size) return false;
  return [...currentIds].every((id) => previousIds.has(id));
}

function calculateRepeatScore(white, black, match) {
  const previousWhite = new Set(match.whiteIds || []);
  const previousBlack = new Set(match.blackIds || []);
  const teams = [white, black].map((team) => team.map((p) => p.id));
  let totalRepeatedMates = 0, maxRepeatedMates = 0;
  teams.forEach((teamIds) => {
    teamIds.forEach((playerId) => {
      const previousTeam = previousWhite.has(playerId) ? previousWhite : previousBlack.has(playerId) ? previousBlack : null;
      if (!previousTeam) return;
      const repeatedMates = teamIds.filter((mateId) => mateId !== playerId && previousTeam.has(mateId)).length;
      totalRepeatedMates += repeatedMates;
      maxRepeatedMates = Math.max(maxRepeatedMates, repeatedMates);
    });
  });
  return { totalRepeatedMates, maxRepeatedMates };
}

function renderTeams() {
  els.teamsArea.hidden = !currentTeams;
  els.resultForm.hidden = true;
  const existingActionsDiv = document.getElementById("teamsActionBtns");
  if (existingActionsDiv) existingActionsDiv.hidden = !currentTeams;
  if (!currentTeams) {
    els.whiteAvg.textContent = "0.0";
    els.blackAvg.textContent = "0.0";
    return;
  }
  renderTeamList(els.whiteTeam, currentTeams.white, "white");
  renderTeamList(els.blackTeam, currentTeams.black, "black");
  els.whiteAvg.textContent = avgLevel(currentTeams.white).toFixed(1);
  els.blackAvg.textContent = avgLevel(currentTeams.black).toFixed(1);
  renderResultInputs();

  // Action buttons: Rehacer, OK, WhatsApp
  let actionsDiv = document.getElementById("teamsActionBtns");
  if (!actionsDiv) {
    actionsDiv = document.createElement("div");
    actionsDiv.id = "teamsActionBtns";
    actionsDiv.style.cssText = "display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:8px";
    els.teamsArea.after(actionsDiv);
  }
  actionsDiv.innerHTML = "";

  const rehacerBtn = document.createElement("button");
  rehacerBtn.className = "secondary";
  rehacerBtn.style.cssText = "grid-column:span 2;display:flex;align-items:center;justify-content:center;gap:6px";
  rehacerBtn.textContent = "🔄 Rehacer";
  rehacerBtn.onclick = async () => {
    const players = state.players.filter((p) => selectedIds.has(p.id));
    const generatedTeams = makeBalancedTeams(players);
    try {
      await createRemoteTeamDraft(generatedTeams);
      currentTeams = generatedTeams;
      goalkeeperIds = { white: null, black: null };
      saveCurrentTeamsLocal();
      renderTeams();
    } catch (error) {
      showToast(`Error: ${error.message}`);
    }
  };

  const okBtn = document.createElement("button");
  okBtn.textContent = "✅ OK — Guardar partido pendiente";
  okBtn.style.cssText = "grid-column:span 2;display:flex;align-items:center;justify-content:center;gap:6px";
  okBtn.onclick = async () => {
    const title = prompt('Ponle un título a este partido (ej. Martes tarde, Jueves noche):');
    if (title === null) return; // cancelled
    const pm = {
      id: createId(),
      title: title.trim() || "Partido sin título",
      teams: JSON.parse(JSON.stringify(currentTeams)),
      goalkeepers: { ...goalkeeperIds },
      createdAt: new Date().toISOString(),
    };
    try {
      await savePendingMatchRemote(pm);
      pendingMatches.push(pm);
      currentTeams = null;
      goalkeeperIds = { white: null, black: null };
      selectedIds.clear();
      renderAll();
      document.querySelectorAll(".tab, .panel").forEach((el) => el.classList.remove("active"));
      document.querySelector('[data-tab="pending"]').classList.add("active");
      document.querySelector("#pending").classList.add("active");
      els.pitchSection.style.display = "none";
      showToast("Partido guardado como pendiente");
    } catch (error) {
      showToast(`No se pudo guardar: ${error.message}`);
    }
  };

  const waBtn = document.createElement("button");
  waBtn.className = "secondary";
  waBtn.style.cssText = "grid-column:span 2;display:flex;align-items:center;justify-content:center;gap:8px";
  waBtn.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="#25D366"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg> Compartir por WhatsApp`;
  waBtn.onclick = shareTeamsWhatsApp;

  actionsDiv.append(rehacerBtn, waBtn, okBtn);
}

async function savePendingMatchRemote(pm) {
  await supabaseRequest("pending_matches", {
    method: "POST",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({
      id: pm.id,
      group_id: currentGroup.id,
      title: pm.title,
      white_player_ids: pm.teams.white.map((p) => p.id),
      black_player_ids: pm.teams.black.map((p) => p.id),
      goalkeeper_white: pm.goalkeepers.white || null,
      goalkeeper_black: pm.goalkeepers.black || null,
    }),
  });
}

async function deletePendingMatchRemote(pmId) {
  await supabaseRequest(`pending_matches?id=eq.${encodeURIComponent(pmId)}`, {
    method: "DELETE",
    headers: { Prefer: "return=minimal" },
  });
}

async function loadPendingMatchesRemote() {
  if (!currentGroup) return;
  const rows = await supabaseRequest(`pending_matches?group_id=eq.${currentGroup.id}&order=created_at.asc`);
  // Rebuild teams from player ids using current state.players
  pendingMatches = (rows || []).map((row) => {
    const whiteIds = row.white_player_ids || [];
    const blackIds = row.black_player_ids || [];
    const findPlayer = (id) => state.players.find((p) => p.id === id) || { id, name: "?", level: 5 };
    return {
      id: row.id,
      title: row.title,
      createdAt: row.created_at,
      goalkeepers: { white: row.goalkeeper_white, black: row.goalkeeper_black },
      teams: {
        white: whiteIds.map(findPlayer),
        black: blackIds.map(findPlayer),
      },
    };
  });
}

function renderPending() {
  if (!els.pendingArea) return;
  els.pendingArea.innerHTML = "";
  if (!pendingMatches.length) {
    els.pendingArea.append(emptyRow("No hay partidos pendientes."));
    return;
  }
  pendingMatches.forEach((pm) => {
    const { id, title, teams, goalkeepers, createdAt } = pm;
    const allPlayers = [...teams.white, ...teams.black];

    const card = document.createElement("div");
    card.style.cssText = "display:grid;gap:10px;padding:12px;background:var(--surface);border:1px solid var(--line);border-radius:var(--radius);margin-bottom:12px";

    // Title + date
    const header = document.createElement("div");
    header.innerHTML = `<strong style="font-size:16px">${escapeHtml(title)}</strong><div class="meta">${formatDate(createdAt)}</div>`;
    card.append(header);

    // Teams display
    const teamsGrid = document.createElement("div");
    teamsGrid.style.cssText = "display:grid;grid-template-columns:1fr 1fr;gap:8px";
    ["white", "black"].forEach((color) => {
      const box = document.createElement("div");
      box.className = `team ${color === "black" ? "black" : ""}`;
      box.innerHTML = `<h3>${color === "white" ? "⬜ Blanco" : "⬛ Negro"}</h3>` +
        teams[color].map((p) => {
          const isGk = goalkeepers[color] === p.id;
          return `<div class="player-chip"><span>${escapeHtml(p.name)}${isGk ? " 🧤" : ""}</span><strong style="font-size:12px">${p.level.toFixed(1)}</strong></div>`;
        }).join("");
      teamsGrid.append(box);
    });
    card.append(teamsGrid);

    // Helper to save pending match teams
    const savePendingTeams = async () => {
      await supabaseRequest(`pending_matches?id=eq.${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({
          white_player_ids: teams.white.map((p) => p.id),
          black_player_ids: teams.black.map((p) => p.id),
          goalkeeper_white: goalkeepers.white || null,
          goalkeeper_black: goalkeepers.black || null,
        }),
      });
      const pmIdx = pendingMatches.findIndex((m) => m.id === id);
      if (pmIdx !== -1) pendingMatches[pmIdx].teams = JSON.parse(JSON.stringify(teams));
    };

    // Action buttons row
    const actionBtnsRow = document.createElement("div");
    actionBtnsRow.style.cssText = "display:grid;grid-template-columns:1fr 1fr;gap:8px";

    const subBtn = document.createElement("button");
    subBtn.className = "secondary";
    subBtn.style.cssText = "font-size:13px";
    subBtn.textContent = "🔄 Sustituir";

    const swapBtn = document.createElement("button");
    swapBtn.className = "secondary";
    swapBtn.style.cssText = "font-size:13px";
    swapBtn.textContent = "↔️ Cambiar";

    actionBtnsRow.append(subBtn, swapBtn);
    card.append(actionBtnsRow);

    // SUSTITUIR form (player outside → player inside)
    const allMatchIds = new Set([...teams.white, ...teams.black].map((p) => p.id));
    const outsidePlayers = state.players.filter((p) => !allMatchIds.has(p.id));
    const subForm = document.createElement("div");
    subForm.style.cssText = "display:none;gap:8px;padding:10px;background:var(--wash);border-radius:var(--radius)";
    subForm.innerHTML = `
      <div style="font-size:13px;font-weight:700;color:var(--ink)">Sustituir — entra alguien de fuera</div>
      <label style="font-size:13px;color:var(--muted);font-weight:700;display:grid;gap:4px">Sale del partido
        <select class="sub-out" style="min-height:40px;padding:0 10px;border:1px solid var(--line);border-radius:var(--radius);background:var(--surface)">
          ${[...teams.white, ...teams.black].map((p) => {
            const t = teams.white.find(w => w.id === p.id) ? "white" : "black";
            return `<option value="${p.id}|${t}">${escapeHtml(p.name)} (${t === "white" ? "Blanco" : "Negro"})</option>`;
          }).join("")}
        </select>
      </label>
      <label style="font-size:13px;color:var(--muted);font-weight:700;display:grid;gap:4px">Entra (de fuera del partido)
        <select class="sub-in" style="min-height:40px;padding:0 10px;border:1px solid var(--line);border-radius:var(--radius);background:var(--surface)">
          ${outsidePlayers.length ? outsidePlayers.map((p) => `<option value="${p.id}">${escapeHtml(p.name)} (${p.level.toFixed(1)})</option>`).join("") : '<option value="">No hay jugadores fuera</option>'}
        </select>
      </label>
      <div style="display:flex;gap:8px">
        <button class="small sub-confirm-btn" type="button">Confirmar</button>
        <button class="small secondary sub-cancel-btn" type="button">Cancelar</button>
      </div>
    `;
    card.append(subForm);

    subBtn.onclick = () => { subForm.style.display = subForm.style.display === "none" ? "grid" : "none"; swapForm.style.display = "none"; };
    subForm.querySelector(".sub-cancel-btn").onclick = () => { subForm.style.display = "none"; };
    subForm.querySelector(".sub-confirm-btn").onclick = async () => {
      if (!outsidePlayers.length) return;
      const outVal = subForm.querySelector(".sub-out").value;
      const inId = subForm.querySelector(".sub-in").value;
      const [outId, outTeam] = outVal.split("|");
      const newPlayer = state.players.find((p) => p.id === inId);
      if (!newPlayer) return;
      const teamArr = outTeam === "white" ? teams.white : teams.black;
      const idx = teamArr.findIndex((p) => p.id === outId);
      if (idx === -1) return;
      teamArr[idx] = { id: newPlayer.id, name: newPlayer.name, level: newPlayer.level };
      if (goalkeepers[outTeam] === outId) goalkeepers[outTeam] = null;
      try { await savePendingTeams(); renderPending(); showToast("Jugador sustituido"); }
      catch (error) { showToast(`Error: ${error.message}`); }
    };

    // CAMBIAR form (swap between teams)
    const swapForm = document.createElement("div");
    swapForm.style.cssText = "display:none;gap:8px;padding:10px;background:var(--wash);border-radius:var(--radius)";
    swapForm.innerHTML = `
      <div style="font-size:13px;font-weight:700;color:var(--ink)">Cambiar — intercambio entre equipos</div>
      <label style="font-size:13px;color:var(--muted);font-weight:700;display:grid;gap:4px">Jugador del equipo blanco
        <select class="swap-white" style="min-height:40px;padding:0 10px;border:1px solid var(--line);border-radius:var(--radius);background:var(--surface)">
          ${teams.white.map((p) => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join("")}
        </select>
      </label>
      <label style="font-size:13px;color:var(--muted);font-weight:700;display:grid;gap:4px">Jugador del equipo negro
        <select class="swap-black" style="min-height:40px;padding:0 10px;border:1px solid var(--line);border-radius:var(--radius);background:var(--surface)">
          ${teams.black.map((p) => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join("")}
        </select>
      </label>
      <div style="display:flex;gap:8px">
        <button class="small swap-confirm-btn" type="button">Confirmar</button>
        <button class="small secondary swap-cancel-btn" type="button">Cancelar</button>
      </div>
    `;
    card.append(swapForm);

    swapBtn.onclick = () => { swapForm.style.display = swapForm.style.display === "none" ? "grid" : "none"; subForm.style.display = "none"; };
    swapForm.querySelector(".swap-cancel-btn").onclick = () => { swapForm.style.display = "none"; };
    swapForm.querySelector(".swap-confirm-btn").onclick = async () => {
      const whiteId = swapForm.querySelector(".swap-white").value;
      const blackId = swapForm.querySelector(".swap-black").value;
      const wi = teams.white.findIndex((p) => p.id === whiteId);
      const bi = teams.black.findIndex((p) => p.id === blackId);
      if (wi === -1 || bi === -1) return;
      [teams.white[wi], teams.black[bi]] = [teams.black[bi], teams.white[wi]];
      // Fix goalkeepers
      if (goalkeepers.white === whiteId) goalkeepers.white = blackId;
      else if (goalkeepers.white === blackId) goalkeepers.white = whiteId;
      if (goalkeepers.black === blackId) goalkeepers.black = whiteId;
      else if (goalkeepers.black === whiteId) goalkeepers.black = blackId;
      try { await savePendingTeams(); renderPending(); showToast("Jugadores intercambiados"); }
      catch (error) { showToast(`Error: ${error.message}`); }
    };

    // WhatsApp share button
    const waBtnPending = document.createElement("button");
    waBtnPending.className = "secondary";
    waBtnPending.style.cssText = "display:flex;align-items:center;justify-content:center;gap:8px;width:100%";
    waBtnPending.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="#25D366"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg> Compartir por WhatsApp`;
    waBtnPending.onclick = () => {
      const whiteAvg = (teams.white.reduce((s, p) => s + p.level, 0) / teams.white.length).toFixed(1);
      const blackAvg = (teams.black.reduce((s, p) => s + p.level, 0) / teams.black.length).toFixed(1);
      const whiteList = teams.white.map((p) => `  • ${p.name}${goalkeepers.white === p.id ? " 🧤" : ""}`).join("\n");
      const blackList = teams.black.map((p) => `  • ${p.name}${goalkeepers.black === p.id ? " 🧤" : ""}`).join("\n");
      const text = `⚽ ${currentGroup.name} · ${currentGroup.teamSize}v${currentGroup.teamSize}\n\n` +
        `⬜ EQUIPO BLANCO (media: ${whiteAvg})\n${whiteList}\n\n` +
        `⬛ EQUIPO NEGRO (media: ${blackAvg})\n${blackList}`;
      window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank");
    };
    card.append(waBtnPending);

    // Result form
    const form = document.createElement("div");
    form.style.cssText = "display:grid;gap:10px;padding:12px;background:var(--wash);border:1px solid var(--line);border-radius:var(--radius)";
    form.innerHTML = `
      <div style="font-size:14px;font-weight:700;color:var(--ink)">Añadir resultado</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
        <label style="display:grid;gap:4px;font-size:13px;color:var(--muted);font-weight:700">Goles blanco
          <input class="p-white" type="number" min="0" value="0" style="min-height:44px;padding:0 12px;border:1px solid var(--line);border-radius:var(--radius);background:var(--surface)" />
        </label>
        <label style="display:grid;gap:4px;font-size:13px;color:var(--muted);font-weight:700">Goles negro
          <input class="p-black" type="number" min="0" value="0" style="min-height:44px;padding:0 12px;border:1px solid var(--line);border-radius:var(--radius);background:var(--surface)" />
        </label>
      </div>
      <label style="display:grid;gap:4px;font-size:13px;color:var(--muted);font-weight:700">MVP
        <select class="p-mvp" style="min-height:44px;padding:0 12px;border:1px solid var(--line);border-radius:var(--radius);background:var(--surface)">
          <option value="">Sin MVP</option>
          ${allPlayers.map((p) => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join("")}
        </select>
      </label>
      <div style="font-size:13px;color:var(--muted);font-weight:700">Goles por jugador</div>
      ${allPlayers.map((p) => `
        <div style="display:grid;grid-template-columns:1fr 84px;gap:8px;align-items:center">
          <span style="font-size:13px">${escapeHtml(p.name)}</span>
          <input type="number" min="0" value="0" data-pending-goals="${p.id}" style="min-height:40px;padding:0 10px;border:1px solid var(--line);border-radius:var(--radius);background:var(--surface)" />
        </div>`).join("")}
    `;
    card.append(form);

    // Buttons
    const btnRow = document.createElement("div");
    btnRow.style.cssText = "display:grid;grid-template-columns:1fr 1fr;gap:8px";

    const cancelBtn = document.createElement("button");
    cancelBtn.className = "secondary";
    cancelBtn.textContent = "Cancelar";
    cancelBtn.onclick = async () => {
      if (!confirm(`¿Cancelar el partido "${title}"?`)) return;
      try {
        await deletePendingMatchRemote(id);
        pendingMatches = pendingMatches.filter((m) => m.id !== id);
        renderPending();
        showToast("Partido pendiente cancelado");
      } catch (error) {
        showToast(`Error: ${error.message}`);
      }
    };

    const saveBtn = document.createElement("button");
    saveBtn.textContent = "Guardar resultado";
    saveBtn.onclick = async () => {
      const whiteScore = Math.max(0, Number(form.querySelector(".p-white").value) || 0);
      const blackScore = Math.max(0, Number(form.querySelector(".p-black").value) || 0);
      const mvpId = form.querySelector(".p-mvp").value;
      const goalsByPlayer = {};
      form.querySelectorAll("[data-pending-goals]").forEach((input) => {
        goalsByPlayer[input.dataset.pendingGoals] = Math.max(0, Number(input.value) || 0);
      });
      const whiteGoalsTotal = teams.white.reduce((s, p) => s + (goalsByPlayer[p.id] || 0), 0);
      const blackGoalsTotal = teams.black.reduce((s, p) => s + (goalsByPlayer[p.id] || 0), 0);
      if (whiteGoalsTotal !== whiteScore || blackGoalsTotal !== blackScore) {
        showToast("Los goles de cada equipo deben coincidir con el marcador"); return;
      }
      saveBtn.disabled = true;
      currentTeams = teams;
      goalkeeperIds = goalkeepers;
      const previousState = cloneState(state);
      const match = saveMatch(whiteScore, blackScore, goalsByPlayer, mvpId);
      try {
        await createRemoteMatch(match);
        await deletePendingMatchRemote(id);
        pendingMatches = pendingMatches.filter((m) => m.id !== id);
        currentTeams = null;
        goalkeeperIds = { white: null, black: null };
        await syncFromSupabase(false);
        document.querySelectorAll(".tab, .panel").forEach((el) => el.classList.remove("active"));
        document.querySelector('[data-tab="history"]').classList.add("active");
        document.querySelector("#history").classList.add("active");
        els.pitchSection.style.display = "none";
        showToast("Partido guardado");
      } catch (error) {
        state.players = previousState.players;
        state.matches = previousState.matches;
        currentTeams = null;
        goalkeeperIds = { white: null, black: null };
        renderAll();
        showToast(`No se pudo guardar: ${error.message}`);
        saveBtn.disabled = false;
      }
    };

    btnRow.append(cancelBtn, saveBtn);
    card.append(btnRow);
    els.pendingArea.append(card);
  });
}

function shareTeamsWhatsApp() {
  const whiteAvg = avgLevel(currentTeams.white).toFixed(1);
  const blackAvg = avgLevel(currentTeams.black).toFixed(1);
  const whiteList = currentTeams.white.map((p) => {
    const isGk = goalkeeperIds.white === p.id;
    return `  • ${p.name}${isGk ? " 🧤" : ""}`;
  }).join("\n");
  const blackList = currentTeams.black.map((p) => {
    const isGk = goalkeeperIds.black === p.id;
    return `  • ${p.name}${isGk ? " 🧤" : ""}`;
  }).join("\n");
  const text = `⚽ ${currentGroup.name} · ${currentGroup.teamSize}v${currentGroup.teamSize}\n\n` +
    `⬜ EQUIPO BLANCO (media: ${whiteAvg})\n${whiteList}\n\n` +
    `⬛ EQUIPO NEGRO (media: ${blackAvg})\n${blackList}`;
  const url = `https://wa.me/?text=${encodeURIComponent(text)}`;
  window.open(url, "_blank");
}

function renderTeamList(target, players, teamColor) {
  target.innerHTML = "";
  players.forEach((player) => {
    const isGk = goalkeeperIds[teamColor] === player.id;
    const item = document.createElement("div");
    item.className = "player-chip";
    item.innerHTML = `
      <span>${escapeHtml(player.name)}${isGk ? " 🧤" : ""}</span>
      <div style="display:flex;align-items:center;gap:4px;flex-shrink:0">
        <label style="display:flex;align-items:center;gap:2px;font-size:11px;color:${teamColor === "black" ? "#aaa" : "#555"};cursor:pointer">
          <input type="checkbox" ${isGk ? "checked" : ""} style="width:14px;height:14px;accent-color:#1f6f43;flex-shrink:0" />
          <span>🧤</span>
        </label>
        <strong style="font-size:12px">${player.level.toFixed(1)}</strong>
      </div>
    `;
    item.querySelector("input[type=checkbox]").addEventListener("change", (e) => {
      goalkeeperIds[teamColor] = e.target.checked ? player.id : null;
      renderTeamList(target, players, teamColor);
    });
    target.append(item);
  });
}

function renderResultInputs() {
  const allPlayers = [...currentTeams.white, ...currentTeams.black];
  els.mvpSelect.innerHTML = `<option value="">Sin MVP</option>`;
  allPlayers.forEach((player) => {
    const option = document.createElement("option");
    option.value = player.id;
    option.textContent = player.name;
    els.mvpSelect.append(option);
  });
  els.goalInputs.innerHTML = "";
  allPlayers.forEach((player) => {
    const label = document.createElement("label");
    label.className = "goal-row";
    label.innerHTML = `
      <span>${escapeHtml(player.name)}</span>
      <input data-goals-player="${player.id}" type="number" min="0" value="0" />
    `;
    els.goalInputs.append(label);
  });
}

function saveMatch(whiteScore, blackScore, goalsByPlayer, mvpId) {
  const whiteIds = currentTeams.white.map((p) => p.id);
  const blackIds = currentTeams.black.map((p) => p.id);
  const winner = whiteScore === blackScore ? "draw" : whiteScore > blackScore ? "white" : "black";
  const whiteAvg = avgLevel(currentTeams.white);
  const blackAvg = avgLevel(currentTeams.black);
  // Store avgs on the match for accurate recalculation later
  const whiteGkId = goalkeeperIds.white;
  const blackGkId = goalkeeperIds.black;
  const whiteGkBonus = whiteGkId !== null && blackScore < 2;
  const blackGkBonus = blackGkId !== null && whiteScore < 2;
  const playerSnapshots = [...currentTeams.white, ...currentTeams.black].map((player) => {
    const team = whiteIds.includes(player.id) ? "white" : "black";
    const goals = goalsByPlayer[player.id] || 0;
    const playerTeamAvg = team === "white" ? whiteAvg : blackAvg;
    const rivalTeamAvg = team === "white" ? blackAvg : whiteAvg;
    const isGoalkeeper = (team === "white" && player.id === whiteGkId) || (team === "black" && player.id === blackGkId);
    const goalkeeperBonus = (team === "white" && player.id === whiteGkId && whiteGkBonus) || (team === "black" && player.id === blackGkId && blackGkBonus);
    const delta = calculateRatingDelta({ team, winner, goals, isMvp: player.id === mvpId, isGoalkeeper, goalkeeperBonus, playerTeamAvg, rivalTeamAvg });
    const stored = state.players.find((item) => item.id === player.id);
    stored.level = clamp(Number((stored.level + delta).toFixed(2)), MIN_LEVEL, MAX_LEVEL);
    stored.stats.played += 1;
    stored.stats.goals += goals;
    if (player.id === mvpId) stored.stats.mvps += 1;
    if (winner === "draw") stored.stats.draws += 1;
    else if (winner === team) stored.stats.wins += 1;
    else stored.stats.losses += 1;
    return { id: player.id, name: player.name, team, levelBefore: player.level, levelAfter: stored.level, goals, mvp: player.id === mvpId, goalkeeper: isGoalkeeper, goalkeeperBonus, delta, rivalTeamAvg };
  });
  const match = { id: createId(), date: new Date().toISOString(), whiteScore, blackScore, winner, whiteAvg, blackAvg, whiteIds, blackIds, players: playerSnapshots };
  state.matches.unshift(match);
  return match;
}

function calculateRatingDelta({ team, winner, goals, isMvp, isGoalkeeper, goalkeeperBonus, playerTeamAvg, rivalTeamAvg }) {
  const actualResult = winner === "draw" ? 0.5 : winner === team ? 1 : 0;
  const expectedResult = 1 / (1 + 10 ** ((rivalTeamAvg - playerTeamAvg) / 4));
  const resultDelta = RESULT_WEIGHT * (actualResult - expectedResult);
  const rivalMultiplier = clamp(0.75 + rivalTeamAvg / MAX_LEVEL, 0.75, 1.75);
  const goalDelta = goals * GOAL_WEIGHT * rivalMultiplier;
  const mvpDelta = isMvp ? MVP_WEIGHT * rivalMultiplier : 0;
  const gkDelta = goalkeeperBonus ? GOALKEEPER_BONUS_WEIGHT * rivalMultiplier : 0;
  return Number((resultDelta + goalDelta + mvpDelta + gkDelta).toFixed(2));
}

function renderRanking() {
  els.rankingList.innerHTML = "";
  if (!state.players.length) { els.rankingList.append(emptyRow("El ranking aparecerá aqui.")); return; }
  [...state.players].sort((a, b) => b.level - a.level).forEach((player, index) => {
    const row = document.createElement("article");
    row.className = "row";
    row.innerHTML = `
      <div>
        <strong>${index + 1}. ${escapeHtml(player.name)}</strong>
        <div class="meta">${player.stats.played} PJ · ${player.stats.wins} V · ${player.stats.draws} E · ${player.stats.losses} D · ${player.stats.goals} goles · ${player.stats.mvps} MVP</div>
      </div>
      <span class="pill">${player.level.toFixed(1)}</span>
    `;
    els.rankingList.append(row);
  });
}

function renderHistory() {
  els.matchCount.textContent = `${state.matches.length}`;
  els.historyList.innerHTML = "";
  if (!state.matches.length) { els.historyList.append(emptyRow("Todavia no hay partidos guardados.")); return; }
  state.matches.forEach((match) => {
    const row = document.createElement("article");
    row.className = "row";
    row.style.cssText = "flex-direction:column;align-items:stretch;padding:0;overflow:hidden";

    const whitePlayers = match.players.filter((p) => p.team === "white");
    const blackPlayers = match.players.filter((p) => p.team === "black");
    const mvpPlayer = match.players.find((p) => p.mvp);
    const goalscorers = match.players.filter((p) => p.goals > 0)
      .map((p) => `${"⚽".repeat(p.goals)} ${escapeHtml(p.name)}`).join("<br>");
    const winner = match.winner === "white" ? "⬜ Blanco" : match.winner === "black" ? "⬛ Negro" : "Empate";

    // Summary (always visible, clickable)
    const summary = document.createElement("div");
    summary.style.cssText = "padding:12px;cursor:pointer;border-bottom:1px solid var(--line);text-align:center";
    summary.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
        <div class="meta">${formatDate(match.date)}</div>
        <span class="chevron" style="font-size:16px;transition:transform .2s">▾</span>
      </div>
      <div style="font-size:22px;font-weight:800;letter-spacing:1px">⬜ ${match.whiteScore} — ${match.blackScore} ⬛</div>
      <div style="font-size:12px;font-weight:700;color:var(--grass);margin-top:4px">${winner === "Empate" ? "Empate" : `Gana ${winner}`}</div>
    `;
    row.append(summary);

    // Detail (hidden by default)
    const detail = document.createElement("div");
    detail.style.cssText = "display:none;padding:12px;gap:10px;flex-direction:column";

    // Teams grid full width
    const teamsGrid = document.createElement("div");
    teamsGrid.style.cssText = "display:grid;grid-template-columns:1fr 1fr;gap:8px";
    ["white","black"].forEach((color) => {
      const players = color === "white" ? whitePlayers : blackPlayers;
      const box = document.createElement("div");
      box.className = `team ${color === "black" ? "black" : ""}`;
      box.innerHTML = `<h3 style="font-size:12px;margin-bottom:4px">${color === "white" ? "⬜ Blanco" : "⬛ Negro"}</h3>` +
        players.map((p) => `<div class="player-chip"><span>${escapeHtml(p.name)}</span><strong style="font-size:11px">${p.goals > 0 ? "⚽".repeat(Math.min(p.goals,3)) + (p.goals > 3 ? p.goals : "") : ""}</strong></div>`).join("");
      teamsGrid.append(box);
    });
    detail.append(teamsGrid);

    // Stats row full width
    const stats = document.createElement("div");
    stats.style.cssText = "padding:8px;background:var(--wash);border-radius:var(--radius)";
    stats.innerHTML = `
      <div class="meta">${goalscorers || "Sin goles"}</div>
      <div class="meta" style="margin-top:4px">🏅 ${mvpPlayer ? escapeHtml(mvpPlayer.name) : "Sin MVP"}</div>
    `;
    detail.append(stats);

    // Edit/delete buttons
    const btnRow = document.createElement("div");
    btnRow.style.cssText = "display:flex;gap:8px";
    btnRow.innerHTML = `
      <button class="secondary small edit-match-btn" type="button">Editar</button>
      <button class="secondary small delete-match-btn" type="button">Borrar</button>
    `;
    detail.append(btnRow);
    detail.style.display = "none";
    // Override display to use grid when shown
    detail._show = () => { detail.style.display = "flex"; detail.style.flexDirection = "column"; };
    detail._hide = () => { detail.style.display = "none"; };
    row.append(detail);

    // Edit form
    const editForm = document.createElement("div");
    editForm.style.cssText = "display:none;padding:0 12px 12px;gap:8px";
    editForm.innerHTML = `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
        <label style="font-size:13px;color:var(--muted);font-weight:700;display:grid;gap:4px">Goles blanco
          <input type="number" min="0" class="edit-white-score" value="${match.whiteScore}" style="min-height:36px;padding:0 8px" />
        </label>
        <label style="font-size:13px;color:var(--muted);font-weight:700;display:grid;gap:4px">Goles negro
          <input type="number" min="0" class="edit-black-score" value="${match.blackScore}" style="min-height:36px;padding:0 8px" />
        </label>
      </div>
      <label style="font-size:13px;color:var(--muted);font-weight:700;display:grid;gap:4px">MVP
        <select class="edit-mvp" style="min-height:36px;padding:0 8px">
          <option value="">Sin MVP</option>
          ${match.players.map((p) => `<option value="${p.id}" ${p.mvp ? "selected" : ""}>${escapeHtml(p.name)}</option>`).join("")}
        </select>
      </label>
      <div style="font-size:13px;color:var(--muted);font-weight:700">Goles por jugador</div>
      ${match.players.map((p) => `
        <div style="display:grid;grid-template-columns:1fr 84px;gap:8px;align-items:center">
          <span style="font-size:13px">${escapeHtml(p.name)}</span>
          <input type="number" min="0" class="edit-goals" data-player-id="${p.id}" value="${p.goals || 0}" style="min-height:36px;padding:0 8px" />
        </div>`).join("")}
      <div style="display:flex;gap:8px;margin-top:4px">
        <button class="small save-match-btn" type="button">Guardar</button>
        <button class="small secondary cancel-match-btn" type="button">Cancelar</button>
      </div>
    `;
    row.append(editForm);

    // Events
    const chevron = summary.querySelector(".chevron");
    summary.addEventListener("click", () => {
      const open = detail.style.display !== "none";
      open ? detail._hide() : detail._show();
      chevron.style.transform = open ? "" : "rotate(180deg)";
      if (open) editForm.style.display = "none";
    });

    btnRow.querySelector(".edit-match-btn").addEventListener("click", (e) => {
      e.stopPropagation();
      detail._hide();
      editForm.style.display = "grid";
    });

    btnRow.querySelector(".delete-match-btn").addEventListener("click", async (e) => {
      e.stopPropagation();
      if (!confirm("¿Borrar este partido? Los niveles y estadísticas se recalcularán.")) return;
      try {
        await deleteRemoteMatch(match.id);
        state.matches = state.matches.filter((m) => m.id !== match.id);
        recalculateAllPlayersFromHistory();
        await Promise.all(state.players.map((p) => updateRemotePlayerAfterMatch({ id: p.id })));
        renderAll();
        showToast("Partido borrado y niveles recalculados");
      } catch (error) {
        showToast(`Error: ${error.message}`);
      }
    });

    editForm.querySelector(".cancel-match-btn").addEventListener("click", () => {
      editForm.style.display = "none";
      detail.style.display = "block";
    });

    editForm.querySelector(".save-match-btn").addEventListener("click", async () => {
      const newWhiteScore = Math.max(0, Number(editForm.querySelector(".edit-white-score").value) || 0);
      const newBlackScore = Math.max(0, Number(editForm.querySelector(".edit-black-score").value) || 0);
      const newMvpId = editForm.querySelector(".edit-mvp").value;
      const newGoals = {};
      editForm.querySelectorAll(".edit-goals").forEach((input) => { newGoals[input.dataset.playerId] = Math.max(0, Number(input.value) || 0); });
      const whiteGoalsTotal = whitePlayers.reduce((s, p) => s + (newGoals[p.id] || 0), 0);
      const blackGoalsTotal = blackPlayers.reduce((s, p) => s + (newGoals[p.id] || 0), 0);
      if (whiteGoalsTotal !== newWhiteScore || blackGoalsTotal !== newBlackScore) {
        showToast("Los goles de cada equipo deben coincidir con el marcador"); return;
      }
      const saveBtn = editForm.querySelector(".save-match-btn");
      saveBtn.disabled = true;
      try {
        match.whiteScore = newWhiteScore; match.blackScore = newBlackScore;
        match.winner = newWhiteScore === newBlackScore ? "draw" : newWhiteScore > newBlackScore ? "white" : "black";
        match.players.forEach((p) => { p.goals = newGoals[p.id] || 0; p.mvp = p.id === newMvpId; });
        // Keep existing stored avgs (don't recalculate them on edit)
        recalculateAllPlayersFromHistory();
        await updateRemoteMatch(match);
        await Promise.all(state.players.map((p) => updateRemotePlayerAfterMatch({ id: p.id })));
        await syncFromSupabase(false);
        showToast("Partido actualizado");
      } catch (error) {
        showToast(`Error: ${error.message}`); saveBtn.disabled = false;
      }
    });

    els.historyList.append(row);
  });
}

// ── Utils ────────────────────────────────────────────────────────
function combinations(items, size) {
  const result = [];
  function walk(start, combo) {
    if (combo.length === size) { result.push(combo); return; }
    for (let i = start; i < items.length; i++) walk(i + 1, [...combo, items[i]]);
  }
  walk(0, []);
  return result;
}
function teamLevel(players) { return players.reduce((sum, p) => sum + p.level, 0); }
function avgLevel(players) { return players.length ? teamLevel(players) / players.length : 0; }
function shuffle(items) {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}
function clamp(value, min, max) { return Math.min(max, Math.max(min, Number.isFinite(value) ? value : min)); }
function cloneState(value) { return JSON.parse(JSON.stringify(value)); }
function setFormBusy(form, isBusy) { form.querySelectorAll("button, input, select").forEach((c) => { c.disabled = isBusy; }); }
function createId() {
  return globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
function emptyRow(text) {
  const row = document.createElement("div");
  row.className = "row";
  row.innerHTML = `<span class="meta">${escapeHtml(text)}</span>`;
  return row;
}
function formatDate(value) {
  return new Intl.DateTimeFormat("es", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}
function escapeHtml(value) {
  return String(value).replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&#039;");
}
function showToast(message) {
  els.toast.textContent = message;
  els.toast.classList.add("show");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => els.toast.classList.remove("show"), 2200);
}

// ── Init ─────────────────────────────────────────────────────────
if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});

// Restore group from localStorage (no password needed if already validated this session)
const savedGroup = localStorage.getItem("selectedGroup");
if (savedGroup && GROUPS[savedGroup]) {
  selectGroup(savedGroup);
}

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") syncFromSupabase(false);
});
