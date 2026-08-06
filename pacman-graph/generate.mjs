#!/usr/bin/env node
/**
 * pacman-graph — self-hosted animated contribution graph.
 *
 * Renders ZAKRIAZ's last 12 months of GitHub contributions as an arcade maze and
 * sends a Pac-Man on a serpentine sweep through it, eating every contribution it
 * passes. Output is a single self-contained animated SVG.
 *
 * Node 20+, ESM, ZERO npm dependencies (global fetch only).
 *
 *   node pacman-graph/generate.mjs            # live, needs GITHUB_TOKEN
 *   node pacman-graph/generate.mjs --demo     # synthetic data, no network
 *
 * env: GITHUB_TOKEN, LOGIN (default ZAKRIAZ), OUT (default ../assets/pacman-contributions.svg)
 *
 * SVG constraints this file deliberately respects (GitHub serves README images
 * inside <img> through camo, which makes the SVG a CLOSED document):
 *   - no external refs of any kind, no web fonts, no scripts
 *   - headline lettering is drawn as <rect> geometry from a hand-built 5x7 grid
 *   - body text uses only generic monospace families
 *   - animation is SMIL + CSS inside the document, looping forever
 *   - frame 1 (no animation support) is the full, legible maze
 *   - prefers-reduced-motion holds a single static frame
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/* ------------------------------------------------------------------ config */

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = process.env.OUT
  ? resolve(process.env.OUT)
  : resolve(HERE, '..', 'assets', 'pacman-contributions.svg');

const LOGIN = process.env.LOGIN || process.env.GITHUB_LOGIN || 'ZAKRIAZ';
const DEMO = process.argv.includes('--demo');

// visual identity — do not drift
const C = {
  bg: '#0a0a0b',
  crimson: '#b71c1c',
  deep: '#8b0000',
  ink: '#e8e6e3',
  dim: '#9a9a9a',
  ok: '#5ce08a',
  frame: '#2a1a1c',
  dot: '#232326',
};
const RAMP = ['#7d1215', C.deep, C.crimson, '#e04b4b']; // level 1..4, crimson family
const MONO = 'ui-monospace,SFMono-Regular,Menlo,Consolas,monospace';

// geometry
const ROWS = 7;
const CELL = 12;
const PITCH = 15;
const PAD = 22;
const GY = 74; // grid top
const LOOP = 28; // seconds for one full sweep
const PAC_R = 7.5;

/* -------------------------------------------------------------- 5x7 pixel font */

const GLYPHS = {
  A: '01110,10001,10001,11111,10001,10001,10001',
  B: '11110,10001,10001,11110,10001,10001,11110',
  C: '01110,10001,10000,10000,10000,10001,01110',
  D: '11110,10001,10001,10001,10001,10001,11110',
  E: '11111,10000,10000,11110,10000,10000,11111',
  F: '11111,10000,10000,11110,10000,10000,10000',
  G: '01110,10001,10000,10111,10001,10001,01110',
  H: '10001,10001,10001,11111,10001,10001,10001',
  I: '11111,00100,00100,00100,00100,00100,11111',
  J: '00111,00010,00010,00010,00010,10010,01100',
  K: '10001,10010,10100,11000,10100,10010,10001',
  L: '10000,10000,10000,10000,10000,10000,11111',
  M: '10001,11011,10101,10101,10001,10001,10001',
  N: '10001,11001,10101,10101,10011,10001,10001',
  O: '01110,10001,10001,10001,10001,10001,01110',
  P: '11110,10001,10001,11110,10000,10000,10000',
  Q: '01110,10001,10001,10001,10101,10010,01101',
  R: '11110,10001,10001,11110,10100,10010,10001',
  S: '01111,10000,10000,01110,00001,00001,11110',
  T: '11111,00100,00100,00100,00100,00100,00100',
  U: '10001,10001,10001,10001,10001,10001,01110',
  V: '10001,10001,10001,10001,10001,01010,00100',
  W: '10001,10001,10001,10101,10101,11011,10001',
  X: '10001,10001,01010,00100,01010,10001,10001',
  Y: '10001,10001,01010,00100,00100,00100,00100',
  Z: '11111,00001,00010,00100,01000,10000,11111',
  0: '01110,10011,10101,10101,10101,11001,01110',
  1: '00100,01100,00100,00100,00100,00100,01110',
  2: '01110,10001,00001,00010,00100,01000,11111',
  3: '11111,00010,00100,00010,00001,10001,01110',
  4: '00010,00110,01010,10010,11111,00010,00010',
  5: '11111,10000,11110,00001,00001,10001,01110',
  6: '00110,01000,10000,11110,10001,10001,01110',
  7: '11111,00001,00010,00100,01000,01000,01000',
  8: '01110,10001,10001,01110,10001,10001,01110',
  9: '01110,10001,10001,01111,00001,00010,01100',
  '-': '00000,00000,00000,11111,00000,00000,00000',
  '.': '00000,00000,00000,00000,00000,01100,01100',
  ':': '00000,01100,01100,00000,01100,01100,00000',
  '/': '00001,00001,00010,00100,01000,10000,10000',
  ' ': '00000,00000,00000,00000,00000,00000,00000',
};

