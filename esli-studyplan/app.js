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
const SEARCH_LIMIT = 80;
const DB_LABEL = "Lichess ECO openings";

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
  searchMatches: [],
  searchMatchTotal: 0,
  searchActiveIndex: -1,
  browseMode: false,
  browseBackup: null,
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
  searchDbStatus: document.getElementById("search-db-status"),
  searchReader: document.getElementById("search-reader"),
  readerKicker: document.getElementById("reader-kicker"),
  readerPgn: document.getElementById("reader-pgn"),
  readerHint: document.getElementById("reader-hint"),
  btnPracticeResult: document.getElementById("btn-practice-result"),
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
      ? "Search the openings database, read the line, then practice the moves yourself."
      : "Search the openings database, read through matches, then coach the line.";
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
  if (isBusy() || state.browseMode) return;
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
  if (state.browseMode) return;
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
  state.browseMode = false;
  state.browseBackup = null;
  document.body.classList.remove("is-browsing-search");
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

function formatSanLine(san) {
  if (!Array.isArray(san) || !san.length) return "";
  const parts = [];
  for (let i = 0; i < san.length; i += 1) {
    if (i % 2 === 0) parts.push(`${Math.floor(i / 2) + 1}.`);
    parts.push(san[i]);
  }
  return parts.join(" ");
}

function plyFromPgn(pgn) {
  return String(pgn || "")
    .split(/\s+/)
    .filter((tok) => tok && !/^\d+\.+?$/.test(tok) && tok !== "*" && tok !== "...")
    .length;
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
    tip: "ECO book line — read the moves, then practice them yourself.",
    uci: history.map((m) => m.from + m.to + (m.promotion || "")),
    san: history.map((m) => m.san),
    pgn: formatSanLine(history.map((m) => m.san)) || String(pgn || "").trim(),
    ply: history.length,
  };
}

function resolveOpeningEntry(entry) {
  if (!entry) return null;
  if (Array.isArray(entry.uci) && entry.uci.length) {
    const san = Array.isArray(entry.san) && entry.san.length
      ? entry.san
      : [];
    return {
      eco: entry.eco || "",
      name: entry.name || entry.label || "Opening",
      label: entry.label || shortName(entry.name || "Opening"),
      tip: entry.tip || "Curriculum line — read the moves, then practice them yourself.",
      uci: entry.uci.slice(),
      san: san.slice(),
      pgn: formatSanLine(san) || entry.pgn || "",
      ply: entry.uci.length,
      source: entry.source || "curriculum",
      packLabel: entry.packLabel,
    };
  }
  if (entry._resolved) return entry._resolved;
  const line = lineFromPgn(entry.eco, entry.name, entry.pgn);
  if (!line) return null;
  line.source = entry.source || "eco";
  entry._resolved = line;
  return line;
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
      plyEstimate: plyFromPgn(pgn),
    });
  }
  return out;
}

function setDbStatus(stateName, text) {
  if (!el.searchDbStatus) return;
  el.searchDbStatus.dataset.state = stateName || "";
  el.searchDbStatus.textContent = text;
}

async function ensureEcoCatalog() {
  if (state.ecoCatalog) return state.ecoCatalog;
  if (state.ecoLoading) return state.ecoLoading;
  setDbStatus("loading", `Loading ${DB_LABEL}…`);
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
    setDbStatus("ready", `${DB_LABEL} · ${state.ecoCatalog.length.toLocaleString()} lines ready`);
    return state.ecoCatalog;
  })().catch((err) => {
    state.ecoLoading = null;
    setDbStatus("error", "Openings database unavailable — curriculum search only");
    throw err;
  });
  return state.ecoLoading;
}

function curriculumEntries() {
  const entries = [];
  for (const pack of state.packs) {
    for (const line of pack.lines || []) {
      const name = line.name || line.label || line.q || "";
      const san = Array.isArray(line.san) ? line.san : [];
      entries.push({
        ...line,
        name,
        label: line.label || shortName(name),
        pgn: formatSanLine(san),
        search: normalizeSearch(`${line.eco || ""} ${name} ${line.label || ""} ${line.q || ""}`),
        source: "curriculum",
        packLabel: pack.label,
        packId: pack.id,
        plyEstimate: Array.isArray(line.uci) ? line.uci.length : plyFromPgn(line.pgn),
      });
    }
  }
  return entries;
}

