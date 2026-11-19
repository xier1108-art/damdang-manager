'use strict';
/* 담당사업 관리 — 화면 로직 */

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ICON = {
  chev: '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="m6 9 6 6 6-6"/></svg>',
  x: '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg>',
  plus: '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
  copy: '<svg aria-hidden="true" viewBox="0 0 24 24"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>',
  trash: '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/></svg>',
  doc: '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6M9 13h6M9 17h4"/></svg>',
  link: '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M10 14a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1"/><path d="M14 10a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1"/></svg>',
  up: '<svg aria-hidden="true" viewBox="0 0 24 24" style="width:12px;height:12px"><path d="m6 15 6-6 6 6"/></svg>',
  down: '<svg aria-hidden="true" viewBox="0 0 24 24" style="width:12px;height:12px"><path d="m6 9 6 6 6-6"/></svg>',
};

const SCHOOL_COLORS = {
  '북가좌초': ['#2F6FDB', '#E8F0FD', '#1F4FA8'], '갈현초': ['#1F9D55', '#E7F6EC', '#11692F'], '중동초': ['#E07B1A', '#FDF0E2', '#8A3B06'],
  '고은초': ['#C9A200', '#FBF5D9', '#6F5800'], '수색초': ['#8B5CF6', '#F1ECFE', '#5B32B8'], '은평고': ['#D6409F', '#FCEAF4', '#99236D'],
  '상암중': ['#8D6748', '#F3ECE5', '#5E4128'], '*미지정': ['#D64545', '#FDECEC', '#A61B1B'], '은평초': ['#7A808C', '#EEF0F2', '#4B5260'], '연천중': ['#475467', '#EEF0F3', '#343A46'],
};
const PALETTE = [['#0E9384', '#E1F5F2', '#08665C'], ['#DD2590', '#FCE7F3', '#9E1A66'], ['#6172F3', '#EEF0FE', '#3B48B5'], ['#B54708', '#FEF0DF', '#8A3B06']];
// 노션 선택 태그 색 — [기본, 밝은 배경, 글자]. 다크 모드 배경·글자는 CSS가 기본색에서 만든다
const CAT_COLORS = {
  '공사': ['#D44C47', '#FFE2DD', '#5D1715'], '설계': ['#337EA9', '#D3E5EF', '#183347'], '건설사업관리': ['#9065B0', '#E8DEEE', '#412454'], '모듈러': ['#CB912F', '#FDECC8', '#402C1B'],
  '감리': ['#C14C8A', '#F5E0E9', '#4C2337'], '관급자재': ['#D9730D', '#FADEC9', '#49290E'], '폐기물': ['#9F6B53', '#EEE0DA', '#442A1E'], '기타용역': ['#787774', '#E3E2E0', '#32302C'],
};
const NOTION_EXTRA = [['#448361', '#DBEDDB', '#1C3829'], ['#337EA9', '#D3E5EF', '#183347'], ['#9065B0', '#E8DEEE', '#412454'], ['#CB912F', '#FDECC8', '#402C1B']];
function catColor(name) {
  if (CAT_COLORS[name]) return CAT_COLORS[name];
  const i = Math.max(0, data.options.categories.indexOf(name));
  return NOTION_EXTRA[i % NOTION_EXTRA.length];
}
const tintVars = (c) => `--c:${c[0]};--t:${c[1]};--k:${c[2]}`;
const STATUS_ORDER = { '진행': 0, '중지': 1, '완료': 2 };

let data = null;
const ui = {
  view: 'list', school: '__all', status: '전체', cat: '전체', q: '', kpi: null,
  expandAll: false, expanded: new Set(), sel: null, sort: { key: null, dir: 1 }, activeOnly: true,
  colW: {}, calMonth: null, calMore: null, collapsed: new Set(), calSide: true, calShowContracts: true, calEdit: null,
};
// 목록 열(키, 이름) — 너비 조정 기준
const COLS = ['title', 'category', 'status', 'contractor', 'amount', 'contractDate', 'startDate', 'endDate', 'dday'];
let info = {};

// ---------- 날짜 ----------
const DAY = 86400000;
function todayStr() { const d = new Date(); return ymd(d); }
function ymd(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
function parseD(s) { if (!s) return null; const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); }
function diffDays(a, b) { return Math.round((parseD(a) - parseD(b)) / DAY); }
function shortD(s) { return s ? s.slice(2).replace(/-/g, '.') : '—'; }

// ---------- 숫자 ----------
const fmt = (n) => (n || n === 0) ? Number(n).toLocaleString('ko-KR') : '';
function eok(n) {
  if (!n) return '0';
  const e = n / 1e8;
  if (e >= 100) return e.toLocaleString('ko-KR', { maximumFractionDigits: 1 });
  if (e >= 1) return e.toLocaleString('ko-KR', { maximumFractionDigits: 2 });
  return null;
}
function korMoney(n) {
  n = Math.round(n || 0);
  if (n >= 1e8) {
    const e = Math.floor(n / 1e8), m = Math.floor((n % 1e8) / 1e4);
    return `${e.toLocaleString('ko-KR')}억${m ? ' ' + m.toLocaleString('ko-KR') + '만' : ''}원`;
  }
  if (n >= 1e4) return `${Math.floor(n / 1e4).toLocaleString('ko-KR')}만원`;
  return `${n.toLocaleString('ko-KR')}원`;
}

// ---------- 데이터 구조 ----------
let byId = new Map(), kids = new Map();
function phaseIdx(p) { const i = data.options.phases.indexOf(p); return i < 0 ? 99 : i; }
function reindex() {
  byId = new Map(data.items.map((x) => [x.id, x]));
  kids = new Map();
  for (const x of data.items) {
    if (x.parentId && byId.has(x.parentId)) {
      if (!kids.has(x.parentId)) kids.set(x.parentId, []);
      kids.get(x.parentId).push(x);
    }
  }
  for (const arr of kids.values()) arr.sort((a, b) => phaseIdx(a.phase) - phaseIdx(b.phase) || (a.startDate || '').localeCompare(b.startDate || ''));
}
const isTop = (x) => !x.parentId || !byId.has(x.parentId);
const childrenOf = (x) => kids.get(x.id) || [];
function schoolColor(name) {
  if (SCHOOL_COLORS[name]) return SCHOOL_COLORS[name];
  const i = Math.max(0, data.options.schools.indexOf(name));
  return PALETTE[i % PALETTE.length];
}
function newId() { return 'l' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }

