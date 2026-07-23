import { Chess } from "https://cdn.jsdelivr.net/npm/chess.js@1.0.0-beta.6/+esm";

const START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
const PIECE_FILE = {
  K: "wK", Q: "wQ", R: "wR", B: "wB", N: "wN", P: "wP",
  k: "bK", q: "bQ", r: "bR", b: "bB", n: "bN", p: "bP",
};

const ROLE_KEY = "esli-studyplan-role";
const DIFF_KEY = "esli-studyplan-difficulty";
const PACK_KEY = "esli-studyplan-pack";
const RECENTS_KEY = "esli-studyplan-recents";
const PROGRESS_KEY = "esli-studyplan-progress";

const ECO_TSV_URLS = ["a", "b", "c", "d", "e"].map(
  (letter) => `https://cdn.jsdelivr.net/gh/lichess-org/chess-openings@master/${letter}.tsv`,
);
const SEARCH_LIMIT = 40;

const DIFFICULTY = {
  beginner: { maxPly: 20 },
  intermediate: { maxPly: null }, // full baked book line
  advanced: { maxPly: null },
};

const state = {
  role: "teacher",
  difficulty: "intermediate",
  fen: START_FEN,
  moves: [],
  legal: [],
  selected: null,
  targets: new Set(),
  flipped: false,
  lastMove: null,
  practice: null,
  practiceIndex: 0,
  hint: null,
  showCoords: true,
  autoplaying: false,
  stopAutoplay: false,
  streak: 0,
  packs: [],
  packId: "beginner",
  game: new Chess(),
  ecoCatalog: null,
  ecoLoading: null,
  searchQuery: "",
  searchTimer: null,
};

const el = {
  board: document.getElementById("board"),
  status: document.getElementById("status"),
  chip: document.getElementById("status-chip"),
  openingName: document.getElementById("opening-name"),
  openingMeta: document.getElementById("opening-meta"),
  eco: document.getElementById("eco"),
  tip: document.getElementById("strategy-tip"),
  learnProgress: document.getElementById("learn-progress"),
  learnStreak: document.getElementById("learn-streak"),
  openingResults: document.getElementById("opening-results"),
  openingSearch: document.getElementById("opening-search"),
  lessonTray: document.getElementById("lesson-tray"),
  packSelect: document.getElementById("pack-select"),
  packBlurb: document.getElementById("pack-blurb"),
  lessonRow: document.getElementById("lesson-row"),
  recentsRow: document.getElementById("recents-row"),
  progressSummary: document.getElementById("progress-summary"),
  pgnStrip: document.getElementById("pgn-strip"),
  difficultySelect: document.getElementById("difficulty-select"),
  learnLead: document.getElementById("learn-lead"),
  btnHint: document.getElementById("btn-hint"),
  btnShowMove: document.getElementById("btn-show-move"),
  btnAuto: document.getElementById("btn-auto"),
  btnStopAuto: document.getElementById("btn-stop-auto"),
  btnRestart: document.getElementById("btn-restart-line"),
  btnUndo: document.getElementById("btn-undo"),
  btnFlip: document.getElementById("btn-flip"),
};

function setChip(kind, text) {
  el.chip.dataset.kind = kind || "idle";
  el.chip.textContent = text || "Ready";
}

function setStatus(text) {
  el.status.textContent = text;
}

function isBusy() {
  return state.autoplaying;
}

function parseSq(name) {
  return "abcdefgh".indexOf(name[0]) + (Number(name[1]) - 1) * 8;
}

function sqName(i) {
  return "abcdefgh"[i & 7] + String((i >> 3) + 1);
}

function sideToMove(fen) {
  return fen.split(" ")[1] || "w";
}

function parseFenPieces(fen) {
  const placement = fen.split(" ")[0];
  const grid = Array(64).fill(null);
  let rank = 7;
  let file = 0;
  for (const ch of placement) {
    if (ch === "/") {
      rank -= 1;
      file = 0;
      continue;
    }
    if (/\d/.test(ch)) {
      file += Number(ch);
      continue;
    }
    grid[file + rank * 8] = ch;
    file += 1;
  }
  return grid;
}