function lineLength(entry) {
  if (!entry) return 0;
  if (Array.isArray(entry.uci) && entry.uci.length) return entry.uci.length;
  if (entry.plyEstimate) return entry.plyEstimate;
  return plyFromPgn(entry.pgn);
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
  return score;
}

function rankSearchHits(rows) {
  return rows
    .filter((row) => row.score >= 0)
    .sort((a, b) => {
      const lenDiff = lineLength(b.entry) - lineLength(a.entry);
      if (lenDiff) return lenDiff;
      if (b.score !== a.score) return b.score - a.score;
      return a.entry.name.localeCompare(b.entry.name);
    })
    .map((row) => row.entry);
}

function snapshotBoardState() {
  return {
    practice: state.practice,
    practiceIndex: state.practiceIndex,
    moves: state.moves.slice(),
    fen: state.fen,
    lastMove: state.lastMove ? { ...state.lastMove } : null,
    hint: state.hint ? { ...state.hint } : null,
    streak: state.streak,
    eco: el.eco.textContent,
    openingName: el.openingName.textContent,
    openingMeta: el.openingMeta.textContent,
    tip: el.tip.textContent,
    status: el.status.textContent,
    chipKind: el.chip.dataset.kind,
    chipText: el.chip.textContent,
  };
}

function restoreBoardSnapshot(snap) {
  if (!snap) return;
  state.practice = snap.practice;
  state.practiceIndex = snap.practiceIndex;
  state.moves = snap.moves.slice();
  state.lastMove = snap.lastMove;
  state.hint = snap.hint;
  state.streak = snap.streak;
  state.selected = null;
  state.targets = new Set();
  state.game = new Chess();
  state.fen = state.game.fen();
  for (const u of state.moves) {
    const from = u.slice(0, 2);
    const to = u.slice(2, 4);
    const promotion = u.length > 4 ? u[4] : undefined;
    const move = state.game.move({ from, to, promotion });
    if (!move) break;
    state.lastMove = { from: parseSq(from), to: parseSq(to) };
  }
  state.fen = state.game.fen();
  refreshLegal();
  el.eco.textContent = snap.eco;
  el.openingName.textContent = snap.openingName;
  el.openingMeta.textContent = snap.openingMeta;
  el.tip.textContent = snap.tip;
  setStatus(snap.status);
  setChip(snap.chipKind, snap.chipText);
  updateLearnProgress();
  updateStreakUi();
  renderBoard();
  syncControls();
}

function showPreviewBoard(line) {
  const game = new Chess();
  let last = null;
  for (const u of line.uci || []) {
    const from = u.slice(0, 2);
    const to = u.slice(2, 4);
    const promotion = u.length > 4 ? u[4] : undefined;
    const move = game.move({ from, to, promotion });
    if (!move) break;
    last = { from: parseSq(from), to: parseSq(to) };
  }
  state.fen = game.fen();
  state.game = game;
  state.lastMove = last;
  state.selected = null;
  state.targets = new Set();
  state.hint = null;
  state.moves = (line.uci || []).slice();
  state.practice = null;
  state.practiceIndex = 0;
  refreshLegal();
  renderBoard();
  if (el.pgnStrip) {
    el.pgnStrip.innerHTML = "";
    const sans = line.san || [];
    for (let i = 0; i < (line.uci || []).length; i += 1) {
      if (i % 2 === 0) {
        const num = document.createElement("span");
        num.className = "num";
        num.textContent = `${i / 2 + 1}.`;
        el.pgnStrip.appendChild(num);
      }
      const span = document.createElement("span");
      span.className = "ply on";
      span.textContent = sans[i] || line.uci[i];
      el.pgnStrip.appendChild(span);
    }
  }
  if (el.learnProgress) el.learnProgress.textContent = `Browse · ${(line.uci || []).length} ply`;
}

function setSearchExpanded(open) {
  if (el.openingSearch) el.openingSearch.setAttribute("aria-expanded", open ? "true" : "false");
}