const pixelWidth = (s, sc) => s.length * 6 * sc - sc;

/** Draw a string as merged <rect> runs. Deliberately pixelated everywhere. */
function pixelText(str, x, y, sc, fill, opacity) {
  const out = [];
  let cx = x;
  for (const ch of str.toUpperCase()) {
    const g = GLYPHS[ch];
    if (g) {
      g.split(',').forEach((row, r) => {
        let c = 0;
        while (c < 5) {
          if (row[c] === '1') {
            let n = 1;
            while (c + n < 5 && row[c + n] === '1') n++;
            out.push(
              `<rect x="${cx + c * sc}" y="${y + r * sc}" width="${n * sc}" height="${sc}"/>`
            );
            c += n;
          } else c++;
        }
      });
    }
    cx += 6 * sc;
  }
  const op = opacity == null ? '' : ` opacity="${opacity}"`;
  return `<g fill="${fill}"${op}>${out.join('')}</g>`;
}

/* ------------------------------------------------------------------- data */

const QUERY = `query($login:String!){user(login:$login){contributionsCollection{contributionCalendar{totalContributions weeks{firstDay contributionDays{date contributionCount weekday}}}}}}`;

async function fetchCalendar(login) {
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  if (!token) {
    console.error('GITHUB_TOKEN is not set. Use --demo for an offline render.');
    process.exit(1);
  }
  const res = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: {
      Authorization: `bearer ${token}`,
      'Content-Type': 'application/json',
      'User-Agent': 'pacman-graph (self-hosted)',
    },
    body: JSON.stringify({ query: QUERY, variables: { login } }),
  });
  if (!res.ok) {
    console.error(`GitHub GraphQL HTTP ${res.status}: ${(await res.text()).slice(0, 400)}`);
    process.exit(1);
  }
  const json = await res.json();
  if (json.errors?.length) {
    console.error(`GitHub GraphQL error: ${json.errors.map((e) => e.message).join('; ')}`);
    process.exit(1);
  }
  const cal = json.data?.user?.contributionsCollection?.contributionCalendar;
  if (!cal) {
    console.error(`No contribution calendar returned for "${login}".`);
    process.exit(1);
  }
  return cal;
}

