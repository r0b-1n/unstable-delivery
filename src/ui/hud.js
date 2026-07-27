import { i18n, t, LANGS } from './i18n.js';
import { MARK_SVG, STAMPS, barcodeCss, rankFor } from './brand.js';

// DOM HUD. No framework, just refs and small mutations.
//
// Every method that renders user-facing text takes a TRANSLATION KEY plus
// params, never a finished string. A string handed to the Hud has already lost
// the information needed to re-render it when the language flips, and the
// language can flip at any moment including mid-delivery.
//
// Every setter is memoised. director.js writes the hazard banner 60×/s while an
// event is live, and each write used to force a style recalculation over a live
// WebGL composite. Compare-then-write here rather than teaching six call sites
// to be careful.

const TICKS = 10;

export class Hud {
  constructor() {
    const $ = (id) => document.getElementById(id);
    this.root = $('hud');
    this.pkgName = $('ud-pkg-name');
    this.pkgNote = $('ud-pkg-note');
    this.mCondition = $('ud-meter-condition');
    this.mShake = $('ud-meter-shake');
    this.score = $('ud-score');
    this.deliveries = $('ud-deliveries');
    this.alt = $('ud-alt');
    this.shiftEl = $('ud-shift');
    this.stackEl = $('ud-stack');
    this.arrow = $('ud-arrow');
    this.dist = $('ud-dist');
    this.navLabel = $('ud-nav-label');
    this.timerEl = $('ud-timer');
    this.chainEl = $('ud-chain');
    this.bannerEl = $('ud-banner');
    this.toasts = $('ud-toasts');
    this.pops = $('ud-pops');
    this.waybill = $('ud-waybill');
    this.wbNo = $('ud-wb-no');
    this.wbItem = $('ud-wb-item');
    this.wbTo = $('ud-wb-to');
    this.wbWarning = $('ud-wb-warning');
    this.barcode = $('ud-barcode');
    this.wbTrack = $('ud-wb-track');
    this.hint = $('ud-hint');
    this.lockHint = $('ud-lockhint');
    this.status = $('ud-status');
    this.titleLoading = $('ud-title-loading');
    this.titleBar = $('ud-title-bar').firstElementChild;
    this.titleStart = $('ud-title-start');
    this.titleControls = $('ud-title-controls');
    this.titleBlurb = $('ud-title-blurb');
    this.titleActions = $('ud-title-actions');

    this.screens = {
      title: $('ud-title'), briefing: $('ud-briefing'), pause: $('ud-pause'),
      results: $('ud-results'), meta: $('ud-meta'), fault: $('ud-fault'),
    };

    for (const el of [$('ud-mark'), ...document.querySelectorAll('.ud-wb-mark')]) el.innerHTML = MARK_SVG;
    this._buildTicks(this.mCondition);
    this._buildTicks(this.mShake);

    this._memo = {};
    this._scoreShown = 0;
    this._handlers = {};
    this._motionOverride = null;

    i18n.onChange(() => this._relocalise());
    document.documentElement.lang = i18n.lang;
    i18n.apply();
    this.applyScale();
    window.addEventListener('resize', () => this.applyScale());
  }

  // ---------- infrastructure ----------

  // min/max keeps the interface usable from a 1280×720 laptop to a 4K panel
  // without a single per-component media query.
  applyScale() {
    const s = Math.min(Math.max(Math.min(window.innerWidth / 1600, window.innerHeight / 900), 0.82), 1.3);
    document.documentElement.style.setProperty('--ud-scale', s.toFixed(3));
  }

  reduced() {
    if (this._motionOverride !== null) return this._motionOverride;
    return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  }

  setReducedMotion(on) {
    this._motionOverride = on;
    document.documentElement.dataset.motion = on ? 'reduced' : '';
  }

  _buildTicks(meter) {
    const row = meter.querySelector('.ud-ticks');
    for (let i = 0; i < TICKS; i++) row.appendChild(document.createElement('i'));
  }