function refreshLegal() {
  state.legal = state.game.moves({ verbose: true }).map((m) => m.from + m.to + (m.promotion || ""));
}

function expectedPracticeMove() {
  if (!state.practice) return null;
  return state.practice.uci[state.practiceIndex] || null;
}

function applyRoleChrome() {
  const student = state.role === "student";
  document.body.classList.toggle("role-student", student);
  document.body.classList.toggle("role-teacher", !student);
  document.getElementById("role-teacher")?.classList.toggle("on", !student);
  document.getElementById("role-teacher")?.classList.toggle("ghost", student);
  document.getElementById("role-student")?.classList.toggle("on", student);
  document.getElementById("role-student")?.classList.toggle("ghost", !student);
  if (el.learnLead) {
    el.learnLead.textContent = student
      ? "Search an opening by name, or pick a curriculum line, then play the theory moves yourself."
      : "Search any ECO opening by name, or coach through a curriculum pack.";
  }
}

function setRole(role) {
  state.role = role === "student" ? "student" : "teacher";
  try {
    localStorage.setItem(ROLE_KEY, state.role);
  } catch {
    /* ignore */
  }
  if (state.role === "student" && state.autoplaying) state.stopAutoplay = true;
  applyRoleChrome();
  syncControls();
}

function setDifficulty(diff) {
  state.difficulty = DIFFICULTY[diff] ? diff : "intermediate";
  try {
    localStorage.setItem(DIFF_KEY, state.difficulty);
  } catch {
    /* ignore */
  }
  if (el.difficultySelect) el.difficultySelect.value = state.difficulty;
}

function syncControls() {
  const busy = isBusy();
  const hasPractice = Boolean(state.practice);
  const hasMoves = state.moves.length > 0;
  const lineDone = hasPractice && state.practiceIndex >= (state.practice.uci?.length || 0);
  const canTheory = hasPractice && !lineDone;
  const student = state.role === "student";

  el.btnUndo.disabled = busy || !hasMoves;
  el.btnRestart.disabled = busy || !hasPractice;
  el.btnHint.disabled = busy || !canTheory;
  el.btnShowMove.disabled = busy || !canTheory || student;
  el.btnShowMove.classList.toggle("hidden", student);
  el.btnAuto.disabled = busy || !canTheory || student;
  el.btnAuto.classList.toggle("hidden", state.autoplaying || student);
  el.btnStopAuto.classList.toggle("hidden", !state.autoplaying);
  el.btnStopAuto.disabled = !state.autoplaying;
  if (el.difficultySelect) el.difficultySelect.disabled = busy;
  if (el.packSelect) el.packSelect.disabled = busy;
  if (el.openingSearch) el.openingSearch.disabled = busy;
  updateStreakUi();
}

function updateStreakUi() {
  if (!el.learnStreak) return;
  el.learnStreak.textContent = `streak ${state.streak}`;
  el.learnStreak.classList.toggle("hot", state.streak >= 5);
}

function flashWrongBoard() {
  el.board.classList.remove("flash-wrong");
  void el.board.offsetWidth;
  el.board.classList.add("flash-wrong");
  window.setTimeout(() => el.board.classList.remove("flash-wrong"), 650);
}