// ---------- 저장 ----------
let saveTimer = null, saving = false, pending = false;
function setSaveState(html, err) { const el = $('#saveState'); el.innerHTML = html; el.className = err ? 'err' : ''; }
function scheduleSave() {
  setSaveState('변경 사항 저장 중…');
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, 450);
  gcalSchedule();
}
async function saveNow() {
  if (saving) { pending = true; return; }
  saving = true;
  try {
    const r = await fetch('api/data', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
    if (!r.ok) throw new Error(await r.text());
    const t = new Date();
    setSaveState(`자동 저장됨 · ${t.toLocaleTimeString('ko-KR', { hour: 'numeric', minute: '2-digit' })}`);
  } catch (e) {
    setSaveState('저장 실패 — ' + esc(e.message || e), true);
  } finally {
    saving = false;
    if (pending) { pending = false; saveNow(); }
  }
}
function touch(item) { item.updatedAt = new Date().toISOString(); }

// ---------- 필터 ----------
function inSchool(x) { return ui.school === '__all' || x.school === ui.school; }
function textHit(x, q) {
  if (!q) return true;
  const hay = [x.title, x.name, x.contractor, x.no, x.bizno, x.note, x.contact, x.category].join('\n').toLowerCase();
  return q.split(/\s+/).filter(Boolean).every((t) => hay.includes(t));
}
function isLate(x) { return x.status === '진행' && x.endDate && x.endDate < todayStr(); }
function isSoon(x) { if (x.status !== '진행' || !x.endDate) return false; const d = diffDays(x.endDate, todayStr()); return d >= 0 && d <= 30; }
function matchSelf(x) {
  if (!inSchool(x)) return false;
  if (ui.status !== '전체' && x.status !== ui.status) return false;
  if (ui.cat !== '전체' && x.category !== ui.cat) return false;
  if (ui.kpi === 'late' && !isLate(x)) return false;
  if (ui.kpi === 'soon' && !isSoon(x)) return false;
  return textHit(x, ui.q.trim().toLowerCase());
}
const filtering = () => ui.status !== '전체' || ui.cat !== '전체' || ui.q.trim() || ui.kpi;

function sortTop(arr) {
  const k = ui.sort.key, d = ui.sort.dir;
  const cmpDefault = (a, b) => (STATUS_ORDER[a.status] ?? 9) - (STATUS_ORDER[b.status] ?? 9)
    || (b.phase === '총괄') - (a.phase === '총괄')
    || (a.endDate || '9999').localeCompare(b.endDate || '9999') || a.title.localeCompare(b.title, 'ko');
  const cmp = {
    title: (a, b) => a.title.localeCompare(b.title, 'ko'),
    category: (a, b) => data.options.categories.indexOf(a.category) - data.options.categories.indexOf(b.category),
    status: (a, b) => (STATUS_ORDER[a.status] ?? 9) - (STATUS_ORDER[b.status] ?? 9),
    amount: (a, b) => (a.amount || 0) - (b.amount || 0),
    endDate: (a, b) => (a.endDate || '9999').localeCompare(b.endDate || '9999'),
    contractDate: (a, b) => (a.contractDate || '9999').localeCompare(b.contractDate || '9999'),
    startDate: (a, b) => (a.startDate || '9999').localeCompare(b.startDate || '9999'),
  }[k];
  return arr.sort((a, b) => (cmp ? cmp(a, b) * d : 0) || cmpDefault(a, b));
}

// 화면에 보일 행: [{item, level, forced}] — 그룹(학교)별
function visibleTree() {
  const groups = new Map();
  const tops = data.items.filter(isTop);
  for (const t of tops) {
    const ch = childrenOf(t);
    const selfHit = matchSelf(t);
    const hitKids = ch.filter(matchSelf);
    if (!selfHit && !hitKids.length) continue;
    const open = ui.expandAll || ui.expanded.has(t.id) || (!selfHit && hitKids.length > 0) || (filtering() && hitKids.length > 0);
    const showKids = filtering() ? (selfHit && !hitKids.length ? [] : hitKids) : ch;
    const g = ui.school === '__all' ? t.school : '_';
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push({ item: t, open, kids: showKids, allKids: ch, dim: !selfHit });
  }
  const order = ui.school === '__all' ? data.options.schools : ['_'];
  const res = [];
  const keys = [...groups.keys()].sort((a, b) => {
    const ia = order.indexOf(a), ib = order.indexOf(b);
    return (ia < 0 ? 999 : ia) - (ib < 0 ? 999 : ib);
  });
  for (const k of keys) {
    const arr = groups.get(k);
    const byItem = new Map(arr.map((r) => [r.item, r]));
    res.push({ school: k, rows: sortTop(arr.map((r) => r.item)).map((it) => byItem.get(it)) });
  }
  return res;
}

// ---------- 렌더: 사이드 ----------
function renderSide() {
  $$('.nav-item').forEach((b) => b.classList.toggle('on', b.dataset.view === ui.view));
  const counts = new Map();
  for (const x of data.items) counts.set(x.school, (counts.get(x.school) || 0) + 1);
  const list = [['__all', '전체', '#191C22', data.items.length]];
  for (const s of data.options.schools) if (counts.get(s) || !s.startsWith('*')) list.push([s, s, schoolColor(s)[0], counts.get(s) || 0]);
  for (const [s, c] of counts) if (!data.options.schools.includes(s)) list.push([s, s, '#7A808C', c]);
  $('#schoolNav').innerHTML = list.map(([key, nm, col, c]) =>
    `<button type="button" class="school-item${ui.school === key ? ' on' : ''}" data-school="${esc(key)}"><span class="nm"><span class="dot" style="background:${col}"></span><span>${esc(nm)}</span></span><span class="cnt">${c}</span></button>`).join('');
}

// ---------- 렌더: 상단 · KPI · 필터 ----------
function renderTop() {
  const scope = data.items.filter(inSchool);
  const tops = scope.filter(isTop);
  const sum = tops.reduce((a, x) => a + (x.amount || 0), 0);
  $('#pageTitle').textContent = ui.school === '__all' ? '전체 사업' : ui.school;
  $('#pageSub').textContent = `계약 ${scope.length}건 · 총괄 기준 ${korMoney(sum)}`;

  const act = tops.filter((x) => x.status === '진행');
  const actSum = act.reduce((a, x) => a + (x.amount || 0), 0);
  const late = scope.filter(isLate).length, soon = scope.filter(isSoon).length;
  const e = eok(actSum);
  $('#kpis').innerHTML = `
    <div class="kpi"><span>진행 중 사업 <small class="muted">(총괄 1건 집계)</small></span><strong>${act.length}<small>건</small></strong></div>
    <div class="kpi"><span>진행 계약금액 (총괄 기준)</span><strong>${e !== null ? e + '<small>억원</small>' : korMoney(actSum)}</strong></div>
    <button type="button" class="kpi soon${ui.kpi === 'soon' ? ' on' : ''}${soon ? '' : ' zero'}" data-kpi="soon" aria-pressed="${ui.kpi === 'soon'}"><span>30일 내 완수 예정</span><strong>${soon}<small>건</small></strong></button>
    <button type="button" class="kpi warn${ui.kpi === 'late' ? ' on' : ''}${late ? '' : ' zero'}" data-kpi="late" aria-pressed="${ui.kpi === 'late'}"><span>완수일 경과 · 상태 확인 필요</span><strong>${late}<small>건</small></strong></button>`;

  const sc = { '전체': scope.length };
  for (const s of data.options.statuses) sc[s] = scope.filter((x) => x.status === s).length;
  $('#statusSeg').innerHTML = ['전체', ...data.options.statuses].map((s) =>
    `<button type="button" data-status="${esc(s)}" class="${ui.status === s ? 'on' : ''}" aria-pressed="${ui.status === s}">${esc(s)} ${sc[s] ?? 0}</button>`).join('');
  $('#catSel').innerHTML = ['전체', ...data.options.categories].map((c) => `<option${ui.cat === c ? ' selected' : ''}>${esc(c)}</option>`).join('');
  $('#expandAll').checked = ui.expandAll;
  $('#activeOnly').checked = ui.activeOnly;
  $('#expandWrap').hidden = ui.view !== 'list';
  const ga = $('#grpAll');
  if (ga) {
    ga.hidden = ui.view !== 'list' || ui.school !== '__all';
    ga.textContent = visibleTree().every((g) => ui.collapsed.has(g.school)) && ui.collapsed.size ? '학교 모두 펼치기' : '학교 모두 접기';
  }
  $('#activeOnlyWrap').hidden = ui.view === 'list';
  $('#listView').hidden = ui.view !== 'list';
  $('#calendarView').hidden = ui.view !== 'calendar';
}
function renderView() {
  if (ui.view === 'list') renderList();
  else renderCalendar();
}

// ---------- 렌더: 목록 ----------
function shortContractor(s) {
  if (!s) return '';
  const lines = s.split('\n').map((l) => l.trim()).filter(Boolean);
  const first = lines[0].replace(/\s*\(\d{3}-\d{2}-\d{5}\)\s*$/, '').replace(/\s+대표\s+.*$/, '');
  return lines.length > 1 ? `${first} 외 ${lines.length - 1}` : first;
}
function hl(s) {
  const q = ui.q.trim();
  if (!q) return esc(s);
  let out = esc(s);
  for (const t of q.split(/\s+/).filter(Boolean)) {
    const re = new RegExp(esc(t).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
    out = out.replace(re, (m) => `<mark>${m}</mark>`);
  }
  return out;
}
function ddayCell(x) {
  if (x.status === '완료') return '<span class="dd done">완료</span>';
  if (x.status === '중지') return '<span class="dd done">중지</span>';
  if (!x.endDate) return '<span class="dd done">—</span>';
  const d = diffDays(x.endDate, todayStr());
  if (d < 0) return `<span class="dd late">${-d}일 경과</span>`;
  if (d === 0) return '<span class="dd soon">오늘 완수</span>';
  return `<span class="dd${d <= 30 ? ' soon' : ''}">D-${d}</span>`;
}
function rowHtml(x, level, hasKids, open) {
  const tog = hasKids
    ? `<button type="button" class="tog${open ? '' : ' closed'}" data-tog="${x.id}" aria-label="${open ? '차수 접기' : '차수 펼치기'}" aria-expanded="${open}">${ICON.chev}</button>`
    : (level ? '<span class="branch">└</span>' : '<span class="tog-sp"></span>');
  const tag = x.phase && x.phase !== '단일' ? `<span class="tag">${esc(x.phase)}</span>` : '';
  const kidsN = hasKids ? `<span class="tag n">${childrenOf(x).length}</span>` : '';
  const sel = ui.sel === x.id ? ' is-sel' : '';
  const cp = (k) => cellText(x, k) ? `<button type="button" class="cp" data-cp="${k}" aria-label="${CP_LABEL[k]} 복사" title="${CP_LABEL[k]} 복사">${ICON.copy}</button>` : '';
  return `<tr class="row${level ? ' child' : ''}${sel}" data-id="${x.id}">
    <td class="has-cp"><span class="t-title">${tog}<span class="tx">${hl(x.title || '(제목 없음)')}</span>${tag}${kidsN}</span>${cp('title')}</td>
    <td>${x.category ? `<span class="pill tint" style="${tintVars(catColor(x.category))}">${esc(x.category)}</span>` : '<span class="muted">—</span>'}</td>
    <td><span class="pill st-${esc(x.status)}">${esc(x.status)}</span></td>
    <td class="ctr has-cp" title="${esc(x.contractor)}">${hl(shortContractor(x.contractor))}${cp('contractor')}</td>
    <td class="r amt has-cp">${x.amount ? fmt(x.amount) : '<span class="muted">—</span>'}${cp('amount')}</td>
    <td class="dt has-cp">${x.contractDate || '<span class="muted">—</span>'}${cp('contractDate')}</td>
    <td class="dt col-per has-cp">${x.startDate || '<span class="muted">—</span>'}${cp('startDate')}</td>
    <td class="dt has-cp">${x.endDate || '<span class="muted">—</span>'}${cp('endDate')}</td>
    <td class="r has-cp">${ddayCell(x)}${cp('dday')}</td></tr>`;
}
// ---------- 칸 복사 ----------
const CP_LABEL = { title: '계약명', contractor: '계약자', amount: '계약금액', contractDate: '계약일', startDate: '착수일', endDate: '완수일', dday: '남은 기간' };
function cellText(x, k) {
  if (k === 'title') return String(x.name || x.title || '').trim(); // 요약명 칸은 본 계약명을 복사
  if (k === 'amount') return x.amount ? fmt(x.amount) : '';
  if (k === 'dday') { const d = document.createElement('div'); d.innerHTML = ddayCell(x); const s = d.textContent.trim(); return s === '—' ? '' : s; }
  return String(x[k] || '').trim(); // 계약자는 줄여 보이지만 전체(대표·공동, 사업자번호 포함)를 복사
}
async function copyText(s) {
  try { await navigator.clipboard.writeText(s); return true; } catch (e) { /* 아래 방식으로 */ }
  const ta = document.createElement('textarea');
  ta.value = s; ta.style.position = 'fixed'; ta.style.opacity = '0';
  document.body.appendChild(ta); ta.select();
  let ok = false; try { ok = document.execCommand('copy'); } catch (e) { /* 무시 */ }
  ta.remove();
  return ok;
}
async function copyCell(btn) {
  const x = byId.get(btn.closest('tr').dataset.id); if (!x) return;
  const k = btn.dataset.cp, s = cellText(x, k);
  if (!s) return;
  if (!(await copyText(s))) { toast('복사하지 못했습니다'); return; }
  btn.classList.add('done');
  btn.innerHTML = '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M5 12l5 5L20 7"/></svg>';
  setTimeout(() => { btn.classList.remove('done'); btn.innerHTML = ICON.copy; }, 1200);
  toast(`${CP_LABEL[k]} 복사됨 — ${s.length > 40 ? s.slice(0, 40).replace(/\n/g, ' ') + '…' : s.replace(/\n/g, ' ')}`);
}
const RZ = (col) => `<span class="col-rz" data-rz="${col}" title="끌어서 열 너비 조정 · 두 번 누르면 원래대로" aria-hidden="true"></span>`;
function th(label, key, right, cls, col) {
  const on = ui.sort.key === key;
  const ic = on ? (ui.sort.dir > 0 ? ICON.up : ICON.down) : '';
  return `<th class="${right ? 'r' : ''} ${cls || ''}" data-col="${col || key}" aria-sort="${on ? (ui.sort.dir > 0 ? 'ascending' : 'descending') : 'none'}"><button type="button" data-sort="${key}">${label}${ic}</button>${RZ(col || key)}</th>`;
}
// 조정한 열 너비가 있으면 고정 너비 표로 그린다
const colHidden = (c) => c === 'startDate' && !!ui.sel;
const hasColW = () => COLS.some((c) => ui.colW[c]);
function colgroup() {
  if (!hasColW()) return '';
  return `<colgroup>${COLS.map((c) => `<col data-colw="${c}" style="width:${ui.colW[c] || 100}px${colHidden(c) ? ';display:none' : ''}">`).join('')}</colgroup>`;
}
const colSum = () => COLS.filter((c) => !colHidden(c)).reduce((a, c) => a + (ui.colW[c] || 100), 0);
function startColResize(e) {
  const h = e.target.closest('[data-rz]'); if (!h) return;
  e.preventDefault();
  const table = h.closest('table');
  if (!hasColW()) { // 처음 조정할 때 지금 보이는 너비를 그대로 잡아 둔다
    $$('th[data-col]', table).forEach((t) => { ui.colW[t.dataset.col] = Math.round(t.getBoundingClientRect().width); });
    if (!ui.colW.startDate) ui.colW.startDate = ui.colW.endDate || 110;
    renderList();
  }
  const key = h.dataset.rz, x0 = e.clientX, w0 = ui.colW[key];
  const tbl = $('#listView table');
  document.body.classList.add('col-resizing');
  const move = (ev) => {
    ui.colW[key] = Math.max(56, Math.round(w0 + ev.clientX - x0));
    const col = $(`col[data-colw="${key}"]`, tbl); if (col) col.style.width = ui.colW[key] + 'px';
    tbl.style.width = colSum() + 'px';
  };
  const up = () => { document.body.classList.remove('col-resizing'); window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); savePrefs(); };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
}
function renderList() {
  const tree = visibleTree();
  const total = tree.reduce((a, g) => a + g.rows.length, 0);
  if (!total) {
    $('#listView').innerHTML = `<div class="empty"><strong>조건에 맞는 계약이 없습니다</strong>검색어나 필터를 바꿔 보세요.</div>`;
    return;
  }
  // 학교 묶음마다 따로 카드처럼 보이도록 tbody를 나누고 사이에 여백 행을 둔다
  let body = '';
  for (const g of tree) {
    body += '<tbody class="gap" aria-hidden="true"><tr><td colspan="9"></td></tr></tbody><tbody class="g">';
    const folded = ui.school === '__all' && ui.collapsed.has(g.school) && !ui.q.trim(); // 검색 중에는 다 펼친다
    if (ui.school === '__all') {
      const sum = g.rows.reduce((a, r) => a + (r.item.amount || 0), 0);
      body += `<tr class="grp${folded ? ' folded' : ''}"><td colspan="9"><button type="button" class="grp-tog" data-grptog="${esc(g.school)}" aria-expanded="${!folded}" title="${folded ? '펼치기' : '접기'}"><span class="gchev">${ICON.chev}</span><span class="pill tint" style="${tintVars(schoolColor(g.school))}">${esc(g.school)}</span><span class="gmeta">${g.rows.length}건 · ${korMoney(sum)}</span></button></td></tr>`;
    }
    if (!folded) for (const r of g.rows) {
      const hasKids = r.allKids.length > 0;
      body += rowHtml(r.item, 0, hasKids, r.open);
      if (r.open) for (const k of r.kids) body += rowHtml(k, 1, false, false);
    }
    body += '</tbody>';
  }
  const fixed = hasColW();
  $('#listView').innerHTML = `<table${fixed ? ` class="fixed" style="width:${colSum()}px"` : ''}>${colgroup()}<thead><tr>${th('요약명', 'title')}${th('항목', 'category')}${th('상태', 'status')}<th data-col="contractor">계약자${RZ('contractor')}</th>${th('계약금액(원)', 'amount', true)}${th('계약일', 'contractDate')}${th('착수일', 'startDate', false, 'col-per')}${th('완수일', 'endDate')}${th('남은 기간', 'endDate', true, '', 'dday')}</tr></thead>${body}</table>`;
}

// ---------- 렌더: 캘린더 (노션 캘린더 월 보기) ----------
// 구글 캘린더 '업무'와 같은 규칙: 착수일에 (착수) 요약명, 완수일에 (완수) 요약명
const WEEK = ['일', '월', '화', '수', '목', '금', '토'];
function calEvents() {
  const map = new Map();
  if (!ui.calShowContracts) return map;
  const add = (date, ev) => { if (!map.has(date)) map.set(date, []); map.get(date).push(ev); };
  for (const x of data.items) {
    if (!matchSelf(x)) continue;
    if (ui.activeOnly && x.status !== '진행') continue;
    if (x.startDate) add(x.startDate, { x, k: 's' });
    if (x.endDate) add(x.endDate, { x, k: 'e' });
  }
  for (const arr of map.values()) arr.sort((a, b) => (a.k === b.k ? 0 : a.k === 's' ? -1 : 1) || (a.x.title || '').localeCompare(b.x.title || '', 'ko'));
  return map;
}
// 구글 캘린더의 다른 일정(회의 등) — 달 단위로 받아 두고 5분 지나면 다시 받는다
const GCAL_EVENT_COLORS = { 1: '#7986CB', 2: '#33B679', 3: '#8E24AA', 4: '#E67C73', 5: '#F6BF26', 6: '#F4511E', 7: '#039BE5', 8: '#616161', 9: '#3F51B5', 10: '#0B8043', 11: '#D50000' };
const gev = { on: true, cache: new Map(), byDay: new Map(), busy: false, err: '' };
function gevOn() { return gev.on && cfg.hasGcal; }
function gevReset() { gev.cache.clear(); gev.byDay.clear(); gevIndex.clear(); gev.err = ''; }
async function gevEnsure(ym) {
  if (!gevOn() || gev.busy) return;
  const [y, m] = ym.split('-').map(Number);
  const months = [-1, 0, 1, 2].map((d) => ymOf(new Date(y, m - 1 + d, 1)));
  const need = months.filter((k) => { const c = gev.cache.get(k); return !c || Date.now() - c.at > 300000; });
  if (!need.length) return;
  const [ly, lm] = need[need.length - 1].split('-').map(Number);
  gev.busy = true;
  try {
    const r = await fetch('api/gcal', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'list', from: `${need[0]}-01`, to: ymd(new Date(ly, lm, 1)) }) });
    if (!r.ok) throw new Error(await r.text());
    const res = await r.json();
    if (!Array.isArray(res.events)) throw new Error('일정을 받지 못했습니다');
    const at = Date.now();
    for (const k of need) gev.cache.set(k, { at, list: res.events.filter((e) => e.start.slice(0, 7) === k) });
    gev.err = '';
  } catch (e) {
    gev.err = e.message || String(e);
    for (const k of need) gev.cache.set(k, { at: Date.now(), list: (gev.cache.get(k) || {}).list || [] }); // 실패해도 5분은 다시 묻지 않음
  } finally { gev.busy = false; }
  gevRebuild();
  if (ui.view === 'calendar') renderCalendar();
}
function gevRebuild() {
  gev.byDay.clear(); gevIndex.clear();
  for (const { list } of gev.cache.values()) for (const e of list) {
    if (gevIndex.has(e.id)) continue;
    gevIndex.set(e.id, e);
    const s = parseD(e.start), en = parseD(e.end || e.start);
    for (let d = s, n = 0; d <= en && n < 62; d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1), n++) {
      const ds = ymd(d);
      if (!gev.byDay.has(ds)) gev.byDay.set(ds, []);
      gev.byDay.get(ds).push({ g: e });
    }
  }
  for (const arr of gev.byDay.values()) arr.sort((a, b) => (a.g.allDay === b.g.allDay ? 0 : a.g.allDay ? -1 : 1) || (a.g.time || '').localeCompare(b.g.time || '') || a.g.title.localeCompare(b.g.title, 'ko'));
}
function gevChip(e) {
  const c = GCAL_EVENT_COLORS[e.evColor] || e.color || '#7A808C';
  const tip = `${e.title}${e.time ? ' · ' + e.time : ''} · ${e.cal}`;
  const sel = ui.calEdit && ui.calEdit.ev && ui.calEdit.ev.id === e.id ? ' sel' : '';
  return `<button type="button" class="cal-ev cal-g${sel}" data-gev="${esc(e.id)}"${e.editable ? ` draggable="true" data-drag="g|${esc(e.id)}"` : ''} style="--c:${esc(c)}" title="${esc(tip)}">${e.time ? `<span class="cal-k">${esc(e.time)}</span>` : ''}<span class="cal-t">${esc(e.title)}</span></button>`;
}
function calChip(ev) {
  if (ev.g) return gevChip(ev.g);
  const x = ev.x, c = schoolColor(x.school);
  const late = ev.k === 'e' && isLate(x);
  const cls = `cal-ev k-${ev.k}${late ? ' late' : ''}${x.status !== '진행' ? ' dim' : ''}${ui.sel === x.id ? ' sel' : ''}`;
  const tip = `(${ev.k === 's' ? '착수' : '완수'}) ${x.title} · ${x.school} · ${x.status}${x.amount ? ' · ' + fmt(x.amount) + '원' : ''}`;
  return `<button type="button" class="${cls}" data-id="${x.id}" draggable="true" data-drag="c|${x.id}|${ev.k}" style="--c:${c[0]};--t:${c[1]};--k:${c[2]}" title="${esc(tip)}"><span class="cal-k">${ev.k === 's' ? '착수' : '완수'}</span><span class="cal-t">${esc(x.title || '(제목 없음)')}</span></button>`;
}
// 노션 캘린더처럼 주 단위로 이어서 스크롤 — 계약이 있는 기간 전체를 한 번에 그린다
const CAL_ROW = 132; // 주 한 줄 높이(px), CSS .cal-week와 같게
let calWeeks = null, calCounts = {}, calRaf = 0, calPopTop = 0, calTarget = null;
const ymOf = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
const calDay = (i) => new Date(calWeeks.start.getFullYear(), calWeeks.start.getMonth(), calWeeks.start.getDate() + i);
const calWeekOf = (ds) => Math.floor(Math.round((parseD(ds) - calWeeks.start) / DAY) / 7);
function calRange() {
  const t = parseD(todayStr());
  let lo = new Date(t.getFullYear(), t.getMonth() - 12, 1), hi = new Date(t.getFullYear(), t.getMonth() + 18, 1);
  const widen = (d) => { if (d < lo) lo = new Date(d.getFullYear(), d.getMonth(), 1); if (d >= hi) hi = new Date(d.getFullYear(), d.getMonth() + 1, 1); };
  for (const x of data.items) for (const s of [x.startDate, x.endDate]) if (s) widen(parseD(s));
  if (ui.calMonth) { const m = parseD(ui.calMonth + '-01'); widen(new Date(m.getFullYear(), m.getMonth() - 2, 1)); widen(new Date(m.getFullYear(), m.getMonth() + 3, 0)); }
  const minLo = new Date(t.getFullYear() - 5, 0, 1), maxHi = new Date(t.getFullYear() + 6, 0, 1);
  if (lo < minLo) lo = minLo;
  if (hi > maxHi) hi = maxHi;
  const start = new Date(lo.getFullYear(), lo.getMonth(), 1 - lo.getDay());
  return { start, n: Math.ceil(Math.round((hi - start) / DAY) / 7) + 1 };
}
// 그날의 계약 착수·완수 + (켜져 있으면) 구글 캘린더 일정
const dayItems = (evs, ds) => [...(evs.get(ds) || []), ...(gevOn() ? gev.byDay.get(ds) || [] : [])];
function renderCalendar() {
  const t = todayStr();
  const old = $('#calScroll');
  let keepDate = null, keepOff = 0; // 다시 그려도 보던 주를 그대로
  if (old && calWeeks && !calTarget) { const w = Math.floor(old.scrollTop / CAL_ROW); keepDate = ymd(calDay(w * 7)); keepOff = old.scrollTop - w * CAL_ROW; }
  calWeeks = calRange();
  const evs = calEvents();
  calCounts = {};
  for (const [d, arr] of evs) { const c = calCounts[d.slice(0, 7)] || (calCounts[d.slice(0, 7)] = { s: 0, e: 0 }); for (const e of arr) e.k === 's' ? c.s++ : c.e++; }
  const MAX = 4;
  let body = '';
  for (let w = 0; w < calWeeks.n; w++) {
    body += '<div class="cal-week">';
    for (let i = 0; i < 7; i++) {
      const d = calDay(w * 7 + i), ds = ymd(d), arr = dayItems(evs, ds);
      const dn = d.getDate() === 1 ? `${d.getMonth() + 1}월 1일` : d.getDate();
      const shown = arr.length > MAX ? arr.slice(0, MAX - 1) : arr;
      body += `<div class="cal-day${ds === t ? ' today' : ''}${i === 0 ? ' sun' : ''}" data-date="${ds}" data-m="${ds.slice(0, 7)}">
        <div class="cal-dn"><span>${dn}</span></div>
        <div class="cal-evs">${shown.map(calChip).join('')}${arr.length > shown.length ? `<button type="button" class="cal-more" data-more="${ds}">${arr.length - shown.length}개 더</button>` : ''}</div></div>`;
    }
    body += '</div>';
  }
  let pop = '';
  if (ui.calMore && dayItems(evs, ui.calMore).length) {
    const d = parseD(ui.calMore);
    pop = `<div class="cal-pop" role="dialog" aria-label="${d.getMonth() + 1}월 ${d.getDate()}일 일정"><div class="cal-pop-h"><strong>${d.getMonth() + 1}월 ${d.getDate()}일 (${WEEK[d.getDay()]})</strong><button type="button" class="icon-btn" style="width:28px;height:28px" data-cal="closeMore" aria-label="닫기">${ICON.x}</button></div><div class="cal-pop-b">${dayItems(evs, ui.calMore).map(calChip).join('')}</div></div>`;
  }
  $('#calendarView').innerHTML = `<div class="cal-shell${ui.calSide ? '' : ' side-off'}"><aside class="cal-side" aria-label="캘린더 목록">${calSideHtml()}</aside><div class="cal">
    <div class="cal-bar">
      <button type="button" class="icon-btn cal-sidetog" data-calside aria-label="캘린더 목록 ${ui.calSide ? '숨기기' : '보기'}" title="캘린더 목록 ${ui.calSide ? '숨기기' : '보기'}" aria-pressed="${ui.calSide}"><svg aria-hidden="true" viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16"/></svg></button>
      <h2 id="calTitle"></h2>
      <div class="cal-nav">
        <button type="button" class="icon-btn" data-cal="prev" aria-label="이전 달"><svg aria-hidden="true" viewBox="0 0 24 24"><path d="m15 6-6 6 6 6"/></svg></button>
        <button type="button" class="btn sm" data-cal="today">오늘</button>
        <button type="button" class="icon-btn" data-cal="next" aria-label="다음 달"><svg aria-hidden="true" viewBox="0 0 24 24"><path d="m9 6 6 6-6 6"/></svg></button>
      </div>
      <span class="muted cal-sum" id="calSum"></span>
      ${cfg.hasGcal ? `<button type="button" class="btn sm" data-calnew>${ICON.plus}새 일정</button>${gev.err ? `<span class="gc-err cal-gerr" title="${esc(gev.err)}">구글 일정 못 불러옴 — ${esc(gev.err)}</span>` : ''}<span class="cal-gc" title="등록한 계약은 구글 캘린더 '업무'에도 같은 일정이 있습니다">${gcalBadge()}</span>` : ''}
    </div>
    <div class="cal-wds">${WEEK.map((w, i) => `<div class="cal-wd${i === 0 ? ' sun' : ''}">${w}</div>`).join('')}</div>
    <div class="cal-scroll" id="calScroll"><div class="cal-body">${body}${pop}${calEditorHtml()}</div></div>
    <style id="calCur"></style></div></div>`;
  const sc = $('#calScroll');
  if (keepDate) sc.scrollTop = calWeekOf(keepDate) * CAL_ROW + keepOff;
  else sc.scrollTop = calWeekOf((calTarget || ui.calMonth || t.slice(0, 7)) + '-01') * CAL_ROW;
  calTarget = null;
  calSync(true);
  if (cfg.hasGcal && gcals === null) loadGcals();
  if (ui.calEdit) placeCalEditor();
  sc.addEventListener('scroll', onCalScroll, { passive: true });
  const p = $('#calendarView .cal-pop'), cell = ui.calMore && $(`#calendarView .cal-day[data-date="${ui.calMore}"]`);
  if (p && cell) {
    const bw = $('#calendarView .cal-body').clientWidth;
    p.style.left = Math.max(8, Math.min(bw - 290, cell.offsetLeft - 20)) + 'px';
    p.style.top = Math.max(sc.scrollTop + 8, Math.min(sc.scrollTop + sc.clientHeight - p.offsetHeight - 8, cell.offsetTop - 8)) + 'px';
    calPopTop = sc.scrollTop;
  }
}
function onCalScroll() {
  const sc = $('#calScroll');
  if (ui.calMore && sc && Math.abs(sc.scrollTop - calPopTop) > 40) { ui.calMore = null; const p = $('#calendarView .cal-pop'); if (p) p.remove(); }
  if (!calRaf) calRaf = requestAnimationFrame(() => { calRaf = 0; calSync(); });
}
// 화면에 날짜가 가장 많이 보이는 달을 제목으로, 다른 달 날짜는 흐리게
function calSync(force) {
  const sc = $('#calScroll');
  if (!sc || !calWeeks) return;
  const first = Math.max(0, Math.floor(sc.scrollTop / CAL_ROW)), last = Math.min(calWeeks.n - 1, Math.floor((sc.scrollTop + sc.clientHeight - 1) / CAL_ROW));
  const tally = {};
  for (let w = first; w <= last; w++) for (let i = 0; i < 7; i++) { const k = ymOf(calDay(w * 7 + i)); tally[k] = (tally[k] || 0) + 1; }
  const cur = Object.keys(tally).sort().reduce((a, b) => (tally[b] > tally[a] ? b : a));
  gevEnsure(cur);
  if (cur === ui.calMonth && !force) return;
  ui.calMonth = cur;
  const [y, m] = cur.split('-').map(Number), c = calCounts[cur] || { s: 0, e: 0 };
  $('#calTitle').textContent = `${y}년 ${m}월`;
  $('#calSum').textContent = `이 달 착수 ${c.s} · 완수 ${c.e}`;
  const o = `#calendarView .cal-day:not([data-m="${cur}"])`;
  $('#calCur').textContent = `${o}{background:var(--sunken)}${o} .cal-dn{color:var(--faint)}${o} .cal-ev{opacity:.6}`;
}
function calGoto(ym, smooth) {
  ui.calMore = null;
  const sc = $('#calScroll');
  const idx = calWeeks ? calWeekOf(ym + '-01') : -1;
  if (!sc || idx < 0 || idx >= calWeeks.n) { calTarget = ym; ui.calMonth = ym; renderCalendar(); return; }
  const p = $('#calendarView .cal-pop');
  if (p) p.remove();
  calGoto.last = { ym, at: Date.now() };
  sc.scrollTo({ top: idx * CAL_ROW, behavior: smooth ? 'smooth' : 'auto' });
}
function calMove(dir) {
  // 부드럽게 넘어가는 중에 또 누르면 목표 달에서 이어서
  const base = calGoto.last && Date.now() - calGoto.last.at < 700 ? calGoto.last.ym : (ui.calMonth || todayStr().slice(0, 7));
  const [y, m] = base.split('-').map(Number);
  calGoto(ymOf(new Date(y, m - 1 + dir, 1)), true);
}