  // Re-render everything that carries live text. Static markup is handled by
  // the data-i18n pass; these are the values the game wrote at runtime.
  _relocalise() {
    i18n.apply();
    this._memo = {};
    const s = this._last ?? {};
    if (s.pkg !== undefined) this.setPackage(s.pkg, s.pkgOpts);
    if (s.deliveries !== undefined) this.setDeliveries(s.deliveries);
    if (s.alt) this.setAlt(s.alt.y, s.alt.zoneKey);
    if (s.target) this.setTarget(s.target.rel, s.target.dist, s.target.spotKey);
    if (s.banner) this.banner(s.banner.key, s.banner.params);
    if (s.slip) this.showSlip(s.slip.num, s.slip.def, s.slip.targetKey);
    if (s.shift) this.setShift(s.shift);
    if (s.stack) this.setStack(s.stack.n, s.stack.max);
    this.setStatus(this._statusData ?? {});
    if (this._openScreen) this._renderScreen(this._openScreen);
  }

  _set(el, prop, value) {
    const k = `${el.id || el.className}.${prop}`;
    if (this._memo[k] === value) return false;
    this._memo[k] = value;
    el[prop] = value;
    return true;
  }

  show() { this.root.classList.add('on'); }

  // ---------- consignment card ----------

  setPackage(def, opts = {}) {
    (this._last ??= {}).pkg = def;
    this._last.pkgOpts = opts;
    if (!def) {
      this._set(this.pkgName, 'textContent', t('hud.nopackage'));
      this._set(this.pkgNote, 'textContent', t('hud.nopackage.note'));
      this.mCondition.hidden = true;
      this.mShake.hidden = true;
      return;
    }
    this._set(this.pkgName, 'textContent', packageName(def));
    this._set(this.pkgNote, 'textContent', packageNote(def));
    this.mCondition.hidden = false;
    this.mShake.hidden = def.id !== 'potion';
  }

  // How much of the stack is loaded. Only shown once there is more than one
  // parcel — a permanent "1/3" is noise the player learns to stop reading.
  setStack(n, max) {
    (this._last ??= {}).stack = { n, max };
    this._set(this.stackEl, 'textContent', n > 1 ? t('hud.stack', { n, max }) : '');
  }

  setCondition(pct) { this._meter(this.mCondition, pct, true); }
  setShake(pct) { this._meter(this.mShake, pct, false); }

  // `goodIsHigh` flips which end of the ramp counts as trouble: condition is
  // bad when it runs out, instability is bad when it fills up.
  _meter(meter, pct, goodIsHigh) {
    const p = Math.max(0, Math.min(100, Math.round(pct)));
    const filled = Math.round((p / 100) * TICKS);
    if (meter._filled !== filled) {
      meter._filled = filled;
      const ticks = meter.querySelectorAll('.ud-ticks i');
      for (let i = 0; i < TICKS; i++) ticks[i].classList.toggle('on', i < filled);
    }
    const val = meter.querySelector('.ud-meter-val');
    if (val.textContent !== `${p}%`) val.textContent = `${p}%`;
    const danger = goodIsHigh ? 100 - p : p;
    const state = danger > 75 ? 'bad' : danger > 45 ? 'warn' : 'ok';
    if (meter.dataset.state !== state) meter.dataset.state = state;
  }

  // ---------- revenue block ----------

  // Counts up rather than teleporting — small numbers feel earned too.
  setScore(n) {
    cancelAnimationFrame(this._scoreRaf);
    if (this.reduced()) { this._scoreShown = n; this.score.textContent = String(n); return; }
    const from = this._scoreShown;
    const t0 = performance.now();
    const tick = (now) => {
      const k = Math.min((now - t0) / 500, 1);
      this._scoreShown = Math.round(from + (n - from) * (1 - Math.pow(1 - k, 3)));
      this.score.textContent = String(this._scoreShown);
      if (k < 1) this._scoreRaf = requestAnimationFrame(tick);
    };
    this._scoreRaf = requestAnimationFrame(tick);
  }

  setDeliveries(n) {
    (this._last ??= {}).deliveries = n;
    this._set(this.deliveries, 'textContent', i18n.plural('hud.deliveries', n));
  }

