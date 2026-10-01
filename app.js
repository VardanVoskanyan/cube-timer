const STORAGE_KEY = "cube-timer-solves";
const HOLD_MS = 300; // how long Space must be held before the timer arms
const MIN_BINS = 4; // histogram bin slider range
const MAX_BINS = 40;

const $ = (sel) => document.querySelector(sel);

// ---------- Storage ----------

function loadSolves() {
  try {
    const data = JSON.parse(localStorage.getItem(STORAGE_KEY));
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

function saveSolves() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(solves));
  } catch {
    // storage unavailable (e.g. private mode) - solves live only for this page load
  }
}

let solves = loadSolves(); // [{ time: ms, scramble: string, date: ISO string }]
let scramble = generateScramble();

// ---------- Formatting & stats ----------

function fmt(ms) {
  if (ms == null || !isFinite(ms)) return "—";
  const cs = Math.floor(ms / 10);
  const minutes = Math.floor(cs / 6000);
  const seconds = Math.floor((cs % 6000) / 100);
  const hundredths = String(cs % 100).padStart(2, "0");
  if (minutes > 0) return `${minutes}:${String(seconds).padStart(2, "0")}.${hundredths}`;
  return `${seconds}.${hundredths}`;
}

const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;

function median(xs) {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function stdDev(xs) {
  if (xs.length < 2) return null;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / (xs.length - 1));
}

// Competition-style average: drop the single best and worst, mean the rest.
function trimmedMean(xs) {
  const s = [...xs].sort((a, b) => a - b);
  return mean(s.slice(1, -1));
}

// fn over the window of k solves ending at each index (null where there aren't k solves yet).
function rolling(times, k, fn) {
  return times.map((_, i) => (i + 1 >= k ? fn(times.slice(i + 1 - k, i + 1)) : null));
}

function minOf(values) {
  let best = null;
  for (const v of values) if (v != null && (best === null || v < best)) best = v;
  return best;
}

// Everything the panels show, computed once per change.
function analyze(times) {
  const n = times.length;
  const mo5 = rolling(times, 5, mean);
  const ao5 = rolling(times, 5, trimmedMean);
  const mo12 = rolling(times, 12, mean);
  const ao12 = rolling(times, 12, trimmedMean);
  // [label, latest, best, change of latest vs best before it, starts a new group]
  const row = (label, arr, groupStart) => {
    const latest = n ? arr[n - 1] : null;
    const prevBest = minOf(arr.slice(0, -1));
    // Compare the values as displayed (hundredths) so the superscript adds up visually.
    const cs = (v) => Math.floor(v / 10) * 10;
    const diff = latest != null && prevBest != null ? cs(latest) - cs(prevBest) : null;
    return [label, latest, minOf(arr), diff, groupStart];
  };
  return {
    n,
    times,
    ao5,
    ao12,
    bestSingle: minOf(times),
    rows: [
      row("Solve", times, true),
      row("Avg. 5", mo5, true),
      row("3 of 5", ao5, false),
      row("Avg. 12", mo12, true),
      row("10 of 12", ao12, false),
    ],
    session: [
      ["Solves", String(n)],
      ["Best", fmt(minOf(times))],
      ["Worst", fmt(n ? Math.max(...times) : null)],
      ["Average", fmt(n ? mean(times) : null)],
      ["Median", fmt(n ? median(times) : null)],
      ["Std.", fmt(stdDev(times))],
    ],
  };
}

// ---------- Rendering ----------

let stats = analyze([]);
let logScale = false;
try {
  logScale = localStorage.getItem("cube-timer-log-scale") === "1";
} catch {}
let binSetting = null; // histogram bin count chosen with the slider; null = automatic
try {
  const saved = Number(localStorage.getItem("cube-timer-bins"));
  if (saved >= MIN_BINS && saved <= MAX_BINS) binSetting = saved;
} catch {}

function renderScramble() {
  $("#scramble").textContent = scramble;
  renderNet();
}

