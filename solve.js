// Fast drop-in for makefun-diff 1.0.0: returns make.fun's own patch of { old, new }
// as one JSON string, exactly as the reference does, but with Myers's search run
// over interned line ids (integer compares) instead of string compares, and with
// the search state kept in flat Int32Array rows instead of per-point path objects.
//
// Lines: a text is cut after every "\n" only; a last line with no "\n" is a line
// too; two lines are equal only when the same code units, newline included.
// Edit script: longest common prefix kept, then longest common suffix of what
// is left; between them Myers's greedy search from the first lines, keeping on
// each diagonal the path furthest into the old text, deletion preferred over
// insertion on a tie, never past either text's end, no edge-diagonal pruning,
// following every run of equal lines as far as it goes; first path to reach
// both ends wins. Patch: header "makefun-diff/1 old=N new=M hunks=H
// deleted=D inserted=I", then per hunk "@ os ol ns nl" and one line per covered
// line ("= kept", "- deleted", "+ inserted"); each change run lists deletions
// before insertions and shows up to 3 kept lines before/after; two runs at
// most 6 kept lines apart share a hunk. A line ending its text with no newline
// is written with one and followed by a line "%". Identical texts: header alone.

const KEEP = 0;
const DELETE = 1;
const INSERT = 2;
const CONTEXT = 3;

/** Split a text into lines, each keeping its "\n" except a final line without one. */
function tokenize(text) {
  const lines = [];
  let start = 0;
  for (;;) {
    const nl = text.indexOf('\n', start);
    if (nl < 0) break;
    lines.push(text.slice(start, nl + 1));
    start = nl + 1;
  }
  if (start < text.length) lines.push(text.slice(start));
  return lines;
}

/**
 * Myers's greedy search over the trimmed middle (a[aOff .. aOff+n), b[bOff .. bOff+m))
 * as id arrays. Returns the merged edit runs [{ kind, count }] in order, where
 * kind is KEEP / DELETE / INSERT. The forward rule and the backtrack use the
 * same tie-break: deletion wins when its candidate x is >= the insertion's.
 */
function myersRuns(a, aOff, n, b, bOff, m) {
  if (n === 0) return m === 0 ? [] : [{ kind: INSERT, count: m }];
  if (m === 0) return [{ kind: DELETE, count: n }];

  // rows[d] is an Int32Array of length 2d+1; rows[d][k + d] is the x (old lines
  // consumed) reached on diagonal k after d edits and its snake, or -1 when
  // that diagonal was unreachable at that d.
  const rows = [];
  let x = 0;
  let y = 0;
  while (x < n && y < m && a[aOff + x] === b[bOff + y]) { x++; y++; }
  const row0 = new Int32Array(1);
  row0[0] = x;
  rows.push(row0);
  if (x >= n && y >= m) return [{ kind: KEEP, count: x }];

  let D = -1;
  let finalK = 0;
  outer: for (let d = 1; d <= n + m; d++) {
    const row = new Int32Array(2 * d + 1);
    row.fill(-1);
    const prev = rows[d - 1];
    // prev index of diagonal k-1 is (k-1)+(d-1) = k+d-2; of k+1 is k+d.
    // Both advance by 2 as k advances by 2. delIdx is in range exactly when
    // k > -d and insIdx exactly when k < d (the other end is always in range).
    let delIdx = -2;
    let insIdx = 0;
    let rowIdx = 0;
    for (let k = -d; k <= d; k += 2, delIdx += 2, insIdx += 2, rowIdx += 2) {
      let delX = -1;
      let insX = -1;
      if (k > -d) {
        const pv = prev[delIdx];
        if (pv >= 0 && pv < n) delX = pv + 1;
      }
      if (k < d) {
        const pv = prev[insIdx];
        if (pv >= 0 && pv - (k + 1) < m) insX = pv;
      }
      if (delX < 0 && insX < 0) continue;
      x = delX >= insX ? delX : insX;
      y = x - k;
      while (x < n && y < m && a[aOff + x] === b[bOff + y]) { x++; y++; }
      row[rowIdx] = x;
      if (x >= n && y >= m) { D = d; finalK = k; break outer; }
    }
    rows.push(row);
  }
  if (D < 0) throw new Error('diff: the search ended without reaching both ends');

  // Backtrack from (D, finalK, x = n). Reversed steps, one entry per edit or
  // snake run; reversed and merged at the end.
  const rev = [];
  let k = finalK;
  x = n;
  for (let d = D; d >= 1; d--) {
    const prev = rows[d - 1];
    let delX = -1;
    let insX = -1;
    const delIdx = k + d - 2;
    const insIdx = k + d;
    if (delIdx >= 0 && delIdx < prev.length) {
      const pv = prev[delIdx];
      if (pv >= 0 && pv < n) delX = pv + 1;
    }
    if (insIdx >= 0 && insIdx < prev.length) {
      const pv = prev[insIdx];
      if (pv >= 0 && pv - (k + 1) < m) insX = pv;
    }
    const isDel = delX >= insX;
    const pre = isDel ? delX : insX;
    if (x - pre > 0) rev.push({ kind: KEEP, count: x - pre });
    rev.push({ kind: isDel ? DELETE : INSERT, count: 1 });
    k = isDel ? k - 1 : k + 1;
    x = prev[k + (d - 1)];
  }
  if (x > 0) rev.push({ kind: KEEP, count: x });

  const runs = [];
  for (let i = rev.length - 1; i >= 0; i--) {
    const r = rev[i];
    const last = runs[runs.length - 1];
    if (last !== undefined && last.kind === r.kind) last.count += r.count;
    else runs.push({ kind: r.kind, count: r.count });
  }
  return runs;
}