  setAlt(y, zoneKey) {
    (this._last ??= {}).alt = { y, zoneKey };
    this._set(this.alt, 'textContent', `${t('hud.altitude')} ${Math.max(0, Math.round(y))} m · ${t(zoneKey)}`);
  }

  setShift(shift) {
    (this._last ??= {}).shift = shift;
    if (!shift) { this._set(this.shiftEl, 'textContent', ''); return; }
    this._set(this.shiftEl, 'textContent', `${t('hud.shift', { n: shift.index })} · ${shift.done}/${shift.total}`);
  }

  // `cap` is handed in rather than hardcoded: the seniority requisition raises
  // it, and a HUD that keeps showing ×3 while the payout is ×5 is a HUD that lies.
  setChain(chain, cap = 4) {
    const mult = 1 + 0.5 * Math.min(chain, cap);
    if (chain < 2) { this.chainEl.classList.remove('on'); return; }
    this.chainEl.classList.add('on');
    this.chainEl.textContent = `🔥 ${t('hud.chain', { mult: mult.toFixed(1) })}`;
    this.chainEl.classList.remove('pop');
    void this.chainEl.offsetWidth; // restart the pop animation
    this.chainEl.classList.add('pop');
  }

  // ---------- navigation ----------

  setTarget(relBearing, dist, spotKey) {
    (this._last ??= {}).target = { rel: relBearing, dist, spotKey };
    // World bearings are counter-clockwise, CSS rotation is clockwise —
    // negate or the arrow mirrors left/right.
    this.arrow.style.transform = `rotate(${-relBearing - Math.PI / 2}rad)`;
    this._set(this.dist, 'textContent', dist > 999 ? `${(dist / 1000).toFixed(1)} km` : `${Math.round(dist)} m`);
    this._set(this.navLabel, 'textContent', `${t('hud.deliverto')} · ${t(spotKey).toUpperCase()}`);
  }

  setTimer(secLeft) {
    if (secLeft === null) { this._set(this.timerEl, 'textContent', ''); return; }
    if (secLeft > 0) {
      this._set(this.timerEl, 'textContent', t('hud.bonus', { n: Math.ceil(secLeft) }));
      this.timerEl.classList.remove('expired');
    } else {
      this._set(this.timerEl, 'textContent', t('hud.bonus.expired'));
      this.timerEl.classList.add('expired');
    }
  }

  // ---------- transient messages ----------

  banner(key, params) {
    (this._last ??= {}).banner = key ? { key, params } : null;
    if (!key) { this.bannerEl.classList.remove('on'); return; }
    const text = t(key, params);
    if (this._set(this.bannerEl, 'textContent', text)) this.bannerEl.classList.add('on');
    else this.bannerEl.classList.add('on');
  }

  toast(key, params, opts = {}) {
    const el = document.createElement('div');
    el.className = opts.small ? 'ud-toast small' : 'ud-toast';
    el.textContent = t(key, params);
    this.toasts.appendChild(el);
    setTimeout(() => el.remove(), 3300);
    while (this.toasts.children.length > 3) this.toasts.firstChild.remove();
  }

  // items: { key, params, amount } — amount is optional (headline rows carry
  // only a label), and the last item is rendered as the total line.
  scorePop(items) {
    const el = document.createElement('div');
    el.className = 'ud-receipt';
    items.forEach((item, i) => {
      const row = document.createElement('div');
      row.className = i === items.length - 1 ? 'ud-receipt-row total' : 'ud-receipt-row';
      const label = document.createElement('span');
      label.textContent = t(item.key, item.params);
      const amount = document.createElement('b');
      amount.textContent = item.amount === undefined ? '' : (item.amount >= 0 ? `+${item.amount}` : String(item.amount));
      row.append(label, amount);
      el.appendChild(row);
    });
    this.pops.appendChild(el);
    setTimeout(() => el.remove(), 2700);
    while (this.pops.children.length > 3) this.pops.firstChild.remove();
  }

  // ---------- waybill ----------

