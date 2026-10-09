const STORAGE_KEY = "endless-vocals-song-mapper-v2";
const TONES = ["", "full voice clean", "mixed voice", "head mix", "falsetto", "airy falsetto", "breathy", "grit", "breathy grit", "distorted clean", "power scream", "growl", "compressed", "tiny singing", "forward placement", "sean connery", "soft palate buzz"];
const INSTRUCTIONS = ["", "support down", "push down", "drop jaw", "breathe", "lean in", "clear consonants", "punch word", "hold back", "explode", "taper off", "drag timing", "push timing", "delay entry", "early entry", "hold longer", "place forward", "place up", "stay small", "add compression", "release tension", "lift soft palate", "stabilize breath", "connect phrase", "light onset", "hard onset", "palate buzz"];
const TYPE_STYLES = [
  { id: "signal", name: "Signal", hint: "Close, sculpted, bold" },
  { id: "tape", name: "Tape", hint: "Monospaced stage marks" },
  { id: "velvet", name: "Velvet", hint: "Expressive italic" },
  { id: "halo", name: "Halo", hint: "A soft-lit edge" },
  { id: "score", name: "Score", hint: "Open, measured spacing" },
  { id: "cut", name: "Cut", hint: "Condensed impact" }
];
const ACCENT_SWATCHES = [{ name: "Mint", color: "#78f0c2" }, { name: "Electric", color: "#80c8ff" }, { name: "Coral", color: "#ff9b83" }, { name: "Violet", color: "#c4a4ff" }, { name: "Gold", color: "#ffd17a" }, { name: "Rose", color: "#ffa6d0" }];
const BACKGROUND_SWATCHES = [{ name: "Midnight", color: "#0f1117" }, { name: "Deep blue", color: "#10243c" }, { name: "Plum", color: "#27172d" }, { name: "Forest", color: "#122b25" }, { name: "Burgundy", color: "#341b26" }, { name: "Slate", color: "#283240" }];
const LYRIC_SWATCHES = [{ name: "Moonlight", color: "#eff3ff" }, { name: "Warm paper", color: "#fff0d3" }, { name: "Mint glow", color: "#c9ffe9" }, { name: "Blue light", color: "#c8e7ff" }, { name: "Rose", color: "#ffd6e6" }, { name: "Gold", color: "#ffe6a5" }];
const SECTION_PRESETS = ["Intro", "Verse 1", "Pre-Chorus", "Chorus 1", "Verse 2", "Chorus 2", "Bridge", "Solo", "Outro"];
const LOOKUP_EXAMPLES = [
  "Queen Bohemian Rhapsody", "Fleetwood Mac Dreams", "Prince Purple Rain", "Adele Hello", "Radiohead Creep",
  "Nirvana Come As You Are", "Whitney Houston I Wanna Dance with Somebody", "The Beatles Yesterday", "David Bowie Heroes", "Metallica Nothing Else Matters",
  "Taylor Swift Anti-Hero", "Billie Eilish Ocean Eyes", "Stevie Wonder Superstition", "Paramore Misery Business", "Hozier Take Me to Church",
  "Amy Winehouse Back to Black", "Coldplay Fix You", "The Weeknd Blinding Lights", "Bruno Mars Grenade", "Journey Don't Stop Believin'"
];
const DEFAULT_APPEARANCE = Object.freeze({ type: "signal", accent: "#78f0c2", lyric: "#eff3ff", background: "#0f1117" });
const $ = (id) => document.getElementById(id);
const clamp = (value, low, high) => Math.min(high, Math.max(low, Number(value) || 0));
const safe = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const validHex = (value, fallback) => /^#[0-9a-f]{6}$/i.test(String(value || "")) ? String(value).toLowerCase() : fallback;
function normalizeAppearance(value = {}) {
  value = value && typeof value === "object" ? value : {};
  return {
    type: TYPE_STYLES.some((style) => style.id === value.type) ? value.type : DEFAULT_APPEARANCE.type,
    accent: validHex(value.accent, DEFAULT_APPEARANCE.accent),
    lyric: validHex(value.lyric, DEFAULT_APPEARANCE.lyric),
    background: validHex(value.background, DEFAULT_APPEARANCE.background)
  };
}
function normalizeSection(value) {
  if (!value || typeof value !== "object") return null;
  const name = String(value.name || "").trim().slice(0, 48);
  if (!name) return null;
  const input = value.appearance && typeof value.appearance === "object" ? value.appearance : {};
  const appearance = {};
  if (TYPE_STYLES.some((style) => style.id === input.type)) appearance.type = input.type;
  for (const key of ["accent", "lyric"]) if (/^#[0-9a-f]{6}$/i.test(String(input[key] || ""))) appearance[key] = input[key].toLowerCase();
  return { name, appearance, endLineId: typeof value.endLineId === "string" ? value.endLineId : null };
}
function noteName(midi) {
  const names = ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"];
  return `${names[midi % 12]}${Math.floor(midi / 12) - 1}`;
}
const validNote = (value) => Number.isInteger(Number(value)) && value != null && Number(value) >= 36 && Number(value) <= 83 ? Number(value) : null;
const SYLLABLE_EXCEPTIONS = { believe: ["be", "lieve"], beautiful: ["beau", "ti", "ful"], every: ["ev", "ery"], fire: ["fire"], hour: ["hour"], love: ["love"], poem: ["po", "em"], rhythm: ["rhyth", "m"], table: ["ta", "ble"], tomorrow: ["to", "mor", "row"] };
function suggestSyllables(text) {
  const word = String(text);
  const match = word.match(/^([^A-Za-z]*)([A-Za-z]+)([^A-Za-z]*)$/);
  if (!match) return [word];
  const [, leading, core, trailing] = match;
  const exception = SYLLABLE_EXCEPTIONS[core.toLowerCase()];
  if (exception) return exception.map((part, index) => `${index ? "" : leading}${core.slice(exception.slice(0, index).join("").length, exception.slice(0, index + 1).join("").length)}${index === exception.length - 1 ? trailing : ""}`);
  const lower = core.toLowerCase();
  const vowels = [...lower.matchAll(/[aeiouy]+/g)].map((part) => ({ start: part.index, end: part.index + part[0].length }));
  if (vowels.length > 1 && /[^aeiouy]e$/.test(lower) && !/[^aeiouy]le$/.test(lower)) vowels.pop();
  if (vowels.length < 2) return [word];
  const cuts = vowels.slice(1).map((vowel, index) => Math.max(vowels[index].end, vowel.start - 1));
  const parts = [], boundaries = [0, ...cuts, core.length];
  for (let index = 0; index < boundaries.length - 1; index++) parts.push(`${index ? "" : leading}${core.slice(boundaries[index], boundaries[index + 1])}${index === boundaries.length - 2 ? trailing : ""}`);
  return parts.filter(Boolean);
}
function normalizeSyllables(text, existing, legacyNote = null) {
  const valid = Array.isArray(existing) && existing.length && existing.length <= 12 && existing.every((part) => part && typeof part.text === "string" && part.text.length) && existing.map((part) => part.text).join("") === text;
  if (valid) {
    const parts = existing.map((part) => ({ text: part.text, notes: Array.isArray(part.notes) && part.notes.length ? part.notes.map(validNote) : [null] }));
    if (!parts.some((part) => part.notes.some((note) => note != null)) && validNote(legacyNote) != null) parts[0].notes[0] = validNote(legacyNote);
    return parts;
  }
  const suggested = suggestSyllables(text).map((part) => ({ text: part, notes: [null] }));
  if (Array.isArray(existing) && existing.length) {
    existing.forEach((part, index) => {
      const notes = Array.isArray(part?.notes) && part.notes.length ? part.notes.map(validNote) : [null];
      if (index < suggested.length) suggested[index].notes = notes;
      else suggested.at(-1)?.notes.push(...notes);
    });
  } else if (suggested.length) suggested[0].notes[0] = validNote(legacyNote);
  return suggested;
}
function noteForWord(word) {
  return word?.syllables?.flatMap((part) => part.notes || []).map(validNote).find((note) => note != null) ?? validNote(word?.note);
}
function wordPitchDetails(word) {
  const syllables = word?.syllables?.length ? word.syllables : [{ text: word?.text || "", notes: [word?.note] }];
  if (!syllables.some((part) => (part.notes || []).some((note) => validNote(note) != null))) return [];
  return syllables.map((part) => ({
    syllable: part.text,
    notes: (part.notes?.length ? part.notes : [null]).map((note) => validNote(note) == null ? "—" : noteName(validNote(note)))
  }));
}
function wordPitchMarkup(word, details) {
  if (!details.length) return `<strong>${visibleLetters(word)}</strong>`;
  let letterOffset = 0;
  return `<strong class="word-syllables" aria-hidden="true">${details.map(({ syllable, notes }, index) => {
    const nextOffset = letterOffset + Array.from(syllable).length;
    const letters = visibleLetters(word, letterOffset, nextOffset);
    letterOffset = nextOffset;
    const previousNotes = details[index - 1]?.notes || [];
    const sustained = index > 0 && notes[0] !== "—" && previousNotes.at(-1) === notes[0];
    const pitches = notes.map((note, noteIndex) => {
      const held = note !== "—" && (noteIndex ? notes[noteIndex - 1] === note : sustained);
      const arrow = noteIndex && !held ? '<span class="pitch-arrow">→</span>' : "";
      return `${arrow}${held ? '<span class="pitch-hold-line"></span>' : safe(note)}`;
    }).join("");
    return `<span class="syllable-column ${sustained ? "same-note" : ""}"><span class="syllable-lyric">${letters}</span><span class="syllable-notes">${pitches}</span></span>`;
  }).join("")}</strong>`;
}

function makeWord(text, old = {}) {
  const enunciation = clamp(old.enunciation ?? 50, 0, 100);
  const syllables = normalizeSyllables(String(text), old.syllables, old.note);
  return {
    text: String(text), above: String(old.above || ""), below: String(old.below || ""),
    volume: old.volume == null ? null : clamp(old.volume, 1, 10),
    enunciation, pitch: clamp(old.pitch ?? 50, 0, 100),
    letterLevels: Array.from(String(text), (_, index) => Array.isArray(old.letterLevels) && old.letterLevels[index] != null ? clamp(old.letterLevels[index], 0, 100) : enunciation),
    breathBefore: String(old.breathBefore || ""),
    syllables,
    note: syllables.flatMap((part) => part.notes).find((note) => note != null) ?? null
  };
}

function alignWords(text, previous = []) {
  const tokens = String(text).trim().split(/\s+/).filter(Boolean);
  const used = new Set();
  return tokens.map((token, index) => {
    let match = previous[index]?.text === token ? index : previous.findIndex((word, oldIndex) => !used.has(oldIndex) && word.text === token);
    if (match < 0 && previous[index] && !used.has(index)) match = index;
    if (match >= 0) used.add(match);
    return makeWord(token, match >= 0 ? previous[match] : {});
  });
}

function makeLine(text, previous) {
  const line = { id: previous?.id || uid(), text: String(text), words: alignWords(text, previous?.words || []), pitchPoints: previous?.pitchPoints || [], breaths: previous?.breaths || [], section: normalizeSection(previous?.section) };
  return line;
}

function makeMap(title = "") { return { id: uid(), title, lines: [], appearance: normalizeAppearance(), updatedAt: Date.now() }; }

function loadDatabase() {
  let raw = window.__songMapperInitialState;
  if (!raw) { try { raw = localStorage.getItem(STORAGE_KEY); } catch (_) {} }
  try {
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (parsed && Array.isArray(parsed.maps) && parsed.maps.length) {
      const maps = parsed.maps.map((map) => ({
        id: String(map.id || uid()), title: String(map.title || ""), updatedAt: Number(map.updatedAt) || Date.now(),
        appearance: normalizeAppearance(map.appearance || parsed.appearance),
        lines: Array.isArray(map.lines) ? map.lines.map((line) => makeLine(line.text ?? "", line)) : []
      }));
      return { maps, activeId: maps.some((map) => map.id === parsed.activeId) ? parsed.activeId : maps[0].id };
    }
  } catch (_) {}
  const first = makeMap();
  return { maps: [first], activeId: first.id };
}

let database = loadDatabase();
let selection = null;
let drawMode = null;
let groupedIds = new Set();
let sectionDraft = null;
let editorMode = null;
let editorScrollY = 0;
let editorReturnsToFocus = false;
let inlineMode = null;
let focusOpen = false;
let selectedLetterIndex = 0;
let rollLineId = null;
let rollWordIndex = 0;
let rollSyllableIndex = 0;
let rollPitchIndex = 0;
let rollDrag = null;
let suppressRollCellClick = false;
let noteAudioContext = null;
let notePreview = null;
let notePreviewRequest = 0;
let toastTimer;
const activeMap = () => database.maps.find((map) => map.id === database.activeId) || database.maps[0];
let appearanceScopeLineId = null;
let lookupExamplePool = [];
let lastLookupExample = "";
let focusTop;
let focusBottom;

function nextLookupExample() {
  if (!lookupExamplePool.length) {
    lookupExamplePool = [...LOOKUP_EXAMPLES];
    for (let index = lookupExamplePool.length - 1; index > 0; index--) {
      const swap = Math.floor(Math.random() * (index + 1));
      [lookupExamplePool[index], lookupExamplePool[swap]] = [lookupExamplePool[swap], lookupExamplePool[index]];
    }
    if (lookupExamplePool[lookupExamplePool.length - 1] === lastLookupExample && lookupExamplePool.length > 1) {
      [lookupExamplePool[0], lookupExamplePool[lookupExamplePool.length - 1]] = [lookupExamplePool[lookupExamplePool.length - 1], lookupExamplePool[0]];
    }
  }
  lastLookupExample = lookupExamplePool.pop();
  return lastLookupExample;
}

function updateSongTitle(title) {
  const name = title || "Untitled song";
  const heading = $("songName");
  $("songNameText").textContent = name;
  $("songNameCopy").textContent = name;
  heading.setAttribute("aria-label", name);
  requestAnimationFrame(() => {
    const width = $("songNameText").getBoundingClientRect().width;
    const moving = width > heading.clientWidth + 1;
    heading.classList.toggle("moving", moving);
    heading.style.setProperty("--song-title-distance", `${Math.round(width + 32)}px`);
    heading.style.setProperty("--song-title-duration", `${Math.max(14, Math.round((width + 32) / 31))}s`);
  });
}

function sectionRanges(map) {
  const starts = map.lines.map((line, start) => ({ line, start })).filter(({ line }) => line.section);
  return starts.map(({ line, start }, position) => {
    const nextStart = starts[position + 1]?.start ?? map.lines.length;
    const explicitEnd = line.section.endLineId ? map.lines.findIndex((item) => item.id === line.section.endLineId) : -1;
    return { line, start, end: explicitEnd >= start ? Math.min(explicitEnd, nextStart - 1) : nextStart - 1, section: line.section };
  });
}
function sectionForLine(map, lineIndex) {
  return sectionRanges(map).find(({ start, end }) => lineIndex >= start && lineIndex <= end)?.section || null;
}
function appearanceForLine(map, lineIndex) {
  return normalizeAppearance({ ...normalizeAppearance(map.appearance), ...sectionForLine(map, lineIndex)?.appearance });
}
function accentChannels(color) { return [1, 3, 5].map((index) => parseInt(color.slice(index, index + 2), 16)); }
function accentInk(channels) { return (channels[0] * 299 + channels[1] * 587 + channels[2] * 114) / 1000 >= 150 ? "#10221b" : "#ffffff"; }

function persist() {
  activeMap().updatedAt = Date.now();
  const json = JSON.stringify(database);
  let saved = false;
  try { localStorage.setItem(STORAGE_KEY, json); saved = true; } catch (_) {}
  try {
    window.webkit?.messageHandlers?.songMapperSave?.postMessage(json);
    if (window.webkit?.messageHandlers?.songMapperSave) saved = true;
  } catch (_) {}
  $("saveStatus").textContent = saved ? "Saved" : "Save unavailable";
  $("saveStatus").classList.toggle("saving", !saved);
}

function showToast(message) {
  $("toast").textContent = message;
  $("toast").classList.remove("hidden");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $("toast").classList.add("hidden"), 2200);
}