// ---------- 캘린더 목록 패널 · 일정 편집 · 끌어서 날짜 바꾸기 ----------
let gcals = null, gcalsBusy = false; // 구글 캘린더 목록 [{id,name,color,editable,primary}]
let calDrag = null, calDragFrom = null;
const gevIndex = new Map(); // 'calId|eventId' → 일정
async function loadGcals(force) {
  if (!cfg.hasGcal || gcalsBusy || (gcals && !force)) return;
  gcalsBusy = true;
  try {
    const r = await fetch('api/gcal', { method: 'POST', body: JSON.stringify({ action: 'calendars' }) });
    if (!r.ok) throw new Error(await r.text());
    gcals = (await r.json()).calendars || [];
  } catch (e) { gcals = []; gev.err = e.message || String(e); }
  gcalsBusy = false;
  if (ui.view === 'calendar') renderCalendar();
}
const primaryCal = () => ((gcals || []).find((c) => c.primary) || {}).id || 'primary';
const writeCal = () => cfg.gcalCalendar || primaryCal(); // 계약 일정을 넣는 캘린더(새 일정 기본값)
function shownCals() {
  const s = cfg.gcalShow || [];
  return s.length ? s.filter((x) => x !== 'none') : [writeCal()];
}
function calSideHtml() {
  const contracts = `<label class="cs-item"><input type="checkbox" data-calshowc${ui.calShowContracts ? ' checked' : ''} style="--c:var(--accent)"><span>계약 착수·완수</span></label>`;
  if (!cfg.hasGcal) {
    return `<div class="cs-sec"><div class="cs-h">이 프로그램</div>${contracts}</div>
      <div class="cs-sec"><div class="cs-h">구글 캘린더</div><button type="button" class="link-btn" data-act="gcalSetup">Google 계정 연결하기</button></div>`;
  }
  const shown = new Set(shownCals()), wc = writeCal();
  const list = gcals === null ? '<div class="cs-empty"><span class="spin"></span> 불러오는 중…</div>'
    : gcals.map((c) => `<label class="cs-item" title="${esc(c.name)}"><input type="checkbox" data-calvis="${esc(c.id)}"${shown.has(c.id) ? ' checked' : ''} style="--c:${esc(c.color || '#7A808C')}"><span>${esc(c.name)}</span>${c.id === wc ? '<span class="cs-tag" title="계약 착수·완수 일정을 넣는 캘린더">계약</span>' : ''}${c.editable ? '' : '<span class="cs-tag" title="읽기 전용">보기</span>'}</label>`).join('');
  return `<div class="cs-sec"><div class="cs-h">이 프로그램</div>${contracts}</div>
    <div class="cs-sec"><div class="cs-h"><span title="${esc(cfg.googleEmail || '')}">${esc(cfg.googleEmail || '구글 캘린더')}</span><button type="button" class="icon-btn cs-ref" data-calref aria-label="캘린더 목록 새로 고침" title="새로 고침"><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M21 12a9 9 0 1 1-3-6.7L21 8M21 3v5h-5"/></svg></button></div>${list}</div>`;
}
async function toggleCalVis(id, on) {
  const s = new Set(shownCals());
  if (on) s.add(id); else s.delete(id);
  await postSettings({ gcalShow: s.size ? [...s] : ['none'] });
  gevReset(); renderCalendar();
}

// 편집 창 — ui.calEdit = { ev } (고치기) 또는 { date } (새 일정)
function calEditorHtml() {
  const ce = ui.calEdit; if (!ce) return '';
  const ev = ce.ev || { title: '', allDay: true, start: ce.date, end: ce.date, time: '09:00', etime: '10:00', desc: '', calId: writeCal(), editable: true };
  const isNew = !ce.ev, ro = !ev.editable;
  const cals = (gcals || []).filter((c) => c.editable || c.id === ev.calId);
  const cal = (gcals || []).find((c) => c.id === ev.calId);
  const dot = GCAL_EVENT_COLORS[ev.evColor] || (cal && cal.color) || ev.color || '#7A808C';
  const dis = ro ? ' disabled' : '';
  return `<div class="cal-ed" role="dialog" aria-label="${isNew ? '새 일정' : '일정 편집'}">
    <div class="ce-h"><span class="ce-dot" style="background:${esc(dot)}"></span><strong>${isNew ? '새 일정' : '일정'}</strong><span class="sp"></span>
      ${!isNew && !ro ? `<button type="button" class="btn sm ghost" data-ce="dup" title="같은 날에 사본 만들기">${ICON.copy}복제</button><button type="button" class="btn sm ghost danger" data-ce="del">${ICON.trash}삭제</button>` : ''}
      <button type="button" class="icon-btn" style="width:28px;height:28px" data-ce="close" aria-label="닫기">${ICON.x}</button></div>
    <input class="ce-title" id="ceTitle" value="${esc(ev.title)}" placeholder="제목"${dis} aria-label="제목">
    <label class="check ce-all"><input type="checkbox" id="ceAll"${ev.allDay ? ' checked' : ''}${dis}>종일</label>
    <div class="ce-when">
      <span class="muted">시작</span><input type="date" id="ceStart" value="${esc(ev.start)}"${dis} aria-label="시작 날짜"><input type="time" id="ceStime" value="${esc(ev.time || '09:00')}"${dis} aria-label="시작 시간"${ev.allDay ? ' hidden' : ''}>
      <span class="muted">끝</span><input type="date" id="ceEnd" value="${esc(ev.end || ev.start)}"${dis} aria-label="끝 날짜"><input type="time" id="ceEtime" value="${esc(ev.etime || '10:00')}"${dis} aria-label="끝 시간"${ev.allDay ? ' hidden' : ''}>
    </div>
    <label class="fld">캘린더<select id="ceCal"${dis}>${cals.map((c) => `<option value="${esc(c.id)}"${c.id === ev.calId ? ' selected' : ''}>${esc(c.name)}</option>`).join('')}</select></label>
    <label class="fld">설명<textarea id="ceDesc" rows="3"${dis}>${esc(ev.desc || '')}</textarea></label>
    ${ev.recurring ? '<p class="hint">반복 일정입니다 — 이 날짜의 일정만 바뀝니다.</p>' : ''}
    ${ro ? '<p class="hint">이 캘린더는 읽기 전용이라 고칠 수 없습니다.</p>' : ''}
    <div class="ce-foot"><span class="hint" id="ceMsg">저장하면 구글 캘린더에 바로 반영됩니다</span><span class="sp"></span>${ro ? '' : `<button type="button" class="btn sm primary" data-ce="save">${isNew ? '만들기' : '저장'}</button>`}</div>
  </div>`;
}
function placeCalEditor() {
  const ed = $('#calendarView .cal-ed'), sc = $('#calScroll'); if (!ed || !sc) return;
  const ce = ui.calEdit;
  const anchor = (ce.ev && $(`#calendarView [data-gev="${CSS.escape(ce.ev.id)}"]`)) || $(`#calendarView .cal-day[data-date="${ce.ev ? ce.ev.start : ce.date}"]`);
  const bw = $('#calendarView .cal-body').clientWidth;
  let left = 8, top = sc.scrollTop + 8;
  if (anchor) {
    const day = anchor.closest('.cal-day') || anchor;
    left = day.offsetLeft + day.offsetWidth + 6;
    if (left + 330 > bw) left = day.offsetLeft - 330 - 6;
    top = day.offsetTop;
  }
  ed.style.left = Math.max(8, Math.min(bw - 330, left)) + 'px';
  ed.style.top = Math.max(sc.scrollTop + 8, Math.min(sc.scrollTop + sc.clientHeight - ed.offsetHeight - 8, top)) + 'px';
}
function openCalEditor(ce) {
  ui.calEdit = ce; ui.calMore = null; closeCalMenu();
  if (cfg.hasGcal && gcals === null) loadGcals();
  renderCalendar();
  setTimeout(() => { const t = $('#ceTitle'); if (t && !t.disabled && !ce.ev) t.focus(); }, 30);
}
function closeCalEditor() { if (!ui.calEdit) return; ui.calEdit = null; const ed = $('#calendarView .cal-ed'); if (ed) ed.remove(); }
async function gevSave(ev, patch) {
  const b = Object.assign({ action: 'evSave', calId: ev.calId || '', eid: ev.eid || '', target: ev.calId || writeCal(), title: ev.title, allDay: ev.allDay, start: ev.start, end: ev.end, stime: ev.time, etime: ev.etime, desc: ev.desc || '' }, patch);
  const r = await fetch('api/gcal', { method: 'POST', body: JSON.stringify(b) });
  if (!r.ok) throw new Error(await r.text());
  return (await r.json()).event;
}
async function saveCalEditor() {
  const ce = ui.calEdit; if (!ce) return;
  const v = (id) => ($(id) || {}).value || '';
  const allDay = $('#ceAll').checked;
  const start = v('#ceStart'), end = v('#ceEnd') || start;
  if (!start) { $('#ceMsg').textContent = '시작 날짜를 넣어 주세요'; return; }
  if (end < start) { $('#ceMsg').textContent = '끝 날짜가 시작보다 앞섭니다'; return; }
  const btn = $('#calendarView [data-ce="save"]'); btn.disabled = true;
  $('#ceMsg').innerHTML = '<span class="spin"></span> 구글 캘린더에 저장하는 중…';
  try {
    await gevSave(ce.ev || {}, { title: v('#ceTitle').trim() || '(제목 없음)', allDay, start, end, stime: v('#ceStime'), etime: v('#ceEtime'), desc: v('#ceDesc'), target: v('#ceCal') || writeCal(), calId: ce.ev ? ce.ev.calId : v('#ceCal') });
    ui.calEdit = null; gevReset(); renderCalendar();
    toast(ce.ev ? '일정을 고쳤습니다 — 구글 캘린더에도 반영됨' : '새 일정을 만들었습니다 — 구글 캘린더에도 반영됨');
  } catch (e) { btn.disabled = false; $('#ceMsg').innerHTML = `<span class="gc-err">${esc(e.message || e)}</span>`; }
}
// 노션 캘린더처럼 바로 지우고, 알림에서 되돌릴 수 있게 (되돌리면 같은 내용으로 다시 만든다)
async function gevDelete(ev) {
  closeCalEditor(); closeCalMenu();
  const r = await fetch('api/gcal', { method: 'POST', body: JSON.stringify({ action: 'evDelete', calId: ev.calId, eid: ev.eid }) });
  if (!r.ok) { toast('지우지 못했습니다: ' + (await r.text())); return; }
  gevReset(); renderCalendar();
  toast(`'${ev.title}' 일정을 지웠습니다 — 구글 캘린더에서도 삭제됨`, '되돌리기', async () => {
    try { await gevSave(Object.assign({}, ev, { eid: '' }), { target: ev.calId }); gevReset(); renderCalendar(); toast('일정을 되살렸습니다'); }
    catch (e) { toast('되살리지 못했습니다: ' + (e.message || e)); }
  });
}
async function gevDuplicate(ev) {
  closeCalEditor(); closeCalMenu();
  try { await gevSave(Object.assign({}, ev, { eid: '' }), { target: ev.calId }); gevReset(); renderCalendar(); toast(`'${ev.title}' 일정을 복제했습니다`); }
  catch (e) { toast('복제하지 못했습니다: ' + (e.message || e)); }
}
function deleteCalEditor() { const ev = ui.calEdit && ui.calEdit.ev; if (ev) gevDelete(ev); }
// 오른쪽 클릭 메뉴
function closeCalMenu() { const m = $('#calMenu'); if (m) m.remove(); }
function openCalMenu(e, chip) {
  closeCalMenu();
  let items = [];
  if (chip.dataset.gev) {
    const ev = gevIndex.get(chip.dataset.gev); if (!ev) return;
    items = [['open', '열기'], ...(ev.editable ? [['dup', '복제'], ['del', '삭제', 'danger']] : [])];
    calMenuTarget = { ev };
  } else if (chip.dataset.id) {
    items = [['contract', '계약 열기']];
    calMenuTarget = { id: chip.dataset.id };
  }
  const m = document.createElement('div');
  m.id = 'calMenu'; m.className = 'cal-menu'; m.setAttribute('role', 'menu');
  m.innerHTML = items.map(([a, l, c]) => `<button type="button" role="menuitem" class="${c || ''}" data-cm="${a}">${l}</button>`).join('');
  document.body.appendChild(m);
  m.style.left = Math.min(window.innerWidth - m.offsetWidth - 8, e.clientX) + 'px';
  m.style.top = Math.min(window.innerHeight - m.offsetHeight - 8, e.clientY) + 'px';
  const first = m.querySelector('button'); if (first) first.focus();
}
let calMenuTarget = null;
function runCalMenu(a) {
  const t = calMenuTarget; closeCalMenu(); if (!t) return;
  if (a === 'open' && t.ev) openCalEditor({ ev: Object.assign({}, t.ev) });
  if (a === 'dup' && t.ev) gevDuplicate(t.ev);
  if (a === 'del' && t.ev) gevDelete(t.ev);
  if (a === 'contract' && t.id) select(t.id);
}
const addDays = (ds, n) => { const d = parseD(ds); return ymd(new Date(d.getFullYear(), d.getMonth(), d.getDate() + n)); };
// 끌어 놓은 날짜로 — 계약 착수·완수일이나 구글 일정의 날짜를 바꾼다
async function calDropTo(payload, from, to) {
  if (!to || from === to) return;
  if (payload.startsWith('c|')) {
    const [, id, k] = payload.split('|'), x = byId.get(id);
    if (!x) return;
    const key = k === 's' ? 'startDate' : 'endDate', prev = x[key];
    x[key] = to;
    addHistory(x, '직접 수정', [{ k: key, from: prev, to }]);
    touch(x); reindex(); scheduleSave(); render();
    toast(`${x.title} ${k === 's' ? '착수일' : '완수일'} ${shortD(prev)} → ${shortD(to)}`, '되돌리기', () => { x[key] = prev; addHistory(x, '직접 수정', [{ k: key, from: to, to: prev }]); touch(x); reindex(); scheduleSave(); render(); });
    return;
  }
  const ev = gevIndex.get(payload.slice(2));
  if (!ev || !ev.editable) return;
  const n = diffDays(to, from), was = { start: ev.start, end: ev.end };
  ev.start = addDays(ev.start, n); ev.end = addDays(ev.end || was.start, n);
  gevRebuild(); renderCalendar(); // 먼저 화면에서 옮기고
  try {
    await gevSave(ev, {});
    toast(`'${ev.title}' ${shortD(was.start)} → ${shortD(ev.start)} — 구글 캘린더에도 반영됨`);
  } catch (e) {
    Object.assign(ev, was); gevRebuild(); renderCalendar();
    toast('옮기지 못했습니다: ' + (e.message || e));
  }
  gevReset(); gevEnsure(ui.calMonth);
}