function renderTimes() {
  const body = $("#times-body");
  const rows = [];
  for (let i = stats.n - 1; i >= 0; i--) {
    const t = stats.times[i];
    const pb = stats.n > 1 && t === stats.bestSingle ? `<span class="badge">PB</span>` : "";
    // Newest row only: change vs the previous best (Solve, 3 of 5, 10 of 12 rows of the stats).
    const sup = (r) => (i === stats.n - 1 ? diffSup(stats.rows[r][3]) : "");
    rows.push(`<tr title="${solves[i].scramble ?? ""}">
      <td class="idx">${i + 1}</td>
      <td class="time">${pb}${fmt(t)}${sup(0)}</td>
      <td>${fmt(stats.ao5[i])}${sup(2)}</td>
      <td>${fmt(stats.ao12[i])}${sup(4)}</td>
      <td><button class="del" title="Delete this solve" data-i="${i}">✕</button></td>
    </tr>`);
  }
  body.innerHTML = rows.join("");
  $("#times-empty").classList.toggle("hidden", stats.n > 0);
  $("#count").textContent = stats.n ? String(stats.n) : "";
}

function renderStats() {
  $("#stats-body").innerHTML = stats.rows
    .map(([label, cur, best, diff, groupStart]) => {
      const isPb = diff != null && diff < 0;
      return `<tr class="${groupStart ? "group-start" : ""}">
        <td>${label}</td>
        <td>${isPb ? `<span class="badge">PB</span>` : ""}${fmt(cur)}${diffSup(diff)}</td>
        <td class="best">${fmt(best)}</td>
      </tr>`;
    })
    .join("");
  $("#session").innerHTML = stats.session
    .map(([label, value]) => `<div><dt>${label}</dt><dd>${value}</dd></div>`)
    .join("");
}

// Small "+1.34 s" / "−0.34 s" above the timer: latest solve vs the best before it.
let showDelta = false; // only while the timer is showing the latest result
function renderDelta() {
  const el = $("#delta");
  el.textContent = "";
  if (!showDelta || stats.n < 2) return;
  el.textContent = `${signed(stats.rows[0][3])} s`;
}

const diffSup = (d) => (d == null ? "" : `<sup class="diff" title="vs. best before this solve">${signed(d)}</sup>`);
const signed = (d) => `${d < 0 ? "−" : "+"}${fmt(Math.abs(d))}`;

// One line under the timer about the latest solve.
function renderLastInfo() {
  const el = $("#last-info");
  if (!stats.n) return (el.innerHTML = "");
  const t = stats.times[stats.n - 1];
  const parts = [];
  if (stats.n > 1 && t === stats.bestSingle) parts.push(`<span class="badge">PB</span>New best single`);
  if (stats.ao5[stats.n - 1] != null) parts.push(`3 of 5: ${fmt(stats.ao5[stats.n - 1])}`);
  if (stats.ao12[stats.n - 1] != null) parts.push(`10 of 12: ${fmt(stats.ao12[stats.n - 1])}`);
  el.innerHTML = parts.join(" · ");
}

function renderNet() {
  const net = cubeNet(scramble);
  // Position of each face in the 4x3 unfolded layout.
  const layout = { U: [1, 2], L: [2, 1], F: [2, 2], R: [2, 3], B: [2, 4], D: [3, 2] };
  $("#net").innerHTML = Object.entries(layout)
    .map(([face, [row, col]]) => {
      const stickers = net[face].flat().map((c) => `<div class="sticker ${c}"></div>`).join("");
      return `<div class="face" style="grid-row:${row};grid-column:${col}">${stickers}</div>`;
    })
    .join("");
}

function niceStep(range, targetTicks) {
  const raw = range / targetTicks;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const n = raw / pow;
  return (n < 1.5 ? 1 : n < 3 ? 2 : n < 7 ? 5 : 10) * pow;
}