function applyAppearance() {
  const map = activeMap();
  const look = map.appearance = normalizeAppearance(map.appearance);
  const root = document.documentElement;
  root.style.setProperty("--mint", look.accent);
  root.style.setProperty("--lyric-ink", look.lyric);
  root.style.setProperty("--bg", look.background);
  const channels = accentChannels(look.accent);
  const backgroundChannels = accentChannels(look.background);
  root.style.setProperty("--bg-glow", `rgb(${backgroundChannels.map((channel) => Math.min(255, Math.round(channel * .76 + 38))).join(",")})`);
  root.style.setProperty("--accent-rgb", channels.join(","));
  root.style.setProperty("--accent-ink", accentInk(channels));
  $("appShell").dataset.type = look.type;
  const line = map.lines.find((item) => item.id === appearanceScopeLineId && item.section);
  if (appearanceScopeLineId && !line) appearanceScopeLineId = null;
  const scopedLook = line ? normalizeAppearance({ ...look, ...line.section.appearance }) : look;
  const scopedChannels = accentChannels(scopedLook.accent);
  const card = $("appearanceModal").querySelector(".appearance-card");
  card.style.setProperty("--mint", scopedLook.accent);
  card.style.setProperty("--lyric-ink", scopedLook.lyric);
  card.style.setProperty("--accent-rgb", scopedChannels.join(","));
  card.style.setProperty("--accent-ink", accentInk(scopedChannels));
  $("appearancePreview").dataset.type = scopedLook.type;
  $("appearancePreview").querySelector("span").textContent = line ? line.section.name.toUpperCase() : "LIVE ON STAGE";
  $("appearanceScopeHint").textContent = line ? "This section keeps the song background while its letters and accents can stand apart." : "This look belongs to this song only. Sections can inherit it or add their own colors and type.";
  $("backgroundControls").classList.toggle("hidden", !!line);
  $("backgroundPicker").classList.toggle("hidden", !!line);
  $("resetAppearance").textContent = line ? "Use song look" : "Reset song look";
  $("accentColor").value = scopedLook.accent;
  $("lyricColor").value = scopedLook.lyric;
  $("backgroundColor").value = look.background;
  document.querySelectorAll("[data-type-option]").forEach((button) => button.setAttribute("aria-pressed", String(button.dataset.typeOption === scopedLook.type)));
  document.querySelectorAll("[data-swatch]").forEach((button) => button.setAttribute("aria-pressed", String(button.dataset.swatch === scopedLook.accent)));
  document.querySelectorAll("[data-lyric-swatch]").forEach((button) => button.setAttribute("aria-pressed", String(button.dataset.lyricSwatch === scopedLook.lyric)));
  document.querySelectorAll("[data-background-swatch]").forEach((button) => button.setAttribute("aria-pressed", String(button.dataset.backgroundSwatch === look.background)));
}

function renderAppearanceScopes() {
  const options = [`<option value="song">Entire song · ${safe(activeMap().title || "Untitled song")}</option>`];
  activeMap().lines.forEach((line) => { if (line.section) options.push(`<option value="${safe(line.id)}">Section · ${safe(line.section.name)}</option>`); });
  $("appearanceScope").innerHTML = options.join("");
  $("appearanceScope").value = appearanceScopeLineId || "song";
}
function renderAppearanceStudio() {
  $("typeOptions").innerHTML = TYPE_STYLES.map((style) => `<button class="type-option" type="button" data-type-option="${style.id}" aria-pressed="false"><span class="type-name">${style.name}</span><strong class="type-sample">Hold the light</strong><small>${style.hint}</small></button>`).join("");
  $("colorSwatches").innerHTML = ACCENT_SWATCHES.map((swatch) => `<button type="button" data-swatch="${swatch.color}" style="--swatch:${swatch.color}" aria-label="${swatch.name} accent" aria-pressed="false"></button>`).join("");
  $("lyricSwatches").innerHTML = LYRIC_SWATCHES.map((swatch) => `<button type="button" data-lyric-swatch="${swatch.color}" style="--swatch:${swatch.color}" aria-label="${swatch.name} lyric ink" aria-pressed="false"></button>`).join("");
  $("backgroundSwatches").innerHTML = BACKGROUND_SWATCHES.map((swatch) => `<button type="button" data-background-swatch="${swatch.color}" style="--swatch:${swatch.color}" aria-label="${swatch.name} background" aria-pressed="false"></button>`).join("");
  renderAppearanceScopes();
  applyAppearance();
}

function updateAppearance(key, value) {
  const map = activeMap();
  const line = map.lines.find((item) => item.id === appearanceScopeLineId && item.section);
  if (line && key !== "background") {
    line.section.appearance = normalizeSection({ name: line.section.name, appearance: { ...line.section.appearance, [key]: value } }).appearance;
  } else if (!line) map.appearance = normalizeAppearance({ ...map.appearance, [key]: value });
  applyAppearance();
  render();
  persist();
}

function openAppearance(scopeLineId = null) { closeMenu(); closeSections(); appearanceScopeLineId = scopeLineId; renderAppearanceStudio(); $("appearanceModal").classList.remove("hidden"); }
function closeAppearance() { $("appearanceModal").classList.add("hidden"); }

function getLine(id) { return activeMap().lines.find((line) => line.id === id); }
function selectedLines() { return selection ? selection.lineIds.map(getLine).filter(Boolean) : []; }
function selectedWords() {
  const lines = selectedLines();
  if (selection?.type === "word") return lines[0]?.words[selection.wordIndex] ? [lines[0].words[selection.wordIndex]] : [];
  return lines.flatMap((line) => line.words);
}
function firstValue(key, fallback) { return selectedWords()[0]?.[key] ?? fallback; }

function visibleLetters(word, start = 0, end = Array.from(word.text).length) {
  return Array.from(word.text).slice(start, end).map((letter, offset) => {
    const index = start + offset;
    const level = clamp(word.letterLevels?.[index] ?? word.enunciation, 0, 100);
    const strength = level > 70 ? "strong" : level < 35 ? "soft" : "normal";
    const displayed = strength === "strong" ? letter.toUpperCase() : strength === "soft" ? letter.toLowerCase() : letter;
    return `<span class="enunc-letter ${strength}">${safe(displayed)}</span>`;
  }).join("");
}

function normalizedPitchPoints(line) {
  let points = (line.pitchPoints || []).map((point) => ({ x: Number(point.x), y: Number(point.y), row: Number.isInteger(Number(point.row)) && point.row != null ? Number(point.row) : null })).filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y));
  if (!points.length && line.words.some((word) => word.pitch !== 50)) {
    points = line.words.map((word, index) => ({ x: line.words.length === 1 ? 50 : index * 100 / (line.words.length - 1), y: 100 - word.pitch }));
  }
  const maxX = Math.max(100, ...points.map((point) => point.x));
  const maxY = Math.max(100, ...points.map((point) => point.y));
  return points.map((point) => ({ x: clamp(point.x / maxX * 100, 0, 100), y: clamp(point.y / (point.row == null ? maxY : 100) * 100, 0, 100), row: point.row })).sort((a, b) => a.x - b.x);
}

function noteLabelFromY(y) {
  const midi = 96 - Math.round(clamp(y, 0, 100) * 72 / 100);
  return ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"][midi % 12] + (Math.floor(midi / 12) - 1);
}

function pitchOverlay(line) {
  if (drawMode !== "pitch" && !line.pitchPoints?.length) return "";
  return `<div class="pitch-layer ${drawMode === "pitch" ? "interactive" : ""}" aria-label="Pitch drawing surface"><svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><g class="pitch-paths"></g></svg><span class="pitch-note-readout hidden" role="status"></span></div>`;
}

function visualPitchRows(layer) {
  const wrap = layer.parentElement;
  const bounds = wrap.getBoundingClientRect();
  const centers = [];
  for (const chip of wrap.querySelectorAll(".word-chip")) {
    const rect = chip.getBoundingClientRect();
    const center = rect.top + rect.height / 2 - bounds.top;
    if (!centers.length || Math.abs(center - centers[centers.length - 1]) > 12) centers.push(center);
  }
  if (!centers.length) return [{ top: 0, bottom: bounds.height || 1 }];
  return centers.map((center, index) => ({
    top: index ? (centers[index - 1] + center) / 2 : 0,
    bottom: index + 1 < centers.length ? (center + centers[index + 1]) / 2 : bounds.height || 1
  }));
}

function pitchPointsByRow(line, rows) {
  const groups = rows.map(() => []);
  for (const point of normalizedPitchPoints(line)) {
    let row = point.row;
    let y = point.y;
    if (row == null) {
      const globalY = y / 100 * rows[rows.length - 1].bottom;
      row = rows.findIndex((band) => globalY >= band.top && globalY <= band.bottom);
      if (row < 0) row = rows.length - 1;
      y = (globalY - rows[row].top) / Math.max(1, rows[row].bottom - rows[row].top) * 100;
    }
    row = clamp(row, 0, rows.length - 1);
    groups[row].push({ x: point.x, y: clamp(y, 0, 100), row });
  }
  return groups;
}

