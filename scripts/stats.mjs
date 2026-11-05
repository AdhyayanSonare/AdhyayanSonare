// Builds the GitHub stats cards from real data. No dependencies, no third-party service.
// Run by .github/workflows/stats.yml. Local test: STATS_FIXTURE=fixture.json node scripts/stats.mjs
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const fonts = JSON.parse(readFileSync(join(here, "fonts.json"), "utf8"));
const LOGIN = "AdhyayanSonare";

const QUERY = `query($login:String!){user(login:$login){
  contributionsCollection{contributionCalendar{totalContributions weeks{contributionDays{date contributionCount}}}}
  repositories(first:100,ownerAffiliations:OWNER,privacy:PUBLIC){totalCount nodes{isFork languages(first:12,orderBy:{field:SIZE,direction:DESC}){edges{size node{name}}}}}
}}`;

async function load() {
  if (process.env.STATS_FIXTURE) return JSON.parse(readFileSync(process.env.STATS_FIXTURE, "utf8"));
  const res = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: { Authorization: `bearer ${process.env.GH_TOKEN}`, "Content-Type": "application/json", "User-Agent": LOGIN },
    body: JSON.stringify({ query: QUERY, variables: { login: LOGIN } }),
  });
  const json = await res.json();
  if (!res.ok || json.errors) throw new Error(JSON.stringify(json.errors ?? res.status));
  return json.data.user;
}

function summarise(u) {
  const cal = u.contributionsCollection.contributionCalendar;
  const days = cal.weeks.flatMap((w) => w.contributionDays);
  let streak = 0, best = 0;
  for (const d of days) { streak = d.contributionCount ? streak + 1 : 0; best = Math.max(best, streak); }
  const bytes = {};
  for (const r of u.repositories.nodes) {
    if (r.isFork) continue;
    for (const e of r.languages.edges) bytes[e.node.name] = (bytes[e.node.name] ?? 0) + e.size;
  }
  const months = new Map();
  for (const d of days) { const k = d.date.slice(0, 7); months.set(k, (months.get(k) ?? 0) + d.contributionCount); }
  const total = Object.values(bytes).reduce((a, b) => a + b, 0) || 1;
  const sorted = Object.entries(bytes).sort((a, b) => b[1] - a[1]);
  const top = sorted.slice(0, 4).map(([name, b]) => ({ name, pct: (b / total) * 100 }));
  const rest = sorted.slice(4).reduce((a, [, b]) => a + b, 0);
  if (rest) top.push({ name: "Other", pct: (rest / total) * 100 });
  return { contributions: cal.totalContributions, active: days.filter((d) => d.contributionCount).length, streak: best, repos: u.repositories.totalCount, langs: top, months: [...months].slice(0, -1) };
}

const THEME = {
  dark: { bg: "#05070B", line: "#1D2730", fg: "#F4FAFB", mute: "#9DB4BC", ramp: ["#BFE9F2", "#6CC6DA", "#3C97B1", "#27677F", "#4A5A63"] },
  light: { bg: "#F4F8FA", line: "#D5E0E5", fg: "#05070B", mute: "#4C626B", ramp: ["#0B4F63", "#0F7E99", "#35A4BF", "#5A9AAC", "#7E8E96"] },
};