function linearAxis(lo, hi) {
  const step = niceStep(Math.max(hi - lo, 0.5), 4);
  const yMin = Math.max(0, Math.floor(lo / step) * step);
  const yMax = Math.ceil(hi / step) * step + (hi === lo ? step : 0);
  const ticks = [];
  for (let v = yMin; v <= yMax + 1e-9; v += step) ticks.push(v);
  return { yMin, yMax, ticks };
}

function renderGraph() {
  const el = $("#graph");
  el.innerHTML = "";
  const n = stats.n;
  $("#graph-empty").classList.toggle("hidden", n >= 2);
  if (n < 2) return;

  const sec = (arr) => arr.map((v) => (v == null ? null : v / 1000));
  const times = sec(stats.times);
  const series = [
    { name: "Single", color: "var(--series-1)", values: times },
    { name: "3 of 5", color: "var(--series-2)", values: sec(stats.ao5) },
    { name: "10 of 12", color: "var(--series-3)", values: sec(stats.ao12) },
  ];

  const W = Math.max(el.clientWidth, 280);
  const H = 220;
  const pad = { l: 44, r: 12, t: 10, b: 26 };
  const lo = Math.min(...times);
  const hi = Math.max(...times);
  const { yMin, yMax, ticks } = linearAxis(lo, hi);
  const x = (i) => pad.l + (i / (n - 1)) * (W - pad.l - pad.r);
  const y = (v) => pad.t + (1 - (v - yMin) / (yMax - yMin)) * (H - pad.t - pad.b);

  let svg = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Solve times over time">`;
  for (const v of ticks) {
    svg += `<line class="gridline" x1="${pad.l}" x2="${W - pad.r}" y1="${y(v)}" y2="${y(v)}"/>`;
    svg += `<text class="axis" x="${pad.l - 8}" y="${y(v) + 4}" text-anchor="end">${+v.toFixed(2)}s</text>`;
  }
  const xStep = Math.max(1, Math.ceil(niceStep(n, 6)));
  for (let i = 0; i < n; i += xStep) {
    svg += `<text class="axis" x="${x(i)}" y="${H - 6}" text-anchor="middle">${i + 1}</text>`;
  }
  for (const s of series) {
    let d = "";
    s.values.forEach((v, i) => {
      if (v == null) return;
      d += `${d ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`;
    });
    if (d) svg += `<path class="line" d="${d}" stroke="${s.color}"/>`;
  }
  svg += `<line class="crosshair hidden" x1="0" x2="0" y1="${pad.t}" y2="${H - pad.b}"/>`;
  svg += `<g class="dots"></g>`;
  svg += `<rect x="${pad.l}" y="0" width="${W - pad.l - pad.r}" height="${H}" fill="transparent" class="hit"/>`;
  svg += `</svg>`;
  el.innerHTML = svg + `<div class="tooltip hidden"></div>`;

  // Hover: crosshair + tooltip on the nearest solve.
  const svgEl = el.querySelector("svg");
  const cross = el.querySelector(".crosshair");
  const dots = el.querySelector(".dots");
  const tip = el.querySelector(".tooltip");
  const hit = el.querySelector(".hit");
  hit.addEventListener("mousemove", (e) => {
    const rect = svgEl.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * W;
    const i = Math.max(0, Math.min(n - 1, Math.round(((px - pad.l) / (W - pad.l - pad.r)) * (n - 1))));
    cross.setAttribute("x1", x(i));
    cross.setAttribute("x2", x(i));
    cross.classList.remove("hidden");
    dots.innerHTML = series
      .filter((s) => s.values[i] != null)
      .map((s) => `<circle cx="${x(i)}" cy="${y(s.values[i])}" r="4.5" fill="${s.color}" stroke="var(--surface)" stroke-width="2"/>`)
      .join("");
    tip.innerHTML =
      `<div><b>Solve ${i + 1}</b></div>` +
      series
        .map((s) => `<div class="row"><i class="sw" style="background:${s.color}"></i>${s.name}: ${fmt(s.values[i] == null ? null : s.values[i] * 1000)}</div>`)
        .join("");
    tip.classList.remove("hidden");
    const left = (x(i) / W) * rect.width;
    tip.style.top = "8px";
    tip.style.left = left > rect.width / 2 ? `${left - tip.offsetWidth - 12}px` : `${left + 12}px`;
  });
  hit.addEventListener("mouseleave", () => {
    cross.classList.add("hidden");
    dots.innerHTML = "";
    tip.classList.add("hidden");
  });
}