function pitchSvgY(point, rows) {
  const band = rows[point.row];
  return (band.top + point.y / 100 * (band.bottom - band.top)) / Math.max(1, rows[rows.length - 1].bottom) * 100;
}

function paintPitchLayer(layer, line, active = null) {
  const rows = visualPitchRows(layer);
  const groups = pitchPointsByRow(line, rows);
  if (active) groups[active.row] = active.points;
  const paths = layer.querySelector(".pitch-paths");
  paths.replaceChildren(...groups.map((points, row) => {
    const path = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
    path.setAttribute("class", "pitch-path");
    path.setAttribute("data-pitch-row", row);
    path.setAttribute("points", points.slice().sort((a, b) => a.x - b.x).map((point) => `${point.x.toFixed(1)},${pitchSvgY(point, rows).toFixed(1)}`).join(" "));
    return path;
  }));
  return rows;
}

function refreshPitchLayers() {
  for (const layer of document.querySelectorAll(".pitch-layer")) {
    const line = getLine(layer.closest(".lyric-line").dataset.lineId);
    if (line) paintPitchLayer(layer, line);
  }
}

function breathMarkup(type, extraClass = "") {
  const valid = ["micro", "quick", "normal", "deep", "maximum"].includes(type) ? type : "normal";
  return `<span class="breath-mark ${valid} ${extraClass}" role="img" aria-label="${valid} breath" title="${valid} breath"><span class="breath-label">${valid}</span></span>`;
}

function lineStyle(look) {
  const channels = accentChannels(look.accent);
  return `--mint:${look.accent};--lyric-ink:${look.lyric};--accent-rgb:${channels.join(",")};--accent-ink:${accentInk(channels)}`;
}
function sectionColor(section) {
  if (section.appearance?.accent) return section.appearance.accent;
  const name = section.name.toLowerCase();
  if (/chorus|refrain|hook/.test(name)) return "#ffa6d0";
  if (/verse/.test(name)) return "#80c8ff";
  if (/bridge|breakdown/.test(name)) return "#ffd17a";
  if (/intro|opening/.test(name)) return "#c4a4ff";
  if (/outro|ending/.test(name)) return "#78f0c2";
  return "#ff9b83";
}
function sectionOutlineStyle(section) {
  const color = sectionColor(section);
  return `--section-outline:${color};--section-outline-rgb:${accentChannels(color).join(",")}`;
}

function selectedSectionRange() {
  const lines = activeMap().lines;
  const indices = lines.flatMap((line, index) => groupedIds.has(line.id) && line.words.length ? [index] : []);
  if (!indices.length) return null;
  const start = indices[0], end = indices[indices.length - 1];
  if (lines.slice(start, end + 1).some((line) => line.words.length && !groupedIds.has(line.id))) return null;
  return { start, end, startId: lines[start].id, endId: lines[end].id };
}
function renderSectionManager() {
  const ranges = sectionRanges(activeMap());
  $("sectionList").innerHTML = ranges.length ? ranges.map(({ line, start, end }) =>
    `<div class="section-list-row" style="${sectionOutlineStyle(line.section)}"><button class="section-jump" type="button" data-section-jump="${safe(line.id)}" aria-label="Jump to ${safe(line.section.name)}, lines ${start + 1} to ${end + 1}"><span>LINES ${start + 1}–${end + 1}</span><strong>${safe(line.section.name)}</strong><em aria-hidden="true">↗</em></button><button type="button" data-section-edit="${safe(line.id)}" aria-label="Edit ${safe(line.section.name)}">Edit</button><button type="button" data-section-style="${safe(line.id)}" aria-label="Style ${safe(line.section.name)}">Style</button></div>`
  ).join("") : `<p class="section-empty">No sections yet. Select line numbers on the map, then tap Mark section.</p>`;
  $("sectionPresets").innerHTML = SECTION_PRESETS.map((name) => `<button type="button" data-section-preset="${safe(name)}">${safe(name)}</button>`).join("");
}
function beginSectionDraft(start, end) {
  const lines = activeMap().lines;
  sectionDraft = { start, end, startId: lines[start].id, endId: lines[end].id };
  const existing = lines[start].section;
  $("sectionRange").textContent = `LINES ${start + 1}–${end + 1} · ${lines.slice(start, end + 1).filter((line) => line.words.length).length} lyric lines`;
  $("sectionNameInput").value = existing?.name || "";
  $("deleteSection").disabled = !existing;
  $("sectionEditor").classList.remove("hidden");
  $("sectionNameInput").focus();
}
function editSection(lineId) {
  const range = sectionRanges(activeMap()).find(({ line }) => line.id === lineId);
  if (range) beginSectionDraft(range.start, range.end);
}
function openSections(lineId = null) {
  closeMenu(); closeAppearance();
  if (!activeMap().lines.some((line) => line.words.length)) { showToast("Add lyrics before arranging sections"); return; }
  sectionDraft = null;
  $("sectionEditor").classList.add("hidden");
  renderSectionManager();
  $("sectionsModal").classList.remove("hidden");
  if (lineId) editSection(lineId);
}
function markSelectedSection() {
  const range = selectedSectionRange();
  if (!range) { showToast("Select neighboring line numbers for one section"); return; }
  openSections();
  beginSectionDraft(range.start, range.end);
}
function closeSections() { sectionDraft = null; $("sectionsModal").classList.add("hidden"); }
function jumpToSection(lineId) {
  if (!sectionRanges(activeMap()).some(({ line }) => line.id === lineId)) return;
  closeSections();
  requestAnimationFrame(() => {
    const target = [...$("lyricsList").querySelectorAll(".section-block")].find((block) => block.dataset.sectionStart === lineId);
    if (!target) return;
    target.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
    target.classList.add("section-arrival");
    setTimeout(() => target.classList.remove("section-arrival"), 1600);
  });
}
function saveSection() {
  const draft = sectionDraft;
  const name = $("sectionNameInput").value.trim().slice(0, 48);
  if (!draft || !name) { showToast("Give this section a name"); return; }
  const lines = activeMap().lines;
  const conflicts = sectionRanges(activeMap()).some(({ line, start, end }) => line.id !== draft.startId && start <= draft.end && end >= draft.start);
  if (conflicts) { showToast("That range overlaps another section. Edit or remove it first."); return; }
  const line = lines[draft.start];
  line.section = normalizeSection({ name, endLineId: draft.endId, appearance: line.section?.appearance });
  groupedIds.clear();
  closeSections(); persist(); render(); showToast(`${name} marked on lines ${draft.start + 1}–${draft.end + 1}`);
}
function deleteSection() {
  const line = sectionDraft && activeMap().lines[sectionDraft.start];
  if (!line?.section) return;
  line.section = null;
  groupedIds.clear();
  closeSections(); persist(); render(); showToast("Section removed");
}

function render() {
  const scrollBeforeRender = window.scrollY;
  const bottomScrollBeforeRender = focusBottom?.scrollTop || 0;
  const topScrollBeforeRender = focusTop?.scrollTop || 0;
  focusTop ||= $("focusTop");
  focusBottom ||= $("focusBottom");
  const map = activeMap();
  applyAppearance();
  const focused = focusOpen && !!selection && selectedLines().length > 0;
  const enunciationOnOverview = drawMode === "enunciation" && !focused;
  $("focusParking").append(focusTop, focusBottom);
  const nonempty = map.lines.filter((line) => line.words.length);
  const markCount = map.lines.flatMap((line) => line.words).filter((word) => word.above || word.below || word.volume != null || word.enunciation !== 50 || word.pitch !== 50 || word.breathBefore || noteForWord(word) != null).length;
  const pitchCount = map.lines.filter((line) => line.pitchPoints?.length).length;
  updateSongTitle(map.title);
  $("songDetails").textContent = map.lines.length ? `${nonempty.length} lyric lines · ${markCount} marked words${pitchCount ? ` · ${pitchCount} pitch lines` : ""}` : "Add lyrics to begin mapping";
  $("lineCount").textContent = `${nonempty.length} line${nonempty.length === 1 ? "" : "s"}`;
  $("sectionButton").disabled = !nonempty.length;
  $("emptyState").classList.toggle("hidden", !!map.lines.length);
  $("addLineButton").classList.toggle("hidden", !map.lines.length);
  $("lyricsButton").textContent = map.lines.length ? "Edit lyrics" : "Paste lyrics";
  const ranges = sectionRanges(map);
  const rangeAtLine = map.lines.map((_, index) => ranges.find(({ start, end }) => index >= start && index <= end));
  $("lyricsList").innerHTML = map.lines.map((line, lineIndex) => {
    const look = appearanceForLine(map, lineIndex);
    const style = lineStyle(look);
    const sectionRange = rangeAtLine[lineIndex];
    const opensSection = sectionRange?.start === lineIndex;
    const sectionOpen = opensSection ? `<div class="section-block" style="${sectionOutlineStyle(sectionRange.section)}" data-section-start="${safe(line.id)}" role="group" aria-label="${safe(sectionRange.section.name)} section, lines ${lineIndex + 1} to ${sectionRange.end + 1}">` : "";
    const sectionClose = sectionRange?.end === lineIndex ? "</div>" : "";
    const sectionHeading = opensSection ? `<div class="section-marker" style="${style}"><span class="section-marker-rule"></span><span class="section-marker-title">${safe(sectionRange.section.name)} <small>· LINES ${lineIndex + 1}–${sectionRange.end + 1}</small></span><button type="button" data-section-line="${safe(line.id)}" aria-label="Edit ${safe(sectionRange.section.name)} section">Edit section ↗</button></div>` : "";
    if (!line.words.length) return `${sectionOpen}${sectionHeading}<div class="line-break" aria-label="Section break"></div>${sectionClose}`;
    const words = line.words.map((word, wordIndex) => {
      const marked = word.above || word.below || word.volume != null || word.enunciation !== 50 || word.pitch !== 50 || word.breathBefore || noteForWord(word) != null;
      const pitchDetails = wordPitchDetails(word);
      const pitchDescription = pitchDetails.map(({ syllable, notes }) => `${syllable} ${notes.join(" to ")}`).join("; ");
      const active = selection?.type === "word" && selection.lineIds[0] === line.id && selection.wordIndex === wordIndex;
      const volumeHue = word.volume == null ? null : Math.round(205 - (word.volume - 1) / 9 * 175);
      const volumeStyle = volumeHue == null ? "" : `style="background:linear-gradient(180deg,hsla(${volumeHue},85%,55%,.24),hsla(${volumeHue},85%,43%,.42))"`;
      return `${word.breathBefore ? breathMarkup(word.breathBefore) : ""}<button type="button" class="word-chip ${marked ? "marked" : ""} ${active ? "active" : ""}" data-word-index="${wordIndex}" aria-label="Edit ${safe(word.text)}${pitchDetails.length ? `: ${safe(pitchDescription)}` : ""}" ${word.volume != null ? `data-volume="${word.volume}"` : ""} ${volumeStyle}>${word.above ? `<small>${safe(word.above)}</small>` : ""}${wordPitchMarkup(word, pitchDetails)}</button>`;
    }).join("");
    const below = [...new Set(line.words.map((word) => word.below).filter(Boolean))].map((value) => `<span>${safe(value)}</span>`).join("");
    const legacyBreaths = line.breaths?.length ? line.breaths.map((breath) => breathMarkup(breath.type)).join("") : "";
    const contour = pitchOverlay(line);
    const selected = focused && selection.lineIds.includes(line.id);
    const hasPitch = !!line.pitchPoints?.length;
    return `${sectionOpen}${sectionHeading}<div class="lyric-line ${selected ? "selected" : ""} ${groupedIds.has(line.id) ? "grouped" : ""} ${drawMode === "pitch" ? "pitch-active" : ""} ${enunciationOnOverview ? "enunciation-active" : ""} ${hasPitch ? "has-pitch" : ""}" style="${style}" data-type="${look.type}" data-line-id="${safe(line.id)}" role="button" tabindex="0" aria-label="Edit line ${lineIndex + 1}: ${safe(line.text)}"><button type="button" class="line-index" aria-pressed="${groupedIds.has(line.id)}" aria-label="${groupedIds.has(line.id) ? "Remove" : "Add"} line ${lineIndex + 1} ${groupedIds.has(line.id) ? "from" : "to"} selection">${lineIndex + 1}</button><div class="line-content"><div class="line-words">${words}${contour}</div>${below || legacyBreaths ? `<div class="line-meta">${below}${legacyBreaths}</div>` : ""}${drawMode === "pitch" && hasPitch ? `<button type="button" class="pitch-clear" aria-label="Clear pitch on line ${lineIndex + 1}">Clear pitch</button>` : ""}</div><button type="button" class="line-open" aria-label="Edit line ${lineIndex + 1}">›</button></div>${sectionClose}`;
  }).join("");
  $("appShell").classList.toggle("focus-mode", focused);
  $("lyricsList").classList.toggle("single-focus", focused && selection.type !== "group");
  if (focused) {
    const rows = [...$("lyricsList").querySelectorAll(".lyric-line.selected")];
    if (rows.length) {
      rows[0].append(focusTop);
      rows[rows.length - 1].append(focusBottom);
    }
  }
  focusBottom.scrollTop = bottomScrollBeforeRender;
  focusTop.scrollTop = topScrollBeforeRender;
  $("enunciationModeButton").setAttribute("aria-pressed", String(drawMode === "enunciation"));
  $("mapInstruction").textContent = drawMode === "pitch" ? "Drag across a lyric to draw its pitch. Hold your finger to see the note. Tap Clear pitch to redraw." : drawMode === "enunciation" ? "Drag over letters to shape enunciation. Tap a word to customize it; drawing pauses while its controls are open." : "Tap a lyric to shape it. Tap or drag across line numbers to select lyrics, then shape them or mark a section.";
  renderSelectionBar();
  refreshPitchLayers();
  if (window.scrollY !== scrollBeforeRender) window.scrollTo(0, scrollBeforeRender);
  requestAnimationFrame(() => { if (Math.abs(window.scrollY - scrollBeforeRender) > 1) window.scrollTo(0, scrollBeforeRender); });
}