/** A line as the patch writes it: its op, the line, a newline, and "%" on a line of its own when it had none. */
function written(op, line) {
  return line.endsWith('\n') ? op + line : op + line + '\n%\n';
}

/** makefun-diff 1.0.0's answer for one case's input { old, new }. */
export function run(input) {
  if (input === null || typeof input !== 'object' || typeof input.old !== 'string' || typeof input.new !== 'string') {
    throw new TypeError('diff: the input is { old, new }, two strings');
  }
  // Intern lines to integer ids with one map per call, shared for old+new,
  // so equal lines get equal ids and every Myers compare is an int compare.
  const ids = new Map();
  const intern = (text) => {
    const lines = tokenize(text);
    const arr = new Uint32Array(lines.length);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      let id = ids.get(line);
      if (id === undefined) { id = ids.size; ids.set(line, id); }
      arr[i] = id;
    }
    return { lines, arr };
  };
  const oldT = intern(input.old);
  const newT = intern(input.new);
  const a = oldT.lines;
  const bb = newT.lines;
  const ai = oldT.arr;
  const bi = newT.arr;
  const n = a.length;
  const m = bb.length;

  // Common prefix, then common suffix of what is left.
  let prefix = 0;
  while (prefix < n && prefix < m && ai[prefix] === bi[prefix]) prefix++;
  let suffix = 0;
  while (suffix < n - prefix && suffix < m - prefix && ai[n - 1 - suffix] === bi[m - 1 - suffix]) suffix++;

  const runs = [];
  const pushRun = (kind, count) => {
    if (count <= 0) return;
    const last = runs[runs.length - 1];
    if (last !== undefined && last.kind === kind) last.count += count;
    else runs.push({ kind, count });
  };
  pushRun(KEEP, prefix);
  for (const r of myersRuns(ai, prefix, n - prefix - suffix, bi, prefix, m - prefix - suffix)) pushRun(r.kind, r.count);
  pushRun(KEEP, suffix);

  // Change runs: each a stretch of deletions and insertions between two kept
  // lines, at old line o and new line p.
  const changes = [];
  let o = 0;
  let p = 0;
  let deleted = 0;
  let inserted = 0;
  for (const r of runs) {
    if (r.kind === KEEP) { o += r.count; p += r.count; continue; }
    let c = changes[changes.length - 1];
    if (c === undefined || c.o + c.dels !== o || c.p + c.ins !== p) {
      c = { o, p, dels: 0, ins: 0 };
      changes.push(c);
    }
    if (r.kind === DELETE) { c.dels += r.count; o += r.count; deleted += r.count; }
    else { c.ins += r.count; p += r.count; inserted += r.count; }
  }

  // Hunks: change runs at most 2 * CONTEXT kept lines apart share one.
  const hunks = [];
  for (const c of changes) {
    const h = hunks[hunks.length - 1];
    const prev = h !== undefined ? h[h.length - 1] : undefined;
    if (prev !== undefined && c.o - (prev.o + prev.dels) <= 2 * CONTEXT) h.push(c);
    else hunks.push([c]);
  }

  const out = [`makefun-diff/1 old=${n} new=${m} hunks=${hunks.length} deleted=${deleted} inserted=${inserted}\n`];
  for (const h of hunks) {
    const first = h[0];
    const last = h[h.length - 1];
    const oldStart = Math.max(0, first.o - CONTEXT);
    const newStart = first.p - (first.o - oldStart);
    const after = Math.min(CONTEXT, n - (last.o + last.dels));
    const oldEnd = last.o + last.dels + after;
    const newEnd = last.p + last.ins + after;
    out.push(`@ ${oldStart + 1} ${oldEnd - oldStart} ${newStart + 1} ${newEnd - newStart}\n`);
    let at = oldStart;
    for (const c of h) {
      for (; at < c.o; at++) out.push(written('=', a[at]));
      for (let i = 0; i < c.dels; i++) out.push(written('-', a[c.o + i]));
      for (let i = 0; i < c.ins; i++) out.push(written('+', bb[c.p + i]));
      at = c.o + c.dels;
    }
    for (; at < oldEnd; at++) out.push(written('=', a[at]));
  }
  return out.join('');
}