  showSlip(num, def, targetKey) {
    (this._last ??= {}).slip = { num, def, targetKey };
    this.wbNo.textContent = `No. ${String(num).padStart(3, '0')}`;
    // textContent throughout. The old innerHTML path interpolated package
    // names straight into markup, and package names now come from a table
    // that a translator edits.
    this.wbItem.textContent = packageName(def);
    this.wbTo.textContent = t(targetKey);
    this.wbWarning.textContent = `⚠ ${packageWarning(def)}`;
    this.waybill.classList.add('on');
    clearTimeout(this._slipTimer);
    this._slipTimer = setTimeout(() => this.hideSlip(), 9000);
  }

  hideSlip() { this.waybill.classList.remove('on'); }

  setTracking(str) {
    this.wbTrack.textContent = str;
    this.barcode.style.backgroundImage = barcodeCss(str);
    this.barcode.style.backgroundRepeat = 'repeat-x';
  }

  // ---------- stamps ----------

  // opts: { subKey, params, at: {x,y}, quiet }. `at` is a fraction of the
  // viewport; omitted, the stamp lands on the waybill.
  stamp(kindId, opts = {}) {
    const def = STAMPS[kindId];
    if (!def) return;
    const el = document.createElement('div');
    el.className = `ud-stamp ${def.tone}${def.oval ? ' oval' : ''}`;
    el.style.setProperty('--rot', `${def.rot}deg`);
    el.textContent = t(def.key);
    if (opts.subKey) {
      const sub = document.createElement('small');
      sub.textContent = t(opts.subKey, opts.params);
      el.appendChild(sub);
    }
    if (!opts.quiet) this.ctx?.sfx?.stamp?.();
    const host = opts.host ?? this.waybill;
    const at = opts.at ?? { x: 0.5, y: 0.55 };
    el.style.left = `${at.x * 100}%`;
    el.style.top = `${at.y * 100}%`;
    el.style.transform = `translate(-50%, -50%)`;
    host.appendChild(el);
    if (!opts.keep) setTimeout(() => el.remove(), 2600);
    return el;
  }

  // ---------- status + hints ----------

  setStatus(data) {
    this._statusData = { ...this._statusData, ...data };
    const d = this._statusData;
    const chips = [];
    if (d.quality) chips.push(t('hud.quality', { tier: d.quality.toUpperCase() }));
    if (d.lang) chips.push(t('lang.name'));
    if (d.music !== undefined) chips.push(d.music ? '♪' : '♪ —');
    const html = chips.map((c) => `<span class="ud-chip"></span>`).join('');
    if (this.status.dataset.n !== String(chips.length)) {
      this.status.innerHTML = html;
      this.status.dataset.n = String(chips.length);
    }
    const nodes = this.status.children;
    chips.forEach((c, i) => { if (nodes[i].textContent !== c) nodes[i].textContent = c; });
  }

  setLockHint(on) { this.lockHint.classList.toggle('on', on); }

  // ---------- boot / fault ----------

  boot(msgKey, pct) {
    this.titleLoading.textContent = t(msgKey);
    this.titleBar.style.width = `${Math.round(pct * 100)}%`;
  }

  // `shiftIndex > 1` means this player has been here before. Shift 4 looking
  // exactly like shift 1 is the cheapest way to tell a returning player their
  // progress does not matter.
  titleReady(shiftIndex = 1, mp = 0) {
    this.titleLoading.hidden = true;
    this.titleBar.parentElement.hidden = true;
    for (const el of [this.titleStart, this.titleControls, this.titleBlurb, this.titleActions]) el.hidden = false;
    this.titleActions.innerHTML = '';
    if (shiftIndex > 1 || mp > 0) {
      const back = el('div', { className: 'ud-wordmark-sub' },
        `${t('hud.shift', { n: shiftIndex })} · ${t('meta.mp')} ${mp}`);
      this.titleActions.appendChild(back);
    }
  }

  // Photo mode: hide the paperwork, keep the mountain.
  setPhotoMode(on) {
    this.root.style.opacity = on ? '0' : '';
    this._photo = on;
  }