function renderBoard() {
  const pieces = parseFenPieces(state.fen);
  el.board.innerHTML = "";
  const order = [];
  for (let r = 0; r < 8; r += 1) {
    for (let f = 0; f < 8; f += 1) {
      const rank = state.flipped ? r : 7 - r;
      const file = state.flipped ? 7 - f : f;
      order.push(file + rank * 8);
    }
  }
  order.forEach((sq) => {
    const div = document.createElement("div");
    const light = ((sq & 7) + (sq >> 3)) % 2 === 1;
    div.className = `sq ${light ? "light" : "dark"}`;
    div.dataset.sq = String(sq);
    if (state.lastMove && (state.lastMove.from === sq || state.lastMove.to === sq)) {
      div.classList.add("last");
    }
    if (state.selected === sq) div.classList.add("selected");
    if (state.targets.has(sq)) {
      div.classList.add("target");
      if (pieces[sq]) div.classList.add("capture");
    }
    if (state.hint?.from === sq) div.classList.add("hint-from");
    if (state.hint?.to === sq) div.classList.add("hint-to");
    if (state.showCoords) {
      const file = sq & 7;
      const rank = sq >> 3;
      if ((!state.flipped && rank === 0) || (state.flipped && rank === 7)) {
        const c = document.createElement("span");
        c.className = "coord file";
        c.textContent = "abcdefgh"[file];
        div.appendChild(c);
      }
      if ((!state.flipped && file === 0) || (state.flipped && file === 7)) {
        const c = document.createElement("span");
        c.className = "coord rank";
        c.textContent = String(rank + 1);
        div.appendChild(c);
      }
    }
    const p = pieces[sq];
    if (p) {
      const img = document.createElement("img");
      img.className = "piece";
      img.alt = p;
      img.draggable = true;
      img.src = `./pieces/cburnett/${PIECE_FILE[p]}.svg`;
      img.addEventListener("dragstart", (e) => {
        state.dragFrom = sq;
        img.classList.add("dragging");
        e.dataTransfer.setData("text/plain", String(sq));
      });
      img.addEventListener("dragend", () => img.classList.remove("dragging"));
      div.appendChild(img);
    }
    div.addEventListener("dragover", (e) => {
      e.preventDefault();
      div.classList.add("drag-over");
    });
    div.addEventListener("dragleave", () => div.classList.remove("drag-over"));
    div.addEventListener("drop", (e) => {
      e.preventDefault();
      div.classList.remove("drag-over");
      const from = Number(e.dataTransfer.getData("text/plain"));
      if (!Number.isNaN(from)) tryMoveFromTo(from, sq);
      state.dragFrom = null;
    });
    div.addEventListener("click", () => onSquareClick(sq));
    el.board.appendChild(div);
  });
}

function movesFrom(sq) {
  const from = sqName(sq);
  return state.legal.filter((m) => m.slice(0, 2) === from);
}

function selectSquare(sq) {
  const pieces = parseFenPieces(state.fen);
  const p = pieces[sq];
  if (!p) {
    state.selected = null;
    state.targets = new Set();
    renderBoard();
    return;
  }
  const white = p === p.toUpperCase();
  if ((sideToMove(state.fen) === "w") !== white) return;
  state.selected = sq;
  state.targets = new Set(movesFrom(sq).map((m) => parseSq(m.slice(2, 4))));
  renderBoard();
}

function onSquareClick(sq) {
  if (isBusy()) return;
  if (state.selected === null) {
    selectSquare(sq);
    return;
  }
  if (state.selected === sq) {
    state.selected = null;
    state.targets = new Set();
    renderBoard();
    return;
  }
  tryMoveFromTo(state.selected, sq);
}

function tryMoveFromTo(from, to) {
  const fromName = sqName(from);
  const toName = sqName(to);
  const candidates = state.legal.filter((m) => m.startsWith(fromName + toName));
  if (!candidates.length) {
    selectSquare(to);
    return;
  }
  // auto-queen promotions in this static trainer
  const mv = candidates.find((m) => m.length === 4) || candidates.find((m) => m.endsWith("q")) || candidates[0];
  playMove(mv);
}

function lineForDifficulty(op) {
  const uci = Array.isArray(op.uci) ? op.uci.slice() : [];
  const cfg = DIFFICULTY[state.difficulty] || DIFFICULTY.intermediate;
  const maxPly = cfg.maxPly;
  const cut = maxPly != null ? uci.slice(0, maxPly) : uci;
  const san = Array.isArray(op.san) ? op.san.slice(0, cut.length) : [];
  return {
    eco: op.eco || "",
    name: op.name || op.label || "Practice line",
    tip: op.tip || "",
    uci: cut,
    san,
    book_ply: cut.length,
    ply: cut.length,
    moves: Math.floor(cut.length / 2),
  };
}