/** Synthetic but plausible year: weekday bias, streaks, quiet stretches. */
function demoCalendar() {
  let seed = 20260806 >>> 0; // mulberry32 — deterministic, integer-safe
  const rnd = () => {
    seed = (seed + 0x6d2b79f5) >>> 0;
    let t = seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const today = new Date();
  const end = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  const startSunday = new Date(end);
  startSunday.setUTCDate(startSunday.getUTCDate() - end.getUTCDay() - 52 * 7);

  const weeks = [];
  let total = 0;
  let heat = 0.6;
  for (let w = 0; w < 53; w++) {
    heat = Math.min(1, Math.max(0.22, heat + (rnd() - 0.46) * 0.3));
    const days = [];
    for (let d = 0; d < 7; d++) {
      const date = new Date(startSunday);
      date.setUTCDate(date.getUTCDate() + w * 7 + d);
      if (date > end) break;
      const weekend = d === 0 || d === 6;
      const chance = heat * (weekend ? 0.55 : 1.05);
      let count = 0;
      if (rnd() < chance) count = 1 + Math.floor(rnd() * rnd() * 22 * heat);
      total += count;
      days.push({ date: date.toISOString().slice(0, 10), contributionCount: count, weekday: d });
    }
    weeks.push({ firstDay: days[0]?.date ?? null, contributionDays: days });
  }
  return { totalContributions: total, weeks };
}

/* ------------------------------------------------------------------ layout */

const cx = (col) => PAD + col * PITCH;
const cy = (row) => GY + row * PITCH;
const mid = (v) => v + CELL / 2;
const num = (v) => String(Math.round(v * 10) / 10); // 1dp keeps the path data small
const commas = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
const MON = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

/** Serpentine sweep: down column 0, right, up column 1, right, ... Never jumps. */
function route(cols, ox = 0, oy = 0) {
  const top = mid(cy(0)) - oy;
  const bot = mid(cy(ROWS - 1)) - oy;
  const pts = [];
  for (let c = 0; c < cols; c++) {
    const x = mid(cx(c)) - ox;
    pts.push([x, c % 2 === 0 ? top : bot], [x, c % 2 === 0 ? bot : top]);
  }
  // V/H shorthand keeps the path (emitted twice) small
  let d = `M${num(pts[0][0])},${num(pts[0][1])}`;
  let len = 0;
  for (let i = 1; i < pts.length; i++) {
    const [px, py] = pts[i - 1];
    const [x, y] = pts[i];
    d += x === px ? `V${num(y)}` : `H${num(x)}`;
    len += Math.abs(x - px) + Math.abs(y - py);
  }
  return { d, len, start: pts[0], end: pts[pts.length - 1] };
}

/* --------------------------------------------------------------------- svg */

function build(cal) {
  const weeks = cal.weeks;
  const cols = weeks.length;
  const gridW = cols * PITCH - (PITCH - CELL);
  const gridH = ROWS * PITCH - (PITCH - CELL);
  const W = PAD * 2 + gridW;
  const H = 210;

  // ----- cells
  const cells = [];
  let pellets = 0;
  let total = 0;
  weeks.forEach((w, col) => {
    for (const day of w.contributionDays) {
      const row = day.weekday ?? new Date(day.date + 'T00:00:00Z').getUTCDay();
      const n = day.contributionCount | 0;
      total += n;
      if (n > 0) pellets++;
      cells.push({ col, row, n, date: day.date });
    }
  });
  const score = cal.totalContributions ?? total;

  // Scale the ramp off the 90th percentile of ACTIVE days, never off the max: one
  // 120-commit day (a merge, a scripted import) divided by 4 pushes every ordinary
  // day down to level 1 and flattens the whole year into one near-invisible tone.
  const active = cells
    .filter((c) => c.n > 0)
    .map((c) => c.n)
    .sort((a, b) => a - b);
  const top = Math.max(4, active[Math.floor(0.9 * (active.length - 1))] ?? 0);
  const level = (n) => (n <= 0 ? 0 : Math.min(4, Math.max(1, Math.ceil((n / top) * 4))));
  const SIZE = [0, 5, 7, 9, 12];

  // ----- route (page space + origin-relative copy for animateMotion)
  const O = { x: mid(cx(0)), y: mid(cy(0)) };
  const page = route(cols);
  const rel = route(cols, O.x, O.y);
  const steps = cols * (ROWS - 1) + (cols - 1);

  // ----- pellets + empty dots
  const dots = [];
  const pel = [];
  for (const cell of cells) {
    const x = cx(cell.col);
    const y = cy(cell.row);
    if (cell.n <= 0) {
      dots.push(`<rect x="${x + 5}" y="${y + 5}" width="2" height="2"/>`);
    } else {
      const s = SIZE[level(cell.n)];
      const o = (CELL - s) / 2;
      pel.push(
        `<rect x="${num(x + o)}" y="${num(y + o)}" width="${s}" height="${s}" fill="${
          RAMP[level(cell.n) - 1]
        }"/>`
      );
    }
  }

  // ----- month ticks
  const months = [];
  let prevMonth = -1;
  let lastCol = -9;
  weeks.forEach((w, col) => {
    const first = w.firstDay || w.contributionDays[0]?.date;
    if (!first) return;
    const m = new Date(first + 'T00:00:00Z').getUTCMonth();
    if (m !== prevMonth) {
      prevMonth = m;
      if (col - lastCol >= 3 && cx(col) + 22 <= PAD + gridW) {
        lastCol = col;
        months.push(
          `<text x="${cx(col)}" y="68">${MON[m]}</text>`
        );
      }
    }
  });

  // ----- pac-man wedge (authored at the origin so rotate="auto" works, and so a
  //       renderer that ignores SMIL still draws it on the first cell)
  const wedge = (deg) => {
    const a = (deg * Math.PI) / 180;
    const x = num(PAC_R * Math.cos(a));
    const y = num(PAC_R * Math.sin(a));
    return `M0,0L${x},-${y}A${PAC_R},${PAC_R} 0 1 0 ${x},${y}Z`;
  };
  const OPEN = wedge(43);
  const SHUT = wedge(5);

  // ----- BIOS line
  const bios = `&gt; scan grid=${cols}x${ROWS} days=${cells.length} pellets=${pellets} route=${steps} loop=${LOOP}s`;
  const stamp = new Date().toISOString().slice(0, 10);
  const foot = `github.com/${LOGIN}  |  LAST 12 MONTHS  |  UPDATED ${stamp}`;

  // ----- legend
  const legW = 93;
  const legX = W - PAD - legW;
  const legend =
    `<text x="${legX}" y="194" font-size="8" fill="${C.dim}" opacity=".8">LESS</text>` +
    RAMP.map(
      (c, i) => `<rect x="${legX + 26 + i * 11}" y="187" width="8" height="8" fill="${c}"/>`
    ).join('') +
    `<text x="${W - PAD}" y="194" font-size="8" fill="${C.dim}" opacity=".8" text-anchor="end">MORE</text>`;

  // ----- corner bezel ticks
  const tick = (x, y, dx, dy) =>
    `<path d="M${x + dx * 9},${y}H${x}V${y + dy * 9}"/>`;
  const corners =
    `<g fill="none" stroke="${C.crimson}" stroke-width="1" opacity=".45">` +
    tick(6, 6, 1, 1) +
    tick(W - 6, 6, -1, 1) +
    tick(6, H - 6, 1, -1) +
    tick(W - 6, H - 6, -1, -1) +
    '</g>';

  const scoreStr = `SCORE ${score}`;
  const scoreX = W - PAD - pixelWidth(scoreStr, 2);

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${num(-O.x)} ${num(
    -O.y
  )} ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Pac-Man eating ${
    LOGIN
  }'s GitHub contributions">
<title>PAC-MAN / ${LOGIN} contribution grid</title>
<desc>${score} contributions in the last 12 months. A Pac-Man sweeps the ${cols}x${ROWS} grid column by column and eats every contribution it passes. ${LOOP}s loop.</desc>
<style>
text{font-family:${MONO};letter-spacing:.4px}
.eat{animation:eat ${LOOP}s linear infinite}
@keyframes eat{from{stroke-dashoffset:${num(page.len)}}to{stroke-dashoffset:0}}
.still{display:none}
@media (prefers-reduced-motion:reduce){.live{display:none}.still{display:inline}}
</style>
<defs>
<g id="pellets">${pel.join('')}</g>
<pattern id="scan" width="4" height="3" patternUnits="userSpaceOnUse"><rect width="4" height="1" fill="#000" opacity=".55"/></pattern>
<radialGradient id="vig" cx="50%" cy="50%" r="72%"><stop offset="55%" stop-color="#000" stop-opacity="0"/><stop offset="100%" stop-color="#000" stop-opacity=".45"/></radialGradient>
<mask id="eaten" maskUnits="userSpaceOnUse" x="${PAD - PITCH}" y="${GY - PITCH}" width="${
    gridW + PITCH * 2
  }" height="${gridH + PITCH * 2}">
<rect x="${PAD - PITCH}" y="${GY - PITCH}" width="${gridW + PITCH * 2}" height="${
    gridH + PITCH * 2
  }" fill="#fff"/>