  fault(message) {
    const sheet = this.screens.fault.firstElementChild;
    sheet.innerHTML = '';
    sheet.append(
      this._sheetHead(t('fault.title')),
      el('p', {}, t('fault.body')),
      el('pre', { className: 'ud-memo', style: 'white-space:pre-wrap;margin-top:10px' }, String(message)),
    );
    this.showScreen('fault');
  }

  // ---------- screens ----------

  bindMenu(handlers) { Object.assign(this._handlers, handlers); }

  showScreen(name) {
    for (const [k, elx] of Object.entries(this.screens)) elx.classList.toggle('on', k === name);
    this._openScreen = name;
    if (name !== 'title' && name !== 'fault') this._renderScreen(name);
    // Focus the first control so the sheet is keyboard-reachable immediately.
    this.screens[name]?.querySelector('.ud-btn')?.focus?.();
  }

  hideScreen(name) {
    this.screens[name]?.classList.remove('on');
    if (this._openScreen === name) this._openScreen = null;
  }

  _renderScreen(name) {
    if (name === 'pause') this._renderPause();
    else if (name === 'briefing') this._renderBriefing(this._briefingData);
    else if (name === 'results') this._renderResults(this._resultsData);
    else if (name === 'meta') this._renderMeta(this._metaData);
  }

  _sheetHead(title) {
    const head = el('div', { className: 'ud-sheet-head' });
    const mark = el('div', { className: 'ud-wb-mark' });
    mark.innerHTML = MARK_SVG;
    head.append(mark, el('div', {}, el('div', { className: 'ud-wordmark' }, 'VPS'),
      el('div', { className: 'ud-wordmark-sub' }, title)));
    return head;
  }

  _legal() { return el('div', { className: 'ud-legal' }, t('brand.legal')); }

  _renderPause() {
    const sheet = this.screens.pause.firstElementChild;
    sheet.innerHTML = '';
    const row = el('div', { className: 'ud-btnrow' });
    row.append(
      button(t('menu.resume'), () => this._handlers.onResume?.()),
      button(t('menu.lang'), () => this._handlers.onLang?.(), 'ghost'),
      button(t('menu.motion'), () => this._handlers.onMotion?.(), 'ghost'),
      button(t('menu.quality'), () => this._handlers.onQuality?.(), 'ghost'),
      button(t('menu.abandon'), () => this._handlers.onAbandon?.(), 'ghost'),
    );
    sheet.append(this._sheetHead(t('hud.paused')), el('p', {}, t('menu.pausenote')), row, this._legal());
  }

  briefing(data) { this._briefingData = data; this.showScreen('briefing'); }

  _renderBriefing(data) {
    if (!data) return;
    const sheet = this.screens.briefing.firstElementChild;
    sheet.innerHTML = '';
    const rows = el('div', { className: 'ud-rows' });
    for (const line of data.manifest) rows.appendChild(manifestRow(line));
    const row = el('div', { className: 'ud-btnrow' });
    row.append(button(t('menu.accept'), () => this._handlers.onStart?.()));
    sheet.append(
      this._sheetHead(t('hud.shift', { n: data.index })),
      el('h2', {}, t('brief.title')),
      el('p', { className: 'ud-memo' }, t(data.memoKey, { n: data.index })),
      el('h2', {}, t('hud.manifest')),
      rows,
      el('div', { className: 'ud-row total' }, el('span', {}, t('hud.quota')), el('b', {}, String(data.quota))),
      row, this._legal(),
    );
  }

  results(data) { this._resultsData = data; this.showScreen('results'); }

  _renderResults(data) {
    if (!data) return;
    const sheet = this.screens.results.firstElementChild;
    sheet.innerHTML = '';
    const rank = rankFor(data.revenue / Math.max(data.quota, 1));
    const rows = el('div', { className: 'ud-rows' });
    for (const s of data.stats) {
      rows.appendChild(el('div', { className: 'ud-row' },
        el('span', {}, t(s.key, s.params)), el('b', {}, String(s.value))));
    }
    rows.appendChild(el('div', { className: 'ud-row total' },
      el('span', {}, t('results.revenue')), el('b', {}, String(data.revenue))));
    const row = el('div', { className: 'ud-btnrow' });
    row.append(
      button(t('menu.next'), () => this._handlers.onNextShift?.()),
      button(t('menu.meta'), () => this._handlers.onMeta?.(), 'ghost'),
    );
    sheet.append(
      this._sheetHead(t('results.title', { n: data.index })),
      el('h2', {}, t(rank.key)),
      el('p', { className: 'ud-memo' }, t(data.verdictKey, { quota: data.quota, revenue: data.revenue })),
      rows, row, this._legal(),
    );
    const stampHost = el('div', { id: 'ud-results-stamp' });
    sheet.appendChild(stampHost);
    this.stamp(data.met ? 'closed' : 'refused', { host: stampHost, at: { x: 0.5, y: 0.5 }, keep: true });
  }

