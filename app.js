const MIN_LEVEL = 0;
const MAX_LEVEL = 10;
const DEFAULT_LEVEL = 5;
const RESULT_WEIGHT = 0.8;
const GOAL_WEIGHT = 0.1;
const MVP_WEIGHT = 0.1;
const BALANCE_TOLERANCE = 0.4;
const SUPABASE_URL = "https://rumvrsonnxujcxbrizyb.supabase.co";
const SUPABASE_KEY = "sb_publishable_vhH6ilTt_-KHGC8TKrwqnQ_pYhC-ntf";
const SUPABASE_REST_URL = `${SUPABASE_URL}/rest/v1`;

const state = { players: [], matches: [] };
normalizeState();
let selectedIds = new Set();
let currentTeams = null;

const els = {
  playerForm: document.querySelector("#playerForm"),
  playerName: document.querySelector("#playerName"),
  playerLevel: document.querySelector("#playerLevel"),
  playersList: document.querySelector("#playersList"),
  playerCount: document.querySelector("#playerCount"),
  signupList: document.querySelector("#signupList"),
  selectedCount: document.querySelector("#selectedCount"),
  makeTeamsBtn: document.querySelector("#makeTeamsBtn"),
  clearSignupBtn: document.querySelector("#clearSignupBtn"),
  teamsArea: document.querySelector("#teamsArea"),
  whiteTeam: document.querySelector("#whiteTeam"),
  blackTeam: document.querySelector("#blackTeam"),
  whiteAvg: document.querySelector("#whiteAvg"),
  blackAvg: document.querySelector("#blackAvg"),
  resultForm: document.querySelector("#resultForm"),
  whiteScore: document.querySelector("#whiteScore"),
  blackScore: document.querySelector("#blackScore"),
  mvpSelect: document.querySelector("#mvpSelect"),
  goalInputs: document.querySelector("#goalInputs"),
  rankingList: document.querySelector("#rankingList"),
  historyList: document.querySelector("#historyList"),
  matchCount: document.querySelector("#matchCount"),
  exportBtn: document.querySelector("#exportBtn"),
  importBtn: document.querySelector("#importBtn"),
  toast: document.querySelector("#toast"),
};

document.querySelectorAll(".tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".tab, .panel").forEach((el) => el.classList.remove("active"));
    tab.classList.add("active");
    document.querySelector(`#${tab.dataset.tab}`).classList.add("active");
  });
});

els.playerForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const name = els.playerName.value.trim();
  const level = clamp(Number(els.playerLevel.value), MIN_LEVEL, MAX_LEVEL);
  if (!name) return;
  setFormBusy(els.playerForm, true);
  try {
    await createRemotePlayer({
    name,
    level,
    initialLevel: level,
    stats: { played: 0, wins: 0, losses: 0, draws: 0, goals: 0, mvps: 0 },
    });
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

els.makeTeamsBtn.addEventListener("click", async () => {
  const players = state.players.filter((player) => selectedIds.has(player.id));
  if (players.length !== 10) {
    showToast("Selecciona exactamente 10 jugadores");
    return;
  }
  const generatedTeams = makeBalancedTeams(players);
  try {
    await createRemoteTeamDraft(generatedTeams);
    currentTeams = generatedTeams;
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
  renderAll();
});

els.resultForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!currentTeams) return;
  const whiteScore = Math.max(0, Number(els.whiteScore.value) || 0);
  const blackScore = Math.max(0, Number(els.blackScore.value) || 0);
  const goalsByPlayer = {};
  document.querySelectorAll("[data-goals-player]").forEach((input) => {
    goalsByPlayer[input.dataset.goalsPlayer] = Math.max(0, Number(input.value) || 0);
  });
  const whitePlayerGoals = currentTeams.white.reduce((sum, player) => sum + (goalsByPlayer[player.id] || 0), 0);
  const blackPlayerGoals = currentTeams.black.reduce((sum, player) => sum + (goalsByPlayer[player.id] || 0), 0);
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

els.exportBtn.addEventListener("click", () => {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `futbol-amigos-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  URL.revokeObjectURL(url);
});

els.importBtn.addEventListener("click", () => syncFromSupabase(true));

function normalizeState() {
  let changed = false;
  state.players.forEach((player) => {
    if (!player.stats) {
      player.stats = { played: 0, wins: 0, losses: 0, draws: 0, goals: 0, mvps: 0 };
      changed = true;
    }
    if (player.level > MAX_LEVEL) {
      player.level = Number((player.level / 10).toFixed(1));
      changed = true;
    }
    if (player.initialLevel > MAX_LEVEL) {
      player.initialLevel = Number((player.initialLevel / 10).toFixed(1));
      changed = true;
    }
    player.level = clamp(player.level, MIN_LEVEL, MAX_LEVEL);
    player.initialLevel = clamp(player.initialLevel ?? player.level, MIN_LEVEL, MAX_LEVEL);
  });
  if (changed) renderAll();
}

async function syncFromSupabase(showMessage = true) {
  try {
    const [remotePlayers, remoteMatches, remoteMatchPlayers] = await Promise.all([
      supabaseRequest("players?select=*&order=name.asc"),
      supabaseRequest("matches?select=*&order=created_at.desc"),
      supabaseRequest("match_players?select=*&order=id.asc"),
    ]);
    state.players = remotePlayers.map(mapRemotePlayer);
    state.matches = mapRemoteMatches(remoteMatches, remoteMatchPlayers);
    selectedIds = new Set([...selectedIds].filter((id) => state.players.some((player) => player.id === id)));
    currentTeams = null;
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
  return response.json();
}

async function createRemotePlayer(player) {
  const [savedPlayer] = await supabaseRequest("players?select=*", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({
      name: player.name,
      level: player.level,
      initial_level: player.initialLevel,
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

async function createRemoteTeamDraft(teams) {
  await supabaseRequest("team_drafts", {
    method: "POST",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({
      white_player_ids: teams.white.map((player) => player.id),
      black_player_ids: teams.black.map((player) => player.id),
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
  await Promise.all(match.players.map((player) => updateRemotePlayerAfterMatch(player)));
}

async function updateRemotePlayerAfterMatch(matchPlayer) {
  const stored = state.players.find((player) => player.id === matchPlayer.id);
  if (!stored) return;
  await supabaseRequest(`players?id=eq.${encodeURIComponent(matchPlayer.id)}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({
      level: stored.level,
      played: stored.stats.played,
      wins: stored.stats.wins,
      losses: stored.stats.losses,
      draws: stored.stats.draws,
      goals: stored.stats.goals,
      mvps: stored.stats.mvps,
    }),
  });
}