// ---------- 렌더: 상세 ----------
function opt(list, v) {
  const l = list.includes(v) || !v ? list : [v, ...list];
  return l.map((o) => `<option${o === v ? ' selected' : ''}>${esc(o)}</option>`).join('');
}
function renderDetail() {
  const el = $('#detail');
  const x = ui.sel && byId.get(ui.sel);
  $('.app').classList.toggle('has-detail', !!x);
  if (!x) { el.hidden = true; el.innerHTML = ''; return; }
  el.hidden = false;
  el.classList.toggle('ai-fill', !!x._ai);
  const ch = childrenOf(x);
  const parents = data.items.filter((p) => p.id !== x.id && isTop(p) && p.phase === '총괄' && p.school === x.school);
  const parent = x.parentId && byId.get(x.parentId);

  let prog = '';
  const sS = x.startDate || x.contractDate;
  if (sS && x.endDate) {
    const total = Math.max(1, diffDays(x.endDate, sS)), done = diffDays(todayStr(), sS);
    const pct = Math.max(0, Math.min(100, Math.round((done / total) * 100)));
    const left = diffDays(x.endDate, todayStr());
    const lt = x.status === '완료' ? '완료' : left >= 0 ? `${left}일 남음` : `${-left}일 경과`;
    prog = `<div class="prog"><div class="row"><span>기간 경과율 · 총 ${total + 1}일</span><span>${pct}% · ${lt}</span></div><div class="bar${isLate(x) ? ' late' : ''}"><i style="width:${x.status === '완료' ? 100 : pct}%"></i></div></div>`;
  }

  let sub = '';
  if (ch.length || x.phase === '총괄') {
    const s = ch.reduce((a, k) => a + (k.amount || 0), 0);
    sub = `<div class="sec-h"><span>하위 차수 ${ch.length}건${ch.length ? ' · 합계 ' + korMoney(s) : ''}</span><button type="button" class="btn sm ghost" data-act="addPhase">${ICON.plus}차수 추가</button></div>
      ${ch.length ? `<div class="sub-list">${ch.map((k) => `<button type="button" data-goto="${k.id}"><span>${esc(k.phase)} · <span class="pill st-${esc(k.status)}" style="padding:1px 7px">${esc(k.status)}</span> <span class="muted">${shortD(k.startDate)} → ${shortD(k.endDate)}</span></span><span>${fmt(k.amount)}</span></button>`).join('')}</div>` : ''}`;
  }
  const parentLink = parent ? `<button type="button" class="link-btn" data-goto="${parent.id}">↑ ${esc(parent.title)}</button>` : '';
  const bizLinks = bizList(x.contractor);

  el.innerHTML = `
    <div class="d-head">
      <div class="h">
        <div class="chips">
          <span class="chip tint" style="${tintVars(schoolColor(x.school))}">${esc(x.school)}</span>
          <span class="chip tint" style="${tintVars(x.category ? catColor(x.category) : ['#787774', '#E3E2E0', '#32302C'])}">${esc(x.category || '항목 없음')}</span>
          ${x.phase && x.phase !== '단일' ? `<span class="chip" style="background:var(--tag-bg);color:var(--tag-ink)">${esc(x.phase)}</span>` : ''}
        </div>
        <label class="sr" for="f-title">요약명</label>
        <input id="f-title" class="d-title" data-k="title" value="${esc(x.title)}" placeholder="요약명 입력">
        ${parentLink}
      </div>
      <button type="button" class="icon-btn" data-act="close" aria-label="상세 닫기 (Esc)">${ICON.x}</button>
    </div>
    <div class="d-body">
      ${x._ai ? `<div class="ai-banner"><strong>Claude가 문서에서 채운 계약입니다</strong>${x._ai.review && x._ai.review.length ? `<ul>${x._ai.review.map((r) => `<li>${esc(r)}</li>`).join('')}</ul>` : '<span>입력값을 한 번 확인해 주세요.</span>'}${cfg.hasGcal ? '<label class="check gc-check"><input type="checkbox" id="aiGcal" checked>확인 완료 시 구글 캘린더 \'업무\'에 착수·완수 일정 추가</label>' : ''}${(pendingDocs.get(x.id) || []).length ? `<label class="check gc-check"><input type="checkbox" id="aiDocs" checked>넣은 문서 ${pendingDocs.get(x.id).length}개를 계약 문서에 보관</label>` : ''}<div class="row"><button type="button" class="btn sm primary" data-act="aiOk">확인 완료</button><button type="button" class="btn sm" data-act="aiCancel">추가 취소</button></div></div>` : ''}
      <div class="grid2">
        <label class="fld">학교<select data-k="school">${opt(data.options.schools, x.school)}</select></label>
        <label class="fld">항목<select data-k="category">${opt(data.options.categories, x.category)}</select></label>
        <label class="fld">상태<select data-k="status">${opt(data.options.statuses, x.status)}</select></label>
        <label class="fld">차수<select data-k="phase">${opt(data.options.phases, x.phase)}</select></label>
      </div>
      <label class="fld">상위계약 (장기계속 총차)
        <select data-k="parentId" ${ch.length ? 'disabled' : ''}><option value="">없음</option>${parents.map((p) => `<option value="${p.id}"${p.id === x.parentId ? ' selected' : ''}>${esc(p.title)}</option>`).join('')}</select>
        ${ch.length ? '<span class="hint">하위 차수가 있는 총괄 계약은 다른 계약 아래에 둘 수 없습니다.</span>' : ''}
      </label>
      <label class="fld">계약명<input data-k="name" value="${esc(x.name)}"></label>
      <div class="grid2">
        <label class="fld">계약번호<input data-k="no" value="${esc(x.no)}" placeholder="R26TA…"></label>
        <label class="fld">계약금액(원)<input class="amt-in" data-k="amount" inputmode="numeric" value="${x.amount ? fmt(x.amount) : ''}" placeholder="0"></label>
      </div>
      <div class="grid3">
        <label class="fld">계약일<input type="date" data-k="contractDate" value="${esc(x.contractDate)}"></label>
        <label class="fld">착수일<input type="date" data-k="startDate" value="${esc(x.startDate)}"></label>
        <label class="fld">완수일<input type="date" data-k="endDate" value="${esc(x.endDate)}"></label>
      </div>
      ${prog}
      <div class="gc-box">
        <label class="check"><input type="checkbox" data-gcal${x.gcal && x.gcal.on ? ' checked' : ''}>구글 캘린더 '업무'에 착수·완수 일정 등록</label>
        <div class="gc-state" id="gcState">${gcalDetailState(x)}</div>
      </div>
      <label class="fld">계약자<textarea data-k="contractor" rows="2" placeholder="업체명 대표 성명 (000-00-00000)">${esc(x.contractor)}</textarea></label>
      ${bizLinks.length ? `<div class="bz-list" aria-label="비즈노 조회">${bizLinks.map((b) => `<button type="button" class="btn sm" data-act="bizno" data-q="${b.no}" title="비즈노에서 ${esc(b.name)} (${b.no}) 조회">${ICON.link}${b.role ? `<span class="bz-role">${esc(b.role)}</span>` : ''}<span class="bz-nm">${esc(b.name)}</span><span class="muted">${b.no}</span></button>`).join('')}</div>` : ''}
      <label class="fld">연락처·담당<textarea data-k="contact" rows="2">${esc(x.contact)}</textarea></label>
      ${sub}
      <label class="fld">특이사항<textarea data-k="note" rows="5">${esc(x.note)}</textarea></label>
      ${x._ai ? '' : docsHtml(x)}
      ${histHtml(x)}
      <div class="d-actions">
        <button type="button" class="btn sm" data-act="dup">${ICON.copy}복제</button>
        <button type="button" class="btn sm" data-act="aiUpdate">${ICON.doc}문서로 갱신</button>
        <span class="sp"></span>
        <button type="button" class="btn sm danger" data-act="del">${ICON.trash}삭제</button>
      </div>
      <div class="meta">${x.updatedAt ? '최종 수정 ' + new Date(x.updatedAt).toLocaleString('ko-KR') : '노션에서 가져온 원본'}${x._nEdited ? ' · 노션 반영 ' + new Date(x._nEdited).toLocaleString('ko-KR') : (x.id.startsWith('l') ? ' · 노션에 아직 없음' : '')}</div>
    </div>`;
  autoGrow();
  loadDocs(x);
}
function autoGrow() { $$('#detail textarea').forEach((t) => { t.style.height = 'auto'; t.style.height = Math.min(320, t.scrollHeight + 2) + 'px'; }); }

// ---------- 전체 렌더 ----------
function render() {
  renderSide();
  renderTop();
  renderDetail(); // 상세 열림 여부가 목록 열 구성에 영향을 주므로 먼저
  renderView();
  renderSync();
  savePrefs();
}
function renderMain() { renderSide(); renderTop(); renderView(); }

// ---------- 동작 ----------
function select(id, scroll) {
  ui.sel = id;
  const x = byId.get(id);
  if (x && x.parentId) ui.expanded.add(x.parentId);
  render();
  if (scroll) { const tr = $(`tr[data-id="${id}"]`); if (tr) tr.scrollIntoView({ block: 'nearest' }); }
}
function blank(over) {
  return Object.assign({ id: newId(), title: '', school: ui.school !== '__all' ? ui.school : data.options.schools[0], category: ui.cat !== '전체' ? ui.cat : data.options.categories[0], phase: '단일', status: '진행', name: '', no: '', contractor: '', amount: 0, contractDate: '', startDate: '', endDate: '', contact: '', bizno: '', note: '', parentId: null, gcal: { on: true } }, over || {});
}
function addItem(item) {
  touch(item);
  data.items.push(item);
  reindex();
  if (ui.status !== '전체' && ui.status !== item.status) ui.status = '전체';
  ui.kpi = null; ui.q = ''; $('#q').value = '';
  select(item.id, true);
  scheduleSave();
  setTimeout(() => { const t = $('#f-title'); if (t) { t.focus(); t.select(); } }, 30);
}
function addPhase(p) {
  const ch = childrenOf(p);
  const nums = ch.map((k) => parseInt(k.phase, 10)).filter((n) => !isNaN(n));
  const n = (nums.length ? Math.max(...nums) : 0) + 1;
  const phase = `${n}차`;
  if (!data.options.phases.includes(phase)) data.options.phases.push(phase);
  const title = /\(총차\)/.test(p.title) ? p.title.replace('(총차)', `(${phase})`) : `${p.title} (${phase})`;
  ui.expanded.add(p.id);
  addItem(blank({ title, school: p.school, category: p.category, phase, status: '진행', parentId: p.id, name: p.name.replace(/\(장기계속\)|\(총차\)/g, '').trim() }));
}
function removeItem(x) {
  const ch = childrenOf(x);
  const doIt = () => {
    const snapshot = JSON.stringify(data.items), delSnap = JSON.stringify(data.deleted || []), trashSnap = JSON.stringify(data.gcalTrash || []);
    const gone = new Set([x.id, ...ch.map((k) => k.id)]);
    const at = Date.now(); // 구글 캘린더 일정도 함께 지운다(되돌리기 시간 뒤)
    for (const i of data.items) if (gone.has(i.id) && i.gcal) for (const k of ['s', 'e']) if (i.gcal[k] && i.gcal[k].id) (data.gcalTrash = data.gcalTrash || []).push({ id: i.gcal[k].id, at });
    data.items = data.items.filter((i) => !gone.has(i.id));
    data.deleted = [...(data.deleted || []), ...[...gone].filter((id) => !id.startsWith('l'))];
    reindex(); ui.sel = null; render(); scheduleSave();
    toast(`'${x.title || '제목 없음'}' 삭제됨${ch.length ? ` (하위 ${ch.length}건 포함)` : ''}`, '되돌리기', () => {
      data.items = JSON.parse(snapshot); data.deleted = JSON.parse(delSnap); data.gcalTrash = JSON.parse(trashSnap); reindex(); ui.sel = x.id; render(); scheduleSave();
    });
  };
  if (!ch.length) return doIt();
  modal(`<div class="m-head"><h2 id="modalTitle">총괄 계약 삭제</h2></div>
    <div class="m-body"><p>'${esc(x.title)}'에 연결된 하위 차수 ${ch.length}건도 함께 삭제됩니다. 삭제 직후 화면 아래에서 되돌릴 수 있습니다.</p></div>
    <div class="m-foot"><button type="button" class="btn" data-m="cancel">취소</button><button type="button" class="btn primary" style="background:#C2262A;border-color:#C2262A" data-m="ok">함께 삭제</button></div>`,
  { ok: () => { closeModal(); doIt(); } });
}
function onField(e, final) {
  const f = e.target.closest('[data-k]');
  if (!f || !ui.sel) return;
  const x = byId.get(ui.sel);
  if (!x) return;
  const k = f.dataset.k;
  let v = f.value;
  if (k === 'amount') {
    const n = parseInt(v.replace(/[^\d]/g, ''), 10) || 0;
    x.amount = n;
    if (final) f.value = n ? fmt(n) : '';
  } else if (k === 'parentId') {
    x.parentId = v || null;
    if (x.parentId && x.phase === '단일') x.phase = '1차';
  } else {
    x[k] = v;
    if (k === 'bizno') delete x._biznoAuto;
    // 비즈노넷 칸은 화면에서 뺐으므로 계약자를 고치면 항상 따라 맞춘다(노션 링크용)
    if (k === 'contractor' && final) { x.bizno = deriveBizno(v); x._biznoAuto = true; }
  }
  if (final && !x._ai) recordFieldChange(x, k);
  touch(x);
  reindex();
  scheduleSave();
  if (['school', 'category', 'status', 'phase', 'parentId', 'startDate', 'endDate', 'contractDate', 'contractor'].includes(k) && final) {
    if (k === 'school' && ui.school !== '__all' && ui.school !== x.school) ui.school = x.school;
    render();
  } else {
    renderMain();
  }
  if (f.tagName === 'TEXTAREA') autoGrow();
}