  meta(data) { this._metaData = data; this.showScreen('meta'); }

  _renderMeta(data) {
    if (!data) return;
    const sheet = this.screens.meta.firstElementChild;
    sheet.innerHTML = '';
    const cols = el('div', { className: 'ud-cols' });
    for (const group of data.groups) {
      const col = el('div', {});
      col.appendChild(el('h2', {}, t(group.key)));
      for (const u of group.items) col.appendChild(this._metaCard(u, data.mp));
      cols.appendChild(col);
    }
    const row = el('div', { className: 'ud-btnrow' });
    row.append(button(t('menu.next'), () => this._handlers.onNextShift?.()));
    sheet.append(
      this._sheetHead(t('meta.title')),
      el('div', { className: 'ud-row total' }, el('span', {}, t('meta.mp')), el('b', {}, String(data.mp))),
      cols, row,
      el('div', { className: 'ud-legal' }, t('meta.legal')),
    );
  }

  _metaCard(u, mp) {
    const card = el('div', { className: `ud-card${u.level >= u.levels ? ' owned' : u.locked ? ' locked' : ''}` });
    card.append(
      el('h3', {}, t(`unlock.${u.id}`)),
      el('div', { className: 'lvl' }, '■'.repeat(u.level) + '□'.repeat(u.levels - u.level)),
      el('div', { className: 'eff' }, t(`unlock.${u.id}.eff`)),
    );
    if (u.level < u.levels) {
      const affordable = !u.locked && mp >= u.cost;
      const b = button(`${t('menu.requisition')} · ${u.cost}`, () => this._handlers.onBuy?.(u.id), 'ghost');
      b.disabled = !affordable;
      if (!affordable) b.style.opacity = '0.45';
      card.appendChild(el('div', { className: 'ud-btnrow', style: 'margin-top:8px' }, b));
    }
    if (u.locked) card.appendChild(el('div', { className: 'eff' }, t('meta.locked', { n: u.from })));
    return card;
  }

  setLang(code) {
    i18n.setLang(code);
    this.setStatus({ lang: code });
  }
}

// ---------- small DOM helpers ----------

function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'style') node.setAttribute('style', v);
    else node[k] = v;
  }
  for (const c of children) node.append(c);
  return node;
}

function button(label, onClick, variant = '') {
  const b = el('button', { className: `ud-btn ${variant}`.trim(), type: 'button' }, label);
  b.addEventListener('click', onClick);
  return b;
}

function manifestRow(line) {
  return el('div', { className: 'ud-row' },
    el('span', {}, `${String(line.no).padStart(2, '0')} · ${t(`pkg.${line.defId}.name`)}${line.golden ? ' ✦' : ''}`),
    el('span', { className: `st ${line.status}` }, t(`status.${line.status}`)),
    el('b', {}, t(line.spotKey)));
}

// Golden cargo wraps the base name and note rather than duplicating eight more
// table entries, so a new package type needs exactly three strings, not six.
function packageName(def) {
  const base = t(`pkg.${def.id}.name`);
  return def.golden ? t('pkg.golden.name', { name: base }) : base;
}
function packageNote(def) {
  const base = t(`pkg.${def.id}.note`);
  return def.golden ? t('pkg.golden.note', { note: base }) : base;
}
function packageWarning(def) {
  return def.golden ? t('pkg.golden.warning') : t(`pkg.${def.id}.warning`);
}

export { packageName, packageNote, packageWarning, LANGS };