<path class="eat" d="${page.d}" fill="none" stroke="#000" stroke-width="13" stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="${num(
    page.len
  )}" stroke-dashoffset="${num(page.len)}"/>
</mask>
</defs>
<g transform="translate(${num(-O.x)},${num(-O.y)})">
<rect width="${W}" height="${H}" fill="${C.bg}"/>
<rect width="${W}" height="${H}" fill="url(#scan)"/>
${corners}
${pixelText('PAC-MAN', PAD, 18, 3, C.crimson)}
${pixelText(scoreStr, scoreX, 22, 2, C.ink, '.92')}
<text x="${PAD}" y="54" font-size="9" fill="${C.dim}">${bios}</text>
<text x="${W - PAD}" y="54" font-size="9" fill="${C.ok}" text-anchor="end">[ OK ]</text>
<g font-size="8" fill="${C.dim}" opacity=".75">${months.join('')}</g>
<g fill="${C.dot}">${dots.join('')}</g>
<g class="live" mask="url(#eaten)"><use href="#pellets"/></g>
<g class="still"><use href="#pellets"/><path fill="${C.ink}" transform="translate(${
    O.x
  },${O.y}) rotate(90)" d="${OPEN}"/></g>
<text x="${PAD}" y="194" font-size="9" fill="${C.dim}" opacity=".85">${foot}</text>
${legend}
</g>
<g class="live"><path fill="${C.ink}" d="${OPEN}"><animate attributeName="d" values="${OPEN};${SHUT};${OPEN}" dur=".26s" repeatCount="indefinite"/></path><animateMotion path="${
    rel.d
  }" dur="${LOOP}s" calcMode="paced" rotate="auto" repeatCount="indefinite"/></g>