function startPractice(op) {
  if (isBusy() || !op?.uci?.length) return;
  state.stopAutoplay = true;
  state.practice = lineForDifficulty(op);
  state.practiceIndex = 0;
  state.moves = [];
  state.hint = null;
  state.selected = null;
  state.targets = new Set();
  state.lastMove = null;
  state.streak = 0;
  state.game = new Chess();
  state.fen = state.game.fen();
  refreshLegal();
  el.eco.textContent = state.practice.eco || "—";
  el.openingName.textContent = state.practice.name;
  el.openingMeta.textContent = `Practice · ${state.practice.moves} moves · ${state.difficulty}`;
  el.tip.textContent = state.practice.tip || "";
  pushRecent(op);
  updateLearnProgress();
  updateLearnStatus();
  renderBoard();
  syncControls();
}

function updateLearnProgress() {
  if (!state.practice) {
    el.learnProgress.textContent = "";
    renderPgnStrip();
    return;
  }
  const total = state.practice.uci.length || 1;
  const pct = Math.round((state.practiceIndex / total) * 100);
  el.learnProgress.textContent = `${state.practiceIndex} / ${total} ply · ${pct}%`;
  renderPgnStrip();
}

function updateLearnStatus() {
  if (!state.practice) {
    setStatus("Pick a curriculum line to begin");
    setChip("idle", "Pick a line");
    return;
  }
  if (state.practiceIndex >= state.practice.uci.length) {
    setStatus("Line complete — well trained.");
    setChip("done", "Line complete");
    return;
  }
  const side = sideToMove(state.fen) === "w" ? "White" : "Black";
  setStatus(`${side} to move · book move`);
  setChip("your_move", "Your move");
}

function playMove(uci) {
  if (isBusy() && !state.autoplaying) return;
  if (state.practice) {
    const expected = expectedPracticeMove();
    if (expected && uci !== expected) {
      state.streak = 0;
      updateStreakUi();
      flashWrongBoard();
      setChip("wrong", "Wrong — try again");
      setStatus(state.practice.tip ? `Not the theory move — ${state.practice.tip}` : "Not the theory move — try again");
      state.selected = null;
      state.targets = new Set();
      state.hint = null;
      renderBoard();
      syncControls();
      return;
    }
  }

  const from = uci.slice(0, 2);
  const to = uci.slice(2, 4);
  const promotion = uci.length > 4 ? uci[4] : undefined;
  const move = state.game.move({ from, to, promotion });
  if (!move) {
    setChip("error", "Illegal");
    return;
  }
  state.fen = state.game.fen();
  state.lastMove = { from: parseSq(from), to: parseSq(to) };
  state.moves.push(uci);
  state.selected = null;
  state.targets = new Set();
  state.hint = null;
  if (state.practice) {
    state.practiceIndex += 1;
    state.streak += 1;
    updateStreakUi();
    const total = state.practice.uci.length || 1;
    const pct = Math.min(100, (state.practiceIndex / total) * 100);
    saveLineProgress(state.practice, pct, state.practiceIndex >= total);
    updateLearnProgress();
  }
  refreshLegal();
  renderBoard();
  updateLearnStatus();
  syncControls();
}

function renderPgnStrip() {
  if (!el.pgnStrip) return;
  el.pgnStrip.innerHTML = "";
  if (!state.practice) return;
  const sans = state.practice.san || [];
  const uci = state.practice.uci || [];
  const idx = state.practiceIndex;
  for (let i = 0; i < uci.length; i += 1) {
    if (i % 2 === 0) {
      const num = document.createElement("span");
      num.className = "num";
      num.textContent = `${i / 2 + 1}.`;
      el.pgnStrip.appendChild(num);
    }
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "ply";
    btn.textContent = sans[i] || uci[i];
    if (i < idx) {
      btn.classList.add("on");
      btn.addEventListener("click", () => jumpToPly(i + 1));
    } else if (i === idx) {
      btn.classList.add("on");
    } else {
      btn.classList.add("ahead");
      btn.disabled = true;
    }
    el.pgnStrip.appendChild(btn);
  }
}