// Top-rounded bar anchored to the baseline.
function barPath(x, y, w, h, r = 4) {
  r = Math.min(r, w / 2, h);
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}

// Exactly `count` equal-width time bins spanning [lo, hi]: edge(i) = start + i·step.
function linearBins(lo, hi, count) {
  const span = Math.max(hi - lo, 0.5); // widen a zero-width range around its centre
  const start = (lo + hi) / 2 - span / 2;
  const step = span / count;
  return {
    edge: (i) => start + i * step,
    binOf: (t) => Math.min(count - 1, Math.max(0, Math.floor((t - start) / step))),
  };
}

// Exactly `count` log-spaced time bins: each bin is a fixed % wider than the previous, edge(i) = start·ratio^i.
function logBins(lo, hi, count) {
  lo = Math.max(lo, 0.01); // log(0) is undefined; an instant 0.00 stop lands in the first bin
  const spanRatio = Math.max(hi / lo, 1.05);
  const start = Math.sqrt((lo * hi) / spanRatio); // centre the span on the data (in log space)
  const ratio = spanRatio ** (1 / count);
  return {
    edge: (i) => start * ratio ** i,
    binOf: (t) => Math.min(count - 1, Math.max(0, Math.floor(Math.log(t / start) / Math.log(ratio)))),
  };
}

// Auto: roughly √n bins, within sensible limits.
const autoBins = (n) => Math.min(25, Math.max(6, Math.round(Math.sqrt(n) * 1.5)));

