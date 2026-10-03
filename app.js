/* Wishlist — a small, dependency-free wish list app.
   Data lives in localStorage; lists can be shared as a read-only snapshot
   encoded in the URL hash (#share=…), so no server is needed. */
(() => {
  'use strict';

  const STORAGE_KEY = 'wishful:v1';
  const THEME_KEY = 'wishful:theme';
  const SHARED_PICKS_PREFIX = 'wishful:picks:';

  const EMOJIS = ['🎁', '🎂', '🎄', '🏠', '✈️', '📚', '🎧', '👟', '💍', '🧸', '🎮', '🌿', '🍳', '🎨', '💻', '⭐'];
  const WANT_LEVEL = { 1: 'high', 2: 'medium', 3: 'low' };
  const WEEKLY_OPTIONS = [10, 20, 40];

  // Pick a line icon for a wish from its title and category.
  const ICON_RULES = [
    ['headphones', /head ?phone|earbud|airpod|earphone|speaker|audio/],
    ['camera', /camera|film|photo|lens|polaroid|instax/],
    ['shoe', /shoe|sneaker|runner|boot|trainer|sandal/],
    ['keyboard', /keyboard|keycap/],
    ['cup', /coffee|pour|mug|cup|tea|espresso|kettle|grinder/],
    ['book', /book|novel|kindle|reader|comic|magazine/],
    ['laptop', /laptop|macbook|computer|monitor|tablet|ipad/],
    ['phone', /phone|iphone|pixel|galaxy/],
    ['watch', /watch|smartwatch/],
    ['gamepad', /game|console|switch|playstation|xbox|controller|lego/],
    ['shirt', /shirt|cloth|jacket|hoodie|sock|dress|sweater|coat|fashion|jeans/],
    ['ticket', /ticket|concert|class|course|trip|travel|flight|experience|festival|spa/],
    ['plant', /plant|garden|flower|seed/],
    ['bike', /bike|bicycle|cycling|scooter/],
    ['bed', /bed|sheet|pillow|duvet|blanket|mattress/],
    ['home', /home|lamp|sofa|chair|desk|decor|kitchen|rug/],
  ];

  /* ---------- helpers ---------- */

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

  const uid = () =>
    (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2)).slice(0, 12);

  const escapeHtml = (s) =>
    String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const icon = (name) => `<svg aria-hidden="true"><use href="#${name}"/></svg>`;

  // Only allow http(s) links — shared payloads are untrusted input.
  function safeUrl(raw) {
    if (!raw) return '';
    let s = String(raw).trim();
    if (!s) return '';
    if (!/^[a-z][a-z0-9+.-]*:/i.test(s)) s = 'https://' + s;
    try {
      const u = new URL(s);
      return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : '';
    } catch {
      return '';
    }
  }

  function hostOf(url) {
    try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; }
  }

  function hashStr(s) {
    let h = 5381;
    for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
    return (h >>> 0).toString(36);
  }

  const fmtCache = new Map();
  function money(value, currency) {
    if (value == null || Number.isNaN(value)) return '';
    // Whole amounts drop the decimals (€279), others keep two (€24.90).
    const digits = Number.isInteger(value) ? 0 : 2;
    const key = currency + digits;
    let f = fmtCache.get(key);
    if (!f) {
      try {
        f = new Intl.NumberFormat(undefined, { style: 'currency', currency, minimumFractionDigits: digits, maximumFractionDigits: digits });
      } catch {
        f = new Intl.NumberFormat(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits });
      }
      fmtCache.set(key, f);
    }
    return f.format(value);
  }

  // The currency symbol on its own, for "€20/wk" chips.
  function currencySymbol(currency) {
    try {
      const part = new Intl.NumberFormat(undefined, { style: 'currency', currency }).formatToParts(0).find((p) => p.type === 'currency');
      return part ? part.value : currency;
    } catch {
      return currency;
    }
  }

  const plural = (n, word) => `${n} ${n === 1 ? word : word.endsWith('sh') ? word + 'es' : word + 's'}`;
  const round2 = (n) => Math.round(n * 100) / 100;

  function iconFor(item) {
    const hay = `${item.title} ${item.category}`.toLowerCase();
    const hit = ICON_RULES.find(([, re]) => re.test(hay));
    return 'w-' + (hit ? hit[0] : 'gift');
  }

  /* ---------- data ---------- */

  function normalizeItem(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const title = String(raw.title ?? '').trim().slice(0, 120);
    if (!title) return null;
    const num = (v) => (v === '' || v == null ? null : Number(v));
    const price = num(raw.price);
    const saved = num(raw.saved);
    const weekly = Number(raw.weekly);
    const priority = [1, 2, 3].includes(Number(raw.priority)) ? Number(raw.priority) : 2;
    const status = ['wanted', 'reserved', 'got'].includes(raw.status) ? raw.status : 'wanted';
    return {
      id: typeof raw.id === 'string' && raw.id ? raw.id.slice(0, 40) : uid(),
      title,
      url: safeUrl(raw.url),
      image: safeUrl(raw.image),
      price: Number.isFinite(price) && price >= 0 ? round2(price) : null,
      saved: Number.isFinite(saved) && saved > 0 ? round2(saved) : 0,
      weekly: Number.isFinite(weekly) && weekly > 0 ? round2(weekly) : 0,
      priority,
      category: String(raw.category ?? '').trim().slice(0, 40),
      notes: String(raw.notes ?? '').slice(0, 500),
      status,
      createdAt: Number(raw.createdAt) || Date.now(),
    };
  }

  function normalizeList(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const name = String(raw.name ?? '').trim().slice(0, 60) || 'My wishes';
    return {
      id: typeof raw.id === 'string' && raw.id ? raw.id.slice(0, 40) : uid(),
      name,
      emoji: EMOJIS.includes(raw.emoji) ? raw.emoji : '🎁',
      currency: /^[A-Z]{3}$/.test(raw.currency) ? raw.currency : 'EUR',
      createdAt: Number(raw.createdAt) || Date.now(),
      updatedAt: Number(raw.updatedAt) || Date.now(),
      items: Array.isArray(raw.items) ? raw.items.map(normalizeItem).filter(Boolean) : [],
    };
  }

  function seed() {
    const now = Date.now();
    const day = 86400000;
    const main = normalizeList({
      name: 'My wishes',
      emoji: '🎁',
      currency: 'EUR',
      createdAt: now - 20 * day,
      updatedAt: now - day,
      items: [
        { title: 'Headphones', notes: 'Noise-cancelling · black', price: 299, saved: 160, weekly: 20, priority: 1, category: 'Tech', createdAt: now - 20 * day },
        { title: 'Film camera', notes: '35mm point-and-shoot', price: 240, saved: 120, weekly: 15, priority: 2, category: 'Photo', createdAt: now - 18 * day },
        { title: 'Trail runners', notes: 'Size 43', price: 135, saved: 106, weekly: 10, priority: 2, category: 'Sports', createdAt: now - 12 * day },
        { title: 'Keyboard 75%', notes: 'Brown switches', price: 189, saved: 64, weekly: 10, priority: 3, category: 'Tech', createdAt: now - 9 * day },
        { title: 'Pour-over set', notes: 'Kettle, dripper and grinder', price: 46, saved: 36, priority: 3, category: 'Kitchen', status: 'reserved', createdAt: now - 6 * day },
        { title: 'Wool socks', price: 18, saved: 18, priority: 3, category: 'Clothing', status: 'got', createdAt: now - 3 * day },
      ],
    });
    const holidays = normalizeList({ name: 'Holidays 2026', emoji: '🎄', currency: 'EUR', createdAt: now - day });
    return { lists: [main, holidays], activeListId: main.id };
  }

  function load() {
    try {
      const raw = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if (raw && Array.isArray(raw.lists)) {
        const lists = raw.lists.map(normalizeList).filter(Boolean);
        if (lists.length) {
          const activeListId = lists.some((l) => l.id === raw.activeListId) ? raw.activeListId : lists[0].id;
          return { lists, activeListId };
        }
      }
    } catch { /* ignore corrupt or unavailable storage */ }
    return seed();
  }

  let state = load();

  function save() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch { /* storage full or blocked */ }
  }

  function touch(list) {
    list.updatedAt = Date.now();
    save();
  }

  /* ---------- sharing ---------- */

  function encodeShare(list, hideReserved) {
    const payload = {
      v: 1,
      n: list.name,
      e: list.emoji,
      c: list.currency,
      i: list.items
        .filter((it) => it.status !== 'got')
        .map((it) => {
          const o = { id: it.id, t: it.title, r: it.priority };
          if (it.url) o.u = it.url;
          if (it.image) o.m = it.image;
          if (it.price != null) o.p = it.price;
          if (it.category) o.c = it.category;
          if (it.notes) o.n = it.notes;
          if (!hideReserved && it.status === 'reserved') o.s = 1;
          return o;
        }),
    };
    const bytes = new TextEncoder().encode(JSON.stringify(payload));
    let bin = '';
    bytes.forEach((b) => { bin += String.fromCharCode(b); });
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  function decodeShare(str) {
    const b64 = str.replace(/-/g, '+').replace(/_/g, '/');
    const bin = atob(b64 + '==='.slice((b64.length + 3) % 4));
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    const p = JSON.parse(new TextDecoder().decode(bytes));
    if (!p || p.v !== 1 || !Array.isArray(p.i)) throw new Error('bad payload');
    return normalizeList({
      id: 'shared',
      name: p.n,
      emoji: p.e,
      currency: p.c,
      items: p.i.map((o) => ({
        id: o.id, title: o.t, url: o.u, image: o.m, price: o.p, priority: o.r,
        category: o.c, notes: o.n, status: o.s ? 'reserved' : 'wanted',
      })),
    });
  }

  // When viewing someone else's list: { list, key, picks:Set<itemId> }
  let shared = null;

  function loadPicks(key) {
    try { return new Set(JSON.parse(localStorage.getItem(SHARED_PICKS_PREFIX + key)) || []); } catch { return new Set(); }
  }
  function savePicks() {
    try { localStorage.setItem(SHARED_PICKS_PREFIX + shared.key, JSON.stringify([...shared.picks])); } catch { /* ignore */ }
  }

  function readHash() {
    const m = location.hash.match(/^#share=([A-Za-z0-9_-]+)$/);
    if (!m) { shared = null; return; }
    try {
      const list = decodeShare(m[1]);
      const key = hashStr(m[1]);
      shared = { list, key, picks: loadPicks(key) };
    } catch {
      shared = null;
      history.replaceState(null, '', location.pathname + location.search);
      toast('That share link looks broken or incomplete.');
    }
  }

  /* ---------- view state ---------- */

  const view = { query: '', selectedId: null, searchOpen: false };
  let enterNext = true;       // list rows + hero play their entrance only when a list first appears
  let itemEnterNext = true;   // the item orb plays its entrance only when a different wish opens
  let editingItemId = null;
  let editingListId = null;
  let pickedEmoji = EMOJIS[0];

  const wide = matchMedia('(min-width: 960px)');

  const currentList = () =>
    shared ? shared.list : state.lists.find((l) => l.id === state.activeListId) || state.lists[0];
  const findItem = (id) => currentList().items.find((i) => i.id === id);

  // Effective status (in shared mode, the viewer's own picks count as reserved).
  function statusOf(item) {
    if (shared && shared.picks.has(item.id)) return 'reserved';
    return item.status;
  }

  const savedOf = (item) => (item.price != null ? Math.min(item.saved, item.price) : item.saved);
  const remainingOf = (item) => (item.price != null ? Math.max(0, round2(item.price - item.saved)) : null);
  const weeksLeft = (item) => {
    const rem = remainingOf(item);
    return rem && item.weekly ? Math.ceil(rem / item.weekly) : null;
  };

  /* ---------- rendering ---------- */

  const el = {
    body: document.body,
    hero: $('#hero'),
    rows: $('#rows'),
    doneRows: $('#doneRows'),
    doneHead: $('#doneHead'),
    doneCount: $('#doneCount'),
    upNextTitle: $('#upNextTitle'),
    upNextCount: $('#upNextCount'),
    empty: $('#empty'),
    emptyTitle: $('#emptyTitle'),
    emptyText: $('#emptyText'),
    emptyAddBtn: $('#emptyAddBtn'),
    search: $('#search'),
    searchRow: $('#searchRow'),
    searchBtn: $('#searchBtn'),
    avatarBtn: $('#avatarBtn'),
    sharedNote: $('#sharedNote'),
    tabbar: $('#tabbar'),
    itemScreen: $('#itemScreen'),
    itemMenu: $('#itemMenu'),
  };

  function render() {
    el.body.classList.toggle('is-shared', !!shared);
    el.sharedNote.hidden = !shared;
    el.tabbar.hidden = !!shared;
    el.avatarBtn.textContent = currentList().emoji;
    el.avatarBtn.setAttribute('aria-label', `${currentList().name}. Switch list`);
    el.avatarBtn.disabled = !!shared;
    document.title = `${currentList().name} · Wishlist`;

    // Wide screens always show a wish in the right panel.
    const items = currentList().items;
    if (wide.matches && !findItem(view.selectedId)) {
      const first = sortedOpen(items)[0] || items[0];
      view.selectedId = first ? first.id : null;
      itemEnterNext = true;
    }

    renderHero();
    renderRows();
    renderItem();
  }

  function renderHero() {
    const list = currentList();
    const items = list.items;
    let label, big, of, pct, actions;

    if (shared) {
      const mine = items.filter((i) => shared.picks.has(i.id));
      const total = items.reduce((t, i) => t + (i.price || 0), 0);
      const mineTotal = mine.reduce((t, i) => t + (i.price || 0), 0);
      pct = items.length ? Math.round((mine.length / items.length) * 100) : 0;
      label = `${list.emoji} ${list.name}`;
      big = money(mineTotal, list.currency);
      of = `you're getting, of ${money(total, list.currency)}`;
      actions = `<button class="hero-add" id="saveSharedBtn">Save a copy</button>
        <a class="hero-gear" href="./" aria-label="Go to my lists">${icon('i-heart')}</a>`;
    } else {
      const open = items.filter((i) => i.status !== 'got' && i.price != null);
      const goal = open.reduce((t, i) => t + i.price, 0);
      const saved = open.reduce((t, i) => t + savedOf(i), 0);
      pct = goal ? Math.min(100, Math.round((saved / goal) * 100)) : 0;
      label = 'Saved for your wants';
      big = money(round2(saved), list.currency);
      of = `of ${money(round2(goal), list.currency)}`;
      actions = `<button class="hero-add" data-act="add-money">Add money</button>
        <button class="hero-gear" data-act="list-settings" aria-label="List settings">${icon('i-sliders')}</button>`;
    }

    const SEGS = 20;
    const on = Math.round((pct / 100) * SEGS);
    const segs = Array.from({ length: SEGS }, (_, i) =>
      `<span class="seg${i < on ? ' on' : ''}" style="animation-delay:${i * 22}ms"></span>`).join('');

    el.hero.classList.toggle('is-entering', enterNext);
    el.hero.innerHTML = `
      <div class="hero-top">
        <span class="hero-label">${escapeHtml(label)}</span>
        <span class="hero-pct">${pct}%</span>
      </div>
      <div class="hero-amount">
        <span class="hero-big">${escapeHtml(big)}</span>
        <span class="hero-of">${escapeHtml(of)}</span>
      </div>
      <div class="segs" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}" aria-label="${pct}% ${shared ? 'of wishes picked by you' : 'saved'}">${segs}</div>
      <div class="hero-actions">${actions}</div>`;
  }

  function sortedOpen(items) {
    return items
      .filter((i) => i.status !== 'got')
      .sort((a, b) => a.priority - b.priority || b.createdAt - a.createdAt);
  }

  function matches(item) {
    const q = view.query.trim().toLowerCase();
    if (!q) return true;
    return [item.title, item.notes, item.category, hostOf(item.url)].some((f) => f && f.toLowerCase().includes(q));
  }

  function rowNote(item, list) {
    const status = statusOf(item);
    if (shared) {
      if (shared.picks.has(item.id)) return '<span class="note is-blue">You\'re getting it</span>';
      if (status === 'reserved') return '<span class="note">Reserved</span>';
      return `<span class="note">Want level: ${WANT_LEVEL[item.priority]}</span>`;
    }
    if (status === 'got') return '<span class="note is-good">Got it</span>';
    if (status === 'reserved') return '<span class="note is-blue">Reserved</span>';
    if (item.price != null && item.saved >= item.price) return '<span class="note is-good">Ready to buy</span>';
    const wk = weeksLeft(item);
    if (wk) return `<span class="note">ready in ${wk} wk</span>`;
    const rem = remainingOf(item);
    return rem ? `<span class="note">${escapeHtml(money(rem, list.currency))} to go</span>` : '';
  }

  function rowHtml(item, list, index) {
    const price = money(item.price, list.currency);
    const pct = item.price ? Math.min(100, (savedOf(item) / item.price) * 100) : 0;
    const left = shared
      ? escapeHtml(item.category || hostOf(item.url) || '')
      : `${escapeHtml(money(item.saved, list.currency))} saved`;
    const thumb = item.image
      ? `<img src="${escapeHtml(item.image)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" data-icon="${iconFor(item)}" />`
      : icon(iconFor(item));
    return `<li><button class="row${item.id === view.selectedId && wide.matches ? ' is-selected' : ''}" data-id="${escapeHtml(item.id)}" style="animation-delay:${Math.min(index, 8) * 45}ms">
      <span class="thumb">${thumb}</span>
      <span class="row-main">
        <span class="row-top"><span class="row-title">${escapeHtml(item.title)}</span><span class="row-price">${price ? escapeHtml(price) : ''}</span></span>
        ${shared ? '' : `<span class="bar"><span style="transform:scaleX(${pct / 100})"></span></span>`}
        <span class="row-meta"><span>${left}</span>${rowNote(item, list)}</span>
      </span>
    </button></li>`;
  }

  function renderRows() {
    const list = currentList();
    const items = list.items.filter(matches);
    const open = sortedOpen(items);
    const done = shared ? [] : items.filter((i) => i.status === 'got').sort((a, b) => b.createdAt - a.createdAt);

    el.rows.classList.toggle('is-entering', enterNext);
    el.doneRows.classList.toggle('is-entering', enterNext);
    enterNext = false;

    el.upNextTitle.textContent = shared ? 'Wishes' : 'Up next';
    el.upNextCount.textContent = plural(open.length, 'item');
    el.rows.innerHTML = open.map((it, i) => rowHtml(it, list, i)).join('');
    el.doneHead.hidden = done.length === 0;
    el.doneCount.textContent = plural(done.length, 'item');
    el.doneRows.innerHTML = done.map((it, i) => rowHtml(it, list, open.length + i)).join('');

    const nothing = open.length === 0 && done.length === 0;
    el.empty.hidden = !nothing;
    el.upNextTitle.parentElement.hidden = nothing;
    if (nothing) {
      if (list.items.length) {
        el.emptyTitle.textContent = 'No matches';
        el.emptyText.textContent = 'Try a different search.';
        el.emptyAddBtn.textContent = 'Clear search';
        el.emptyAddBtn.dataset.mode = 'clear';
        el.emptyAddBtn.hidden = false;
      } else {
        el.emptyTitle.textContent = shared ? 'This list is empty' : 'No wishes yet';
        el.emptyText.textContent = shared
          ? 'Every wish on it has already been fulfilled.'
          : 'Add the first thing you’re wishing for. A name and a price is all it takes.';
        el.emptyAddBtn.textContent = 'Add a wish';
        el.emptyAddBtn.dataset.mode = 'add';
        el.emptyAddBtn.hidden = !!shared;
      }
    }
  }

  function renderItem() {
    const list = currentList();
    const item = findItem(view.selectedId);
    if (!item) {
      el.itemScreen.innerHTML = `<div class="item-empty"><div>
        <div class="orbit"><div class="orb">${icon('w-gift')}</div></div>
        <h2>${list.items.length ? 'Pick a wish' : 'Your wishes show up here'}</h2>
        <p>${list.items.length ? 'Choose one from the list to see the details.' : 'Add one to get started.'}</p>
      </div></div>`;
      return;
    }

    const status = statusOf(item);
    const where = hostOf(item.url) || item.category || list.name;
    const sub = item.notes || item.category || '';
    const price = money(item.price, list.currency);
    const orb = item.image
      ? `<img src="${escapeHtml(item.image)}" alt="" referrerpolicy="no-referrer" data-icon="${iconFor(item)}" />`
      : icon(iconFor(item));

    let chip = '';
    if (status === 'reserved') chip = `<span class="status-chip reserved">${icon('i-bookmark')}${shared && shared.picks.has(item.id) ? 'You’re getting this' : 'Reserved'}</span>`;
    if (status === 'got') chip = `<span class="status-chip got">${icon('i-check')}Got it</span>`;

    let saveCard = '';
    if (!shared && status !== 'got' && item.price != null) {
      const rem = remainingOf(item);
      const wk = weeksLeft(item);
      const pct = item.price ? Math.min(100, (savedOf(item) / item.price) * 100) : 0;
      const sym = currencySymbol(list.currency);
      let sub2;
      if (!rem) sub2 = 'Fully saved. Time to treat yourself!';
      else if (wk) sub2 = `Yours in ${plural(wk, 'week')} · ${money(rem, list.currency)} to go`;
      else sub2 = `${money(rem, list.currency)} to go · pick a weekly amount`;
      saveCard = `<section class="save-card" aria-label="Savings plan">
        <div class="save-head">
          <div><p class="save-title">Save each week</p><p class="save-sub">${escapeHtml(sub2)}</p></div>
          <span class="save-amount">${escapeHtml(money(item.saved, list.currency))}</span>
        </div>
        <div class="bar"><span style="transform:scaleX(${pct / 100})"></span></div>
        <div class="chips" role="group" aria-label="Weekly amount">
          ${WEEKLY_OPTIONS.map((v) => `<button class="chip" data-act="weekly" data-value="${v}" aria-pressed="${item.weekly === v}">${escapeHtml(sym)}${v}/wk</button>`).join('')}
        </div>
        <div class="save-more"><button class="text-btn" data-act="add-money-item">Add money now</button></div>
      </section>`;
    }

    let primary;
    if (shared) {
      const mine = shared.picks.has(item.id);
      const taken = !mine && item.status === 'reserved';
      primary = taken
        ? `<button class="pill-btn pill-ghost" disabled style="flex:1">Already reserved</button>`
        : `<button class="pill-btn ${mine ? 'pill-done' : 'pill-primary'}" data-act="pick">${mine ? `${icon('i-check')}You’re getting it` : 'I’ll get it'}</button>`;
    } else if (status === 'got') {
      primary = `<button class="pill-btn pill-done" data-act="status" data-value="wanted" title="Mark as still wanted">${icon('i-check')}Got it</button>`;
    } else if (item.url) {
      primary = `<a class="pill-btn pill-primary" href="${escapeHtml(item.url)}" target="_blank" rel="noopener noreferrer">Buy it now</a>`;
    } else {
      primary = `<button class="pill-btn pill-primary" data-act="status" data-value="got">Mark as got it</button>`;
    }
    const secondary = shared
      ? (item.url ? `<a class="pill-btn pill-ghost" href="${escapeHtml(item.url)}" target="_blank" rel="noopener noreferrer">Open link</a>` : '')
      : `<button class="pill-btn pill-ghost" data-act="share">Share</button>`;

    const enter = itemEnterNext;
    itemEnterNext = false;
    el.itemScreen.innerHTML = `<article class="item${enter ? ' item-enter' : ''}" data-id="${escapeHtml(item.id)}">
      <div class="item-top">
        <button class="round-btn item-back" data-act="back" aria-label="Back to list">${icon('i-back')}</button>
        <span class="item-where">${escapeHtml(where)}</span>
        ${shared ? '<span></span>' : `<button class="round-btn" data-act="menu" aria-label="More actions" aria-haspopup="true">${icon('i-more')}</button>`}
      </div>
      <div class="orbit">
        <div class="orb">${orb}</div>
        <span class="sticker">Want level: ${WANT_LEVEL[item.priority]}</span>
      </div>
      <h2 class="item-title">${escapeHtml(item.title)}</h2>
      ${sub ? `<p class="item-sub">${escapeHtml(sub)}</p>` : ''}
      <p class="item-price${price ? '' : ' is-empty'}">${price ? escapeHtml(price) : 'No price yet'}</p>
      ${chip ? `<div class="item-status">${chip}</div>` : ''}
      ${saveCard}
      <div class="item-spacer"></div>
      <div class="item-actions">${primary}${secondary}</div>
    </article>`;
  }

  // Broken image → fall back to the line icon.
  document.addEventListener('error', (e) => {
    const img = e.target;
    if (img.tagName !== 'IMG' || !img.dataset.icon) return;
    const wrap = document.createElement('span');
    wrap.innerHTML = icon(img.dataset.icon);
    img.replaceWith(wrap.firstChild);
  }, true);

  /* ---------- item screen open / close (phones) ---------- */

  let lastRowFocus = null;
  function openItem(id) {
    if (view.selectedId !== id) itemEnterNext = true;
    view.selectedId = id;
    if (!wide.matches) {
      lastRowFocus = document.activeElement;
      el.body.classList.add('item-open');
      el.itemScreen.scrollTop = 0;
    }
    renderRows();
    renderItem();
    if (!wide.matches) setTimeout(() => $('.item-back', el.itemScreen)?.focus({ preventScroll: true }), 60);
  }

  function closeItem() {
    if (!el.body.classList.contains('item-open')) return;
    el.body.classList.remove('item-open');
    const row = lastRowFocus && document.contains(lastRowFocus)
      ? lastRowFocus
      : $(`.row[data-id="${CSS.escape(view.selectedId || '')}"]`);
    row?.focus({ preventScroll: true });
  }

  /* ---------- toast ---------- */

  let toastTimer;
  function toast(msg, action) {
    const t = $('#toast');
    const btn = $('#toastAction');
    $('#toastMsg').textContent = msg;
    btn.hidden = !action;
    btn.onclick = null;
    if (action) {
      btn.textContent = action.label;
      btn.onclick = () => { action.run(); t.hidden = true; };
    }
    t.hidden = false;
    t.style.animation = 'none';
    void t.offsetWidth;
    t.style.animation = '';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, action ? 6000 : 3000);
  }

  /* ---------- confetti ---------- */

  function celebrate(x, y) {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const colors = ['#1f5bff', '#0b1a3d', '#8fb0ff', '#ffffff', '#ffc94d'];
    for (let i = 0; i < 24; i++) {
      const s = document.createElement('span');
      const w = 5 + Math.random() * 4;
      const round = i % 3 === 0;
      s.style.cssText = `position:fixed;left:${x}px;top:${y}px;z-index:60;pointer-events:none;width:${w}px;height:${round ? w : w * 1.8}px;border-radius:${round ? '50%' : '2px'};background:${colors[i % colors.length]};box-shadow:0 0 0 1px rgba(11,26,61,.08)`;
      document.body.appendChild(s);
      const angle = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 1.4;
      const dist = 50 + Math.random() * 90;
      const dx = Math.cos(angle) * dist;
      const dy = Math.sin(angle) * dist;
      const spin = (Math.random() - 0.5) * 720;
      s.animate(
        [
          { transform: 'translate(-50%, -50%) scale(.6)', opacity: 1 },
          { transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) rotate(${spin / 2}deg)`, opacity: 1, offset: 0.55 },
          { transform: `translate(calc(-50% + ${dx * 1.15}px), calc(-50% + ${dy + 70}px)) rotate(${spin}deg)`, opacity: 0 },
        ],
        { duration: 900 + Math.random() * 300, easing: 'cubic-bezier(0.23, 1, 0.32, 1)' },
      ).onfinish = () => s.remove();
    }
  }
  const celebrateAt = (node) => {
    if (!node) return;
    const r = node.getBoundingClientRect();
    celebrate(r.left + r.width / 2, r.top + r.height / 2);
  };

  /* ---------- sheets ---------- */

  const sheets = $$('dialog.sheet');
  function openSheet(d) {
    sheets.forEach((s) => { if (s !== d && s.open) s.close(); });
    if (typeof d.showModal === 'function') d.showModal();
    else d.setAttribute('open', '');
  }
  sheets.forEach((d) => {
    d.addEventListener('click', (e) => {
      if (e.target === d || e.target.closest('[data-close]')) d.close();
    });
  });

  // Item form
  const itemDialog = $('#itemDialog');
  const itemForm = $('#itemForm');

  function openItemDialog(item) {
    if (shared) return;
    const list = currentList();
    editingItemId = item ? item.id : null;
    itemForm.reset();
    $('#itemDialogTitle').textContent = item ? 'Edit wish' : 'Add a wish';
    $('#itemSubmit').textContent = item ? 'Save' : 'Add wish';
    const cats = [...new Set(state.lists.flatMap((l) => l.items.map((i) => i.category)).filter(Boolean))].sort();
    $('#categoryList').innerHTML = cats.map((c) => `<option value="${escapeHtml(c)}"></option>`).join('');
    const f = itemForm.elements;
    f.title.value = item?.title ?? '';
    f.notes.value = item?.notes ?? '';
    f.price.value = item?.price ?? '';
    f.price.placeholder = `0 ${list.currency}`;
    f.saved.value = item?.saved || '';
    f.category.value = item?.category ?? '';
    f.url.value = item?.url ?? '';
    f.image.value = item?.image ?? '';
    f.priority.value = String(item?.priority ?? 2);
    openSheet(itemDialog);
    setTimeout(() => f.title.focus(), 40);
  }

  itemForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const f = itemForm.elements;
    const list = currentList();
    const rawUrl = f.url.value.trim();
    const rawImg = f.image.value.trim();
    if (rawUrl && !safeUrl(rawUrl)) { f.url.setCustomValidity('Please enter a valid web link'); f.url.reportValidity(); f.url.setCustomValidity(''); return; }
    if (rawImg && !safeUrl(rawImg)) { f.image.setCustomValidity('Please enter a valid image link'); f.image.reportValidity(); f.image.setCustomValidity(''); return; }

    const existing = editingItemId && findItem(editingItemId);
    const data = normalizeItem({
      ...(existing || {}),
      title: f.title.value,
      notes: f.notes.value,
      price: f.price.value,
      saved: f.saved.value,
      category: f.category.value,
      url: rawUrl,
      image: rawImg,
      priority: f.priority.value,
    });
    if (!data) return;
    if (existing) {
      Object.assign(existing, data);
      toast('Wish updated');
    } else {
      list.items.push(data);
      view.selectedId = data.id;
      itemEnterNext = true;
      toast('Wish added');
    }
    touch(list);
    itemDialog.close();
    render();
  });

  function deleteItem(item) {
    const list = currentList();
    const idx = list.items.indexOf(item);
    if (idx < 0) return;
    list.items.splice(idx, 1);
    touch(list);
    if (view.selectedId === item.id) {
      view.selectedId = null;
      el.body.classList.remove('item-open');
    }
    render();
    toast(`Deleted “${item.title}”`, {
      label: 'Undo',
      run: () => {
        list.items.splice(Math.min(idx, list.items.length), 0, item);
        touch(list);
        render();
      },
    });
  }

  function setStatus(item, status, anchor) {
    item.status = status;
    touch(currentList());
    if (status === 'got') {
      celebrateAt(anchor);
      toast(`“${item.title}” is yours. Enjoy!`);
    }
    render();
  }

  // Money sheet
  const moneyDialog = $('#moneyDialog');
  const moneyForm = $('#moneyForm');

  function openMoneyDialog(preselectId) {
    if (shared) return;
    const list = currentList();
    const open = sortedOpen(list.items);
    if (!open.length) { toast('Add a wish first, then start saving for it.'); return; }
    $('#moneyItem').innerHTML = open
      .map((i) => `<option value="${escapeHtml(i.id)}">${escapeHtml(i.title)}${i.price != null ? ` · ${escapeHtml(money(remainingOf(i), list.currency))} to go` : ''}</option>`)
      .join('');
    moneyForm.reset();
    const has = (id) => id && open.some((i) => i.id === id);
    $('#moneyItem').value = has(preselectId) ? preselectId : has(view.selectedId) ? view.selectedId : open[0].id;
    moneyForm.elements.amount.placeholder = `0 ${list.currency}`;
    openSheet(moneyDialog);
    setTimeout(() => moneyForm.elements.amount.focus(), 40);
  }

  $('#moneyQuick').addEventListener('click', (e) => {
    const b = e.target.closest('[data-add]');
    if (!b) return;
    const input = moneyForm.elements.amount;
    input.value = round2((Number(input.value) || 0) + Number(b.dataset.add));
  });

  moneyForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const list = currentList();
    const item = findItem($('#moneyItem').value);
    const amount = round2(Number(moneyForm.elements.amount.value));
    if (!item || !(amount > 0)) return;
    const wasShort = item.price != null && item.saved < item.price;
    item.saved = round2(item.saved + amount);
    touch(list);
    moneyDialog.close();
    render();
    if (wasShort && item.saved >= item.price) {
      celebrateAt($('.hero-big'));
      toast(`You've saved enough for “${item.title}”!`);
    } else {
      toast(`Added ${money(amount, list.currency)} to “${item.title}”`);
    }
  });

  // Lists sheet
  const listsDialog = $('#listsDialog');
  function openListsDialog() {
    if (shared) return;
    $('#listsMenu').innerHTML = state.lists
      .map((l) => {
        const open = l.items.filter((i) => i.status !== 'got').length;
        const active = l.id === state.activeListId;
        return `<li><button class="menu-row${active ? ' is-active' : ''}" data-list="${escapeHtml(l.id)}"${active ? ' aria-current="true"' : ''}>
          <span class="menu-icon" aria-hidden="true">${l.emoji}</span>
          <span class="menu-text">${escapeHtml(l.name)}</span>
          <span class="menu-meta">${plural(open, 'wish')}</span>
          ${active ? `<span class="tick">${icon('i-check')}</span>` : ''}
        </button></li>`;
      })
      .join('');
    openSheet(listsDialog);
  }
  $('#listsMenu').addEventListener('click', (e) => {
    const b = e.target.closest('[data-list]');
    if (!b) return;
    if (state.activeListId !== b.dataset.list) {
      state.activeListId = b.dataset.list;
      view.selectedId = null;
      view.query = '';
      el.search.value = '';
      enterNext = true;
      save();
      render();
    }
    listsDialog.close();
  });
  $('#newListBtn').addEventListener('click', () => openListDialog());
  $('#editListBtn').addEventListener('click', () => openListDialog(currentList()));

  // List form
  const listDialog = $('#listDialog');
  const listForm = $('#listForm');
  const emojiPicker = $('#emojiPicker');
  emojiPicker.innerHTML = EMOJIS.map((e) => `<button type="button" data-emoji="${e}" aria-label="${e}">${e}</button>`).join('');
  emojiPicker.addEventListener('click', (e) => {
    const b = e.target.closest('[data-emoji]');
    if (!b) return;
    pickedEmoji = b.dataset.emoji;
    $$('[data-emoji]', emojiPicker).forEach((x) => x.classList.toggle('is-active', x === b));
  });

  function openListDialog(list) {
    if (shared) return;
    editingListId = list ? list.id : null;
    listForm.reset();
    $('#listDialogTitle').textContent = list ? 'Edit list' : 'New list';
    $('#listSubmit').textContent = list ? 'Save' : 'Create list';
    $('#deleteListBtn').hidden = !list || state.lists.length < 2;
    listForm.elements.name.value = list?.name ?? '';
    listForm.elements.currency.value = list?.currency ?? currentList()?.currency ?? 'EUR';
    pickedEmoji = list?.emoji ?? EMOJIS[Math.floor(Math.random() * EMOJIS.length)];
    $$('[data-emoji]', emojiPicker).forEach((x) => x.classList.toggle('is-active', x.dataset.emoji === pickedEmoji));
    openSheet(listDialog);
    setTimeout(() => listForm.elements.name.focus(), 40);
  }

  listForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const name = listForm.elements.name.value.trim();
    if (!name) return;
    const currency = listForm.elements.currency.value;
    if (editingListId) {
      const list = state.lists.find((l) => l.id === editingListId);
      Object.assign(list, { name: name.slice(0, 60), emoji: pickedEmoji, currency });
      touch(list);
    } else {
      const list = normalizeList({ name, emoji: pickedEmoji, currency });
      state.lists.push(list);
      state.activeListId = list.id;
      view.selectedId = null;
      enterNext = true;
      save();
      toast(`Created “${list.name}”`);
    }
    listDialog.close();
    render();
  });

  $('#deleteListBtn').addEventListener('click', () => {
    const list = state.lists.find((l) => l.id === editingListId);
    if (!list || state.lists.length < 2) return;
    if (!confirm(`Delete “${list.name}” and its ${plural(list.items.length, 'wish')}? This can’t be undone.`)) return;
    state.lists = state.lists.filter((l) => l.id !== list.id);
    state.activeListId = state.lists[0].id;
    view.selectedId = null;
    enterNext = true;
    save();
    listDialog.close();
    render();
    toast('List deleted');
  });

  // Settings sheet
  const meDialog = $('#meDialog');
  const isDark = () => (document.documentElement.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')) === 'dark';
  function openMeDialog() {
    $('#themeSwitch').classList.toggle('is-on', isDark());
    openSheet(meDialog);
  }
  meDialog.addEventListener('click', (e) => {
    const b = e.target.closest('[data-action]');
    if (!b) return;
    const a = b.dataset.action;
    if (a === 'share') { meDialog.close(); openShareDialog(); }
    if (a === 'theme') { toggleTheme(); $('#themeSwitch').classList.toggle('is-on', isDark()); }
    if (a === 'export') exportData();
    if (a === 'import') $('#importFile').click();
  });

  // Share sheet
  const shareDialog = $('#shareDialog');
  function shareLink() {
    const enc = encodeShare(currentList(), $('#shareHideReserved').checked);
    return location.href.split('#')[0] + '#share=' + enc;
  }
  function openShareDialog() {
    const list = currentList();
    if (!list.items.some((i) => i.status !== 'got')) {
      toast('Add a wish or two before sharing this list.');
      return;
    }
    $('#shareUrl').value = shareLink();
    $('#nativeShareBtn').hidden = !navigator.share;
    openSheet(shareDialog);
  }
  $('#shareHideReserved').addEventListener('change', () => { $('#shareUrl').value = shareLink(); });
  $('#copyShareBtn').addEventListener('click', async () => {
    const input = $('#shareUrl');
    try {
      await navigator.clipboard.writeText(input.value);
    } catch {
      input.select();
      document.execCommand('copy');
    }
    $('#copyShareBtn').textContent = 'Copied';
    setTimeout(() => { $('#copyShareBtn').textContent = 'Copy'; }, 1600);
  });
  $('#nativeShareBtn').addEventListener('click', () => {
    const list = currentList();
    navigator.share({ title: `${list.emoji} ${list.name}`, text: `My wish list: ${list.name}`, url: $('#shareUrl').value }).catch(() => {});
  });

  /* ---------- import / export ---------- */

  function exportData() {
    const blob = new Blob([JSON.stringify({ app: 'wishful', version: 2, exportedAt: new Date().toISOString(), ...state }, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `wishlist-backup-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    toast('Backup downloaded');
  }

  $('#importFile').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      const lists = (Array.isArray(data.lists) ? data.lists : []).map(normalizeList).filter(Boolean);
      if (!lists.length) throw new Error('empty');
      lists.forEach((l) => { l.id = uid(); });
      state.lists.push(...lists);
      state.activeListId = lists[0].id;
      view.selectedId = null;
      enterNext = true;
      save();
      if (shared) leaveShared();
      meDialog.close();
      render();
      toast(`Imported ${plural(lists.length, 'list')}`);
    } catch {
      toast('Could not read that file. Is it a Wishlist backup?');
    }
  });

  /* ---------- theme ---------- */

  function applyTheme(theme) {
    if (theme) document.documentElement.dataset.theme = theme;
    else delete document.documentElement.dataset.theme;
    const dark = theme ? theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
    $('meta[name="theme-color"]').content = dark ? '#0b1428' : '#ffffff';
  }
  function toggleTheme() {
    const next = isDark() ? 'light' : 'dark';
    try { localStorage.setItem(THEME_KEY, next); } catch { /* ignore */ }
    applyTheme(next);
  }
  try { applyTheme(localStorage.getItem(THEME_KEY)); } catch { applyTheme(null); }

  /* ---------- item popover menu ---------- */

  function openItemMenu(anchor, item) {
    const m = el.itemMenu;
    const s = item.status;
    m.innerHTML = [
      `<button role="menuitem" data-menu="edit">${icon('i-pencil')}Edit</button>`,
      s === 'wanted' ? `<button role="menuitem" data-menu="reserved">${icon('i-bookmark')}Mark as reserved</button>` : '',
      s === 'reserved' ? `<button role="menuitem" data-menu="wanted">${icon('i-bookmark')}Not reserved</button>` : '',
      s !== 'got' ? `<button role="menuitem" data-menu="got">${icon('i-check')}Mark as got it</button>` : `<button role="menuitem" data-menu="wanted">${icon('i-heart')}Still wanted</button>`,
      `<button role="menuitem" data-menu="delete" class="is-danger">${icon('i-trash')}Delete</button>`,
    ].join('');
    m.hidden = false;
    const r = anchor.getBoundingClientRect();
    m.style.top = `${r.bottom + 8}px`;
    m.style.right = `${Math.max(12, innerWidth - r.right)}px`;
    m.dataset.id = item.id;
    m.querySelector('button')?.focus();
  }
  const closeItemMenu = () => { el.itemMenu.hidden = true; };

  el.itemMenu.addEventListener('click', (e) => {
    const b = e.target.closest('[data-menu]');
    if (!b) return;
    const item = findItem(el.itemMenu.dataset.id);
    closeItemMenu();
    if (!item) return;
    const a = b.dataset.menu;
    if (a === 'edit') openItemDialog(item);
    else if (a === 'delete') deleteItem(item);
    else setStatus(item, a, $('.orb', el.itemScreen));
  });
  document.addEventListener('click', (e) => {
    if (!el.itemMenu.hidden && !el.itemMenu.contains(e.target) && !e.target.closest('[data-act="menu"]')) closeItemMenu();
  });
  addEventListener('resize', closeItemMenu);

  /* ---------- events ---------- */

  function leaveShared() {
    shared = null;
    view.selectedId = null;
    enterNext = true;
    history.replaceState(null, '', location.pathname + location.search);
  }

  $('#listScreen').addEventListener('click', (e) => {
    const row = e.target.closest('.row');
    if (row) { openItem(row.dataset.id); return; }
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'add-money') openMoneyDialog();
    if (act === 'list-settings') openListDialog(currentList());
    if (e.target.closest('#saveSharedBtn') && shared) {
      const copy = normalizeList({ ...shared.list, id: uid(), items: shared.list.items.map((i) => ({ ...i, id: uid(), status: 'wanted' })) });
      state.lists.push(copy);
      state.activeListId = copy.id;
      save();
      leaveShared();
      render();
      toast(`Saved “${copy.name}” to your lists`);
    }
  });

  el.itemScreen.addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const item = findItem(view.selectedId);
    const act = b.dataset.act;
    if (act === 'back') { closeItemMenu(); closeItem(); return; }
    if (!item) return;
    if (act === 'menu') {
      if (el.itemMenu.hidden) openItemMenu(b, item); else closeItemMenu();
    }
    if (act === 'share') openShareDialog();
    if (act === 'add-money-item') openMoneyDialog(item.id);
    if (act === 'status') setStatus(item, b.dataset.value, b);
    if (act === 'weekly') {
      const v = Number(b.dataset.value);
      item.weekly = item.weekly === v ? 0 : v;
      touch(currentList());
      renderItem();
      renderRows();
    }
    if (act === 'pick') {
      if (shared.picks.has(item.id)) shared.picks.delete(item.id);
      else { shared.picks.add(item.id); celebrateAt(b); }
      savePicks();
      renderHero();
      renderRows();
      renderItem();
    }
  });

  el.searchBtn.addEventListener('click', () => {
    view.searchOpen = !view.searchOpen;
    el.searchRow.hidden = !view.searchOpen;
    el.searchBtn.setAttribute('aria-expanded', String(view.searchOpen));
    if (view.searchOpen) el.search.focus();
    else if (view.query) { view.query = ''; el.search.value = ''; renderRows(); }
  });
  el.search.addEventListener('input', () => { view.query = el.search.value; renderRows(); });
  el.avatarBtn.addEventListener('click', openListsDialog);

  el.emptyAddBtn.addEventListener('click', () => {
    if (el.emptyAddBtn.dataset.mode === 'clear') {
      view.query = '';
      el.search.value = '';
      renderRows();
    } else {
      openItemDialog();
    }
  });

  el.tabbar.addEventListener('click', (e) => {
    const t = e.target.closest('[data-tab]');
    if (!t) return;
    const tab = t.dataset.tab;
    if (tab === 'wishes') {
      closeItem();
      window.scrollTo({ top: 0, behavior: 'smooth' });
      $('#listScreen').scrollTo({ top: 0, behavior: 'smooth' });
    }
    if (tab === 'lists') openListsDialog();
    if (tab === 'add') openItemDialog();
    if (tab === 'me') openMeDialog();
  });

  // Keyboard: "n" new wish, "/" search, Esc backs out of the item screen.
  document.addEventListener('keydown', (e) => {
    const dialogOpen = $$('dialog').some((d) => d.open);
    if (e.key === 'Escape' && !dialogOpen) {
      if (!el.itemMenu.hidden) { closeItemMenu(); return; }
      closeItem();
    }
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName) || document.activeElement?.isContentEditable;
    if (typing || dialogOpen || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === 'n' && !shared) { e.preventDefault(); openItemDialog(); }
    if (e.key === '/') {
      e.preventDefault();
      if (!view.searchOpen) el.searchBtn.click(); else el.search.focus();
    }
  });

  window.addEventListener('storage', (e) => {
    if (e.key === STORAGE_KEY) { state = load(); render(); }
  });
  window.addEventListener('hashchange', () => { readHash(); view.selectedId = null; enterNext = true; el.body.classList.remove('item-open'); render(); });
  wide.addEventListener('change', () => { el.body.classList.remove('item-open'); render(); });

  readHash();
  render();
})();