function jumpToPly(ply) {
  if (!state.practice || isBusy()) return;
  const target = Math.max(0, Math.min(ply, state.practiceIndex));
  state.game = new Chess();
  state.moves = state.practice.uci.slice(0, target);
  state.practiceIndex = target;
  state.lastMove = null;
  state.hint = null;
  for (const u of state.moves) {
    const from = u.slice(0, 2);
    const to = u.slice(2, 4);
    const promotion = u.length > 4 ? u[4] : undefined;
    state.game.move({ from, to, promotion });
    state.lastMove = { from: parseSq(from), to: parseSq(to) };
  }
  state.fen = state.game.fen();
  refreshLegal();
  updateLearnProgress();
  updateLearnStatus();
  renderBoard();
  syncControls();
}

function restartLine() {
  if (!state.practice || isBusy()) return;
  startPractice(state.practice);
}

function undo() {
  if (!state.moves.length || isBusy()) return;
  jumpToPly(state.practiceIndex - 1);
}

function showHint() {
  if (isBusy()) return;
  const mv = expectedPracticeMove();
  if (!mv) return;
  state.hint = { from: parseSq(mv.slice(0, 2)), to: parseSq(mv.slice(2, 4)) };
  renderBoard();
  setStatus(`Hint: look at ${mv.slice(0, 2)} → ${mv.slice(2, 4)}`);
  setChip("hint", "Hint shown");
}

function showMove() {
  if (isBusy() || state.role === "student") return;
  const mv = expectedPracticeMove();
  if (mv) playMove(mv);
}

async function autoPlayLine() {
  if (!state.practice || isBusy() || state.role === "student") return;
  state.autoplaying = true;
  state.stopAutoplay = false;
  setChip("busy", "Playing line…");
  syncControls();
  try {
    while (state.practiceIndex < state.practice.uci.length) {
      if (state.stopAutoplay) break;
      const mv = expectedPracticeMove();
      if (!mv) break;
      playMove(mv);
      await new Promise((r) => setTimeout(r, 280));
    }
  } finally {
    state.autoplaying = false;
    state.stopAutoplay = false;
    updateLearnStatus();
    syncControls();
  }
}

function activePack() {
  return state.packs.find((p) => p.id === state.packId) || state.packs[0] || null;
}