function card(s, name, mobile) {
  const t = THEME[name], W = mobile ? 640 : 1280, H = mobile ? 1070 : 672;
  const m = 56, o = [];
  const text = (x, y, str, font, size, fill, extra = "") => o.push(`<text x="${x.toFixed(1)}" y="${y}" font-family="${font}" font-size="${size}" fill="${fill}" ${extra}>${str}</text>`);
  const stats = [[s.contributions, "CONTRIBUTIONS"], [s.active, "ACTIVE DAYS"], [s.streak, "BEST STREAK"], [s.repos, "PUBLIC REPOS"]];
  const cols = mobile ? 2 : 4, cw = (W - m * 2) / cols;
  stats.forEach(([v, k], i) => {
    const x = m + (i % cols) * cw, y = (mobile ? 150 : 150) + Math.floor(i / cols) * 200;
    text(x - 3, y, v, "disp", mobile ? 124 : 116, t.fg);
    text(x, y + 42, k, "mono", mobile ? 20 : 18, t.mute, 'letter-spacing="2.4"');
  });
  // the year as a wave: a smooth curve through each month's total
  const wy = mobile ? 508 : 262, wh = mobile ? 200 : 180, wx = m, ww = W - m * 2;
  text(m, wy, "ACTIVITY BY MONTH", "mono", mobile ? 20 : 18, t.mute, 'letter-spacing="2.4"');
  const peak = Math.max(1, ...s.months.map(([, v]) => v));
  const pts = s.months.map(([, v], i) => [wx + (i / (s.months.length - 1)) * ww, wy + 24 + wh - 8 - (Math.sqrt(v / peak)) * (wh - 22)]);
  let d = `M${pts[0][0].toFixed(1)} ${pts[0][1].toFixed(1)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[Math.max(i - 1, 0)], b = pts[i], c = pts[i + 1], e = pts[Math.min(i + 2, pts.length - 1)];
    const c1 = [b[0] + (c[0] - a[0]) / 6, Math.min(wy + 24 + wh - 8, b[1] + (c[1] - a[1]) / 6)], c2 = [c[0] - (e[0] - b[0]) / 6, Math.min(wy + 24 + wh - 8, c[1] - (e[1] - b[1]) / 6)];
    d += `C${c1[0].toFixed(1)} ${c1[1].toFixed(1)} ${c2[0].toFixed(1)} ${c2[1].toFixed(1)} ${c[0].toFixed(1)} ${c[1].toFixed(1)}`;
  }
  const base = wy + 24 + wh;
  o.push(`<linearGradient id="w" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${t.ramp[1]}" stop-opacity=".42"/><stop offset="1" stop-color="${t.ramp[1]}" stop-opacity="0"/></linearGradient>`);
  o.push(`<path d="${d}L${wx + ww} ${base}L${wx} ${base}Z" fill="url(#w)"/><path d="${d}" fill="none" stroke="${t.ramp[1]}" stroke-width="2.4" stroke-linecap="round"/>`);
  const every = mobile ? 3 : 1, names = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
  s.months.forEach(([k], i) => { if ((i % every) || (i === s.months.length - 1 && s.months.length > 12)) return; text(pts[i][0], base + 28, names[+k.slice(5) - 1], "mono", mobile ? 17 : 16, t.mute, `text-anchor="${i === 0 ? "start" : "middle"}" letter-spacing="1.4"`); });
  const by = mobile ? 816 : 540;
  text(m, by, "LANGUAGES IN PUBLIC CODE", "mono", mobile ? 20 : 18, t.mute, 'letter-spacing="2.4"');
  const bw = W - m * 2; let x = m;
  o.push(`<clipPath id="b"><rect x="${m}" y="${by + 22}" width="${bw}" height="12" rx="6"/></clipPath><g clip-path="url(#b)">`);
  s.langs.forEach((l, i) => { const w = (l.pct / 100) * bw; o.push(`<rect x="${x.toFixed(1)}" y="${by + 22}" width="${w.toFixed(1)}" height="12" fill="${t.ramp[i]}"/>`); x += w; });
  o.push("</g>");
  const lc = mobile ? 2 : s.langs.length, lw = bw / lc;
  s.langs.forEach((l, i) => {
    const lx = m + (i % lc) * lw, ly = by + 76 + Math.floor(i / lc) * 46;
    o.push(`<circle cx="${lx + 7}" cy="${ly - 9}" r="7" fill="${t.ramp[i]}"/>`);
    text(lx + 24, ly, `${l.name.replace("Jupyter Notebook", "Jupyter")} ${l.pct < 1 ? l.pct.toFixed(1) : Math.round(l.pct)}%`, "sans", mobile ? 25 : 20, t.fg);
  });
  const faces = Object.entries(fonts).map(([k, v]) => `@font-face{font-family:${k};src:url(data:font/woff;base64,${v})}`).join("");
  const alt = `GitHub stats. ${s.contributions} contributions, ${s.active} active days, best streak ${s.streak} days, ${s.repos} public repositories. Languages: ${s.langs.map((l) => `${l.name} ${Math.round(l.pct)} percent`).join(", ")}.`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${alt}"><title>${alt}</title><defs><style>${faces}text{font-feature-settings:"lnum"}</style></defs><rect x=".75" y=".75" width="${W - 1.5}" height="${H - 1.5}" rx="22" fill="${t.bg}" stroke="${t.line}" stroke-width="1.5"/>${o.join("")}</svg>`;
}

const s = summarise(await load());
if (s.months.length < 2 || !s.langs.length) throw new Error("incomplete data");
console.log(JSON.stringify(s));
const dir = join(here, "..", "assets");
mkdirSync(dir, { recursive: true });
for (const name of ["dark", "light"]) {
  writeFileSync(join(dir, `stats-${name}.svg`), card(s, name, false));
  writeFileSync(join(dir, `stats-${name}-m.svg`), card(s, name, true));
}