// ---------- 모달 · 토스트 ----------
let modalHandlers = {};
function modal(html, handlers) {
  modalHandlers = handlers || {};
  $('#modal').innerHTML = html;
  $('#modalBack').hidden = false;
  setTimeout(() => { const b = $('#modal [data-m="ok"]') || $('#modal button'); b && b.focus(); }, 20);
}
function closeModal() { $('#modalBack').hidden = true; $('#modal').innerHTML = ''; }
let toastTimer;
function toast(msg, actLabel, act) {
  const t = $('#toast');
  t.innerHTML = `<span>${esc(msg)}</span>${actLabel ? `<button type="button">${esc(actLabel)}</button>` : ''}`;
  t.hidden = false;
  if (actLabel) t.querySelector('button').onclick = () => { t.hidden = true; act(); };
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, actLabel ? 8000 : 3500);
}

// ---------- 설정 ----------
async function openSettings(focus) {
  let backups = [], st = {};
  try { backups = (await (await fetch('api/backups')).json()).backups || []; } catch (e) { /* 무시 */ }
  try { st = await (await fetch('api/settings')).json(); } catch (e) { /* 무시 */ }
  const label = (n) => { const m = n.match(/^(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})_(.+)\.json$/); return m ? `${m[1]}.${m[2]}.${m[3]} ${m[4]}:${m[5]} · ${m[7]}` : n; };
  modal(`<div class="m-head"><h2 id="modalTitle">설정</h2><button type="button" class="icon-btn" data-m="cancel" aria-label="닫기">${ICON.x}</button></div>
    <div class="m-body">
      <section class="set-sec" id="secAI">
        <h3>Claude API <span class="hint">문서로 계약 추가에 사용</span></h3>
        <label class="fld">API 키 <span class="hint">console.anthropic.com › API Keys에서 발급 · 이 PC의 Windows 계정으로 암호화해 저장</span>
          <input id="sKey" type="password" autocomplete="off" placeholder="${st.hasAnthropicKey ? '저장됨 ' + esc(st.anthropicKeyMasked) + ' — 바꿀 때만 입력' : 'sk-ant-…'}"></label>
        <div class="grid2">
          <label class="fld">모델<input id="sModel" value="${esc(st.model || 'claude-sonnet-5-5')}"></label>
          <div class="fld">&nbsp;${st.hasAnthropicKey ? '<button type="button" class="btn sm" data-m="delKey">저장된 키 지우기</button>' : ''}</div>
        </div>
      </section>
      <section class="set-sec" id="secNotion">
        <h3>노션 동기화 <span class="hint">${st.lastSync ? '마지막 ' + new Date(st.lastSync).toLocaleString('ko-KR') : '아직 동기화하지 않음'}</span></h3>
        <label class="fld">통합 토큰 <span class="hint">notion.so/profile/integrations에서 내부 통합 생성 → 계약 추진현황 DB의 ⋯ › 연결에 추가</span>
          <input id="sNotion" type="password" autocomplete="off" placeholder="${st.hasNotionToken ? '저장됨 ' + esc(st.notionTokenMasked) + ' — 바꿀 때만 입력' : 'ntn_…'}"></label>
        <label class="fld">데이터베이스 주소 또는 ID<input id="sDb" value="${esc(st.notionDb || '')}"></label>
        <label class="fld">경유 주소 <span class="hint">기관망에서 노션이 막혀 있을 때만 · 비우면 노션에 직접 연결</span><input id="sRelay" value="${esc(st.notionRelay || '')}" placeholder="https://…vercel.app/notion"></label>
        <div class="grid2">
          <label class="check" style="margin:0"><input type="checkbox" id="sAuto"${st.autoSync ? ' checked' : ''}>자동 동기화</label>
          <label class="fld" style="flex-direction:row;align-items:center;gap:8px">간격(분)<input id="sMin" type="number" min="1" value="${st.syncMinutes || 10}" style="width:80px"></label>
        </div>
        ${st.hasNotionToken ? '<div><button type="button" class="btn sm" data-m="delNotion">저장된 토큰 지우기</button></div>' : ''}
      </section>
      <section class="set-sec" id="secGcal">
        <h3>구글 캘린더 <span class="hint">계약의 착수일·완수일을 '(착수) 요약명', '(완수) 요약명' 종일 일정으로 등록</span></h3>
        ${st.hasGcal ? `<div class="g-acct"><span class="ok-dot" aria-hidden="true"></span><span><b>${esc(st.googleEmail || '구글 계정')}</b>로 연결됨</span><button type="button" class="btn sm" data-m="gLogout">로그아웃</button></div>`
        : `<div class="g-acct"><button type="button" class="btn primary" data-m="gLogin" id="gLoginBtn"><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4M10 17l5-5-5-5M15 12H3"/></svg>Google 계정으로 로그인</button><span class="hint" id="gLoginMsg">브라우저가 열리면 계정을 고르고 허용을 누르세요.</span></div>`}
        <label class="fld">일정을 넣을 캘린더 ID <span class="hint">구글 캘린더 › 캘린더 설정 › 캘린더 통합의 '캘린더 ID' · 비우면 기본 캘린더</span><input id="sGcalCal" value="${esc(st.gcalCalendar || '')}"></label>
        ${st.hasGcal ? `<div class="fld">캘린더 화면에 같이 볼 캘린더 <span class="hint">회의 등 다른 일정을 계약 일정과 함께 표시 · 고르지 않으면 위 캘린더만</span>
          <div id="gcalCals" class="cal-pick"><button type="button" class="btn sm" data-m="gcalCals">캘린더 목록 불러오기</button>${(st.gcalShow || []).length ? `<span class="hint">지금 ${st.gcalShow.length}개 선택됨</span>` : ''}</div></div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:flex-start">
          <button type="button" class="btn sm" data-m="gcalLink">기존 일정 연결</button>
          <span id="gcalOut" class="test-out"><span class="hint">'기존 일정 연결'은 캘린더에 이미 있는 같은 제목·날짜의 일정을 찾아 계약과 묶습니다. 새 일정은 만들지 않습니다.</span></span>
        </div>` : ''}
        <details class="g-adv">
          <summary>선택: 중계 서버 없이 구글과 직접 연결 (클라이언트 보안 비밀)</summary>
          <p class="hint" style="margin:0">보통은 넣지 않아도 됩니다. 로그인은 할일정리와 같은 중계 서버를 거치는데, 그 서버에 닿지 않는 환경에서만 필요합니다. 구글 클라우드 콘솔 › Google 인증 플랫폼 › 클라이언트에서 이 앱의 <b>클라이언트 보안 비밀</b>을 복사해 넣어 두면 구글과 직접 연결합니다. 이 PC의 Windows 계정으로 암호화해 저장합니다.</p>
          <label class="fld">클라이언트 보안 비밀<input id="sGSecret" type="password" autocomplete="off" placeholder="${st.hasGoogleSecret ? '저장됨 — 바꿀 때만 입력' : 'GOCSPX-…'}"></label>
        </details>
      </section>
      <section class="set-sec">
        <h3>네트워크</h3>
        <label class="fld">프록시 (내부망에서 필요할 때만) <input id="sProxy" value="${esc(st.proxy || '')}" placeholder="예: 10.0.0.1:8080"></label>
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><button type="button" class="btn sm" data-m="test">연결 테스트</button><span id="testOut" class="test-out"></span></div>
      </section>
      <section class="set-sec">
        <h3>목록</h3>
        <div class="grid2">
          <label class="fld">학교 (한 줄에 하나)<textarea id="optSchools" rows="6">${esc(data.options.schools.join('\n'))}</textarea></label>
          <label class="fld">항목 (한 줄에 하나)<textarea id="optCats" rows="6">${esc(data.options.categories.join('\n'))}</textarea></label>
        </div>
      </section>
      <section class="set-sec">
        <h3>데이터 · 백업</h3>
        <div class="path">${esc(info.dataFile || '')}</div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button type="button" class="btn sm" data-m="folder">데이터 폴더</button>
          <button type="button" class="btn sm" data-m="bfolder">백업 폴더</button>
          <button type="button" class="btn sm" data-m="efolder">내보내기 폴더</button>
        </div>
        <div class="fld">계약 문서 보관 위치 <span class="hint">계약명 폴더 아래에 '날짜 변경 - 바뀐 칸' 폴더로 정리 · 비우면 기본(${esc(st.docsRootDefault || '')}) · 바꾸면 기존 문서도 옮겨집니다</span>
          <div class="row-in"><input id="sDocsRoot" value="${esc(st.docsRoot || '')}" aria-label="계약 문서 보관 위치"><button type="button" class="btn sm" data-m="pickDocs">폴더 선택</button><button type="button" class="btn sm" data-m="openDocs">열기</button></div>
        </div>
        <div class="fld">백업에서 복원 <span class="hint">실행할 때·동기화 직전·저장 10분마다 자동 백업, 최근 40개 보관</span>
          <div class="bk-list">${backups.length ? backups.map((b, i) => `<label><input type="radio" name="bk" value="${esc(b)}"${i === 0 ? ' checked' : ''}>${esc(label(b))}</label>`).join('') : '<div class="empty" style="padding:16px">백업이 없습니다</div>'}</div>
          ${backups.length ? '<div><button type="button" class="btn sm" data-m="restore">선택한 백업으로 복원</button></div>' : ''}
        </div>
      </section>
    </div>
    <div class="m-foot">
      <button type="button" class="btn" data-m="cancel">닫기</button>
      <button type="button" class="btn primary" data-m="ok">설정 저장</button>
    </div>`, {
    ok: async () => {
      try { await saveSettingsForm(); } catch (e) { toast('설정을 저장하지 못했습니다: ' + (e.message || e)); return; }
      const lines = (id) => $(id).value.split('\n').map((s) => s.trim()).filter(Boolean);
      const s = lines('#optSchools'), c = lines('#optCats');
      if (s.length) data.options.schools = s;
      if (c.length) data.options.categories = c;
      closeModal(); render(); scheduleSave(); setupAutoSync(); toast('설정을 저장했습니다');
    },
    test: async () => {
      await saveSettingsForm();
      const out = $('#testOut');
      out.innerHTML = '<span class="spin"></span> 확인 중…';
      try {
        const r = await (await fetch('api/net-test')).json();
        const line = (n, x) => `<span class="${x.ok ? 'ok' : 'bad'}">${n} ${x.ok ? '연결됨' : '— ' + esc(x.msg)}</span>`;
        let html = line('Claude API', r.anthropic) + line('노션', r.notion) + (r.google ? line('구글 로그인 서버', r.google) : '') + (r.gcal ? line(`구글 캘린더${r.gcal.name ? ` '${r.gcal.name}'` : ''}`, r.gcal) : '');
        if (r.notion.ok && cfg.hasNotionToken) {
          const t = await fetch('api/notion/test');
          if (t.ok) { const j = await t.json(); html += j.rows ? `<span class="ok">DB '${esc(j.title)}' 접근 가능</span>` : `<span class="bad">DB는 찾았지만 계약을 하나도 읽지 못합니다 — 노션 통합의 '콘텐츠 읽기' 권한과 DB 연결을 확인하세요. 이 상태로는 동기화하지 않습니다.</span>`; } else html += `<span class="bad">${esc(await t.text())}</span>`;
        }
        out.innerHTML = html;
      } catch (e) { out.innerHTML = `<span class="bad">${esc(e.message || e)}</span>`; }
    },
    delKey: async () => { await postSettings({ anthropicKey: '' }); closeModal(); openSettings(); },
    delNotion: async () => { await postSettings({ notionToken: '' }); closeModal(); openSettings(); },
    gLogin: async () => {
      await saveSettingsForm();
      const btn = $('#gLoginBtn'), msg = $('#gLoginMsg');
      btn.disabled = true;
      msg.innerHTML = '<span class="spin"></span> 브라우저에서 로그인을 마치면 여기로 돌아옵니다…';
      try {
        const r = await fetch('api/google/login', { method: 'POST' });
        if (!r.ok) throw new Error(await r.text());
        await loadCfg(); gevReset(); closeModal(); render(); openSettings('#secGcal');
        toast('구글 캘린더에 연결했습니다');
      } catch (e) { btn.disabled = false; msg.innerHTML = `<span class="gc-err">${esc(e.message || e)}</span>`; }
    },
    gLogout: async () => { await fetch('api/google/logout', { method: 'POST' }); await loadCfg(); gevReset(); closeModal(); render(); openSettings('#secGcal'); },
    gcalLink: async () => { await saveSettingsForm(); gcalLinkExisting($('#gcalOut')); },
    gcalCals: async () => {
      const box = $('#gcalCals');
      box.innerHTML = '<span><span class="spin"></span> 불러오는 중…</span>';
      try {
        const r = await fetch('api/gcal', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'calendars' }) });
        if (!r.ok) throw new Error(await r.text());
        const cals = (await r.json()).calendars;
        if (!Array.isArray(cals)) throw new Error('캘린더 목록을 받지 못했습니다');
        const chosen = (st.gcalShow || []).length ? st.gcalShow : [st.gcalCalendar];
        box.innerHTML = cals.map((c) => `<label class="check"><input type="checkbox" data-gshow value="${esc(c.id)}"${chosen.includes(c.id) ? ' checked' : ''}><span class="dot" style="background:${esc(c.color)}"></span>${esc(c.name)}</label>`).join('') + '<span class="hint">고른 뒤 설정 저장</span>';
      } catch (e) { box.innerHTML = `<span class="gc-err">${esc(e.message || e)}</span>`; }
    },
    pickDocs: async () => {
      const i = $('#sDocsRoot');
      try {
        const r = await fetch('api/pick-folder?start=' + encodeURIComponent(i.value));
        if (!r.ok) throw new Error(await r.text());
        const p = (await r.json()).path; if (p) i.value = p;
      } catch (e) { toast(e.message || String(e)); }
    },
    openDocs: () => fetch('api/docs/open?root=1'),
    folder: () => fetch('api/open-folder'), bfolder: () => fetch('api/open-folder?which=backup'), efolder: () => fetch('api/open-folder?which=export'),
    restore: async () => {
      const r = $('input[name=bk]:checked'); if (!r) return;
      const res = await fetch('api/restore?name=' + encodeURIComponent(r.value), { method: 'POST' });
      if (!res.ok) { toast('복원 실패: ' + (await res.text())); return; }
      data = normalize(await res.json()); reindex(); ui.sel = null; closeModal(); render(); toast('백업으로 복원했습니다 (복원 직전 상태도 백업됨)');
    },
  });
  if (focus) setTimeout(() => { const el = $(focus); if (el) { el.scrollIntoView({ block: 'start' }); const i = el.querySelector('input'); i && i.focus(); } }, 40);
}
async function postSettings(obj) {
  const r = await fetch('api/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(obj) });
  if (!r.ok) throw new Error(await r.text());
  await loadCfg();
}
async function saveSettingsForm() {
  const o = { model: $('#sModel').value, notionDb: $('#sDb').value, notionRelay: $('#sRelay').value.trim(), docsRoot: $('#sDocsRoot').value.trim(), autoSync: $('#sAuto').checked, syncMinutes: Number($('#sMin').value) || 10, proxy: $('#sProxy').value };
  if ($('#sKey').value.trim()) o.anthropicKey = $('#sKey').value.trim();
  if ($('#sNotion').value.trim()) o.notionToken = $('#sNotion').value.trim();
  if ($('#sGSecret') && $('#sGSecret').value.trim()) o.googleSecret = $('#sGSecret').value.trim();
  o.gcalCalendar = $('#sGcalCal').value.trim();
  if ($$('[data-gshow]').length) o.gcalShow = $$('[data-gshow]').filter((c) => c.checked).map((c) => c.value);
  await postSettings(o);
  docCache.clear(); // 보관 위치가 바뀌었을 수 있다
  gevReset(); // 같이 볼 캘린더가 바뀌었을 수 있으니 다시 받기
  gcalSchedule(800);
}
let cfg = {};
async function loadCfg() { try { cfg = await (await fetch('api/settings')).json(); } catch (e) { cfg = {}; } renderSync(); }

// ---------- 문서로 추가 · 갱신 (Claude) ----------
const FIELD_LABEL = { title: '요약명', school: '학교', category: '항목', phase: '차수', parentId: '상위계약', status: '상태', name: '계약명', no: '계약번호', contractor: '계약자', amount: '계약금액(원)', contractDate: '계약일', startDate: '착수일', endDate: '완수일', contact: '연락처·담당', note: '특이사항' };
let aiFiles = [];
// 계약자 줄마다 (역할) 업체명 · 사업자번호 — 대표·공동·분담 등 모두
function bizList(c) {
  const out = [];
  for (const line of (c || '').split('\n').map((l) => l.trim()).filter(Boolean)) {
    const no = (line.match(/\d{3}-\d{2}-\d{5}/) || [])[0];
    if (!no) continue;
    const role = (line.match(/^\(([가-힣]{2,4})\)/) || [])[1] || ''; // (주)·(유) 같은 법인 표기는 역할이 아님
    const name = line.replace(/^\([가-힣]{2,4}\)\s*/, '').replace(/\s*\(\d{3}-\d{2}-\d{5}\)\s*$/, '').replace(/\s+대표\s+.*$/, '').replace(/\s*\d{3}-\d{2}-\d{5}.*$/, '').trim();
    if (!out.some((b) => b.no === no)) out.push({ role, name: name || no, no });
  }
  return out;
}
function deriveBizno(c) {
  return (c || '').split('\n').map((l) => l.trim()).filter(Boolean)
    .map((l) => l.replace(/\s*\(\d{3}-\d{2}-\d{5}\)\s*$/, '').replace(/\s+대표\s+.*$/, '')).join('\n');
}
function aiContext(mode, cur) {
  const strip = (x) => { const o = {}; for (const k of Object.keys(FIELD_LABEL)) o[k] = x[k]; return o; };
  const pick = (fn) => data.items.find(fn);
  const ex = [
    pick((x) => x.phase === '총괄' && x.category === '공사' && x.contractor.includes('(공동)')),
    pick((x) => x.parentId && /\d차/.test(x.phase) && x.note),
    pick((x) => x.category === '관급자재' && x.note.includes('수수료')),
    pick((x) => x.category === '설계' && x.no && x.note),
    pick((x) => x.category === '폐기물' && x.contractor),
  ].filter(Boolean).map(strip);
  const parents = data.items.filter((x) => x.phase === '총괄' && isTop(x)).map((x) => ({ id: x.id, title: x.title, school: x.school, name: x.name }));
  return { mode, today: todayStr(), schools: data.options.schools, categories: data.options.categories, phases: data.options.phases, parents, examples: ex, current: cur ? strip(cur) : null };
}
function openAIModal(mode, files) {
  if (!cfg.hasAnthropicKey) {
    modal(`<div class="m-head"><h2 id="modalTitle">Claude API 키가 필요합니다</h2></div>
      <div class="m-body"><p>문서를 읽어 입력칸을 채우려면 Claude API 키를 한 번 넣어 두어야 합니다. 키는 claude.ai 구독과 별개로 console.anthropic.com에서 발급하며 사용한 만큼 과금됩니다.</p></div>
      <div class="m-foot"><button type="button" class="btn" data-m="cancel">닫기</button><button type="button" class="btn primary" data-m="ok">설정 열기</button></div>`,
    { ok: () => { closeModal(); openSettings('#secAI'); } });
    return;
  }
  const cur = mode === 'update' ? byId.get(ui.sel) : null;
  aiFiles = files ? [...files] : [];
  modal(`<div class="m-head"><h2 id="modalTitle">${mode === 'update' ? '문서로 계약 갱신' : '문서로 새 계약 추가'}</h2><button type="button" class="icon-btn" data-m="cancel" aria-label="닫기">${ICON.x}</button></div>
    <div class="m-body" id="aiBody">
      ${cur ? `<p class="muted">'${esc(cur.title)}'에 변경계약서 등 새 문서 내용을 반영합니다. 바뀐 칸만 골라 적용할 수 있습니다.</p>` : '<p class="muted">계약서, 나라장터 계약정보, 착공계, 납품요구서 등을 넣으면 Claude가 읽고 입력칸을 채웁니다. 여러 파일을 함께 넣어도 됩니다.</p>'}
      <label class="drop" id="drop">
        <input type="file" id="aiInput" multiple accept=".pdf,.png,.jpg,.jpeg,.webp,.gif,.hwp,.hwpx,.docx,.txt" class="sr">
        <svg aria-hidden="true" viewBox="0 0 24 24" style="width:28px;height:28px"><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6M12 18v-6M9 15l3-3 3 3"/></svg>
        <strong>파일을 여기로 끌어 놓거나 눌러서 선택</strong>
        <span>PDF · 이미지(스캔) · HWP · HWPX · DOCX · TXT</span>
      </label>
      <div id="aiList" class="file-list"></div>
      <label class="fld">또는 내용 붙여넣기 <span class="hint">나라장터 화면 등에서 복사한 텍스트</span><textarea id="aiPaste" rows="3"></textarea></label>
      <p class="hint" style="margin:0">문서 내용은 Claude API(Anthropic)로 전송됩니다. 기관 보안 지침에 맞는 문서만 넣어 주세요.</p>
    </div>
    <div class="m-foot"><button type="button" class="btn" data-m="cancel">취소</button><button type="button" class="btn primary" data-m="ok" id="aiGo">Claude로 읽기</button></div>`,
  { ok: () => runAI(mode, cur) });
  const inp = $('#aiInput');
  inp.addEventListener('change', () => { aiFiles.push(...inp.files); inp.value = ''; renderAIFiles(); });
  const dz = $('#drop');
  dz.addEventListener('dragover', (e) => { e.preventDefault(); dz.classList.add('over'); });
  dz.addEventListener('dragleave', () => dz.classList.remove('over'));
  dz.addEventListener('drop', (e) => { e.preventDefault(); e.stopPropagation(); dz.classList.remove('over'); aiFiles.push(...e.dataTransfer.files); renderAIFiles(); });
  renderAIFiles();
}
function renderAIFiles() {
  const el = $('#aiList'); if (!el) return;
  el.innerHTML = aiFiles.map((f, i) => `<div class="file"><span>${esc(f.name)}</span><span class="muted">${(f.size / 1024 / 1024).toFixed(1)}MB</span><button type="button" class="icon-btn" style="width:28px;height:28px" data-rmfile="${i}" aria-label="${esc(f.name)} 빼기">${ICON.x}</button></div>`).join('');
}
async function runAI(mode, cur) {
  const pasted = ($('#aiPaste') || {}).value || '';
  if (!aiFiles.length && !pasted.trim()) { toast('문서를 넣거나 내용을 붙여넣어 주세요'); return; }
  const fd = new FormData();
  aiFiles.forEach((f) => fd.append('files', f, f.name));
  fd.append('pasted', pasted);
  fd.append('context', JSON.stringify(aiContext(mode, cur)));
  $('#aiBody').innerHTML = `<div class="ai-wait"><span class="spin lg"></span><strong>Claude가 문서를 읽는 중입니다</strong><span class="muted">보통 10~40초 걸립니다. 창을 닫지 마세요.</span></div>`;
  $('#aiGo').disabled = true;
  let res;
  try {
    const r = await fetch('api/ai/extract', { method: 'POST', body: fd });
    if (!r.ok) throw new Error(await r.text());
    res = await r.json();
  } catch (e) {
    $('#aiBody').innerHTML = `<div class="ai-wait"><strong style="color:var(--bad-ink)">읽지 못했습니다</strong><span>${esc(e.message || e)}</span></div>`;
    $('#aiGo').disabled = false; $('#aiGo').textContent = '다시 시도';
    modalHandlers.ok = () => openAIModal(mode, aiFiles);
    return;
  }
  const f = res.fields || {};
  f.amount = Number(f.amount) || 0;
  f.parentId = f.parentId && byId.has(f.parentId) ? f.parentId : null;
  const review = [...(f.review || []), ...(res.notes || [])];
  delete f.review;
  const files = aiFiles.slice(); // 확인하면 계약 문서로 보관
  if (mode === 'update' && cur) return showDiff(cur, f, review, files);
  closeModal();
  const item = blank({ ...f, bizno: deriveBizno(f.contractor), _biznoAuto: true, _ai: { review, at: new Date().toISOString() } });
  if (item.parentId) ui.expanded.add(item.parentId);
  if (files.length) pendingDocs.set(item.id, files);
  addItem(item);
  toast('Claude가 입력칸을 채웠습니다 — 내용 확인 후 "확인 완료"를 눌러 주세요');
}
function showDiff(cur, f, review, files) {
  files = files || [];
  const keys = Object.keys(FIELD_LABEL).filter((k) => f[k] !== undefined && String(f[k] ?? '') !== String(cur[k] ?? ''));
  const show = (k, v) => k === 'amount' ? fmt(v) : k === 'parentId' ? (byId.get(v)?.title || '없음') : esc(v || '—');
  modal(`<div class="m-head"><h2 id="modalTitle">바뀐 내용 확인</h2><button type="button" class="icon-btn" data-m="cancel" aria-label="닫기">${ICON.x}</button></div>
    <div class="m-body">
      ${review.length ? `<div class="ai-banner"><strong>확인할 점</strong><ul>${review.map((r) => `<li>${esc(r)}</li>`).join('')}</ul></div>` : ''}
      ${keys.length ? `<div class="diff">${keys.map((k) => `<label class="drow"><input type="checkbox" data-dk="${k}" checked><span class="dk">${FIELD_LABEL[k]}</span><span class="dv"><del>${show(k, cur[k])}</del><ins>${show(k, f[k])}</ins></span></label>`).join('')}</div>` : '<p>문서 내용이 지금 대장과 같습니다. 바꿀 칸이 없습니다.</p>'}
      ${files.length ? `<label class="check" style="margin:0"><input type="checkbox" id="diffDocs" checked>넣은 문서 ${files.length}개를 계약 문서에 보관</label>` : ''}
    </div>
    <div class="m-foot"><button type="button" class="btn" data-m="cancel">닫기</button>${keys.length ? '<button type="button" class="btn primary" data-m="ok">선택한 칸 적용</button>' : files.length ? '<button type="button" class="btn primary" data-m="ok">문서만 보관</button>' : ''}</div>`,
  { ok: () => {
    const sel = $$('[data-dk]').filter((c) => c.checked).map((c) => c.dataset.dk);
    const keepDocs = files.length > 0 && (!$('#diffDocs') || $('#diffDocs').checked);
    const changes = sel.map((k) => ({ k, from: cur[k], to: f[k] }));
    const confirmBizno = true; // 계약자가 바뀌면 비즈노넷 표기도 새 계약자 기준으로
    for (const k of sel) cur[k] = f[k];
    if (sel.includes('contractor') && (!cur.bizno || cur._biznoAuto || confirmBizno)) { cur.bizno = deriveBizno(cur.contractor); cur._biznoAuto = true; }
    addHistory(cur, '문서로 갱신', changes, keepDocs ? files.map((fl) => fl.name) : []);
    if (sel.length) touch(cur);
    reindex(); closeModal(); render(); scheduleSave();
    if (keepDocs) {
      const labels = sel.map((k) => (FIELD_LABEL[k] || k).replace(/\(원\)$/, ''));
      uploadDocs(cur, files, `${todayStr()} ${labels.length ? '변경 - ' + (labels.length > 4 ? labels.slice(0, 4).join('·') + ' 외 ' + (labels.length - 4) : labels.join('·')) : '자료 추가'}`);
    }
    if (sel.length) toast(`${sel.length}개 칸을 반영했습니다`);
  } });
}

// ---------- 변경 이력 ----------
// x.history = [{ at, source: '문서로 갱신'|'직접 수정'|'문서로 추가', changes: [{k, from, to}], files: [이름] }]
const HIST_KEYS = ['name', 'no', 'amount', 'contractDate', 'startDate', 'endDate', 'contractor'];
const same = (a, b) => String(a ?? '') === String(b ?? '');
function addHistory(x, source, changes, files) {
  changes = changes.filter((c) => !same(c.from, c.to));
  if (!changes.length && !(files && files.length) && source !== '문서로 추가') return;
  const h = x.history || (x.history = []);
  const last = h[h.length - 1], now = new Date();
  // 직접 고친 건 10분 안이면 한 기록으로 묶는다
  if (source === '직접 수정' && last && last.source === source && now - new Date(last.at) < 600000) {
    for (const c of changes) { const o = last.changes.find((z) => z.k === c.k); if (o) o.to = c.to; else last.changes.push(c); }
    last.changes = last.changes.filter((c) => !same(c.from, c.to));
    last.at = now.toISOString();
    if (!last.changes.length) h.pop();
    return;
  }
  h.push({ at: now.toISOString(), source, changes, files: files || [] });
}
function histVal(k, v) {
  if (k === 'amount') return v ? fmt(v) : '—';
  if (k === 'parentId') return (v && byId.get(v)?.title) || '없음';
  return v ? String(v) : '—';
}
function histHtml(x) {
  const h = x.history || [];
  if (!h.length) return '';
  const items = h.map((e, i) => [e, i]).reverse().map(([e, i]) => {
    const ch = e.changes.map((c) => {
      const df = c.k === 'amount' && c.from && c.to ? c.to - c.from : 0;
      return `<li><span class="hk">${FIELD_LABEL[c.k] || c.k}</span><span class="hv"><del>${esc(histVal(c.k, c.from))}</del> → <ins>${esc(histVal(c.k, c.to))}</ins>${df ? ` <span class="muted">(${df > 0 ? '+' : ''}${fmt(df)})</span>` : ''}</span></li>`;
    }).join('');
    const files = e.files && e.files.length ? `<div class="hf">${ICON.doc}<span>${e.files.map(esc).join(', ')}</span></div>` : '';
    return `<div class="h-item"><div class="h-top"><b>${new Date(e.at).toLocaleDateString('ko-KR')}</b><span class="h-src">${esc(e.source)}</span><span class="sp"></span><button type="button" class="h-del" data-hdel="${i}" aria-label="이 기록 지우기" title="이 기록 지우기">${ICON.x}</button></div>${ch ? `<ul>${ch}</ul>` : e.source === '문서로 추가' ? '<div class="muted">문서로 새로 등록</div>' : ''}${files}</div>`;
  }).join('');
  return `<div class="sec"><div class="sec-h"><span>변경 이력 ${h.length}건</span></div><div class="hist">${items}</div></div>`;
}
let fieldStart = null; // 직접 고치기 시작할 때의 값
function noteFieldStart(e) {
  const f = e.target.closest('[data-k]'), x = ui.sel && byId.get(ui.sel);
  if (f && x && HIST_KEYS.includes(f.dataset.k)) fieldStart = { id: x.id, k: f.dataset.k, v: x[f.dataset.k] };
}
function recordFieldChange(x, k) {
  if (!fieldStart || fieldStart.id !== x.id || fieldStart.k !== k || same(fieldStart.v, x[k])) return;
  addHistory(x, '직접 수정', [{ k, from: fieldStart.v, to: x[k] }]);
  fieldStart.v = x[k];
}

// ---------- 계약 문서 보관 ----------
// 파일은 데이터 폴더의 문서\학교\요약명 폴더에, 계약에는 그 상대 경로(x.docDir)만
const docCache = new Map(), pendingDocs = new Map(); // docDir → 파일 목록, 계약 id → 확인 전 문서
function docsHtml(x) {
  return `<div class="sec doc-box" data-docdrop><div class="sec-h"><span>계약 문서</span><span class="row-btns"><button type="button" class="btn sm ghost" data-act="docAdd">${ICON.plus}파일 추가</button>${x.docDir ? '<button type="button" class="btn sm ghost" data-act="docFolder">폴더 열기</button>' : ''}</span></div>
    <div class="doc-list" id="docList">${docListHtml(x)}</div><input type="file" id="docInput" multiple class="sr" tabindex="-1" aria-hidden="true"></div>`;
}
function docListHtml(x) {
  if (!x.docDir) return '<div class="doc-empty">보관한 문서가 없습니다. 파일을 여기로 끌어 놓거나 \'파일 추가\'를 누르세요.</div>';
  const files = docCache.get(x.docDir);
  if (!files) return '<div class="doc-empty"><span class="spin"></span> 불러오는 중…</div>';
  if (!files.length) return '<div class="doc-empty">폴더가 비어 있습니다.</div>';
  const size = (n) => (n >= 1048576 ? (n / 1048576).toFixed(1) + 'MB' : Math.max(1, Math.round(n / 1024)) + 'KB');
  let html = '', folder = null;
  for (const f of files) {
    if ((f.folder || '') !== folder) {
      folder = f.folder || '';
      if (folder) html += `<button type="button" class="doc doc-folder" data-docopen="${esc(folder)}" title="'${esc(folder)}' 폴더 열기"><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg><span class="dn">${esc(folder)}</span></button>`;
    }
    const base = f.name.slice(folder ? folder.length + 1 : 0);
    html += `<button type="button" class="doc${folder ? ' in-folder' : ''}" data-docopen="${esc(f.name)}" title="${esc(base)} 열기">${ICON.doc}<span class="dn">${esc(base)}</span><span class="muted">${size(f.size)} · ${new Date(f.modified).toLocaleDateString('ko-KR')}</span></button>`;
  }
  return html;
}
async function loadDocs(x, force) {
  if (!x || !x.docDir || (docCache.has(x.docDir) && !force)) return;
  try {
    const r = await fetch('api/docs/list?dir=' + encodeURIComponent(x.docDir));
    if (!r.ok) throw new Error(await r.text());
    docCache.set(x.docDir, (await r.json()).files || []);
  } catch (e) { docCache.set(x.docDir, []); }
  const el = ui.sel === x.id && $('#docList');
  if (el) el.innerHTML = docListHtml(x);
}
// sub: 계약명 폴더 안의 날짜·사유 폴더 이름 (예: '2026-11-20 변경 - 계약금액·완수일')
async function uploadDocs(x, files, sub) {
  if (!files || !files.length) return [];
  const fd = new FormData();
  [...files].forEach((f) => fd.append('files', f, f.name));
  fd.append('dir', x.docDir || ''); fd.append('name', x.name || x.title || '계약'); fd.append('sub', sub || `${todayStr()} 자료 추가`);
  try {
    const r = await fetch('api/docs/upload', { method: 'POST', body: fd });
    if (!r.ok) throw new Error(await r.text());
    const res = await r.json();
    if (x.docDir !== res.dir) { x.docDir = res.dir; saveQuiet(); }
    docCache.set(res.dir, res.files || []);
    if (ui.sel === x.id) renderDetail();
    toast(`문서 ${(res.saved || []).length}개를 보관했습니다`);
    return res.saved || [];
  } catch (e) { toast('문서 보관 실패: ' + (e.message || e)); return []; }
}

// ---------- 구글 캘린더 ('업무') ----------
// 계약마다 x.gcal = { on, s:{id,title,date}, e:{id,title,date} } — s는 착수, e는 완수 일정
const gc = { busy: false, again: false, timer: null, err: '' };
function gcalWant(x) {
  const t = (x.title || '').trim(), w = {};
  if (!t || !x.gcal || !x.gcal.on) return w;
  if (x.startDate) w.s = { title: `(착수) ${t}`, date: x.startDate };
  if (x.endDate) w.e = { title: `(완수) ${t}`, date: x.endDate };
  return w;
}
const gcalSame = (a, b) => a && b && a.id && a.title === b.title && a.date === b.date;
function gcalPending(x) {
  if (!x.gcal || x._ai) return false;
  const w = gcalWant(x);
  return ['s', 'e'].some((k) => (w[k] ? !gcalSame(x.gcal[k], w[k]) : !!(x.gcal[k] && x.gcal[k].id)));
}
function gcalSchedule(ms) {
  if (!cfg.hasGcal) return;
  clearTimeout(gc.timer);
  gc.timer = setTimeout(gcalRun, ms || 2500);
}
async function gcalRun() {
  if (!cfg.hasGcal || !data) return;
  if (gc.busy) { gc.again = true; return; }
  const ops = [], refs = [];
  for (const x of data.items) {
    if (!x.gcal || x._ai) continue;
    const w = gcalWant(x);
    for (const k of ['s', 'e']) {
      const cur = x.gcal[k];
      if (w[k] && !gcalSame(cur, w[k])) {
        ops.push({ op: 'upsert', id: (cur && cur.id) || '', title: w[k].title, date: w[k].date, prevTitle: (cur && cur.title) || '', prevDate: (cur && cur.date) || '' });
        refs.push({ x, k, w: w[k] });
      } else if (!w[k] && cur && cur.id) {
        ops.push({ op: 'delete', id: cur.id });
        refs.push({ x, k, w: null });
      }
    }
  }
  const now = Date.now(); // 삭제한 계약의 일정은 되돌리기 시간이 지난 뒤 지운다
  for (const t of data.gcalTrash || []) if (now - t.at > 12000) { ops.push({ op: 'delete', id: t.id }); refs.push({ trash: t }); }
  if ((data.gcalTrash || []).some((t) => now - t.at <= 12000)) gcalSchedule(13000);
  if (!ops.length) { if (gc.err) { gc.err = ''; renderGcalState(); } return; }
  gc.busy = true; renderGcalState();
  let changed = false, err = '';
  try {
    for (let i = 0; i < ops.length; i += 40) {
      const r = await fetch('api/gcal', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ops: ops.slice(i, i + 40) }) });
      if (!r.ok) throw new Error(await r.text());
      const res = (await r.json()).results || [];
      res.forEach((o, j) => {
        const ref = refs[i + j];
        if (!o || !o.ok) { err = (o && o.error) || '알 수 없는 오류'; return; }
        changed = true;
        if (ref.trash) data.gcalTrash = (data.gcalTrash || []).filter((t) => t !== ref.trash);
        else if (ref.w) ref.x.gcal[ref.k] = { id: o.id, title: ref.w.title, date: ref.w.date };
        else delete ref.x.gcal[ref.k];
      });
    }
  } catch (e) {
    err = e.message || String(e);
  } finally {
    gc.busy = false; gc.err = err;
    if (changed) saveQuiet();
    renderGcalState();
    if (gc.again) { gc.again = false; gcalSchedule(500); }
  }
}
// 캘린더 기록만 바뀐 저장 — 노션 보낼 변경으로 치지 않도록 updatedAt은 건드리지 않는다
function saveQuiet() { clearTimeout(saveTimer); saveTimer = setTimeout(saveNow, 300); }
function gcalBadge() {
  if (gc.busy) return '<span class="spin"></span> 구글 캘린더 맞추는 중';
  if (gc.err) return `<span class="gc-err">구글 캘린더 오류 — ${esc(gc.err)}</span>`;
  const n = data.items.filter(gcalPending).length;
  return n ? `구글 캘린더에 보낼 일정 ${n}건` : '구글 캘린더와 맞춰짐';
}
function renderGcalState() {
  const b = $('#calendarView .cal-gc'); if (b) b.innerHTML = gcalBadge();
  const d = $('#gcState'); if (d) d.innerHTML = gcalDetailState(ui.sel && byId.get(ui.sel));
}
function gcalDetailState(x) {
  if (!x) return '';
  if (!cfg.hasGcal) return '<button type="button" class="link-btn" data-act="gcalSetup">설정에서 구글 캘린더를 연결하면 등록됩니다</button>';
  if (!x.gcal || !x.gcal.on) return '<span class="muted">등록하지 않음</span>';
  const w = gcalWant(x);
  if (!w.s && !w.e) return '<span class="muted">착수일·완수일을 넣으면 등록됩니다</span>';
  const line = (k, nm) => w[k] ? `<span>${nm} ${shortD(w[k].date)} ${gcalSame(x.gcal[k], w[k]) ? '<b class="ok">등록됨</b>' : gc.busy ? '<span class="spin"></span>' : gc.err ? '<b class="bad">실패</b>' : '<span class="muted">대기</span>'}</span>` : '';
  return line('s', '착수') + line('e', '완수') + (gc.err && !gc.busy ? `<span class="gc-err">${esc(gc.err)}</span>` : '');
}
// 이미 캘린더에 있는 같은 제목·날짜 일정을 찾아 계약과 연결 (예전에 손으로 넣은 일정)
async function gcalLinkExisting(out) {
  const ops = [], refs = [];
  for (const x of data.items) {
    if (x.gcal && (x.gcal.on === false || (x.gcal.s && x.gcal.s.id) || (x.gcal.e && x.gcal.e.id))) continue;
    const t = (x.title || '').trim(); if (!t) continue;
    if (x.startDate) { ops.push({ op: 'find', title: `(착수) ${t}`, date: x.startDate }); refs.push([x, 's']); }
    if (x.endDate) { ops.push({ op: 'find', title: `(완수) ${t}`, date: x.endDate }); refs.push([x, 'e']); }
  }
  if (!ops.length) { out.innerHTML = '<span class="ok">연결할 계약이 없습니다</span>'; return; }
  let found = 0;
  const hit = new Set();
  try {
    for (let i = 0; i < ops.length; i += 40) {
      out.innerHTML = `<span><span class="spin"></span> 일정 찾는 중… ${i}/${ops.length}</span>`;
      const r = await fetch('api/gcal', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ops: ops.slice(i, i + 40) }) });
      if (!r.ok) throw new Error(await r.text());
      ((await r.json()).results || []).forEach((o, j) => {
        if (!o || !o.ok || !o.id) return;
        const [x, k] = refs[i + j], op = ops[i + j];
        x.gcal = Object.assign({ on: true }, x.gcal, { on: true });
        x.gcal[k] = { id: o.id, title: op.title, date: op.date };
        found++; hit.add(x.id);
      });
    }
    saveQuiet();
    out.innerHTML = `<span class="ok">일정 ${found}개를 계약 ${hit.size}건과 연결했습니다</span><span class="muted">찾지 못한 ${ops.length - found}개는 요약명이 바뀌었거나 캘린더에 없는 일정입니다</span>`;
    render();
  } catch (e) { out.innerHTML = `<span class="bad">${esc(e.message || e)}</span>`; }
}

// ---------- 노션 동기화 ----------
let syncing = false, syncTimer = null;
function pendingCount() {
  const ls = data.lastSync || '';
  return data.items.filter((x) => x.id.startsWith('l') || (x.updatedAt && x.updatedAt > ls)).length + (data.deleted || []).length;
}
function ago(iso) {
  const m = Math.round((Date.now() - new Date(iso)) / 60000);
  if (m < 1) return '방금'; if (m < 60) return `${m}분 전`;
  const h = Math.round(m / 60); if (h < 24) return `${h}시간 전`;
  return new Date(iso).toLocaleDateString('ko-KR');
}
function renderSync() {
  const el = $('#syncBox'); if (!el || !data) return;
  if (!cfg.hasNotionToken) { el.innerHTML = `<button type="button" class="link-btn" data-act="notionSetup">노션 동기화 설정</button>`; return; }
  const p = pendingCount();
  el.innerHTML = `<div class="sync-line"><span>${syncing ? '<span class="spin"></span> 노션과 맞추는 중…' : `노션 ${data.lastSync ? ago(data.lastSync) + ' 동기화' : '동기화 전'}`}</span>
    <button type="button" class="btn sm" data-act="sync" ${syncing ? 'disabled' : ''}>지금 동기화</button></div>
    ${p && !syncing ? `<span class="pend">보낼 변경 ${p}건</span>` : ''}`;
}
async function syncNow(auto) {
  if (syncing) return;
  if (!cfg.hasNotionToken) { if (!auto) openSettings('#secNotion'); return; }
  syncing = true; document.body.classList.add('syncing'); renderSync();
  try {
    clearTimeout(saveTimer); await saveNow();
    while (saving) await new Promise((r) => setTimeout(r, 100));
    const r = await fetch('api/notion/sync', { method: 'POST' });
    if (!r.ok) throw new Error(await r.text());
    const out = await r.json();
    data = normalize(out.data); reindex();
    if (ui.sel && !byId.has(ui.sel)) ui.sel = null;
    const rp = out.report || {};
    const parts = [];
    if (rp.Pulled + rp.AddedLocal) parts.push(`받음 ${rp.Pulled + rp.AddedLocal}`);
    if (rp.Pushed + rp.Created) parts.push(`보냄 ${rp.Pushed + rp.Created}`);
    if (rp.Archived + rp.RemovedLocal) parts.push(`삭제 반영 ${rp.Archived + rp.RemovedLocal}`);
    let msg = '노션 동기화 완료' + (parts.length ? ' — ' + parts.join(' · ') : ' — 바뀐 내용 없음');
    if (rp.Conflicts && rp.Conflicts.length) msg += ` · 양쪽 수정 ${rp.Conflicts.length}건은 최근 수정 쪽으로 맞춤(${rp.Conflicts.slice(0, 3).join(', ')})`;
    if (rp.Errors && rp.Errors.length) msg += ` · 실패 ${rp.Errors.length}건: ${rp.Errors[0]}`;
    if (!auto || parts.length || (rp.Errors && rp.Errors.length)) toast(msg);
  } catch (e) {
    if (!auto) toast('노션 동기화 실패: ' + (e.message || e));
    else setSaveState('자동 동기화 실패 — ' + esc(e.message || e), true);
  } finally {
    syncing = false; document.body.classList.remove('syncing'); render(); renderSync();
    gcalSchedule(); // 노션에서 바뀐 요약명·날짜도 캘린더에 반영
  }
}
function setupAutoSync() {
  clearInterval(syncTimer);
  if (cfg.autoSync && cfg.hasNotionToken) {
    syncTimer = setInterval(() => {
      const busyInput = document.activeElement && document.activeElement.closest && document.activeElement.closest('#detail,.modal');
      if (!busyInput && $('#modalBack').hidden) syncNow(true);
    }, Math.max(1, cfg.syncMinutes || 10) * 60000);
  }
}

async function exportXlsx() {
  const rows = [];
  for (const g of visibleTree()) for (const r of g.rows) {
    const push = (x, lvl) => rows.push({ school: x.school, title: x.title, category: x.category, phase: x.phase, status: x.status, parent: (x.parentId && byId.get(x.parentId)?.title) || '', name: x.name, no: x.no, contractor: x.contractor, amount: x.amount || 0, contractDate: x.contractDate, startDate: x.startDate, endDate: x.endDate, contact: x.contact, bizno: x.bizno, note: x.note, level: lvl });
    push(r.item, 0);
    for (const k of (filtering() ? r.kids : r.allKids)) push(k, 1);
  }
  const title = '계약 추진현황_' + (ui.school === '__all' ? '전체' : ui.school);
  try {
    const res = await fetch('api/export', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title, rows }) });
    if (!res.ok) throw new Error(await res.text());
    toast(`엑셀 ${rows.length}건 저장 — 내보내기 폴더가 열립니다`);
  } catch (e) { toast('내보내기 실패: ' + (e.message || e)); }
}

// ---------- 화면 테마 ----------
const darkMQ = window.matchMedia ? matchMedia('(prefers-color-scheme: dark)') : null;
function themeMode() { try { return localStorage.getItem('dm-theme') || 'system'; } catch (e) { return 'system'; } }
function applyTheme(mode) {
  if (mode) { try { localStorage.setItem('dm-theme', mode); } catch (e) { /* 무시 */ } }
  const m = themeMode();
  const dark = m === 'dark' || (m === 'system' && darkMQ && darkMQ.matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  fetch('api/theme?dark=' + (dark ? 1 : 0)).catch(() => {}); // 창 제목 표시줄도 같은 테마로
  $$('[data-theme-set]').forEach((b) => { b.classList.toggle('on', b.dataset.themeSet === m); b.setAttribute('aria-pressed', b.dataset.themeSet === m); });
}
if (darkMQ) darkMQ.addEventListener('change', () => { if (themeMode() === 'system') applyTheme(); });

// ---------- 환경설정 기억 ----------
function savePrefs() {
  try { localStorage.setItem('dm-prefs', JSON.stringify({ view: ui.view, school: ui.school, expandAll: ui.expandAll, activeOnly: ui.activeOnly, expanded: [...ui.expanded], colW: ui.colW, collapsed: [...ui.collapsed], calSide: ui.calSide, calShowContracts: ui.calShowContracts })); } catch (e) { /* 무시 */ }
}
function loadPrefs() {
  try {
    const p = JSON.parse(localStorage.getItem('dm-prefs') || '{}');
    if (p.view === 'list' || p.view === 'calendar') ui.view = p.view; // 기간 타임라인은 없앰 if (p.school) ui.school = p.school;
    ui.expandAll = !!p.expandAll; if (p.activeOnly === false) ui.activeOnly = false;
    if (Array.isArray(p.expanded)) ui.expanded = new Set(p.expanded);
    if (p.colW && typeof p.colW === 'object') ui.colW = p.colW;
    if (Array.isArray(p.collapsed)) ui.collapsed = new Set(p.collapsed);
    if (p.calSide === false) ui.calSide = false;
    if (p.calShowContracts === false) ui.calShowContracts = false;
  } catch (e) { /* 무시 */ }
}

function normalize(d) {
  d.options = d.options || {};
  d.options.schools = d.options.schools || [];
  d.options.categories = d.options.categories || [];
  d.options.phases = d.options.phases || ['단일', '총괄', '1차', '2차', '3차'];
  d.options.statuses = d.options.statuses || ['진행', '중지', '완료'];
  const base = { title: '', school: '*미지정', category: '', phase: '단일', status: '진행', name: '', no: '', contractor: '', amount: 0, contractDate: '', startDate: '', endDate: '', contact: '', bizno: '', note: '', parentId: null };
  d.items = (d.items || []).map((x) => Object.assign({}, base, x, { id: x.id || newId() }));
  return d;
}

// ---------- 이벤트 ----------
function bind() {
  document.addEventListener('click', (e) => {
    const t = e.target;
    const v = t.closest('[data-view]'); if (v) { ui.view = v.dataset.view; render(); return; }
    const s = t.closest('[data-school]'); if (s) { ui.school = s.dataset.school; ui.kpi = null; render(); return; }
    const st = t.closest('[data-status]'); if (st) { ui.status = st.dataset.status; render(); return; }
    const k = t.closest('[data-kpi]'); if (k) { ui.kpi = ui.kpi === k.dataset.kpi ? null : k.dataset.kpi; if (ui.kpi) ui.status = '전체'; render(); return; }
    const so = t.closest('[data-sort]');
    if (so) { const key = so.dataset.sort; if (ui.sort.key === key) { if (ui.sort.dir > 0) ui.sort.dir = -1; else ui.sort = { key: null, dir: 1 }; } else ui.sort = { key, dir: 1 }; render(); return; }
    const tg = t.closest('[data-tog]');
    if (tg) { const id = tg.dataset.tog; if (ui.expandAll) { ui.expandAll = false; data.items.filter((x) => kids.has(x.id)).forEach((x) => ui.expanded.add(x.id)); } ui.expanded.has(id) ? ui.expanded.delete(id) : ui.expanded.add(id); render(); return; }
    const go = t.closest('[data-goto]'); if (go) { select(go.dataset.goto, true); return; }
    const cpb = t.closest('[data-cp]'); if (cpb) { copyCell(cpb); return; } // 행 선택보다 먼저
    const dop = t.closest('[data-docopen]');
    if (dop) { const x = byId.get(ui.sel); if (x && x.docDir) fetch(`api/docs/open?dir=${encodeURIComponent(x.docDir)}&name=${encodeURIComponent(dop.dataset.docopen)}`).then((r) => { if (!r.ok) r.text().then((m) => { toast(m); loadDocs(x, true); }); }); return; }
    const hd = t.closest('[data-hdel]');
    if (hd) {
      const x = byId.get(ui.sel); if (!x || !x.history) return;
      const i = Number(hd.dataset.hdel), gone = x.history.splice(i, 1)[0];
      saveQuiet(); renderDetail();
      toast('변경 이력 1건을 지웠습니다', '되돌리기', () => { x.history.splice(i, 0, gone); saveQuiet(); renderDetail(); });
      return;
    }
    const gt = t.closest('[data-grptog]');
    if (gt) { const k = gt.dataset.grptog; ui.collapsed.has(k) ? ui.collapsed.delete(k) : ui.collapsed.add(k); renderList(); savePrefs(); return; }
    if (t.closest('[data-grpall]')) { const all = visibleTree().map((g) => g.school); if (all.every((k) => ui.collapsed.has(k))) ui.collapsed.clear(); else all.forEach((k) => ui.collapsed.add(k)); renderTop(); renderList(); savePrefs(); return; }
    if (t.closest('[data-calside]')) { ui.calSide = !ui.calSide; savePrefs(); renderCalendar(); return; }
    if (t.closest('[data-calref]')) { gcals = null; gevReset(); loadGcals(true); return; }
    if (t.closest('[data-calnew]')) { openCalEditor({ date: (ui.calMonth || todayStr().slice(0, 7)) === todayStr().slice(0, 7) ? todayStr() : ui.calMonth + '-01' }); return; }
    const gvb = t.closest('[data-gev]');
    if (gvb) { const ev = gevIndex.get(gvb.dataset.gev); if (ev) openCalEditor({ ev: Object.assign({}, ev) }); return; }
    const ceb = t.closest('[data-ce]');
    if (ceb) { const a = ceb.dataset.ce; if (a === 'close') closeCalEditor(); else if (a === 'save') saveCalEditor(); else if (a === 'del') deleteCalEditor(); else if (a === 'dup' && ui.calEdit && ui.calEdit.ev) gevDuplicate(ui.calEdit.ev); return; }
    const cmb = t.closest('[data-cm]'); if (cmb) { runCalMenu(cmb.dataset.cm); return; }
    closeCalMenu();
    if (ui.calEdit && !t.closest('.cal-ed')) closeCalEditor();
    const th_ = t.closest('[data-theme-set]'); if (th_) { applyTheme(th_.dataset.themeSet); return; }
    const cal = t.closest('[data-cal]');
    if (cal) { const c = cal.dataset.cal; if (c === 'prev') calMove(-1); else if (c === 'next') calMove(1); else if (c === 'today') calGoto(todayStr().slice(0, 7), true); else { ui.calMore = null; const p = $('#calendarView .cal-pop'); if (p) p.remove(); } return; }
    const more = t.closest('[data-more]'); if (more) { ui.calMore = more.dataset.more; renderCalendar(); return; }
    const row = t.closest('tr.row,.cal-ev[data-id]'); if (row) { select(row.dataset.id); return; }
    if (ui.calMore && !t.closest('.cal-pop')) { ui.calMore = null; renderCalendar(); }
    const a = t.closest('[data-act]');
    if (a) {
      const x = byId.get(ui.sel);
      const act = a.dataset.act;
      if (syncing && ['dup', 'del', 'addPhase', 'aiCancel'].includes(act)) return;
      if (act === 'close') { ui.sel = null; render(); }
      if (act === 'dup' && x) addItem(blank({ ...x, id: newId(), title: x.title + ' (사본)', updatedAt: null, _snap: undefined, _nEdited: undefined, gcal: { on: x.gcal ? !!x.gcal.on : true } }));
      if (act === 'del' && x) removeItem(x);
      if (act === 'addPhase' && x) addPhase(x);
      if (act === 'aiOk' && x) {
        const c = $('#aiGcal'), files = pendingDocs.get(x.id) || [], keep = !$('#aiDocs') || $('#aiDocs').checked;
        pendingDocs.delete(x.id);
        x.gcal = { on: c ? c.checked : true }; delete x._ai;
        addHistory(x, '문서로 추가', [], keep ? files.map((f) => f.name) : []);
        scheduleSave(); render();
        if (keep && files.length) uploadDocs(x, files, `${todayStr()} 최초 등록`);
      }
      if (act === 'docAdd') { const i = $('#docInput'); if (i) i.click(); }
      if (act === 'docFolder' && x && x.docDir) fetch('api/docs/open?dir=' + encodeURIComponent(x.docDir));
      if (act === 'gcalSetup') openSettings('#secGcal');
      if (act === 'aiCancel' && x) { pendingDocs.delete(x.id); data.items = data.items.filter((i) => i.id !== x.id); reindex(); ui.sel = null; render(); scheduleSave(); toast('추가를 취소했습니다'); }
      if (act === 'aiUpdate' && x) openAIModal('update');
      if (act === 'sync') syncNow(false);
      if (act === 'notionSetup') openSettings('#secNotion');
      if (act === 'bizno') fetch('api/open-url?u=' + encodeURIComponent('https://bizno.net/article/' + a.dataset.q.replace(/-/g, '')));
      return;
    }
    const rf = t.closest('[data-rmfile]'); if (rf) { e.preventDefault(); aiFiles.splice(Number(rf.dataset.rmfile), 1); renderAIFiles(); return; }
    const m = t.closest('[data-m]');
    if (m) { const h = modalHandlers[m.dataset.m]; if (m.dataset.m === 'cancel') closeModal(); else if (h) h(); return; }
    if (t === $('#modalBack')) closeModal();
  });
  $('#detail').addEventListener('input', (e) => { if (!syncing) onField(e, false); });
  $('#detail').addEventListener('focusin', noteFieldStart);
  document.addEventListener('change', (e) => {
    const t = e.target;
    if (t.matches('[data-calvis]')) toggleCalVis(t.dataset.calvis, t.checked);
    else if (t.matches('[data-calshowc]')) { ui.calShowContracts = t.checked; savePrefs(); renderCalendar(); }
    else if (t.id === 'ceAll') { $('#ceStime').hidden = t.checked; $('#ceEtime').hidden = t.checked; }
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.id === 'ceTitle') { e.preventDefault(); saveCalEditor(); } });
  // 캘린더: 빈 곳을 두 번 누르면 새 일정, 일정을 끌어 다른 날로 옮기기
  const cv = $('#calendarView');
  cv.addEventListener('contextmenu', (e) => {
    const chip = e.target.closest('[data-gev],.cal-ev[data-id]'); if (!chip) return;
    e.preventDefault(); openCalMenu(e, chip);
  });
  document.addEventListener('scroll', closeCalMenu, true);
  cv.addEventListener('dblclick', (e) => {
    const d = e.target.closest('.cal-day');
    if (!d || e.target.closest('.cal-ev,.cal-more,.cal-ed,.cal-pop') || !cfg.hasGcal) return;
    openCalEditor({ date: d.dataset.date });
  });
  cv.addEventListener('dragstart', (e) => {
    const c = e.target.closest && e.target.closest('[data-drag]'); if (!c) return;
    calDrag = c.dataset.drag; calDragFrom = (c.closest('.cal-day') || {}).dataset?.date;
    e.dataTransfer.setData('text/plain', calDrag); e.dataTransfer.effectAllowed = 'move';
    closeCalEditor();
  });
  cv.addEventListener('dragover', (e) => {
    if (!calDrag) return;
    const d = e.target.closest('.cal-day'); if (!d) return;
    e.preventDefault(); e.dataTransfer.dropEffect = 'move';
    $$('#calendarView .cal-day.drop-over').forEach((x) => { if (x !== d) x.classList.remove('drop-over'); });
    d.classList.add('drop-over');
  });
  const endDrag = () => { calDrag = null; $$('#calendarView .cal-day.drop-over').forEach((x) => x.classList.remove('drop-over')); };
  cv.addEventListener('dragend', endDrag);
  cv.addEventListener('drop', (e) => {
    if (!calDrag) return;
    e.preventDefault(); e.stopPropagation();
    const d = e.target.closest('.cal-day'), payload = calDrag, from = calDragFrom;
    endDrag();
    if (d) calDropTo(payload, from, d.dataset.date);
  });
  $('#detail').addEventListener('change', (e) => {
    if (e.target.id === 'docInput') {
      const x = byId.get(ui.sel), files = [...e.target.files];
      e.target.value = '';
      if (x && files.length) uploadDocs(x, files);
      return;
    }
    if (e.target.matches('[data-gcal]')) {
      const x = byId.get(ui.sel); if (!x) return;
      x.gcal = Object.assign({}, x.gcal, { on: e.target.checked });
      scheduleSave(); renderGcalState(); renderView();
      return;
    }
    onField(e, true);
  });
  $('#listView').addEventListener('pointerdown', startColResize);
  $('#listView').addEventListener('dblclick', (e) => { if (e.target.closest('[data-rz]')) { ui.colW = {}; render(); } });
  let qt;
  $('#q').addEventListener('input', (e) => { clearTimeout(qt); qt = setTimeout(() => { ui.q = e.target.value; renderMain(); }, 120); });
  $('#catSel').addEventListener('change', (e) => { ui.cat = e.target.value; render(); });
  $('#expandAll').addEventListener('change', (e) => { ui.expandAll = e.target.checked; if (!ui.expandAll) ui.expanded.clear(); render(); });
  $('#activeOnly').addEventListener('change', (e) => { ui.activeOnly = e.target.checked; render(); });
  $('#btnNew').addEventListener('click', () => addItem(blank()));
  $('#btnAI').addEventListener('click', () => openAIModal('new'));
  // 창 어디에든 파일을 끌어 놓으면 문서로 추가
  let dragN = 0;
  const hasFiles = (e) => e.dataTransfer && [...e.dataTransfer.types].includes('Files');
  window.addEventListener('dragenter', (e) => { if (!hasFiles(e)) return; e.preventDefault(); dragN++; if ($('#modalBack').hidden) document.body.classList.add('dragging'); });
  window.addEventListener('dragleave', () => { if (--dragN <= 0) { dragN = 0; document.body.classList.remove('dragging'); $$('.doc-box').forEach((b) => b.classList.remove('over')); } });
  // 상세 패널의 '계약 문서' 칸 위에서는 새 계약 추가 대신 그 계약의 문서로 보관
  const docBoxAt = (e) => e.target && e.target.closest && e.target.closest('[data-docdrop]');
  window.addEventListener('dragover', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    const box = docBoxAt(e);
    $$('.doc-box').forEach((b) => b.classList.toggle('over', b === box));
    document.body.classList.toggle('dragging', !box && $('#modalBack').hidden);
  });
  window.addEventListener('drop', (e) => {
    e.preventDefault(); dragN = 0; document.body.classList.remove('dragging');
    $$('.doc-box').forEach((b) => b.classList.remove('over'));
    if (!hasFiles(e) || !$('#modalBack').hidden) return;
    const x = docBoxAt(e) && byId.get(ui.sel);
    if (x) { uploadDocs(x, [...e.dataTransfer.files]); return; }
    openAIModal('new', e.dataTransfer.files);
  });
  $('#btnExport').addEventListener('click', exportXlsx);
  $('#btnSettings').addEventListener('click', () => openSettings());
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') { e.preventDefault(); $('#q').focus(); $('#q').select(); }
    else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'n') { e.preventDefault(); addItem(blank()); }
    else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); clearTimeout(saveTimer); saveNow(); }
    else if (e.key === 'Escape') {
      if (!$('#modalBack').hidden) closeModal();
      else if ($('#calMenu')) closeCalMenu();
      else if (ui.calEdit) closeCalEditor();
      else if (ui.calMore) { ui.calMore = null; renderCalendar(); }
      else if (document.activeElement === $('#q') && $('#q').value) { $('#q').value = ''; ui.q = ''; renderMain(); }
      else if (ui.sel) { ui.sel = null; render(); }
    }
  });
  window.addEventListener('beforeunload', () => { if (saveTimer) { clearTimeout(saveTimer); navigator.sendBeacon && navigator.sendBeacon('api/data', new Blob([JSON.stringify(data)], { type: 'application/json' })); } });
  setInterval(() => fetch('api/ping').catch(() => {}), 10000);
}

async function init() {
  applyTheme();
  loadPrefs();
  bind();
  try {
    data = normalize(await (await fetch('api/data')).json());
    info = await (await fetch('api/info')).json();
  } catch (e) {
    setSaveState('데이터를 불러오지 못했습니다', true);
    return;
  }
  reindex();
  if (ui.school !== '__all' && !data.items.some((x) => x.school === ui.school) && !data.options.schools.includes(ui.school)) ui.school = '__all';
  setSaveState('자동 저장 켜짐');
  render();
  await loadCfg();
  setupAutoSync();
  gcalSchedule(4000);
  if (cfg.autoSync && cfg.hasNotionToken) setTimeout(() => syncNow(true), 1500);
  setInterval(renderSync, 60000);
  fetch('api/ping');
}
init();