function normalizeSearch(text) {
  return String(text || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function lineFromPgn(eco, name, pgn) {
  const game = new Chess();
  try {
    game.loadPgn(String(pgn || "").trim(), { strict: false });
  } catch {
    return null;
  }
  const history = game.history({ verbose: true });
  if (!history.length) return null;
  return {
    eco: eco || "",
    name: name || "Opening",
    label: shortName(name || "Opening"),
    tip: "ECO book line — play the main moves yourself.",
    uci: history.map((m) => m.from + m.to + (m.promotion || "")),
    san: history.map((m) => m.san),
    ply: history.length,
  };
}

function parseEcoTsv(text) {
  const lines = String(text || "").split(/\r?\n/);
  const out = [];
  for (let i = 0; i < lines.length; i += 1) {
    const row = lines[i];
    if (!row || (i === 0 && row.startsWith("eco"))) continue;
    const tab1 = row.indexOf("\t");
    const tab2 = tab1 >= 0 ? row.indexOf("\t", tab1 + 1) : -1;
    if (tab1 < 0 || tab2 < 0) continue;
    const eco = row.slice(0, tab1).trim();
    const name = row.slice(tab1 + 1, tab2).trim();
    const pgn = row.slice(tab2 + 1).trim();
    if (!name || !pgn) continue;
    out.push({
      eco,
      name,
      pgn,
      label: shortName(name),
      search: normalizeSearch(`${eco} ${name}`),
      source: "eco",
    });
  }
  return out;
}

async function ensureEcoCatalog() {
  if (state.ecoCatalog) return state.ecoCatalog;
  if (state.ecoLoading) return state.ecoLoading;
  state.ecoLoading = (async () => {
    const parts = await Promise.all(
      ECO_TSV_URLS.map(async (url) => {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`Failed to load ${url}`);
        return parseEcoTsv(await res.text());
      }),
    );
    state.ecoCatalog = parts.flat();
    state.ecoLoading = null;
    return state.ecoCatalog;
  })().catch((err) => {
    state.ecoLoading = null;
    throw err;
  });
  return state.ecoLoading;
}

function curriculumEntries() {
  const entries = [];
  for (const pack of state.packs) {
    for (const line of pack.lines || []) {
      const name = line.name || line.label || line.q || "";
      entries.push({
        ...line,
        name,
        label: line.label || shortName(name),
        search: normalizeSearch(`${line.eco || ""} ${name} ${line.label || ""} ${line.q || ""}`),
        source: "curriculum",
        packLabel: pack.label,
        packId: pack.id,
      });
    }
  }
  return entries;
}

function scoreMatch(entry, tokens) {
  if (!tokens.length) return 0;
  const hay = entry.search || "";
  let score = 0;
  for (const token of tokens) {
    if (!hay.includes(token)) return -1;
    if (hay.startsWith(token)) score += 8;
    else if (hay.includes(` ${token}`)) score += 5;
    else score += 2;
    if ((entry.eco || "").toLowerCase() === token) score += 10;
  }
  if (entry.source === "curriculum") score += 4;
  score += Math.max(0, 6 - Math.floor((entry.name || "").length / 18));
  return score;
}

function renderSearchStatus(text) {
  if (!el.openingResults) return;
  el.openingResults.hidden = false;
  el.openingResults.innerHTML = `<li class="or-status">${text}</li>`;
  el.lessonTray?.classList.add("is-searching");
}

function clearSearchResults() {
  if (!el.openingResults) return;
  el.openingResults.hidden = true;
  el.openingResults.innerHTML = "";
  el.lessonTray?.classList.remove("is-searching");
}

function renderSearchResults(matches, query) {
  if (!el.openingResults) return;
  if (!query) {
    clearSearchResults();
    return;
  }
  el.openingResults.hidden = false;
  el.lessonTray?.classList.add("is-searching");
  el.openingResults.innerHTML = "";
  if (!matches.length) {
    el.openingResults.innerHTML = `<li class="or-empty">No openings match “${query}”</li>`;
    return;
  }
  matches.forEach((entry) => {
    const li = document.createElement("li");
    li.tabIndex = 0;
    li.setAttribute("role", "button");
    const ply = Array.isArray(entry.uci)
      ? entry.uci.length
      : String(entry.pgn || "")
          .split(/\s+/)
          .filter((tok) => tok && !/^\d+\.+?$/.test(tok) && tok !== "*" && tok !== "...")
          .length;
    const where = entry.source === "curriculum"
      ? `${entry.packLabel || "Curriculum"} pack`
      : "ECO book";
    li.innerHTML = `<div class="or-name">${entry.name}</div><div class="or-meta">${entry.eco || "—"} · ${where}${ply ? ` · ${ply} ply` : ""}</div>`;
    const pick = () => pickSearchResult(entry);
    li.addEventListener("click", pick);
    li.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        pick();
      }
    });
    el.openingResults.appendChild(li);
  });
}

function pickSearchResult(entry) {
  if (isBusy()) return;
  if (entry.source === "eco" && !entry.uci?.length) {
    const line = lineFromPgn(entry.eco, entry.name, entry.pgn);
    if (!line) {
      setChip("error", "Could not load line");
      setStatus(`Could not parse moves for ${entry.name}`);
      return;
    }
    startPractice(line);
    return;
  }
  startPractice(entry);
}