function renderSelectionBar() {
  if (!groupedIds.size) { $("selectionBar").classList.add("hidden"); return; }
  const count = groupedIds.size;
  $("selectionBar").innerHTML = `<strong>${count} line${count === 1 ? "" : "s"} selected</strong><div class="selection-actions"><button type="button" id="markSection">Mark section</button><button type="button" id="shapeGroup">Shape selected</button></div>`;
  $("selectionBar").classList.remove("hidden");
  $("shapeGroup").onclick = openGroupSheet;
  $("markSection").onclick = markSelectedSection;
}

function toggleGroupedLine(id) {
  if (focusOpen) closeSheet();
  groupedIds.has(id) ? groupedIds.delete(id) : groupedIds.add(id);
  render();
}

function setDrawMode(mode) {
  if (focusOpen) closeSheet();
  drawMode = drawMode === mode ? null : mode;
  render();
}

let pitchGesture = null;
function pitchPointAt(layer, event, lockedRow = null) {
  const rect = layer.getBoundingClientRect();
  const rows = visualPitchRows(layer);
  const localY = clamp(event.clientY - rect.top, 0, rect.height);
  const row = lockedRow == null ? Math.max(0, rows.findIndex((band) => localY >= band.top && localY <= band.bottom)) : lockedRow;
  const band = rows[row] || rows[0];
  const x = clamp((event.clientX - rect.left) / Math.max(1, rect.width) * 100, 0, 100);
  let y = clamp((localY - band.top) / Math.max(1, band.bottom - band.top) * 100, 0, 100);
  return { x, y, row };
}
function showPitchGesture(gesture, point) {
  const layer = gesture.layer;
  const line = getLine(gesture.lineId);
  if (line) paintPitchLayer(layer, line, { row: gesture.row, points: gesture.points });
  const readout = layer.querySelector(".pitch-note-readout");
  readout.textContent = noteLabelFromY(point.y);
  readout.style.left = `${point.x}%`;
  readout.style.top = `${Math.max(24, pitchSvgY(point, visualPitchRows(layer)))}%`;
  readout.classList.remove("hidden");
}

let enunciationGesture = null;
let suppressEnunciationClick = false;
let enunciationClickTimer = null;
function suppressDrawClick() {
  suppressEnunciationClick = true;
  clearTimeout(enunciationClickTimer);
  enunciationClickTimer = setTimeout(() => { suppressEnunciationClick = false; }, 250);
}
function paintEnunciationAt(event) {
  if (!enunciationGesture) return;
  const hit = document.elementFromPoint(event.clientX, event.clientY);
  const row = hit?.closest(".lyric-line") || $("lyricsList").querySelector(`[data-line-id="${enunciationGesture.rowId}"]`);
  const chips = row ? [...row.querySelectorAll(".word-chip")] : [];
  const chip = hit?.closest(".word-chip") || chips.reduce((nearest, item) => {
    const rect = item.getBoundingClientRect();
    const distance = Math.abs(event.clientX - (rect.left + rect.width / 2));
    return !nearest || distance < nearest.distance ? { item, distance } : nearest;
  }, null)?.item;
  if (!chip || !row) return;
  const line = getLine(row.dataset.lineId);
  const word = line?.words[Number(chip.dataset.wordIndex)];
  if (!word?.text.length) return;
  const textRect = chip.querySelector("strong").getBoundingClientRect();
  const band = row.querySelector(".line-words").getBoundingClientRect();
  const letterIndex = clamp(Math.floor((event.clientX - textRect.left) / Math.max(1, textRect.width) * word.text.length), 0, word.text.length - 1);
  const value = Math.round((1 - clamp((event.clientY - band.top) / Math.max(1, band.height), 0, 1)) * 100);
  if (word.letterLevels[letterIndex] === value) return;
  word.letterLevels[letterIndex] = value;
  word.enunciation = Math.round(word.letterLevels.reduce((sum, level) => sum + level, 0) / word.letterLevels.length);
  chip.querySelector("strong").innerHTML = visibleLetters(word);
  chip.classList.add("marked");
  enunciationGesture.changed = true;
}

let lineIndexGesture = null;
let suppressIndexClick = false;
function activateLineGroupGesture() {
  if (!lineIndexGesture || lineIndexGesture.active) return;
  lineIndexGesture.active = true;
  suppressIndexClick = true;
  if (focusOpen) closeSheet();
  groupedIds.add(lineIndexGesture.startId);
  render();
}
function extendLineGroup(endId) {
  if (!lineIndexGesture || !endId) return;
  const lines = activeMap().lines;
  const start = lines.findIndex((line) => line.id === lineIndexGesture.startId);
  const end = lines.findIndex((line) => line.id === endId);
  if (start < 0 || end < 0 || end === lineIndexGesture.end) return;
  lineIndexGesture.end = end;
  for (let index = Math.min(start, end); index <= Math.max(start, end); index++) if (lines[index].words.length) groupedIds.add(lines[index].id);
  render();
}

function selectLine(id, wordIndex = null) {
  closeInlineEditor();
  selection = { type: wordIndex == null ? "line" : "word", lineIds: [id], wordIndex };
  focusOpen = true;
  render(); openSheet();
}

function openGroupSheet() {
  if (!groupedIds.size) return;
  selection = { type: "group", lineIds: activeMap().lines.filter((line) => groupedIds.has(line.id)).map((line) => line.id) };
  focusOpen = true;
  render(); openSheet();
}

function setOptions(element, choices, value) {
  const all = value && !choices.includes(value) ? [...choices, value] : choices;
  element.innerHTML = all.map((choice) => `<option value="${safe(choice)}">${choice ? safe(choice) : "None"}</option>`).join("") + `<option value="__custom">Custom…</option>`;
  element.value = value || "";
}

function openSheet() {
  if (!selection || !selectedLines().length) return;
  const lines = selectedLines();
  const word = selection.type === "word" ? lines[0].words[selection.wordIndex] : null;
  $("sheetEyebrow").textContent = selection.type === "group" ? `${lines.length} LINES SELECTED` : word ? "WORD SELECTED" : "LINE SELECTED";
  $("sheetTitle").textContent = word ? `Shape “${word.text}”` : selection.type === "group" ? "Shape this group" : "Shape this line";
  $("editAction").textContent = word ? "Edit word" : selection.type === "group" ? "Edit selected lines" : "Edit lyric line";
  $("wordTools").innerHTML = word ? `<button type="button" id="previousWord" ${selection.wordIndex === 0 ? "disabled" : ""}>← Previous</button><button type="button" id="nextWord" ${selection.wordIndex === lines[0].words.length - 1 ? "disabled" : ""}>Next →</button>` : "";
  if (word) {
    $("previousWord").onclick = () => moveWord(-1);
    $("nextWord").onclick = () => moveWord(1);
  }
  renderLetterTools(word);
  setOptions($("toneSelect"), TONES, firstValue("above", ""));
  setOptions($("instructionSelect"), INSTRUCTIONS, firstValue("below", ""));
  $("volumeInput").value = firstValue("volume", 0) || 0;
  $("enunciationInput").value = firstValue("enunciation", 50);
  const breathWord = word || lines[0].words[0];
  $("breathSelect").value = breathWord?.breathBefore || "";
  refreshRanges();
}

function renderLetterTools(word) {
  const panel = $("letterTools");
  panel.classList.toggle("hidden", !word);
  if (!word) return;
  selectedLetterIndex = clamp(selectedLetterIndex, 0, Math.max(0, word.text.length - 1));
  const letterButton = (letter, index) => {
    const level = clamp(word.letterLevels[index] ?? 50, 0, 100);
    const strength = level > 70 ? "strong" : level < 35 ? "soft" : "normal";
    const shown = strength === "strong" ? letter.toUpperCase() : strength === "soft" ? letter.toLowerCase() : letter;
    return `<button type="button" data-letter="${index}" class="${strength} ${index === selectedLetterIndex ? "active" : ""}" aria-label="Edit letter ${index + 1}, ${safe(letter)}, strength ${level}">${safe(shown)}</button>`;
  };
  panel.innerHTML = `<span>Enunciation by letter</span><div class="letter-list">${Array.from(word.text).map(letterButton).join("")}</div><label>Letter strength <output id="letterValue">${word.letterLevels[selectedLetterIndex] ?? 50}</output><input id="letterInput" type="range" min="0" max="100" value="${word.letterLevels[selectedLetterIndex] ?? 50}"></label>`;
  panel.querySelectorAll("[data-letter]").forEach((button) => button.onclick = () => {
    selectedLetterIndex = Number(button.dataset.letter);
    panel.querySelectorAll("[data-letter]").forEach((item) => item.classList.toggle("active", item === button));
    $("letterInput").value = word.letterLevels[selectedLetterIndex] ?? 50;
    $("letterValue").textContent = $("letterInput").value;
  });
  $("letterInput").oninput = (event) => {
    const value = Number(event.target.value);
    word.letterLevels[selectedLetterIndex] = value;
    word.enunciation = Math.round(word.letterLevels.reduce((sum, level) => sum + level, 0) / word.letterLevels.length);
    $("letterValue").textContent = value;
    const button = panel.querySelector(`[data-letter="${selectedLetterIndex}"]`);
    const letter = Array.from(word.text)[selectedLetterIndex];
    button.classList.remove("soft", "normal", "strong");
    button.classList.add(value > 70 ? "strong" : value < 35 ? "soft" : "normal");
    button.textContent = value > 70 ? letter.toUpperCase() : value < 35 ? letter.toLowerCase() : letter;
    button.setAttribute("aria-label", `Edit letter ${selectedLetterIndex + 1}, ${letter}, strength ${value}`);
    const chip = $("lyricsList").querySelector(`.lyric-line.selected .word-chip.active`);
    if (chip) chip.querySelector("strong").innerHTML = visibleLetters(word);
  };
  $("letterInput").onchange = persist;
}

function moveWord(delta) {
  if (selection?.type !== "word") return;
  const line = selectedLines()[0];
  closeInlineEditor();
  selection.wordIndex = clamp(selection.wordIndex + delta, 0, line.words.length - 1);
  render(); openSheet();
}
function closeSheet() {
  if (selection?.type === "group") groupedIds.clear();
  focusOpen = false;
  selection = null;
  closeInlineEditor();
  render();
}
function refreshRanges() { $("volumeValue").textContent = $("volumeInput").value === "0" ? "—" : $("volumeInput").value; $("enunciationValue").textContent = $("enunciationInput").value; }

function applyProperty(key, value) {
  const words = selectedWords();
  if (!words.length) return;
  words.forEach((word) => { word[key] = value; if (key === "enunciation") word.letterLevels = Array.from(word.text, () => value); });
  persist(); render();
}

function applyBreath(value) {
  const lines = selectedLines();
  if (selection?.type === "word") lines[0].words[selection.wordIndex].breathBefore = value;
  else lines.forEach((line) => { if (line.words[0]) line.words[0].breathBefore = value; });
  persist(); render();
}