function renderHistogram() {
  const el = $("#hist");
  el.innerHTML = "";
  const n = stats.n;
  $("#hist-empty").classList.toggle("hidden", n >= 2);
  $(".bins-control").classList.toggle("hidden", n < 2);
  if (n < 2) return;

  const times = stats.times.map((t) => t / 1000);
  const lo = Math.min(...times);
  const hi = Math.max(...times);
  const binCount = binSetting ?? autoBins(n);
  $("#bins-value").textContent = binSetting ? binCount : `Auto · ${binCount}`;
  $("#bins").value = binCount;
  $("#bins-auto").classList.toggle("hidden", binSetting == null);
  const { edge, binOf } = logScale ? logBins(lo, hi, binCount) : linearBins(lo, hi, binCount);
  const bins = Array(binCount).fill(0);
  for (const t of times) bins[binOf(t)]++;
  const latestBin = binOf(times[n - 1]);
  const maxCount = Math.max(...bins);

  const W = Math.max(el.clientWidth, 220);
  const H = 220;
  const pad = { l: 30, r: 8, t: 10, b: 26 };
  const plotW = W - pad.l - pad.r;
  const plotH = H - pad.t - pad.b;
  const slot = plotW / binCount;
  const gap = Math.min(2, slot * 0.2);
  const y = (c) => pad.t + (1 - c / maxCount) * plotH;
  // Axis labels show one decimal; tooltips one more.
  const label = (v) => `${+v.toFixed(v < 100 ? 1 : 0)}`;
  const exact = (v) => `${+v.toFixed(v < 10 ? 2 : 1)}`;

  let svg = `<svg class="hist" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Distribution of solve times">`;
  const cStep = Math.max(1, Math.ceil(niceStep(maxCount, 4)));
  for (let c = 0; c <= maxCount; c += cStep) {
    svg += `<line class="gridline" x1="${pad.l}" x2="${W - pad.r}" y1="${y(c)}" y2="${y(c)}"/>`;
    svg += `<text class="axis" x="${pad.l - 6}" y="${y(c) + 4}" text-anchor="end">${c}</text>`;
  }
  const labelEvery = Math.ceil(binCount / Math.max(1, Math.floor(plotW / 40)));
  bins.forEach((c, i) => {
    const x = pad.l + i * slot + gap / 2;
    if (c > 0) {
      const cls = i === latestBin ? "bar" : "bar dim";
      svg += `<path class="${cls}" d="${barPath(x, y(c), slot - gap, H - pad.b - y(c))}"/>`;
    }
    svg += `<rect class="hit" data-i="${i}" x="${pad.l + i * slot}" y="${pad.t}" width="${slot}" height="${plotH}" fill="transparent"/>`;
    if (i % labelEvery === 0) {
      svg += `<text class="axis" x="${pad.l + i * slot}" y="${H - 6}" text-anchor="middle">${label(edge(i))}s</text>`;
    }
  });
  svg += `</svg>`;
  el.innerHTML = svg + `<div class="tooltip hidden"></div>`;

  const svgEl = el.querySelector("svg");
  const tip = el.querySelector(".tooltip");
  svgEl.addEventListener("mousemove", (e) => {
    const hit = e.target.closest(".hit");
    if (!hit) return tip.classList.add("hidden");
    const i = Number(hit.dataset.i);
    const c = bins[i];
    tip.innerHTML =
      `<div><b>${exact(edge(i))}–${exact(edge(i + 1))}s</b></div>` +
      `<div>${c} solve${c === 1 ? "" : "s"} (${Math.round((c / n) * 100)}%)</div>` +
      (i === latestBin ? `<div>Latest solve is here</div>` : "");
    tip.classList.remove("hidden");
    const rect = svgEl.getBoundingClientRect();
    const left = ((pad.l + (i + 0.5) * slot) / W) * rect.width;
    tip.style.top = "8px";
    tip.style.left = left > rect.width / 2 ? `${left - tip.offsetWidth - 8}px` : `${left + 8}px`;
  });
  svgEl.addEventListener("mouseleave", () => tip.classList.add("hidden"));
}

function renderAll() {
  stats = analyze(solves.map((s) => s.time));
  renderTimes();
  renderStats();
  renderLastInfo();
  renderDelta();
  renderGraph();
  renderHistogram();
}

// ---------- Timer ----------

// idle -> holding (Space down) -> ready (held HOLD_MS) -> running (Space up) -> stopped (Space down)
let state = "idle";
let holdTimer = null;
let startTime = 0;
let rafId = null;
const timerEl = $("#timer");

function setState(s) {
  state = s;
  if (s === "holding" || s === "ready" || s === "running") {
    showDelta = false;
    renderDelta();
  }
  timerEl.classList.toggle("holding", s === "holding");
  timerEl.classList.toggle("ready", s === "ready");
  document.body.classList.toggle("running", s === "running");
}

function tick() {
  timerEl.textContent = fmt(performance.now() - startTime);
  rafId = requestAnimationFrame(tick);
}

function pressDown() {
  if (state === "running") {
    stopTimer();
  } else if (state === "idle") {
    setState("holding");
    holdTimer = setTimeout(() => {
      setState("ready");
      timerEl.textContent = fmt(0);
    }, HOLD_MS);
  }
}

function pressUp() {
  if (state === "ready") {
    startTime = performance.now();
    setState("running");
    tick();
  } else if (state === "holding") {
    clearTimeout(holdTimer);
    setState("idle");
  } else if (state === "stopped") {
    setState("idle");
  }
}

function stopTimer() {
  const elapsed = performance.now() - startTime;
  cancelAnimationFrame(rafId);
  timerEl.textContent = fmt(elapsed);
  setState("stopped"); // wait for key release before allowing the next hold
  solves.push({ time: Math.round(elapsed), scramble, date: new Date().toISOString() });
  showDelta = true;
  saveSolves();
  scramble = generateScramble();
  renderScramble();
  renderAll();
}