async function runOpeningSearch(rawQuery) {
  const query = String(rawQuery || "").trim();
  state.searchQuery = query;
  if (!query) {
    clearSearchResults();
    return;
  }
  const tokens = normalizeSearch(query).split(" ").filter(Boolean);
  if (!tokens.length) {
    clearSearchResults();
    return;
  }

  const local = curriculumEntries()
    .map((entry) => ({ entry, score: scoreMatch(entry, tokens) }))
    .filter((row) => row.score >= 0)
    .sort((a, b) => b.score - a.score || a.entry.name.localeCompare(b.entry.name))
    .map((row) => row.entry);

  renderSearchStatus("Searching ECO book…");
  let eco = [];
  try {
    const catalog = await ensureEcoCatalog();
    if (state.searchQuery !== query) return;
    eco = catalog
      .map((entry) => ({ entry, score: scoreMatch(entry, tokens) }))
      .filter((row) => row.score >= 0)
      .sort((a, b) => b.score - a.score || a.entry.name.localeCompare(b.entry.name))
      .map((row) => row.entry);
  } catch {
    if (state.searchQuery !== query) return;
    if (!local.length) {
      renderSearchResults([], query);
      setChip("error", "Search offline");
      return;
    }
  }
  if (state.searchQuery !== query) return;

  const seen = new Set();
  const merged = [];
  for (const entry of [...local, ...eco]) {
    const key = `${entry.eco || ""}|${normalizeSearch(entry.name)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(entry);
    if (merged.length >= SEARCH_LIMIT) break;
  }
  renderSearchResults(merged, query);
}

function scheduleOpeningSearch(value) {
  if (state.searchTimer) window.clearTimeout(state.searchTimer);
  state.searchTimer = window.setTimeout(() => {
    runOpeningSearch(value).catch((err) => {
      setStatus(`Search failed: ${err.message}`);
      setChip("error", "Search error");
    });
  }, 160);
}

function renderPackSelect() {
  el.packSelect.innerHTML = "";
  state.packs.forEach((pack) => {
    const opt = document.createElement("option");
    opt.value = pack.id;
    opt.textContent = pack.label;
    el.packSelect.appendChild(opt);
  });
  el.packSelect.value = state.packId;
  el.packBlurb.textContent = activePack()?.blurb || "";
}

function setPack(packId) {
  const pack = state.packs.find((p) => p.id === packId) || state.packs[0];
  if (!pack) return;
  state.packId = pack.id;
  try {
    localStorage.setItem(PACK_KEY, pack.id);
  } catch {
    /* ignore */
  }
  el.packSelect.value = pack.id;
  el.packBlurb.textContent = pack.blurb || "";
  renderLessonTray();
}

function renderLessonTray() {
  el.lessonRow.innerHTML = "";
  const lines = activePack()?.lines || [];
  lines.forEach((lesson) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = lesson.label;
    btn.title = lesson.name || lesson.q;
    btn.addEventListener("click", () => startPractice(lesson));
    el.lessonRow.appendChild(btn);
  });
}

function shortName(name) {
  if (!name) return "Opening";
  const cut = name.split(/[:,(]/)[0].trim();
  return cut.length > 28 ? `${cut.slice(0, 26)}…` : cut;
}

function loadRecents() {
  try {
    const raw = localStorage.getItem(RECENTS_KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list.slice(0, 5) : [];
  } catch {
    return [];
  }
}

function pushRecent(op) {
  if (!op?.name && !op?.label) return;
  const entry = {
    eco: op.eco || "",
    name: op.name || op.label,
    label: op.label || op.name,
    uci: op.uci || [],
    san: op.san || [],
    tip: op.tip || "",
  };
  if (!entry.uci.length) return;
  const rest = loadRecents().filter((r) => r.name !== entry.name);
  try {
    localStorage.setItem(RECENTS_KEY, JSON.stringify([entry, ...rest].slice(0, 5)));
  } catch {
    /* ignore */
  }
  renderRecents();
}

function renderRecents() {
  const recents = loadRecents();
  el.recentsRow.innerHTML = "";
  if (!recents.length) {
    el.recentsRow.innerHTML = `<span class="tray-empty">None yet</span>`;
    return;
  }
  recents.forEach((op) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = op.eco ? `${op.eco} ${shortName(op.name)}` : shortName(op.name);
    btn.addEventListener("click", () => startPractice(op));
    el.recentsRow.appendChild(btn);
  });
}

function loadProgressMap() {
  try {
    const raw = localStorage.getItem(PROGRESS_KEY);
    const map = raw ? JSON.parse(raw) : {};
    return map && typeof map === "object" ? map : {};
  } catch {
    return {};
  }
}

function saveLineProgress(op, pct, completed) {
  const key = `${op.eco || ""}|${op.name || ""}`;
  const map = loadProgressMap();
  const prev = map[key] || { bestPct: 0, completes: 0, name: op.name, eco: op.eco || "" };
  prev.bestPct = Math.max(prev.bestPct || 0, pct);
  if (completed) prev.completes = (prev.completes || 0) + 1;
  prev.updatedAt = Date.now();
  map[key] = prev;
  try {
    localStorage.setItem(PROGRESS_KEY, JSON.stringify(map));
  } catch {
    /* ignore */
  }
  renderProgressSummary();
}

function renderProgressSummary() {
  const entries = Object.values(loadProgressMap()).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  if (!entries.length) {
    el.progressSummary.textContent = "No lines completed yet";
    return;
  }
  const done = entries.filter((e) => (e.completes || 0) > 0).length;
  const top = entries
    .slice(0, 3)
    .map((e) => `${e.eco ? e.eco + " " : ""}${shortName(e.name)} ${Math.round(e.bestPct || 0)}%`)
    .join(" · ");
  el.progressSummary.textContent = `${done} line${done === 1 ? "" : "s"} finished · ${top}`;
}

async function boot() {
  try {
    const savedRole = localStorage.getItem(ROLE_KEY);
    if (savedRole === "student" || savedRole === "teacher") state.role = savedRole;
    const savedDiff = localStorage.getItem(DIFF_KEY);
    if (DIFFICULTY[savedDiff]) state.difficulty = savedDiff;
  } catch {
    /* ignore */
  }
  setDifficulty(state.difficulty);
  applyRoleChrome();

  const data = await fetch("./curriculum_packs.json").then((r) => r.json());
  state.packs = data.packs || [];
  let packId = "beginner";
  try {
    packId = localStorage.getItem(PACK_KEY) || "beginner";
  } catch {
    /* ignore */
  }
  if (!state.packs.some((p) => p.id === packId)) packId = state.packs[0]?.id || "beginner";
  state.packId = packId;
  renderPackSelect();
  renderLessonTray();
  renderRecents();
  renderProgressSummary();
  refreshLegal();
  renderBoard();
  syncControls();
  setStatus("Pick a curriculum line to begin");
}

document.getElementById("role-teacher").addEventListener("click", () => setRole("teacher"));
document.getElementById("role-student").addEventListener("click", () => setRole("student"));
document.getElementById("btn-restart-line").addEventListener("click", () => restartLine());
document.getElementById("btn-flip").addEventListener("click", () => {
  state.flipped = !state.flipped;
  renderBoard();
});
document.getElementById("btn-undo").addEventListener("click", () => undo());
document.getElementById("btn-hint").addEventListener("click", () => showHint());
document.getElementById("btn-show-move").addEventListener("click", () => showMove());
document.getElementById("btn-auto").addEventListener("click", () => autoPlayLine());
document.getElementById("btn-stop-auto").addEventListener("click", () => {
  state.stopAutoplay = true;
});
el.difficultySelect.addEventListener("change", (e) => setDifficulty(e.target.value));
el.packSelect.addEventListener("change", (e) => setPack(e.target.value));
el.openingSearch?.addEventListener("input", (e) => scheduleOpeningSearch(e.target.value));
el.openingSearch?.addEventListener("search", (e) => scheduleOpeningSearch(e.target.value));
el.openingSearch?.addEventListener("focus", () => {
  ensureEcoCatalog().catch(() => {});
});
document.getElementById("toggle-coords").addEventListener("change", (e) => {
  state.showCoords = e.target.checked;
  renderBoard();
});

boot().catch((err) => {
  setStatus(`Failed to load curriculum: ${err.message}`);
  setChip("error", "Error");
});