function clearSelection() {
  selectedWords().forEach((word) => Object.assign(word, makeWord(word.text)));
  if (selection?.type !== "word") selectedLines().forEach((line) => { line.pitchPoints = []; line.breaths = []; });
  persist(); closeSheet(); showToast("Markings cleared");
}

function openInlineEditor(mode) {
  const lines = selectedLines();
  if (!lines.length) return;
  const word = selection?.type === "word" ? lines[0].words[selection.wordIndex] : null;
  inlineMode = mode;
  $("inlineEditorLabel").textContent = mode === "word" ? "Edit selected word" : mode === "group" ? "Edit selected lines · one per row" : "Edit lyric line";
  $("inlineEditorText").value = mode === "word" ? word?.text || "" : mode === "group" ? lines.map((line) => line.text).join("\n") : lines[0].text;
  $("inlineEditorText").rows = mode === "group" ? Math.max(3, lines.length) : 3;
  $("saveInlineEdit").textContent = mode === "word" ? "Save word" : mode === "group" ? "Save lines" : "Save lyric";
  $("inlineEditor").classList.remove("hidden");
  $("inlineEditorText").focus();
}

function closeInlineEditor() {
  $("inlineEditorText").blur();
  $("inlineEditor").classList.add("hidden");
  inlineMode = null;
}

function saveInlineEditor() {
  const mode = inlineMode;
  const value = $("inlineEditorText").value.replace(/\r\n?/g, "\n");
  const lines = selectedLines();
  if (!mode || !lines.length) return;
  if (mode === "line") {
    const index = activeMap().lines.findIndex((line) => line.id === lines[0].id);
    if (index >= 0) activeMap().lines[index] = makeLine(value.replace(/\n/g, " "), lines[0]);
  } else if (mode === "word") {
    const word = lines[0].words[selection.wordIndex];
    const wordText = value.trim();
    if (!wordText || /\s/.test(wordText)) { showToast("Use one word here; edit the line for spaces"); return; }
    word.text = wordText;
    word.letterLevels = Array.from(wordText, () => word.enunciation);
    lines[0].text = lines[0].words.map((item) => item.text).join(" ");
  } else if (mode === "group") {
    const entries = value.split("\n");
    if (entries.length !== lines.length) { showToast(`Keep ${lines.length} rows for this group`); return; }
    lines.forEach((line, index) => Object.assign(line, makeLine(entries[index], line)));
  }
  closeInlineEditor();
  persist();
  render();
  openSheet();
  showToast("Lyric updated");
}

function openEditor(mode) {
  editorScrollY = window.scrollY;
  editorMode = mode;
  editorReturnsToFocus = focusOpen && (mode === "customAbove" || mode === "customBelow");
  const lines = selectedLines();
  const word = selection?.type === "word" ? lines[0]?.words[selection.wordIndex] : null;
  focusOpen = false;
  closeInlineEditor();
  render();
  closeMenu();
  const config = {
    lyrics: ["PASTE LYRICS", "Edit all lyrics", activeMap().lines.map((line) => line.text).join("\n")],
    line: ["LYRIC LINE", "Edit line", lines[0]?.text || ""],
    word: ["LYRIC WORD", "Edit word", word?.text || ""],
    group: ["SELECTED LINES", "Edit selected lines", lines.map((line) => line.text).join("\n")],
    rename: ["SONG", "Rename song", activeMap().title],
    customAbove: ["VOCAL MODE", "Custom vocal mode", firstValue("above", "")],
    customBelow: ["INSTRUCTION", "Custom instruction", firstValue("below", "")]
  }[mode];
  if (!config) return;
  $("editorEyebrow").textContent = config[0];
  $("editorTitle").textContent = config[1];
  $("editorLabel").textContent = mode === "lyrics" ? "One lyric line per row" : mode === "group" ? "One row for each selected line" : config[1];
  $("editorText").rows = mode === "lyrics" || mode === "group" ? 8 : 2;
  $("editorText").value = config[2];
  $("editorModal").classList.remove("hidden");
  $("editorText").focus();
}

function closeEditor() {
  $("editorText").blur();
  $("editorModal").classList.add("hidden");
  editorMode = null;
  if (editorReturnsToFocus && selection) {
    focusOpen = true;
    render();
    openSheet();
  }
  editorReturnsToFocus = false;
  window.scrollTo(0, editorScrollY);
  setTimeout(() => window.scrollTo(0, editorScrollY), 250);
}
function saveEditor() {
  const value = $("editorText").value.replace(/\r\n?/g, "\n");
  const map = activeMap();
  const lines = selectedLines();
  if (editorMode === "rename") map.title = value.trim();
  else if (editorMode === "lyrics") {
    const entries = value.trim() ? value.split("\n") : [];
    map.lines = entries.map((text, index) => makeLine(text, map.lines[index]));
    selection = null;
  } else if (editorMode === "line") {
    const index = map.lines.findIndex((line) => line.id === lines[0]?.id);
    if (index >= 0) map.lines[index] = makeLine(value.replace(/\n/g, " "), map.lines[index]);
  } else if (editorMode === "word") {
    const word = lines[0]?.words[selection.wordIndex];
    if (!word) return;
    const wordText = value.trim();
    if (!wordText || /\s/.test(wordText)) { showToast("Use a single word here; edit the line for spaces"); return; }
    const updated = makeWord(wordText, word);
    Object.assign(word, updated);
    lines[0].text = lines[0].words.map((item) => item.text).join(" ");
  } else if (editorMode === "group") {
    const entries = value.split("\n");
    if (entries.length !== lines.length) { showToast(`Keep ${lines.length} rows for this group`); return; }
    lines.forEach((line, index) => Object.assign(line, makeLine(entries[index], line)));
  } else if (editorMode === "customAbove" || editorMode === "customBelow") {
    applyProperty(editorMode === "customAbove" ? "above" : "below", value.trim());
  }
  closeEditor(); persist(); render(); showToast("Changes saved");
}

function exportPayload(map) {
  const words = [], lines = [];
  map.lines.forEach((line, lineIndex) => {
    const wordIndices = [];
    line.words.forEach((word) => {
      const index = words.length;
      wordIndices.push(index);
      words.push({ index, lineIndex, text: word.text, above: word.above, below: word.below, volume: word.volume, enunciation: word.enunciation, letterLevels: word.letterLevels, pitch: word.pitch, note: noteForWord(word), syllables: normalizeSyllables(word.text, word.syllables, word.note) });
    });
    const mobileBreaths = line.words.flatMap((word, wordIndex) => word.breathBefore ? [{ id: `mobile-${lineIndex}-${wordIndex}`, type: word.breathBefore, x: wordIndex * 80 + 20, y: 24 }] : []);
    const section = normalizeSection(line.section);
    if (section?.endLineId) section.endLineIndex = map.lines.findIndex((item) => item.id === section.endLineId);
    lines.push({ lineIndex, raw: line.text, wordIndices, pitchPoints: line.pitchPoints || [], breaths: [...(line.breaths || []), ...mobileBreaths], section });
  });
  return { songTitle: map.title, appearance: normalizeAppearance(map.appearance), lyrics: map.lines.map((line) => line.text), words, lines };
}

function readableMap(map) {
  return map.lines.map((line) => {
    if (!line.words.length) return line.section ? `SECTION: ${line.section.name}` : "";
    const row = (key, fn) => `${key}:\n${line.words.map(fn).join(" | ")}`;
    return [line.section ? `SECTION: ${line.section.name}` : "", row("ABOVE", (w) => w.above || "-"), `LYRIC:\n${line.words.map((w) => w.text).join(" ")}`, row("BELOW", (w) => w.below || "-"), row("VOLUME", (w) => w.volume ?? "-"), row("ENUNCIATION", (w) => w.enunciation), row("SYLLABLE NOTES", (w) => w.syllables.map((part) => `${part.text}:${part.notes.map((note) => note == null ? "-" : noteName(note)).join("→")}`).join(" / ")), row("PITCH RANGE", (w) => w.pitch), row("BREATHS", (w) => w.breathBefore || "-")].filter(Boolean).join("\n\n");
  }).join("\n\n");
}

function filename(ext) { return `${(activeMap().title || "song-map").trim().replace(/[<>:"/\\|?*\x00-\x1F]/g, "").replace(/\s+/g, "-") || "song-map"}.${ext}`; }
function shareContent(content, ext, mimeType) {
  const name = filename(ext);
  if (window.webkit?.messageHandlers?.songMapperExport) {
    window.webkit.messageHandlers.songMapperExport.postMessage({ name, content, mimeType });
    return;
  }
  const url = URL.createObjectURL(new Blob([content], { type: mimeType }));
  const link = document.createElement("a"); link.href = url; link.download = name; document.body.appendChild(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 3000);
}

function importPayload(payload) {
  if (!payload || !Array.isArray(payload.lyrics) || !Array.isArray(payload.words) || !Array.isArray(payload.lines)) throw new Error("Invalid .smap file");
  const map = makeMap(String(payload.songTitle || ""));
  map.appearance = normalizeAppearance(payload.appearance);
  const wordsByLine = new Map();
  payload.words.forEach((word) => {
    const lineIndex = Number(word.lineIndex);
    if (!Number.isInteger(lineIndex) || lineIndex < 0) return;
    if (!wordsByLine.has(lineIndex)) wordsByLine.set(lineIndex, []);
    wordsByLine.get(lineIndex).push(word);
  });
  map.lines = payload.lyrics.map((raw, lineIndex) => {
    const importedWords = (wordsByLine.get(lineIndex) || []).sort((a, b) => Number(a.index) - Number(b.index));
    const text = importedWords.length ? importedWords.map((word) => String(word.text || "")).join(" ") : String(raw || "");
    const linePayload = payload.lines.find((line) => Number(line.lineIndex) === lineIndex) || {};
    const line = makeLine(text);
    line.words = importedWords.length ? importedWords.map((word) => makeWord(word.text, word)) : alignWords(text);
    line.pitchPoints = Array.isArray(linePayload.pitchPoints) ? linePayload.pitchPoints : [];
    line.breaths = Array.isArray(linePayload.breaths) ? linePayload.breaths : [];
    line.section = normalizeSection(linePayload.section);
    return line;
  });
  map.lines.forEach((line, lineIndex) => {
    if (!line.section) return;
    const original = payload.lines.find((item) => Number(item.lineIndex) === lineIndex)?.section;
    const end = Number(original?.endLineIndex);
    line.section.endLineId = Number.isInteger(end) && end >= lineIndex && end < map.lines.length ? map.lines[end].id : null;
  });
  database.maps.push(map); database.activeId = map.id; appearanceScopeLineId = null; selection = null; groupedIds.clear();
  persist(); render(); showToast("Song map loaded");
}

function noteFrequency(midi) { return 440 * Math.pow(2, (midi - 69) / 12); }
function stopNotePreview() {
  notePreviewRequest++;
  if (!notePreview) return;
  const voice = notePreview; notePreview = null;
  const now = noteAudioContext.currentTime;
  voice.gain.gain.cancelScheduledValues(now);
  voice.gain.gain.setTargetAtTime(0, now, .005);
  try { voice.oscillator.stop(now + .025); } catch (_) {}
}
async function auditionNote(midi) {
  if (!Number.isInteger(midi) || midi < 36 || midi > 83) return;
  stopNotePreview();
  const request = notePreviewRequest;
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) { showToast("Note preview is unavailable on this device"); return; }
    if (!noteAudioContext || noteAudioContext.state === "closed") noteAudioContext = new AudioContext();
    if (noteAudioContext.state !== "running") await noteAudioContext.resume();
    if (request !== notePreviewRequest) return;
    if (noteAudioContext.state !== "running") { showToast("Tap a note again to enable sound"); return; }
    const now = noteAudioContext.currentTime;
    const oscillator = noteAudioContext.createOscillator();
    const gain = noteAudioContext.createGain();
    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(noteFrequency(midi), now);
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(.18, now + .012);
    gain.gain.setValueAtTime(.18, now + .22);
    gain.gain.linearRampToValueAtTime(0, now + .4);
    oscillator.connect(gain); gain.connect(noteAudioContext.destination);
    const voice = { oscillator, gain }; notePreview = voice;
    oscillator.onended = () => {
      oscillator.disconnect(); gain.disconnect();
      if (notePreview === voice) notePreview = null;
    };
    oscillator.start(now); oscillator.stop(now + .42);
  } catch (_) { showToast("Could not play this note. Tap to try again"); }
}