function mapRemotePlayer(row) {
  return {
    id: row.id,
    name: row.name,
    level: Number(row.level),
    initialLevel: Number(row.initial_level),
    stats: {
      played: row.played,
      wins: row.wins,
      losses: row.losses,
      draws: row.draws,
      goals: row.goals,
      mvps: row.mvps,
    },
  };
}

function mapRemoteMatches(matches, matchPlayers) {
  const playersByMatch = new Map();
  matchPlayers.forEach((row) => {
    if (!playersByMatch.has(row.match_id)) playersByMatch.set(row.match_id, []);
    playersByMatch.get(row.match_id).push({
      id: row.player_id,
      name: row.player_name,
      team: row.team,
      levelBefore: Number(row.level_before),
      levelAfter: Number(row.level_after),
      goals: row.goals,
      mvp: row.mvp,
      delta: Number(row.delta),
    });
  });
  return matches.map((match) => {
    const players = playersByMatch.get(match.id) || [];
    return {
      id: match.id,
      date: match.created_at,
      whiteScore: match.white_score,
      blackScore: match.black_score,
      winner: match.winner,
      whiteIds: players.filter((player) => player.team === "white").map((player) => player.id),
      blackIds: players.filter((player) => player.team === "black").map((player) => player.id),
      players,
    };
  });
}

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
}