function renderSearchStatus(text) {
  if (!el.openingResults) return;
  el.openingResults.hidden = false;
  setSearchExpanded(true);
  el.openingResults.innerHTML = `<li class="or-status">${text}</li>`;
  el.lessonTray?.classList.add("is-searching");
  if (el.searchReader) el.searchReader.hidden = true;
}

function exitBrowseMode({ restore = true } = {}) {
  document.body.classList.remove("is-browsing-search");
  state.browseMode = false;
  state.searchActiveIndex = -1;
  state.searchMatches = [];
  state.searchMatchTotal = 0;
  if (el.searchReader) el.searchReader.hidden = true;
  if (el.openingResults) {
    el.openingResults.hidden = true;
    el.openingResults.innerHTML = "";
  }
  setSearchExpanded(false);
  el.lessonTray?.classList.remove("is-searching");
  if (restore && state.browseBackup) {
    restoreBoardSnapshot(state.browseBackup);
    state.browseBackup = null;
  } else {
    state.browseBackup = null;
  }
}

function clearSearchResults() {
  exitBrowseMode({ restore: true });
}

function updateActiveResultChrome() {
  if (!el.openingResults) return;
  const items = [...el.openingResults.querySelectorAll('[role="option"]')];
  items.forEach((node, idx) => {
    const on = idx === state.searchActiveIndex;
    node.classList.toggle("is-active", on);
    node.setAttribute("aria-selected", on ? "true" : "false");
    if (on) {
      node.scrollIntoView({ block: "nearest" });
      if (el.openingSearch) el.openingSearch.setAttribute("aria-activedescendant", node.id);
    }
  });
}

function browseSearchIndex(index) {
  if (!state.searchMatches.length) return;
  const next = Math.max(0, Math.min(index, state.searchMatches.length - 1));
  state.searchActiveIndex = next;
  updateActiveResultChrome();
  previewSearchResult(state.searchMatches[next], next);
}

function previewSearchResult(entry, index = state.searchActiveIndex) {
  if (isBusy() || !entry) return;
  const line = resolveOpeningEntry(entry);
  if (!line) {
    setChip("error", "Could not read line");
    return;
  }
  if (!state.browseMode) {
    state.browseBackup = snapshotBoardState();
    state.browseMode = true;
    document.body.classList.add("is-browsing-search");
  }
  state.searchActiveIndex = index;
  showPreviewBoard(line);
  el.eco.textContent = line.eco || "—";
  el.openingName.textContent = line.name;
  const where = line.source === "curriculum"
    ? `${line.packLabel || "Curriculum"} pack`
    : DB_LABEL;
  el.openingMeta.textContent = `Reading · ${line.uci.length} ply · ${where}`;
  el.tip.textContent = line.tip || "";
  setStatus("Read the line, then practice — or keep browsing results");
  setChip("hint", "Browsing");
  if (el.searchReader) el.searchReader.hidden = false;
  if (el.readerKicker) {
    el.readerKicker.textContent = `${index + 1} of ${state.searchMatches.length} · ${line.eco || "ECO"}`;
  }
  if (el.readerPgn) el.readerPgn.textContent = line.pgn || formatSanLine(line.san) || "—";
  updateActiveResultChrome();
  syncControls();
}

function pickSearchResult(entry) {
  if (isBusy()) return;
  const line = resolveOpeningEntry(entry);
  if (!line) {
    setChip("error", "Could not load line");
    setStatus(`Could not parse moves for ${entry?.name || "opening"}`);
    return;
  }
  state.browseBackup = null;
  state.browseMode = false;
  document.body.classList.remove("is-browsing-search");
  if (el.searchReader) el.searchReader.hidden = true;
  startPractice(line);
}

function practiceActiveSearchResult() {
  if (state.searchActiveIndex < 0) return;
  const entry = state.searchMatches[state.searchActiveIndex];
  if (entry) pickSearchResult(entry);
}