function currentRollLine() { return getLine(rollLineId); }
function currentRollWord() { return currentRollLine()?.words[rollWordIndex]; }
function currentRollSyllable() { return currentRollWord()?.syllables?.[rollSyllableIndex]; }
function currentRollNote() { return currentRollSyllable()?.notes?.[rollPitchIndex] ?? null; }
function syncWordNote(word) {
  word.note = word.syllables.flatMap((part) => part.notes).find((note) => note != null) ?? null;
  word.pitch = word.note == null ? 50 : Math.round((word.note - 36) / 47 * 100);
}
function selectedRollSlots(word) {
  return word.syllables.flatMap((part, syllableIndex) => part.notes.map((note, pitchIndex) => ({ text: part.text, note, syllableIndex, pitchIndex })));
}
function openPianoRoll(lineId = null) {
  const lines = activeMap().lines.filter((line) => line.words.length);
  if (!lines.length) { showToast("Add lyrics before opening the piano roll"); return; }
  const selectedId = lineId || selection?.lineIds?.[0];
  rollLineId = lines.some((line) => line.id === selectedId) ? selectedId : lines[0].id;
  rollWordIndex = 0;
  rollSyllableIndex = 0;
  rollPitchIndex = 0;
  if (focusOpen) closeSheet();
  drawMode = null;
  render();
  $("pianoRollScreen").classList.remove("hidden");
  document.body.classList.add("roll-open");
  renderPianoRoll();
  scrollToRollNote();
}
function closePianoRoll() {
  stopNotePreview();
  rollDrag = null;
  $("syllableEditor").classList.add("hidden");
  $("pianoRollScreen").classList.add("hidden");
  document.body.classList.remove("roll-open");
  render();
}
function renderPianoRoll() {
  const line = currentRollLine();
  if (!line?.words.length) { closePianoRoll(); return; }
  const viewport = $("rollViewport");
  const oldTop = viewport.scrollTop, oldLeft = viewport.scrollLeft;
  rollWordIndex = clamp(rollWordIndex, 0, line.words.length - 1);
  const word = line.words[rollWordIndex];
  rollSyllableIndex = clamp(rollSyllableIndex, 0, word.syllables.length - 1);
  rollPitchIndex = clamp(rollPitchIndex, 0, word.syllables[rollSyllableIndex].notes.length - 1);
  const slots = selectedRollSlots(word);
  $("rollLinePicker").innerHTML = activeMap().lines.filter((item) => item.words.length).map((item, index) => `<button type="button" data-roll-line="${safe(item.id)}" aria-pressed="${item.id === line.id}">${index + 1}. ${safe(item.text)}</button>`).join("");
  $("rollWordRibbon").innerHTML = line.words.map((item, index) => `<button type="button" data-roll-word="${index}" aria-pressed="${index === rollWordIndex}" aria-label="Choose ${safe(item.text)}">${safe(item.text)}<small>${item.syllables.length} ${item.syllables.length === 1 ? "syllable" : "syllables"}</small></button>`).join("");
  $("rollSyllableRibbon").innerHTML = slots.map((slot) => `<button type="button" data-roll-syllable="${slot.syllableIndex}" data-roll-pitch="${slot.pitchIndex}" aria-pressed="${slot.syllableIndex === rollSyllableIndex && slot.pitchIndex === rollPitchIndex}" aria-label="${safe(slot.text)} pitch ${slot.pitchIndex + 1}: ${slot.note == null ? "unassigned" : noteName(slot.note)}">${safe(slot.text)}${slot.pitchIndex ? ` ↗${slot.pitchIndex + 1}` : ""}<small>${slot.note == null ? "—" : noteName(slot.note)}</small></button>`).join("");
  const notes = Array.from({ length: 48 }, (_, index) => 83 - index);
  const headers = `<div class="roll-corner">NOTE</div>${slots.map((slot) => `<div class="roll-column-head" data-roll-syllable="${slot.syllableIndex}" data-roll-pitch="${slot.pitchIndex}" aria-label="${safe(slot.text)} pitch ${slot.pitchIndex + 1} column">${safe(slot.text)}${slot.pitchIndex ? ` · ${slot.pitchIndex + 1}` : ""}</div>`).join("")}`;
  const rows = notes.map((midi) => {
    const note = noteName(midi), black = [1, 3, 6, 8, 10].includes(midi % 12), octave = midi % 12 === 0;
    const rowClass = `${black ? "black" : "white"} ${octave ? "octave" : ""}`;
    return `<button class="roll-key ${rowClass}" type="button" data-roll-key="${midi}" aria-label="Hear ${note}">${note}</button>${slots.map((slot) => {
      const assigned = slot.note === midi;
      return `<button class="roll-cell ${rowClass}" type="button" data-midi="${midi}" data-roll-syllable="${slot.syllableIndex}" data-roll-pitch="${slot.pitchIndex}" aria-label="Set ${safe(slot.text)} pitch ${slot.pitchIndex + 1} to ${note}" aria-pressed="${assigned}">${assigned ? `<span class="roll-note-chip">${safe(slot.text)}</span>` : ""}</button>`;
    }).join("")}`;
  }).join("");
  $("rollGrid").style.setProperty("--word-count", String(slots.length));
  $("rollGrid").innerHTML = headers + rows;
  viewport.scrollTop = oldTop;
  viewport.scrollLeft = oldLeft;
  $("rollReadoutWord").textContent = rollPitchIndex ? `${word.syllables[rollSyllableIndex].text} · pitch ${rollPitchIndex + 1}` : `${word.syllables[rollSyllableIndex].text} · ${word.text}`;
  $("rollReadoutNote").textContent = currentRollNote() == null ? "Choose a note" : noteName(currentRollNote());
  $("clearWordNote").disabled = currentRollNote() == null;
  $("addSyllablePitch").disabled = currentRollSyllable().notes.length >= 4;
  $("removeSyllablePitch").disabled = currentRollSyllable().notes.length <= 1;
}
function scrollToRollNote() {
  const line = currentRollLine();
  if (!line) return;
  const midi = currentRollNote() ?? 60;
  const key = $("rollGrid").querySelector(`[data-roll-key="${midi}"]`);
  const viewport = $("rollViewport");
  if (key) viewport.scrollTop = Math.max(0, viewport.scrollTop + key.getBoundingClientRect().top - viewport.getBoundingClientRect().top - viewport.clientHeight * .42);
}
function assignWordNote(wordIndex, midi, syllableIndex = rollSyllableIndex, pitchIndex = rollPitchIndex) {
  const line = currentRollLine();
  if (!line?.words[wordIndex] || !Number.isInteger(midi) || midi < 36 || midi > 83) return;
  const word = line.words[wordIndex];
  if (!word.syllables[syllableIndex] || pitchIndex >= word.syllables[syllableIndex].notes.length) return;
  word.syllables[syllableIndex].notes[pitchIndex] = midi;
  syncWordNote(word);
  rollWordIndex = wordIndex;
  rollSyllableIndex = syllableIndex;
  rollPitchIndex = pitchIndex;
  persist();
  render();
  renderPianoRoll();
  auditionNote(midi);
}
function clearSelectedWordNote() {
  stopNotePreview();
  const word = currentRollWord();
  if (!word) return;
  word.syllables[rollSyllableIndex].notes[rollPitchIndex] = null;
  syncWordNote(word);
  persist(); render(); renderPianoRoll();
}
function addSyllablePitch() {
  const syllable = currentRollSyllable();
  if (!syllable || syllable.notes.length >= 4) return;
  syllable.notes.push(null);
  rollPitchIndex = syllable.notes.length - 1;
  persist(); renderPianoRoll(); scrollToRollNote();
}
function removeSyllablePitch() {
  const syllable = currentRollSyllable();
  if (!syllable || syllable.notes.length <= 1) return;
  syllable.notes.splice(rollPitchIndex, 1);
  rollPitchIndex = clamp(rollPitchIndex, 0, syllable.notes.length - 1);
  syncWordNote(currentRollWord());
  persist(); render(); renderPianoRoll();
}
function openSyllableEditor() {
  const word = currentRollWord();
  if (!word) return;
  $("syllableSplitText").value = word.syllables.map((part) => part.text).join(" ");
  $("syllableEditor").classList.remove("hidden");
  $("syllableSplitText").focus();
}
function saveSyllableSplit() {
  const word = currentRollWord();
  if (!word) return;
  const pieces = $("syllableSplitText").value.trim().split(/\s+/).filter(Boolean);
  if (!pieces.length || pieces.length > 8 || pieces.join("") !== word.text) { showToast("Keep every letter, adding spaces only between syllables"); return; }
  const old = word.syllables;
  const next = pieces.map((part, index) => ({ text: part, notes: old[index]?.notes.slice() || [null] }));
  const overflow = old.slice(pieces.length).flatMap((part) => part.notes);
  if (overflow.length && next.at(-1).notes.length + overflow.length > 4) { showToast("Too many pitches to combine; remove extras first"); return; }
  if (overflow.length) next.at(-1).notes.push(...overflow);
  word.syllables = next;
  syncWordNote(word);
  rollSyllableIndex = clamp(rollSyllableIndex, 0, next.length - 1);
  rollPitchIndex = 0;
  $("syllableEditor").classList.add("hidden");
  persist(); render(); renderPianoRoll(); showToast("Syllables saved; review their pitches");
}
function rollMidiAt(clientX, clientY) {
  const bounds = $("rollViewport").getBoundingClientRect();
  if (clientX < bounds.left || clientX > bounds.right || clientY < bounds.top || clientY > bounds.bottom) return null;
  const hovered = document.elementFromPoint(clientX, clientY)?.closest(".roll-cell, .roll-key");
  if (hovered) return Number(hovered.dataset.midi ?? hovered.dataset.rollKey);
  const key = [...$("rollGrid").querySelectorAll(".roll-key")].find((item) => { const rect = item.getBoundingClientRect(); return clientY >= rect.top && clientY <= rect.bottom; });
  return key ? Number(key.dataset.rollKey) : null;
}