function renderPlayers() {
  els.playerCount.textContent = `${state.players.length} jugadores`;
  els.playersList.innerHTML = "";
  if (!state.players.length) {
    els.playersList.append(emptyRow("Añade jugadores para empezar."));
    return;
  }
  [...state.players].sort((a, b) => b.level - a.level).forEach((player) => {
    const row = document.createElement("article");
    row.className = "row";
    row.innerHTML = `
      <div>
        <div class="row-title"><strong>${escapeHtml(player.name)}</strong><span class="pill">${player.level.toFixed(1)}</span></div>
        <div class="meta">${player.stats.played} PJ · ${player.stats.wins} G · ${player.stats.goals} goles · ${player.stats.mvps} MVP</div>
      </div>
      <button class="secondary small" type="button" aria-label="Borrar ${escapeHtml(player.name)}">Borrar</button>
    `;
    row.querySelector("button").addEventListener("click", async () => {
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
  els.selectedCount.textContent = `${selectedIds.size}/10`;
  els.signupList.innerHTML = "";
  if (!state.players.length) {
    els.signupList.append(emptyRow("No hay jugadores disponibles."));
    return;
  }
  [...state.players].sort((a, b) => a.name.localeCompare(b.name, "es")).forEach((player) => {
    const row = document.createElement("label");
    row.className = "row";
    row.innerHTML = `
      <div>
        <strong>${escapeHtml(player.name)}</strong>
        <div class="meta">Nivel ${player.level.toFixed(1)}</div>
      </div>
      <input class="check" type="checkbox" ${selectedIds.has(player.id) ? "checked" : ""} />
    `;
    row.querySelector("input").addEventListener("change", (event) => {
      if (event.target.checked && selectedIds.size >= 10) {
        event.target.checked = false;
        showToast("Ya hay 10 inscritos");
        return;
      }
      event.target.checked ? selectedIds.add(player.id) : selectedIds.delete(player.id);
      currentTeams = null;
      renderSignup();
      renderTeams();
    });
    els.signupList.append(row);
  });
}

function makeBalancedTeams(players) {
  const shuffled = shuffle(players);
  let best = null;
  const combos = combinations(shuffled, 5);
  const previousMatch = state.matches[0] || null;
  const sameTenAsPrevious = previousMatch ? samePlayerSet(players, previousMatch) : false;
  const evaluated = [];

  combos.forEach((white) => {
    const whiteIds = new Set(white.map((player) => player.id));
    const black = shuffled.filter((player) => !whiteIds.has(player.id));
    const diff = Math.abs(teamLevel(white) - teamLevel(black));
    const repeatScore = previousMatch ? calculateRepeatScore(white, black, previousMatch) : 0;
    evaluated.push({ white, black, diff, repeatScore });
  });

  const candidates = sameTenAsPrevious
    ? evaluated.filter((candidate) => candidate.repeatScore.maxRepeatedMates <= 3)
    : evaluated;
  const pool = candidates.length ? candidates : evaluated;

  pool.forEach((candidate) => {
    if (
      !best ||
      candidate.diff < best.diff - BALANCE_TOLERANCE ||
      (Math.abs(candidate.diff - best.diff) <= BALANCE_TOLERANCE &&
        candidate.repeatScore.totalRepeatedMates < best.repeatScore.totalRepeatedMates) ||
      (Math.abs(candidate.diff - best.diff) <= BALANCE_TOLERANCE &&
        candidate.repeatScore.totalRepeatedMates === best.repeatScore.totalRepeatedMates &&
        Math.random() > 0.5)
    ) {
      best = candidate;
    }
  });
  return best;
}

function samePlayerSet(players, match) {
  const currentIds = new Set(players.map((player) => player.id));
  const previousIds = new Set([...(match.whiteIds || []), ...(match.blackIds || [])]);
  if (currentIds.size !== previousIds.size) return false;
  return [...currentIds].every((id) => previousIds.has(id));
}

function calculateRepeatScore(white, black, match) {
  const previousWhite = new Set(match.whiteIds || []);
  const previousBlack = new Set(match.blackIds || []);
  const currentTeams = [white, black].map((team) => team.map((player) => player.id));
  let totalRepeatedMates = 0;
  let maxRepeatedMates = 0;

  currentTeams.forEach((teamIds) => {
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
  els.resultForm.hidden = !currentTeams;
  if (!currentTeams) {
    els.whiteAvg.textContent = "0.0";
    els.blackAvg.textContent = "0.0";
    return;
  }
  renderTeamList(els.whiteTeam, currentTeams.white);
  renderTeamList(els.blackTeam, currentTeams.black);
  els.whiteAvg.textContent = avgLevel(currentTeams.white).toFixed(1);
  els.blackAvg.textContent = avgLevel(currentTeams.black).toFixed(1);
  renderResultInputs();
}

function renderTeamList(target, players) {
  target.innerHTML = "";
  players.forEach((player) => {
    const item = document.createElement("div");
    item.className = "player-chip";
    item.innerHTML = `<span>${escapeHtml(player.name)}</span><strong>${player.level.toFixed(1)}</strong>`;
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
  const whiteIds = currentTeams.white.map((player) => player.id);
  const blackIds = currentTeams.black.map((player) => player.id);
  const winner = whiteScore === blackScore ? "draw" : whiteScore > blackScore ? "white" : "black";
  const whiteAvg = avgLevel(currentTeams.white);
  const blackAvg = avgLevel(currentTeams.black);
  const playerSnapshots = [...currentTeams.white, ...currentTeams.black].map((player) => {
    const team = whiteIds.includes(player.id) ? "white" : "black";
    const goals = goalsByPlayer[player.id] || 0;
    const playerTeamAvg = team === "white" ? whiteAvg : blackAvg;
    const rivalTeamAvg = team === "white" ? blackAvg : whiteAvg;
    const delta = calculateRatingDelta({
      team,
      winner,
      goals,
      isMvp: player.id === mvpId,
      playerTeamAvg,
      rivalTeamAvg,
    });
    const stored = state.players.find((item) => item.id === player.id);
    stored.level = clamp(Number((stored.level + delta).toFixed(2)), MIN_LEVEL, MAX_LEVEL);
    stored.stats.played += 1;
    stored.stats.goals += goals;
    if (player.id === mvpId) stored.stats.mvps += 1;
    if (winner === "draw") stored.stats.draws += 1;
    else if (winner === team) stored.stats.wins += 1;
    else stored.stats.losses += 1;
    return {
      id: player.id,
      name: player.name,
      team,
      levelBefore: player.level,
      levelAfter: stored.level,
      goals,
      mvp: player.id === mvpId,
      delta,
      rivalTeamAvg,
    };
  });
  const match = {
    id: createId(),
    date: new Date().toISOString(),
    whiteScore,
    blackScore,
    winner,
    whiteIds,
    blackIds,
    players: playerSnapshots,
  };
  state.matches.unshift(match);
  return match;
}

function calculateRatingDelta({ team, winner, goals, isMvp, playerTeamAvg, rivalTeamAvg }) {
  const actualResult = winner === "draw" ? 0.5 : winner === team ? 1 : 0;
  const expectedResult = 1 / (1 + 10 ** ((rivalTeamAvg - playerTeamAvg) / 4));
  const resultDelta = RESULT_WEIGHT * (actualResult - expectedResult);
  const rivalMultiplier = clamp(0.75 + rivalTeamAvg / MAX_LEVEL, 0.75, 1.75);
  const goalDelta = goals * GOAL_WEIGHT * rivalMultiplier;
  const mvpDelta = isMvp ? MVP_WEIGHT * rivalMultiplier : 0;
  return Number((resultDelta + goalDelta + mvpDelta).toFixed(2));
}

function renderRanking() {
  els.rankingList.innerHTML = "";
  if (!state.players.length) {
    els.rankingList.append(emptyRow("El ranking aparecera aqui."));
    return;
  }
  [...state.players].sort((a, b) => b.level - a.level).forEach((player, index) => {
    const row = document.createElement("article");
    row.className = "row";
    row.innerHTML = `
      <div>
        <strong>${index + 1}. ${escapeHtml(player.name)}</strong>
        <div class="meta">${player.stats.played} partidos · ${player.stats.goals} goles · ${player.stats.mvps} MVP</div>
      </div>
      <span class="pill">${player.level.toFixed(1)}</span>
    `;
    els.rankingList.append(row);
  });
}

function renderHistory() {
  els.matchCount.textContent = `${state.matches.length}`;
  els.historyList.innerHTML = "";
  if (!state.matches.length) {
    els.historyList.append(emptyRow("Todavia no hay partidos guardados."));
    return;
  }
  state.matches.forEach((match) => {
    const row = document.createElement("article");
    row.className = "row";
    const whiteNames = match.players.filter((p) => p.team === "white").map((p) => p.name).join(", ");
    const blackNames = match.players.filter((p) => p.team === "black").map((p) => p.name).join(", ");
    row.innerHTML = `
      <div>
        <strong>Blanco ${match.whiteScore} - ${match.blackScore} Negro</strong>
        <div class="meta">${formatDate(match.date)}</div>
        <div class="meta">Blanco: ${escapeHtml(whiteNames)}</div>
        <div class="meta">Negro: ${escapeHtml(blackNames)}</div>
      </div>
    `;
    els.historyList.append(row);
  });
}

function combinations(items, size) {
  const result = [];
  function walk(start, combo) {
    if (combo.length === size) {
      result.push(combo);
      return;
    }
    for (let index = start; index < items.length; index += 1) {
      walk(index + 1, [...combo, items[index]]);
    }
  }
  walk(0, []);
  return result;
}

function teamLevel(players) {
  return players.reduce((sum, player) => sum + player.level, 0);
}

function avgLevel(players) {
  return players.length ? teamLevel(players) / players.length : 0;
}

function shuffle(items) {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [copy[index], copy[swapIndex]] = [copy[swapIndex], copy[index]];
  }
  return copy;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));
}

function cloneState(value) {
  return JSON.parse(JSON.stringify(value));
}

function setFormBusy(form, isBusy) {
  form.querySelectorAll("button, input, select").forEach((control) => {
    control.disabled = isBusy;
  });
}

function createId() {
  if (globalThis.crypto && typeof globalThis.crypto.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
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
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function showToast(message) {
  els.toast.textContent = message;
  els.toast.classList.add("show");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => els.toast.classList.remove("show"), 2200);
}

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}

renderAll();
syncFromSupabase(false);