<g transform="translate(${num(-O.x)},${num(-O.y)})">
<rect width="${W}" height="${H}" fill="url(#vig)"/>
<rect x=".5" y=".5" width="${W - 1}" height="${H - 1}" fill="none" stroke="${C.frame}"/>
</g>
</svg>
`;

  return { svg, cols, cells: cells.length, pellets, score, steps, len: page.len, W, H };
}

/* -------------------------------------------------------------------- main */

const cal = DEMO ? demoCalendar() : await fetchCalendar(LOGIN);
const r = build(cal);
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, r.svg);
const bytes = Buffer.byteLength(r.svg);

console.log(`pacman-graph  ${DEMO ? 'DEMO (synthetic data, no network)' : `live @${LOGIN}`}`);
console.log(`  grid      ${r.cols} x ${ROWS}  (${r.W}x${r.H}px)`);
console.log(`  cells     ${r.cells}`);
console.log(`  pellets   ${r.pellets}  (contribution days eaten this loop)`);
console.log(`  score     ${commas(r.score)} contributions`);
console.log(`  route     ${r.steps} steps / ${r.len}px, ${LOOP}s loop`);
console.log(`  bytes     ${bytes} (${(bytes / 1024).toFixed(1)} KiB)`);
console.log(`  wrote     ${OUT}`);