function cleanLyricsText(raw) {
  let text = String(raw || "").replace(/\r\n?/g, "\n").replace(/\u00a0/g, " ");
  if (/<(?:html|div|p|br|section|article)\b/i.test(text)) {
    text = text.replace(/<(script|style|nav|footer|aside)\b[^>]*>[\s\S]*?<\/\1>/gi, "")
      .replace(/<br\s*\/?\s*>/gi, "\n").replace(/<\/(?:p|div|section|article|h[1-6])\s*>/gi, "\n")
      .replace(/<[^>]+>/g, "").replace(/&amp;/gi, "&").replace(/&nbsp;/gi, " ").replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'");
  }
  const noise = /^(?:advertisement|advertising|sponsored|submit lyrics|correct these lyrics|buy this album|back to album|you might also like|related lyrics|share(?: this song)?|cookie settings|privacy policy|terms of use|all rights reserved|lyrics powered by|darklyrics\.com)$/i;
  const lines = text.split("\n").map((line) => line.replace(/^\[\d{1,2}:\d{2}(?:\.\d{1,3})?\]\s*/, "").trimEnd());
  return lines.filter((line) => !noise.test(line.trim())).join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

let lookupResults = [];
let lookupSelectedTitle = "";
function mapHasLyrics(map) { return map.lines.some((line) => line.words.length || line.text.trim()); }
function mapForFoundLyrics(title, text) {
  const current = activeMap();
  const map = mapHasLyrics(current) ? makeMap(title) : current;
  map.title = title;
  map.lines = text.split("\n").map((line) => makeLine(line));
  if (map !== current) database.maps.push(map);
  database.activeId = map.id;
  return map;
}
function openLookup() {
  closeMenu();
  lookupSelectedTitle = "";
  $("lookupQuery").placeholder = `e.g. ${nextLookupExample()}`;
  $("lookupModal").classList.remove("hidden");
  $("lookupQuery").focus();
}
function closeLookup() { $("lookupModal").classList.add("hidden"); }
async function searchLyrics() {
  const query = $("lookupQuery").value.trim();
  if (!query) { $("lookupStatus").textContent = "Enter an artist and song title."; return; }
  lookupSelectedTitle = "";
  $("lookupStatus").textContent = "Searching plain lyric results…";
  $("lookupResults").innerHTML = "";
  try {
    const response = await fetch(`https://lrclib.net/api/search?q=${encodeURIComponent(query)}`, { headers: { Accept: "application/json" } });
    if (!response.ok) throw new Error(`Lookup unavailable (${response.status})`);
    const results = await response.json();
    const unique = new Set();
    lookupResults = Array.isArray(results) ? results.filter((item) => {
      if (!item.plainLyrics && !item.syncedLyrics) return false;
      const key = `${item.artistName || ""}|${item.trackName || ""}|${item.plainLyrics || item.syncedLyrics || ""}`.toLowerCase();
      if (unique.has(key)) return false;
      unique.add(key); return true;
    }).slice(0, 12) : [];
    if (!lookupResults.length) { $("lookupStatus").textContent = "No plain lyrics found. Try Other sources or paste lyric text below."; return; }
    $("lookupStatus").textContent = "Choose a match and review its clean text. An empty map will be filled; a map with lyrics stays untouched.";
    $("lookupResults").innerHTML = lookupResults.map((item, index) => `<button type="button" data-result="${index}"><span>${safe(item.trackName || "Untitled")} · ${safe(item.artistName || "Unknown artist")}</span><small>Preview</small></button>`).join("");
  } catch (_) {
    $("lookupStatus").textContent = "Automatic lookup is unavailable right now. Try Other sources or paste lyrics below.";
  }
}
function chooseLookupResult(index) {
  const item = lookupResults[index];
  if (!item) return;
  lookupSelectedTitle = `${item.artistName || ""} — ${item.trackName || ""}`.replace(/^ — | — $/g, "");
  $("lookupDraft").value = cleanLyricsText(item.plainLyrics || item.syncedLyrics || "");
  $("lookupStatus").textContent = `Reviewing ${lookupSelectedTitle}. Edit any lines before importing.`;
}
function openLyricSearch() {
  const query = $("lookupQuery").value.trim();
  if (!query) { $("lookupStatus").textContent = "Enter an artist and song title first."; return; }
  const terms = `${query} lyrics`;
  const url = `https://www.google.com/search?q=${encodeURIComponent(terms)}`;
  if (window.webkit?.messageHandlers?.songMapperOpenURL) window.webkit.messageHandlers.songMapperOpenURL.postMessage(url);
  else window.open(url, "_blank", "noopener,noreferrer");
  $("lookupStatus").textContent = "Copy only the lyric section, return here, paste it below, and tap Clean pasted text.";
}
function importLookupDraft() {
  const text = cleanLyricsText($("lookupDraft").value);
  if (!text) { $("lookupStatus").textContent = "Add lyric text before importing."; return; }
  const title = lookupSelectedTitle || $("lookupQuery").value.trim();
  const reusedBlankMap = !mapHasLyrics(activeMap());
  mapForFoundLyrics(title, text);
  appearanceScopeLineId = null;
  selection = null; groupedIds.clear(); focusOpen = false;
  persist(); render(); closeLookup(); showToast(reusedBlankMap ? "Lyrics added to this map" : "Lyrics added to a new map");
}

function closeMenu() { $("menuModal").classList.add("hidden"); }
let libraryManageMode = false;
function removeMap(id) {
  const index = database.maps.findIndex((map) => map.id === id);
  if (index < 0) return false;
  const wasActive = database.activeId === id;
  database.maps.splice(index, 1);
  if (!database.maps.length) database.maps.push(makeMap());
  if (wasActive) {
    database.activeId = [...database.maps].sort((a, b) => b.updatedAt - a.updatedAt)[0].id;
    appearanceScopeLineId = null;
    selection = null;
    groupedIds.clear();
    focusOpen = false;
    drawMode = null;
  }
  return true;
}
function confirmDeleteMap(id) {
  const map = database.maps.find((item) => item.id === id);
  if (!map) return;
  const label = map.title || "Untitled song";
  $("menuTitle").textContent = "Delete song map?";
  $("menuModal").querySelector(".menu-list").innerHTML = `<p class="delete-map-warning">Delete <strong>${safe(label)}</strong>? Its lyrics, notes, and markings will be removed from this device. This cannot be undone.</p><button type="button" id="cancelMapDelete">Keep map</button><button type="button" id="confirmMapDelete" class="danger-button">Delete this map</button>`;
  $("cancelMapDelete").onclick = () => renderLibrary(true);
  $("confirmMapDelete").onclick = () => {
    if (!removeMap(id)) { renderLibrary(true); return; }
    persist(); render(); renderLibrary(true); showToast("Song map deleted");
  };
  $("cancelMapDelete").focus();
}
function renderLibrary(manageMode = false) {
  libraryManageMode = manageMode;
  const maps = [...database.maps].sort((a, b) => b.updatedAt - a.updatedAt);
  $("menuTitle").textContent = "Saved maps";
  $("menuModal").querySelector(".menu-list").innerHTML = maps.map((map) => `<div class="map-library-row"><button type="button" data-map-id="${safe(map.id)}">${safe(map.title || "Untitled song")} <span>${map.lines.length} lines${map.id === database.activeId ? " · Current" : ""}</span></button>${manageMode ? `<button type="button" class="map-delete-button" data-map-delete="${safe(map.id)}" aria-label="Delete ${safe(map.title || "Untitled song")}">Delete</button>` : ""}</div>`).join("") + `<button type="button" id="manageMaps" aria-pressed="${manageMode}">${manageMode ? "Done managing" : "Manage maps"} <span>${manageMode ? "✓" : "›"}</span></button><button type="button" id="backToOptions">← Map options</button>`;
  $("menuModal").querySelectorAll("[data-map-id]").forEach((button) => button.onclick = () => {
    database.activeId = button.dataset.mapId; appearanceScopeLineId = null; selection = null; groupedIds.clear(); persist(); render(); closeMenu();
  });
  $("menuModal").querySelectorAll("[data-map-delete]").forEach((button) => button.onclick = () => confirmDeleteMap(button.dataset.mapDelete));
  $("manageMaps").onclick = () => renderLibrary(!libraryManageMode);
  $("backToOptions").onclick = openMenu;
}

const menuMarkup = $("menuModal").querySelector(".menu-list").innerHTML;
function openMenu() {
  libraryManageMode = false;
  $("menuTitle").textContent = "Map options";
  $("menuModal").querySelector(".menu-list").innerHTML = menuMarkup;
  bindMenu();
  $("menuModal").classList.remove("hidden");
}

function bindMenu() {
  $("appearanceButton").onclick = () => openAppearance();
  $("sectionsButton").onclick = () => openSections();
  $("renameButton").onclick = () => openEditor("rename");
  $("editLyricsButton").onclick = () => openEditor("lyrics");
  $("findLyricsButton").onclick = openLookup;
  $("importButton").onclick = () => { closeMenu(); $("fileInput").click(); };
  $("exportTextButton").onclick = () => { closeMenu(); shareContent(readableMap(activeMap()), "txt", "text/plain;charset=utf-8"); };
  $("newMapButton").onclick = () => { const map = makeMap(); database.maps.push(map); database.activeId = map.id; appearanceScopeLineId = null; selection = null; groupedIds.clear(); persist(); render(); closeMenu(); openEditor("rename"); };
  $("savedMapsButton").onclick = () => renderLibrary();
}

$("lyricsList").addEventListener("click", (event) => {
  if (suppressEnunciationClick) { suppressEnunciationClick = false; return; }
  if (event.target.closest(".focus-panel")) return;
  const sectionButton = event.target.closest("[data-section-line]");
  if (sectionButton) { openSections(sectionButton.dataset.sectionLine); return; }
  const row = event.target.closest(".lyric-line"); if (!row) return;
  if (event.target.closest(".pitch-clear")) { getLine(row.dataset.lineId).pitchPoints = []; persist(); render(); return; }
  if (event.target.closest(".pitch-layer")) return;
  if (event.target.closest(".line-index")) {
    if (suppressIndexClick) { suppressIndexClick = false; return; }
    toggleGroupedLine(row.dataset.lineId);
    return;
  }
  const word = event.target.closest(".word-chip");
  selectLine(row.dataset.lineId, word ? Number(word.dataset.wordIndex) : null);
});
$("lyricsList").addEventListener("pointerdown", (event) => {
  if (drawMode === "pitch") {
    const layer = event.target.closest(".pitch-layer.interactive");
    if (layer) {
      const point = pitchPointAt(layer, event);
      pitchGesture = { layer, lineId: layer.closest(".lyric-line").dataset.lineId, pointerId: event.pointerId, row: point.row, start: point, points: [point], moved: false };
      layer.setPointerCapture(event.pointerId);
      showPitchGesture(pitchGesture, point);
      event.preventDefault();
      return;
    }
  }
  if (drawMode === "enunciation" && !focusOpen && event.target.closest(".word-chip")) {
    const chip = event.target.closest(".word-chip");
    enunciationGesture = { pointerId: event.pointerId, rowId: chip.closest(".lyric-line").dataset.lineId, wordIndex: Number(chip.dataset.wordIndex), startX: event.clientX, startY: event.clientY, dragging: false, changed: false };
    try { $("lyricsList").setPointerCapture(event.pointerId); } catch (_) {}
  }
});
$("lyricsList").addEventListener("pointermove", (event) => {
  if (pitchGesture && pitchGesture.pointerId === event.pointerId) {
    const point = pitchPointAt(pitchGesture.layer, event, pitchGesture.row);
    const previous = pitchGesture.points[pitchGesture.points.length - 1];
    if (Math.hypot(point.x - pitchGesture.start.x, point.y - pitchGesture.start.y) > 2) pitchGesture.moved = true;
    if (Math.hypot(point.x - previous.x, point.y - previous.y) > 1) pitchGesture.points.push(point);
    showPitchGesture(pitchGesture, point);
    event.preventDefault();
  }
  if (enunciationGesture && enunciationGesture.pointerId === event.pointerId) {
    if (!enunciationGesture.dragging && Math.hypot(event.clientX - enunciationGesture.startX, event.clientY - enunciationGesture.startY) > 8) {
      enunciationGesture.dragging = true;
      try { $("lyricsList").setPointerCapture(event.pointerId); } catch (_) {}
      paintEnunciationAt({ clientX: enunciationGesture.startX, clientY: enunciationGesture.startY });
    }
    if (enunciationGesture.dragging) { paintEnunciationAt(event); event.preventDefault(); }
  }
});
$("lyricsList").addEventListener("pointerup", (event) => {
  if (pitchGesture && pitchGesture.pointerId === event.pointerId) {
    const line = getLine(pitchGesture.lineId);
    if (line) {
      const rows = visualPitchRows(pitchGesture.layer);
      const groups = pitchPointsByRow(line, rows);
      groups[pitchGesture.row] = pitchGesture.moved ? pitchGesture.points : [...groups[pitchGesture.row], pitchGesture.start];
      line.pitchPoints = groups.flat().map((point) => ({ id: uid(), x: point.x, y: point.y, row: point.row }));
      persist();
    }
    pitchGesture = null;
    render();
  }
  if (enunciationGesture && enunciationGesture.pointerId === event.pointerId) {
    const gesture = enunciationGesture;
    if (!gesture.dragging && Math.hypot(event.clientX - gesture.startX, event.clientY - gesture.startY) > 8) {
      gesture.dragging = true;
      paintEnunciationAt({ clientX: gesture.startX, clientY: gesture.startY });
      paintEnunciationAt(event);
    }
    suppressDrawClick();
    if (gesture.changed) persist();
    enunciationGesture = null;
    if (gesture.dragging) event.preventDefault();
    else selectLine(gesture.rowId, gesture.wordIndex);
  }
});
$("lyricsList").addEventListener("pointercancel", () => { pitchGesture = null; if (enunciationGesture?.changed) persist(); enunciationGesture = null; });
$("lyricsList").addEventListener("pointerdown", (event) => {
  const index = event.target.closest(".line-index");
  if (!index) return;
  event.preventDefault();
  const row = index.closest(".lyric-line");
  lineIndexGesture = { startId: row.dataset.lineId, end: -1, active: false, pointerId: event.pointerId, startX: event.clientX, startY: event.clientY };
});
$("lyricsList").addEventListener("selectstart", (event) => { if (!event.target.closest(".focus-panel, input, textarea")) event.preventDefault(); });
$("lyricsList").addEventListener("contextmenu", (event) => { if (!event.target.closest(".focus-panel, input, textarea")) event.preventDefault(); });
document.addEventListener("pointermove", (event) => {
  if (!lineIndexGesture || event.pointerId !== lineIndexGesture.pointerId) return;
  if (!lineIndexGesture.active && Math.hypot(event.clientX - lineIndexGesture.startX, event.clientY - lineIndexGesture.startY) > 8) activateLineGroupGesture();
  if (!lineIndexGesture?.active) return;
  const row = document.elementFromPoint(event.clientX, event.clientY)?.closest(".lyric-line");
  if (row) extendLineGroup(row.dataset.lineId);
});
document.addEventListener("pointerup", (event) => {
  if (!lineIndexGesture || event.pointerId !== lineIndexGesture.pointerId) return;
  const gesture = lineIndexGesture;
  if (!gesture.active) { suppressIndexClick = true; toggleGroupedLine(gesture.startId); }
  lineIndexGesture = null;
  setTimeout(() => { suppressIndexClick = false; }, 350);
});
document.addEventListener("pointercancel", (event) => { if (lineIndexGesture?.pointerId === event.pointerId) lineIndexGesture = null; suppressIndexClick = false; });
$("lyricsList").addEventListener("keydown", (event) => { if ((event.key === "Enter" || event.key === " ") && event.target.classList.contains("lyric-line")) { event.preventDefault(); selectLine(event.target.dataset.lineId); } });
$("lyricsButton").onclick = () => openEditor("lyrics");
$("lookupButton").onclick = openLookup;
$("pitchModeButton").onclick = () => openPianoRoll();
$("enunciationModeButton").onclick = () => setDrawMode("enunciation");
$("closeLookup").onclick = closeLookup;
$("searchLyrics").onclick = searchLyrics;
$("lookupQuery").addEventListener("keydown", (event) => { if (event.key === "Enter") searchLyrics(); });
$("lookupResults").addEventListener("click", (event) => { const button = event.target.closest("[data-result]"); if (button) chooseLookupResult(Number(button.dataset.result)); });
$("searchOtherLyrics").onclick = openLyricSearch;
$("cleanLookupDraft").onclick = () => { $("lookupDraft").value = cleanLyricsText($("lookupDraft").value); $("lookupStatus").textContent = "Cleaned the text. Review it before importing."; };
$("importLookupDraft").onclick = importLookupDraft;
$("emptyLyricsButton").onclick = () => openEditor("lyrics");
$("sectionButton").onclick = () => openSections();
$("closeSections").onclick = closeSections;
$("saveSection").onclick = saveSection;
$("deleteSection").onclick = deleteSection;
$("sectionPresets").addEventListener("click", (event) => { const preset = event.target.closest("[data-section-preset]"); if (preset) $("sectionNameInput").value = preset.dataset.sectionPreset; });
$("sectionList").addEventListener("click", (event) => {
  const jump = event.target.closest("[data-section-jump]");
  if (jump) { jumpToSection(jump.dataset.sectionJump); return; }
  const style = event.target.closest("[data-section-style]");
  if (style) { openAppearance(style.dataset.sectionStyle); return; }
  const edit = event.target.closest("[data-section-edit]");
  if (edit) editSection(edit.dataset.sectionEdit);
});
$("addLineButton").onclick = () => { const line = makeLine("New lyric line"); activeMap().lines.push(line); selection = { type: "line", lineIds: [line.id] }; focusOpen = true; persist(); render(); openSheet(); openInlineEditor("line"); };
$("closeSheet").onclick = closeSheet;
$("editAction").onclick = () => openInlineEditor(selection?.type === "group" ? "group" : selection?.type === "word" ? "word" : "line");
$("clearAction").onclick = clearSelection;
$("pianoFromSelection").onclick = () => openPianoRoll(selection?.lineIds?.[0]);
$("cancelInlineEdit").onclick = closeInlineEditor;
$("saveInlineEdit").onclick = saveInlineEditor;
$("inlineEditorText").addEventListener("keydown", (event) => { if ((event.metaKey || event.ctrlKey) && event.key === "Enter") saveInlineEditor(); });
document.addEventListener("keydown", (event) => { if (event.key !== "Escape") return; if (!$("pianoRollScreen").classList.contains("hidden")) closePianoRoll(); else if (!$("appearanceModal").classList.contains("hidden")) closeAppearance(); else if (!$("sectionsModal").classList.contains("hidden")) closeSections(); else if (inlineMode) closeInlineEditor(); else if (focusOpen) closeSheet(); });
$("toneSelect").onchange = (event) => event.target.value === "__custom" ? openEditor("customAbove") : applyProperty("above", event.target.value);
$("instructionSelect").onchange = (event) => event.target.value === "__custom" ? openEditor("customBelow") : applyProperty("below", event.target.value);
$("breathSelect").onchange = (event) => applyBreath(event.target.value);
[["volumeInput", "volume", 0], ["enunciationInput", "enunciation", 50]].forEach(([id, key]) => { $(id).oninput = refreshRanges; $(id).onchange = (event) => applyProperty(key, key === "volume" && Number(event.target.value) === 0 ? null : Number(event.target.value)); });
$("closeEditor").onclick = closeEditor;
$("cancelEditor").onclick = closeEditor;
$("saveEditor").onclick = saveEditor;
$("editorText").addEventListener("keydown", (event) => { if ((event.metaKey || event.ctrlKey) && event.key === "Enter") saveEditor(); });
$("menuButton").onclick = openMenu;
$("styleButton").onclick = () => openAppearance();
$("brandWebsite").onclick = () => {
  const url = "https://endlessvocals.com/";
  if (window.webkit?.messageHandlers?.songMapperOpenURL) window.webkit.messageHandlers.songMapperOpenURL.postMessage(url);
  else window.open(url, "_blank", "noopener,noreferrer");
};
$("closeAppearance").onclick = closeAppearance;
$("doneAppearance").onclick = closeAppearance;
$("appearanceScope").addEventListener("change", (event) => { appearanceScopeLineId = event.target.value === "song" ? null : event.target.value; applyAppearance(); });
$("resetAppearance").onclick = () => {
  const line = activeMap().lines.find((item) => item.id === appearanceScopeLineId && item.section);
  if (line) line.section.appearance = {};
  else activeMap().appearance = normalizeAppearance();
  applyAppearance(); render(); persist();
};
$("typeOptions").addEventListener("click", (event) => { const option = event.target.closest("[data-type-option]"); if (option) updateAppearance("type", option.dataset.typeOption); });
$("colorSwatches").addEventListener("click", (event) => { const swatch = event.target.closest("[data-swatch]"); if (swatch) updateAppearance("accent", swatch.dataset.swatch); });
$("lyricSwatches").addEventListener("click", (event) => { const swatch = event.target.closest("[data-lyric-swatch]"); if (swatch) updateAppearance("lyric", swatch.dataset.lyricSwatch); });
$("backgroundSwatches").addEventListener("click", (event) => { const swatch = event.target.closest("[data-background-swatch]"); if (swatch) updateAppearance("background", swatch.dataset.backgroundSwatch); });
$("accentColor").addEventListener("input", (event) => updateAppearance("accent", event.target.value));
$("lyricColor").addEventListener("input", (event) => updateAppearance("lyric", event.target.value));
$("backgroundColor").addEventListener("input", (event) => updateAppearance("background", event.target.value));
$("closePianoRoll").onclick = closePianoRoll;
$("donePianoRoll").onclick = closePianoRoll;
$("clearWordNote").onclick = clearSelectedWordNote;
$("editSyllables").onclick = openSyllableEditor;
$("cancelSyllableSplit").onclick = () => $("syllableEditor").classList.add("hidden");
$("saveSyllableSplit").onclick = saveSyllableSplit;
$("syllableSplitText").addEventListener("keydown", (event) => { if (event.key === "Enter") saveSyllableSplit(); });
$("addSyllablePitch").onclick = addSyllablePitch;
$("removeSyllablePitch").onclick = removeSyllablePitch;
$("rollLinePicker").addEventListener("click", (event) => { const button = event.target.closest("[data-roll-line]"); if (!button) return; stopNotePreview(); rollLineId = button.dataset.rollLine; rollWordIndex = 0; rollSyllableIndex = 0; rollPitchIndex = 0; $("syllableEditor").classList.add("hidden"); renderPianoRoll(); scrollToRollNote(); });
$("rollWordRibbon").addEventListener("click", (event) => { const button = event.target.closest("[data-roll-word]"); if (!button || suppressRollCellClick) return; rollWordIndex = Number(button.dataset.rollWord); rollSyllableIndex = 0; rollPitchIndex = 0; $("syllableEditor").classList.add("hidden"); renderPianoRoll(); scrollToRollNote(); auditionNote(currentRollNote()); });
$("rollSyllableRibbon").addEventListener("click", (event) => { const button = event.target.closest("[data-roll-syllable]"); if (!button || suppressRollCellClick) return; rollSyllableIndex = Number(button.dataset.rollSyllable); rollPitchIndex = Number(button.dataset.rollPitch); renderPianoRoll(); scrollToRollNote(); auditionNote(currentRollNote()); });
$("rollGrid").addEventListener("click", (event) => { if (suppressRollCellClick) return; const key = event.target.closest(".roll-key"); if (key) { auditionNote(Number(key.dataset.rollKey)); return; } const cell = event.target.closest(".roll-cell"); if (!cell) return; assignWordNote(rollWordIndex, Number(cell.dataset.midi), Number(cell.dataset.rollSyllable), Number(cell.dataset.rollPitch)); });
$("pianoRollScreen").addEventListener("pointerdown", (event) => {
  const source = event.target.closest(".roll-word-ribbon [data-roll-word], .roll-syllable-ribbon [data-roll-syllable], .roll-column-head[data-roll-syllable], .roll-note-chip");
  if (!source) return;
  const wordIndex = source.closest("[data-roll-word]") ? Number(source.closest("[data-roll-word]").dataset.rollWord) : rollWordIndex;
  const slot = source.closest("[data-roll-syllable]");
  if (!Number.isInteger(wordIndex)) return;
  const changedWord = wordIndex !== rollWordIndex;
  rollDrag = { pointerId: event.pointerId, wordIndex, syllableIndex: slot ? Number(slot.dataset.rollSyllable) : changedWord ? 0 : rollSyllableIndex, pitchIndex: slot ? Number(slot.dataset.rollPitch) : changedWord ? 0 : rollPitchIndex, startX: event.clientX, startY: event.clientY, moved: false, midi: null };
  $("pianoRollScreen").setPointerCapture(event.pointerId);
  event.preventDefault();
});
$("pianoRollScreen").addEventListener("pointermove", (event) => {
  if (!rollDrag || rollDrag.pointerId !== event.pointerId) return;
  if (Math.hypot(event.clientX - rollDrag.startX, event.clientY - rollDrag.startY) > 6) rollDrag.moved = true;
  if (!rollDrag.moved) return;
  const midi = rollMidiAt(event.clientX, event.clientY);
  if (midi == null || !Number.isInteger(midi)) return;
  rollDrag.midi = midi;
  $("rollReadoutWord").textContent = currentRollLine()?.words[rollDrag.wordIndex]?.syllables?.[rollDrag.syllableIndex]?.text || "—";
  $("rollReadoutNote").textContent = noteName(midi);
  $("rollGrid").querySelector(".roll-cell.preview")?.classList.remove("preview");
  $("rollGrid").querySelector(`.roll-cell[data-midi="${midi}"][data-roll-syllable="${rollDrag.syllableIndex}"][data-roll-pitch="${rollDrag.pitchIndex}"]`)?.classList.add("preview");
  event.preventDefault();
});
$("pianoRollScreen").addEventListener("pointerup", (event) => {
  if (!rollDrag || rollDrag.pointerId !== event.pointerId) return;
  const drag = rollDrag; rollDrag = null;
  if (Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) > 6) drag.moved = true;
  drag.midi = rollMidiAt(event.clientX, event.clientY) ?? drag.midi;
  if (drag.moved && drag.midi != null) {
    suppressRollCellClick = true;
    assignWordNote(drag.wordIndex, drag.midi, drag.syllableIndex, drag.pitchIndex);
    setTimeout(() => { suppressRollCellClick = false; }, 300);
  } else { rollWordIndex = drag.wordIndex; rollSyllableIndex = drag.syllableIndex; rollPitchIndex = drag.pitchIndex; renderPianoRoll(); scrollToRollNote(); auditionNote(currentRollNote()); }
});
$("pianoRollScreen").addEventListener("pointercancel", () => { rollDrag = null; $("rollGrid").querySelector(".roll-cell.preview")?.classList.remove("preview"); });
$("closeMenu").onclick = closeMenu;
$("shareMapButton").onclick = () => { closeMenu(); shareContent(JSON.stringify(exportPayload(activeMap()), null, 2), "smap", "application/json;charset=utf-8"); };
$("saveStatus").onclick = () => { persist(); showToast("Saved on this device"); };
$("fileInput").onchange = async (event) => { const file = event.target.files?.[0]; if (!file) return; try { importPayload(JSON.parse(await file.text())); } catch (error) { showToast(error.message || "Could not load file"); } event.target.value = ""; };
bindMenu();
renderAppearanceStudio();
render();
window.addEventListener("resize", refreshPitchLayers);
window.addEventListener("resize", () => updateSongTitle(activeMap().title));
window.addEventListener("pagehide", stopNotePreview);
document.addEventListener("visibilitychange", () => { if (document.hidden) stopNotePreview(); });
