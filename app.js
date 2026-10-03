/* Wishful — a small, dependency-free wish list app.
   Data lives in localStorage; lists can be shared as a read-only snapshot
   encoded in the URL hash (#share=…), so no server is needed. */
(() => {
  'use strict';

  const STORAGE_KEY = 'wishful:v1';
  const THEME_KEY = 'wishful:theme';
  const SHARED_PICKS_PREFIX = 'wishful:picks:';

  const EMOJIS = ['🎁', '🎂', '🎄', '🏠', '✈️', '📚', '🎧', '👟', '💍', '🧸', '🎮', '🌿', '🍳', '🎨', '💻', '⭐'];
  const PRIORITY = {
    1: { icon: '🔥', label: 'Must have' },
    2: { icon: '💛', label: 'Would love' },
    3: { icon: '🌱', label: 'Nice to have' },
  };
  const STATUS_CYCLE = { wanted: 'reserved', reserved: 'got', got: 'wanted' };
  const STATUS_LABEL = { wanted: '♡ Wanted', reserved: '◎ Reserved', got: '✓ Got it' };
  const STATUS_ORDER = { wanted: 0, reserved: 1, got: 2 };
  const GRADIENTS = [
    'linear-gradient(135deg, #fde2d4, #f9c6b5)',
    'linear-gradient(135deg, #fbe7c6, #f6cf8f)',
    'linear-gradient(135deg, #d9f0e3, #a9dcc0)',
    'linear-gradient(135deg, #dfe8fb, #b7c9f2)',
    'linear-gradient(135deg, #efe0f7, #d4b8ea)',
    'linear-gradient(135deg, #fde0ea, #f5b3c8)',
    'linear-gradient(135deg, #e2f3f5, #a9d9df)',
  ];
  const CATEGORY_EMOJI = {
    tech: '💻', electronics: '💻', gadgets: '📱', books: '📚', book: '📚', reading: '📚',
    home: '🏠', decor: '🪴', kitchen: '🍳', cooking: '🍳', clothes: '👕', clothing: '👕',
    fashion: '👗', shoes: '👟', accessories: '👜', jewelry: '💍', jewellery: '💍',
    games: '🎮', gaming: '🎮', toys: '🧸', kids: '🧸', beauty: '💄', wellness: '🧖',
    sports: '⚽', fitness: '🏋️', outdoors: '🏕️', travel: '✈️', music: '🎵', art: '🎨',
    crafts: '🧶', garden: '🌿', plants: '🪴', experiences: '🎟️', experience: '🎟️',
    food: '🍫', drinks: '🍷', pets: '🐾', car: '🚗', bike: '🚲', photography: '📷',
  };

  /* ---------- helpers ---------- */

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

  const uid = () =>
    (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2)).slice(0, 12);

  const escapeHtml = (s) =>
    String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

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

  function relativeTime(ts) {
    if (!ts) return '';
    const diff = (ts - Date.now()) / 1000;
    const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
    const units = [['year', 31536000], ['month', 2592000], ['week', 604800], ['day', 86400], ['hour', 3600], ['minute', 60]];
    for (const [unit, sec] of units) {
      if (Math.abs(diff) >= sec) return rtf.format(Math.round(diff / sec), unit);
    }
    return 'just now';
  }

  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

  /* ---------- data ---------- */

  function normalizeItem(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const title = String(raw.title ?? '').trim().slice(0, 120);
    if (!title) return null;
    const price = raw.price === '' || raw.price == null ? null : Number(raw.price);
    const priority = [1, 2, 3].includes(Number(raw.priority)) ? Number(raw.priority) : 2;
    const status = ['wanted', 'reserved', 'got'].includes(raw.status) ? raw.status : 'wanted';
    return {
      id: typeof raw.id === 'string' && raw.id ? raw.id.slice(0, 40) : uid(),
      title,
      url: safeUrl(raw.url),
      image: safeUrl(raw.image),
      price: Number.isFinite(price) && price >= 0 ? Math.round(price * 100) / 100 : null,
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
    const birthday = normalizeList({
      name: 'Birthday wishes',
      emoji: '🎂',
      currency: 'EUR',
      createdAt: now - 6 * day,
      updatedAt: now - day,
      items: [
        { title: 'Noise-cancelling headphones', price: 279, priority: 1, category: 'Tech', notes: 'Over-ear, black or silver. Long battery life matters most.', createdAt: now - 6 * day },
        { title: 'The Creative Act by Rick Rubin', price: 24.9, priority: 2, category: 'Books', notes: 'Hardcover please!', createdAt: now - 5 * day },
        { title: 'Pottery class for two', price: 90, priority: 2, category: 'Experiences', status: 'reserved', createdAt: now - 4 * day },
        { title: 'Linen bed sheets', price: 120, priority: 3, category: 'Home', notes: 'Double size, sage green or oat.', createdAt: now - 3 * day },
        { title: 'Cozy wool socks', price: 18, priority: 3, category: 'Clothing', status: 'got', createdAt: now - 2 * day },
      ],
    });
    const holidays = normalizeList({ name: 'Holidays 2026', emoji: '🎄', currency: 'EUR', createdAt: now - day });
    return { lists: [birthday, holidays], activeListId: birthday.id };
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

  const view = { filter: 'all', sort: 'priority', query: '' };
  let editingItemId = null;
  let editingListId = null;
  let pickedEmoji = EMOJIS[0];

  const currentList = () =>
    shared ? shared.list : state.lists.find((l) => l.id === state.activeListId) || state.lists[0];

  // Effective status for display (in shared mode, the viewer's own picks count as reserved).
  function statusOf(item) {
    if (shared && shared.picks.has(item.id)) return 'reserved';
    return item.status;
  }

  /* ---------- rendering ---------- */

  const el = {
    body: document.body,
    listNav: $('#listNav'),
    heroEmoji: $('#heroEmoji'),
    listTitle: $('#listTitle'),
    listSub: $('#listSub'),
    stats: $('#stats'),
    grid: $('#grid'),
    empty: $('#empty'),
    emptyTitle: $('#emptyTitle'),
    emptyText: $('#emptyText'),
    emptyAddBtn: $('#emptyAddBtn'),
    search: $('#search'),
    sort: $('#sort'),
    chips: $('#filterChips'),
    addItemBtn: $('#addItemBtn'),
    shareBtn: $('#shareBtn'),
    editListBtn: $('#editListBtn'),
    sharedBanner: $('#sharedBanner'),
  };

  function render() {
    const isShared = !!shared;
    el.body.classList.toggle('is-shared', isShared);
    el.sharedBanner.hidden = !isShared;
    el.addItemBtn.hidden = isShared;
    el.shareBtn.hidden = isShared;
    el.editListBtn.hidden = isShared;
    $('[data-filter="got"]', el.chips).hidden = isShared;
    if (isShared && view.filter === 'got') view.filter = 'all';

    renderSidebar();
    renderHero();
    renderStats();
    renderGrid();
  }

  function renderSidebar() {
    if (shared) return;
    el.listNav.innerHTML = state.lists
      .map((l) => {
        const open = l.items.filter((i) => i.status !== 'got').length;
        const active = l.id === state.activeListId;
        return `<button class="list-link${active ? ' is-active' : ''}" data-list="${escapeHtml(l.id)}"${active ? ' aria-current="page"' : ''}>
          <span class="list-link-emoji" aria-hidden="true">${l.emoji}</span>
          <span class="list-link-name">${escapeHtml(l.name)}</span>
          <span class="list-link-count">${open}</span>
        </button>`;
      })
      .join('');
  }

  function renderHero() {
    const list = currentList();
    el.heroEmoji.textContent = list.emoji;
    el.listTitle.textContent = list.name;
    el.listSub.textContent = shared
      ? 'A wish list shared with you'
      : `${plural(list.items.length, 'wish')} · updated ${relativeTime(list.updatedAt)}`;
    document.title = `${list.name} — Wishful`;
  }

  function renderStats() {
    const list = currentList();
    const items = list.items;
    const sum = (arr) => arr.reduce((s, i) => s + (i.price || 0), 0);
    let cards;
    if (shared) {
      const mine = items.filter((i) => shared.picks.has(i.id));
      const available = items.filter((i) => statusOf(i) === 'wanted');
      cards = [
        ['Wishes', items.length],
        ['Still available', available.length],
        ["You're getting", mine.length],
        ['Your total', money(sum(mine), list.currency) || '—'],
      ];
    } else {
      const got = items.filter((i) => i.status === 'got');
      const open = items.filter((i) => i.status !== 'got');
      const reserved = items.filter((i) => i.status === 'reserved');
      const pct = items.length ? Math.round((got.length / items.length) * 100) : 0;
      cards = [
        ['Wishes', open.length],
        ['Still to get', money(sum(open), list.currency) || '—'],
        ['Reserved', reserved.length],
        ['Fulfilled', `${got.length}/${items.length}`, pct],
      ];
    }
    el.stats.innerHTML = cards
      .map(([label, value, pct]) => `<div class="stat">
        <div class="stat-label">${escapeHtml(label)}</div>
        <div class="stat-value">${escapeHtml(value)}</div>
        ${pct != null ? `<div class="progress" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100" aria-label="Fulfilled"><span style="width:${pct}%"></span></div>` : ''}
      </div>`)
      .join('');
  }

  function visibleItems() {
    const list = currentList();
    const q = view.query.trim().toLowerCase();
    let items = list.items.filter((it) => {
      if (view.filter !== 'all' && statusOf(it) !== view.filter) return false;
      if (!q) return true;
      return [it.title, it.notes, it.category, hostOf(it.url)].some((f) => f && f.toLowerCase().includes(q));
    });
    const byPrice = (a, b, dir) => {
      if (a.price == null && b.price == null) return 0;
      if (a.price == null) return 1;
      if (b.price == null) return -1;
      return (a.price - b.price) * dir;
    };
    const sorters = {
      priority: (a, b) => a.priority - b.priority || b.createdAt - a.createdAt,
      newest: (a, b) => b.createdAt - a.createdAt,
      'price-asc': (a, b) => byPrice(a, b, 1),
      'price-desc': (a, b) => byPrice(a, b, -1),
      name: (a, b) => a.title.localeCompare(b.title),
    };
    const sorter = sorters[view.sort] || sorters.priority;
    // Fulfilled wishes always sink to the bottom.
    items = items.slice().sort((a, b) => (a.status === 'got') - (b.status === 'got') || sorter(a, b));
    return items;
  }

  function cardHtml(item, list, index) {
    const status = statusOf(item);
    const p = PRIORITY[item.priority];
    const grad = GRADIENTS[parseInt(hashStr(item.id), 36) % GRADIENTS.length];
    const emoji = CATEGORY_EMOJI[item.category.toLowerCase()] || list.emoji;
    const host = hostOf(item.url);
    const price = money(item.price, list.currency);
    const titleHtml = item.url
      ? `<a href="${escapeHtml(item.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(item.title)}</a>`
      : escapeHtml(item.title);

    let statusBadge = '';
    if (status === 'reserved') statusBadge = `<span class="badge badge-reserved">${shared && shared.picks.has(item.id) ? 'For you' : 'Reserved'}</span>`;
    if (status === 'got') statusBadge = '<span class="badge badge-got">Got it ✓</span>';

    let statusBtn;
    if (shared) {
      const mine = shared.picks.has(item.id);
      const takenByOther = !mine && item.status === 'reserved';
      statusBtn = takenByOther
        ? '<button class="status-btn is-reserved" disabled>Already reserved</button>'
        : `<button class="status-btn${mine ? ' is-reserved' : ''}" data-act="pick" aria-pressed="${mine}">${mine ? '✓ Getting it' : '🎁 I’ll get this'}</button>`;
    } else {
      statusBtn = `<button class="status-btn is-${status}" data-act="status" title="Click to change status">${STATUS_LABEL[status]}</button>`;
    }

    const meta = [item.category && escapeHtml(item.category), host && `<span class="host">${escapeHtml(host)}</span>`]
      .filter(Boolean)
      .join('<span class="dot">·</span>');

    return `<article class="card is-${status}" data-id="${escapeHtml(item.id)}" style="--card-grad:${grad};animation-delay:${Math.min(index, 12) * 30}ms">
      <div class="card-media">
        ${item.image ? `<img src="${escapeHtml(item.image)}" alt="" loading="lazy" referrerpolicy="no-referrer" />` : `<span class="card-media-emoji" aria-hidden="true">${emoji}</span>`}
        <div class="card-badges">
          <span class="badge" title="${p.label}">${p.icon}<span class="badge-text"> ${p.label}</span></span>
          ${statusBadge}
        </div>
      </div>
      <div class="card-body">
        ${meta ? `<div class="card-meta">${meta}</div>` : ''}
        <h3 class="card-title">${titleHtml}</h3>
        ${item.notes ? `<p class="card-notes">${escapeHtml(item.notes)}</p>` : ''}
        <div class="card-price${price ? '' : ' is-empty'}">${price ? escapeHtml(price) : 'No price set'}</div>
      </div>
      <div class="card-actions">
        ${statusBtn}
        ${item.url ? `<a class="icon-btn" href="${escapeHtml(item.url)}" target="_blank" rel="noopener noreferrer" title="Open link" aria-label="Open link for ${escapeHtml(item.title)}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 4h6v6M20 4l-9 9M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4"/></svg></a>` : ''}
        ${shared ? '' : `<button class="icon-btn" data-act="edit" title="Edit" aria-label="Edit ${escapeHtml(item.title)}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16v4zM13.5 6.5l4 4"/></svg></button>`}
      </div>
    </article>`;
  }

  function renderGrid() {
    const list = currentList();
    const items = visibleItems();
    el.grid.innerHTML = items.map((it, i) => cardHtml(it, list, i)).join('');

    const filtered = list.items.length > 0;
    el.empty.hidden = items.length > 0;
    if (!items.length) {
      if (filtered) {
        el.emptyTitle.textContent = 'No matching wishes';
        el.emptyText.textContent = 'Try a different search or filter.';
        el.emptyAddBtn.textContent = 'Clear filters';
        el.emptyAddBtn.dataset.mode = 'clear';
        el.emptyAddBtn.hidden = false;
      } else {
        el.emptyTitle.textContent = shared ? 'This list is empty' : 'Nothing here yet';
        el.emptyText.textContent = shared
          ? 'Looks like every wish has already been fulfilled. 🎉'
          : 'Add the first thing you’re wishing for — a link, a price and a note is all it takes.';
        el.emptyAddBtn.textContent = '+ Add a wish';
        el.emptyAddBtn.dataset.mode = 'add';
        el.emptyAddBtn.hidden = !!shared;
      }
    }
  }

  // Broken image → fall back to the emoji placeholder.
  el.grid.addEventListener('error', (e) => {
    const img = e.target;
    if (img.tagName !== 'IMG') return;
    const card = img.closest('.card');
    const item = card && currentList().items.find((i) => i.id === card.dataset.id);
    const span = document.createElement('span');
    span.className = 'card-media-emoji';
    span.setAttribute('aria-hidden', 'true');
    span.textContent = (item && CATEGORY_EMOJI[item.category.toLowerCase()]) || currentList().emoji;
    img.replaceWith(span);
  }, true);

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
    // Restart the entrance animation.
    t.style.animation = 'none';
    void t.offsetWidth;
    t.style.animation = '';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, action ? 6000 : 3000);
  }

  /* ---------- confetti ---------- */

  function celebrate(x, y) {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const bits = ['🎉', '✨', '💖', '⭐', '🎊'];
    for (let i = 0; i < 16; i++) {
      const s = document.createElement('span');
      s.textContent = bits[i % bits.length];
      s.style.cssText = `position:fixed;left:${x}px;top:${y}px;z-index:60;pointer-events:none;font-size:${14 + Math.random() * 10}px`;
      document.body.appendChild(s);
      const angle = Math.random() * Math.PI * 2;
      const dist = 60 + Math.random() * 90;
      s.animate(
        [
          { transform: 'translate(-50%, -50%) scale(.4)', opacity: 1 },
          { transform: `translate(calc(-50% + ${Math.cos(angle) * dist}px), calc(-50% + ${Math.sin(angle) * dist - 40}px)) scale(1) rotate(${Math.random() * 360}deg)`, opacity: 0 },
        ],
        { duration: 700 + Math.random() * 400, easing: 'cubic-bezier(.2,.8,.2,1)' },
      ).onfinish = () => s.remove();
    }
  }

  /* ---------- dialogs ---------- */

  const itemDialog = $('#itemDialog');
  const itemForm = $('#itemForm');
  const listDialog = $('#listDialog');
  const listForm = $('#listForm');
  const shareDialog = $('#shareDialog');

  function openDialog(d) {
    if (typeof d.showModal === 'function') d.showModal();
    else d.setAttribute('open', '');
  }

  for (const d of [itemDialog, listDialog, shareDialog]) {
    d.addEventListener('click', (e) => {
      if (e.target === d || e.target.closest('[data-close]')) d.close();
    });
  }

  function openItemDialog(item) {
    if (shared) return;
    const list = currentList();
    editingItemId = item ? item.id : null;
    itemForm.reset();
    $('#itemDialogTitle').textContent = item ? 'Edit wish' : 'Add a wish';
    $('#itemSubmit').textContent = item ? 'Save changes' : 'Add wish';
    $('#deleteItemBtn').hidden = !item;
    const cats = [...new Set(state.lists.flatMap((l) => l.items.map((i) => i.category)).filter(Boolean))].sort();
    $('#categoryList').innerHTML = cats.map((c) => `<option value="${escapeHtml(c)}"></option>`).join('');
    const f = itemForm.elements;
    f.title.value = item?.title ?? '';
    f.url.value = item?.url ?? '';
    f.price.value = item?.price ?? '';
    f.price.placeholder = `0.00 ${list.currency}`;
    f.category.value = item?.category ?? '';
    f.image.value = item?.image ?? '';
    f.notes.value = item?.notes ?? '';
    f.priority.value = String(item?.priority ?? 2);
    openDialog(itemDialog);
    setTimeout(() => f.title.focus(), 30);
  }

  itemForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const f = itemForm.elements;
    const list = currentList();
    const rawUrl = f.url.value.trim();
    const rawImg = f.image.value.trim();
    if (rawUrl && !safeUrl(rawUrl)) { f.url.setCustomValidity('Please enter a valid web link'); f.url.reportValidity(); f.url.setCustomValidity(''); return; }
    if (rawImg && !safeUrl(rawImg)) { f.image.setCustomValidity('Please enter a valid image link'); f.image.reportValidity(); f.image.setCustomValidity(''); return; }

    const existing = editingItemId && list.items.find((i) => i.id === editingItemId);
    const data = normalizeItem({
      ...(existing || {}),
      title: f.title.value,
      url: rawUrl,
      image: rawImg,
      price: f.price.value,
      category: f.category.value,
      notes: f.notes.value,
      priority: f.priority.value,
    });
    if (!data) return;
    if (existing) {
      Object.assign(existing, data);
      toast('Wish updated');
    } else {
      list.items.push(data);
      toast('Wish added ✨');
    }
    touch(list);
    itemDialog.close();
    render();
  });

  $('#deleteItemBtn').addEventListener('click', () => {
    const list = currentList();
    const idx = list.items.findIndex((i) => i.id === editingItemId);
    if (idx < 0) return;
    const [removed] = list.items.splice(idx, 1);
    touch(list);
    itemDialog.close();
    render();
    toast(`Deleted “${removed.title}”`, {
      label: 'Undo',
      run: () => {
        list.items.splice(Math.min(idx, list.items.length), 0, removed);
        touch(list);
        render();
      },
    });
  });

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
    openDialog(listDialog);
    setTimeout(() => listForm.elements.name.focus(), 30);
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
    save();
    listDialog.close();
    render();
    toast('List deleted');
  });

  /* ---------- share dialog ---------- */

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
    openDialog(shareDialog);
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
    $('#copyShareBtn').textContent = 'Copied!';
    setTimeout(() => { $('#copyShareBtn').textContent = 'Copy'; }, 1600);
  });

  $('#nativeShareBtn').addEventListener('click', () => {
    const list = currentList();
    navigator.share({ title: `${list.emoji} ${list.name}`, text: `My wish list: ${list.name}`, url: $('#shareUrl').value }).catch(() => {});
  });

  /* ---------- import / export ---------- */

  function exportData() {
    const blob = new Blob([JSON.stringify({ app: 'wishful', version: 1, exportedAt: new Date().toISOString(), ...state }, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `wishful-backup-${new Date().toISOString().slice(0, 10)}.json`;
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
      // Fresh ids so imports never collide with existing lists.
      lists.forEach((l) => { l.id = uid(); });
      state.lists.push(...lists);
      state.activeListId = lists[0].id;
      save();
      if (shared) leaveShared();
      render();
      toast(`Imported ${plural(lists.length, 'list')}`);
    } catch {
      toast('Could not read that file — is it a Wishful backup?');
    }
  });

  /* ---------- theme ---------- */

  function applyTheme(theme) {
    if (theme) document.documentElement.dataset.theme = theme;
    else delete document.documentElement.dataset.theme;
    const dark = theme ? theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
    $('meta[name="theme-color"]').content = dark ? '#17130f' : '#f7f1ea';
  }

  function toggleTheme() {
    const current = document.documentElement.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    const next = current === 'dark' ? 'light' : 'dark';
    try { localStorage.setItem(THEME_KEY, next); } catch { /* ignore */ }
    applyTheme(next);
  }

  try { applyTheme(localStorage.getItem(THEME_KEY)); } catch { applyTheme(null); }

  /* ---------- events ---------- */

  function leaveShared() {
    shared = null;
    history.replaceState(null, '', location.pathname + location.search);
  }

  el.listNav.addEventListener('click', (e) => {
    const b = e.target.closest('[data-list]');
    if (!b) return;
    state.activeListId = b.dataset.list;
    save();
    render();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });

  el.grid.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const card = btn.closest('.card');
    const list = currentList();
    const item = list.items.find((i) => i.id === card.dataset.id);
    if (!item) return;

    if (btn.dataset.act === 'edit') openItemDialog(item);

    if (btn.dataset.act === 'status') {
      item.status = STATUS_CYCLE[item.status];
      touch(list);
      if (item.status === 'got') {
        const r = btn.getBoundingClientRect();
        celebrate(r.left + r.width / 2, r.top + r.height / 2);
        toast(`Yay! “${item.title}” is yours 🎉`);
      }
      render();
    }

    if (btn.dataset.act === 'pick') {
      if (shared.picks.has(item.id)) shared.picks.delete(item.id);
      else {
        shared.picks.add(item.id);
        const r = btn.getBoundingClientRect();
        celebrate(r.left + r.width / 2, r.top + r.height / 2);
      }
      savePicks();
      render();
    }
  });

  el.search.addEventListener('input', () => { view.query = el.search.value; renderGrid(); });
  el.sort.addEventListener('change', () => { view.sort = el.sort.value; renderGrid(); });
  el.chips.addEventListener('click', (e) => {
    const c = e.target.closest('[data-filter]');
    if (!c) return;
    view.filter = c.dataset.filter;
    $$('[data-filter]', el.chips).forEach((x) => {
      x.classList.toggle('is-active', x === c);
      x.setAttribute('aria-selected', String(x === c));
    });
    renderGrid();
  });

  el.emptyAddBtn.addEventListener('click', () => {
    if (el.emptyAddBtn.dataset.mode === 'clear') {
      view.query = '';
      el.search.value = '';
      $('[data-filter="all"]', el.chips).click();
    } else {
      openItemDialog();
    }
  });

  el.addItemBtn.addEventListener('click', () => openItemDialog());
  $('#newListBtn').addEventListener('click', () => openListDialog());
  el.editListBtn.addEventListener('click', () => openListDialog(currentList()));
  el.heroEmoji.addEventListener('click', () => openListDialog(currentList()));
  el.shareBtn.addEventListener('click', openShareDialog);

  $('#saveSharedBtn').addEventListener('click', () => {
    const copy = normalizeList({ ...shared.list, id: uid(), items: shared.list.items.map((i) => ({ ...i, id: uid(), status: 'wanted' })) });
    state.lists.push(copy);
    state.activeListId = copy.id;
    save();
    leaveShared();
    render();
    toast(`Saved “${copy.name}” to your lists`);
  });

  // Overflow menu
  const menuBtn = $('#menuBtn');
  const menu = $('#menu');
  const setMenu = (open) => { menu.hidden = !open; menuBtn.setAttribute('aria-expanded', String(open)); };
  menuBtn.addEventListener('click', (e) => { e.stopPropagation(); setMenu(menu.hidden); });
  document.addEventListener('click', (e) => { if (!menu.hidden && !menu.contains(e.target)) setMenu(false); });
  menu.addEventListener('click', (e) => {
    const b = e.target.closest('[data-action]');
    if (!b) return;
    setMenu(false);
    if (b.dataset.action === 'export') exportData();
    if (b.dataset.action === 'import') $('#importFile').click();
    if (b.dataset.action === 'theme') toggleTheme();
  });

  // Keyboard shortcuts: "n" new wish, "/" search, Esc closes menu.
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') setMenu(false);
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName) || document.activeElement?.isContentEditable;
    const dialogOpen = $$('dialog').some((d) => d.open);
    if (typing || dialogOpen || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === 'n' && !shared) { e.preventDefault(); openItemDialog(); }
    if (e.key === '/') { e.preventDefault(); el.search.focus(); }
  });

  // Keep multiple tabs in sync.
  window.addEventListener('storage', (e) => {
    if (e.key === STORAGE_KEY) { state = load(); render(); }
  });

  window.addEventListener('hashchange', () => { readHash(); render(); });

  // Refresh "updated x ago" now and then.
  setInterval(renderHero, 60000);

  readHash();
  render();
})();