function renderSearchResults(matches, query, total) {
  if (!el.openingResults) return;
  if (!query) {
    clearSearchResults();
    return;
  }
  state.searchMatches = matches;
  state.searchMatchTotal = total;
  el.openingResults.hidden = false;
  setSearchExpanded(true);
  el.lessonTray?.classList.add("is-searching");
  el.openingResults.innerHTML = "";
  if (!matches.length) {
    el.openingResults.innerHTML = `<li class="or-empty">No openings match “${query}”</li>`;
    if (el.searchReader) el.searchReader.hidden = true;
    return;
  }

  const count = document.createElement("li");
  count.className = "or-count";
  count.textContent = total > matches.length
    ? `Showing ${matches.length} of ${total.toLocaleString()} matches · longest lines first`
    : `${matches.length} match${matches.length === 1 ? "" : "es"} · longest lines first`;
  el.openingResults.appendChild(count);

  matches.forEach((entry, idx) => {
    const li = document.createElement("li");
    li.id = `opening-result-${idx}`;
    li.tabIndex = -1;
    li.setAttribute("role", "option");
    li.setAttribute("aria-selected", "false");
    const ply = entry.plyEstimate || entry.uci?.length || plyFromPgn(entry.pgn);
    const where = entry.source === "curriculum"
      ? `${entry.packLabel || "Curriculum"} pack`
      : "ECO database";
    const pgnText = entry.pgn || formatSanLine(entry.san) || "";
    li.innerHTML = `<div class="or-name">${entry.name}</div><div class="or-meta">${entry.eco || "—"} · ${where}${ply ? ` · ${ply} ply` : ""}</div>${pgnText ? `<div class="or-pgn">${pgnText}</div>` : ""}`;
    li.addEventListener("click", () => browseSearchIndex(idx));
    li.addEventListener("dblclick", () => pickSearchResult(entry));
    el.openingResults.appendChild(li);
  });

  browseSearchIndex(0);
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

  const local = rankSearchHits(
    curriculumEntries().map((entry) => ({ entry, score: scoreMatch(entry, tokens) })),
  );

  renderSearchStatus(`Searching ${DB_LABEL}…`);
  let eco = [];
  try {
    const catalog = await ensureEcoCatalog();
    if (state.searchQuery !== query) return;
    eco = rankSearchHits(
      catalog.map((entry) => ({ entry, score: scoreMatch(entry, tokens) })),
    );
  } catch {
    if (state.searchQuery !== query) return;
    if (!local.length) {
      renderSearchResults([], query, 0);
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
  }
  merged.sort((a, b) => {
    const lenDiff = lineLength(b) - lineLength(a);
    if (lenDiff) return lenDiff;
    return a.name.localeCompare(b.name);
  });
  renderSearchResults(merged.slice(0, SEARCH_LIMIT), query, merged.length);
}

function scheduleOpeningSearch(value) {
  if (state.searchTimer) window.clearTimeout(state.searchTimer);
  state.searchTimer = window.setTimeout(() => {
    runOpeningSearch(value).catch((err) => {
      setStatus(`Search failed: ${err.message}`);
      setChip("error", "Search error");
    });
  }, 120);
}

function onOpeningSearchKeydown(e) {
  if (!state.searchMatches.length && !["Escape"].includes(e.key)) return;
  if (e.key === "ArrowDown") {
    e.preventDefault();
    browseSearchIndex(state.searchActiveIndex < 0 ? 0 : state.searchActiveIndex + 1);
  } else if (e.key === "ArrowUp") {
    e.preventDefault();
    browseSearchIndex(state.searchActiveIndex <= 0 ? 0 : state.searchActiveIndex - 1);
  } else if (e.key === "Enter") {
    if (state.searchActiveIndex >= 0) {
      e.preventDefault();
      practiceActiveSearchResult();
    }
  } else if (e.key === "Escape") {
    e.preventDefault();
    if (el.openingSearch) el.openingSearch.value = "";
    clearSearchResults();
  }
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
  ensureEcoCatalog().catch(() => {});
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
el.openingSearch?.addEventListener("keydown", onOpeningSearchKeydown);
el.openingSearch?.addEventListener("focus", () => {
  ensureEcoCatalog().catch(() => {});
});
el.btnPracticeResult?.addEventListener("click", () => practiceActiveSearchResult());
document.getElementById("toggle-coords").addEventListener("change", (e) => {
  state.showCoords = e.target.checked;
  renderBoard();
});

boot().catch((err) => {
  setStatus(`Failed to load curriculum: ${err.message}`);
  setChip("error", "Error");
});