// Put the latest solve (and its difference from the previous best) on the timer.
function showLatest() {
  const last = solves[solves.length - 1];
  timerEl.textContent = fmt(last ? last.time : 0);
  showDelta = Boolean(last);
}

// After deleting/importing/clearing, re-sync the timer with the new latest solve.
function solvesChanged() {
  saveSolves();
  showLatest();
  renderAll();
}

function cancelTimer() {
  cancelAnimationFrame(rafId);
  clearTimeout(holdTimer);
  timerEl.textContent = fmt(0);
  setState("idle");
}

document.addEventListener("keydown", (e) => {
  if (e.code === "Space") {
    e.preventDefault();
    document.activeElement?.blur();
    if (!e.repeat) pressDown();
  } else if (e.code === "Escape" && state !== "idle") {
    cancelTimer();
  } else if (state === "running") {
    stopTimer(); // any key stops a running timer
  }
});
document.addEventListener("keyup", (e) => {
  if (e.code === "Space") {
    e.preventDefault();
    pressUp();
  } else if (state === "stopped") {
    setState("idle"); // timer was stopped with a non-Space key
  }
});

// Touch / mouse on the timer works the same way as Space.
const timerArea = $(".timer-area");
timerArea.addEventListener("pointerdown", (e) => { e.preventDefault(); pressDown(); });
timerArea.addEventListener("pointerup", (e) => { e.preventDefault(); pressUp(); });

// ---------- Controls ----------

$("#new-scramble").addEventListener("click", () => {
  scramble = generateScramble();
  renderScramble();
});

$("#times-body").addEventListener("click", (e) => {
  const btn = e.target.closest("button.del");
  if (!btn) return;
  const i = Number(btn.dataset.i);
  if (!confirm(`Delete solve #${i + 1} (${fmt(solves[i].time)})?`)) return;
  solves.splice(i, 1);
  solvesChanged();
});

$("#clear").addEventListener("click", () => {
  if (!solves.length || !confirm(`Delete all ${solves.length} solves? Export first if you want a backup.`)) return;
  solves = [];
  solvesChanged();
});

$("#export").addEventListener("click", () => {
  const blob = new Blob([JSON.stringify(solves, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `cube-solves-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
});

$("#import").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  e.target.value = "";
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    const valid = Array.isArray(data) && data.every((s) => typeof s.time === "number");
    if (!valid) throw new Error("Expected a list of solves with a numeric 'time' (ms).");
    const replace = solves.length === 0 || confirm("OK = replace current solves, Cancel = append to them.");
    solves = replace ? data : solves.concat(data);
    solvesChanged();
  } catch (err) {
    alert(`Could not import file: ${err.message}`);
  }
});

const logToggle = $("#log-scale");
logToggle.checked = logScale;
logToggle.addEventListener("change", () => {
  logScale = logToggle.checked;
  try {
    localStorage.setItem("cube-timer-log-scale", logScale ? "1" : "0");
  } catch {}
  logToggle.blur(); // keep Space for the timer
  renderHistogram();
});

// Histogram bin count: null = automatic.
const binsSlider = $("#bins");
binsSlider.min = MIN_BINS;
binsSlider.max = MAX_BINS;
function setBins(value) {
  binSetting = value;
  try {
    if (value == null) localStorage.removeItem("cube-timer-bins");
    else localStorage.setItem("cube-timer-bins", String(value));
  } catch {}
  renderHistogram();
}
// (No blur needed: the Space handler already blurs the focused control, and arrow keys keep working.)
binsSlider.addEventListener("input", () => setBins(Number(binsSlider.value)));
$("#bins-auto").addEventListener("click", (e) => {
  e.currentTarget.blur();
  setBins(null);
});

let resizeTimer;
window.addEventListener("resize", () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    renderGraph();
    renderHistogram();
  }, 100);
});

renderScramble();
showLatest();
renderAll();
