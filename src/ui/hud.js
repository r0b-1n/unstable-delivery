// DOM HUD: no framework, just refs and small mutations.
export class Hud {
  constructor() {
    this.root = document.getElementById('hud');
    this.pkgName = document.getElementById('hud-package-name');
    this.pkgNote = document.getElementById('hud-package-note');
    this.rowCondition = document.getElementById('row-condition');
    this.rowShake = document.getElementById('row-shake');
    this.barCondition = document.querySelector('#bar-condition > div');
    this.barShake = document.querySelector('#bar-shake > div');
    this.score = document.getElementById('hud-score');
    this.deliveries = document.getElementById('hud-deliveries');
    this.alt = document.getElementById('hud-alt');
    this.targetArrow = document.getElementById('hud-target-arrow');
    this.targetDist = document.getElementById('hud-target-dist');
    this.targetLabel = document.getElementById('hud-target-label');
    this.toastHolder = document.getElementById('toast-holder');
    this.slip = document.getElementById('slip');
    this.slipBody = document.getElementById('slip-body');
    this.slipWarning = document.getElementById('slip-warning');
    this.vignette = document.getElementById('vignette-damage');
    this.bannerEl = document.getElementById('hud-banner');
    this.timerEl = document.getElementById('hud-timer');
    this.chainEl = document.getElementById('hud-chain');
    this.popHolder = document.getElementById('pop-holder');
    this._vignetteT = 0;
    this._scoreShown = 0;
  }

  banner(text) {
    if (!text) { this.bannerEl.style.display = 'none'; return; }
    this.bannerEl.textContent = text;
    this.bannerEl.style.display = 'block';
  }

  setTimer(secLeft) {
    if (secLeft === null) { this.timerEl.textContent = ''; return; }
    if (secLeft > 0) {
      this.timerEl.textContent = `⚡ bonus ${Math.ceil(secLeft)}s`;
      this.timerEl.className = '';
    } else {
      this.timerEl.textContent = 'bonus expired';
      this.timerEl.className = 'expired';
    }
  }

  show() { this.root.style.display = 'block'; }

  setPackage(name, note, hasShake = false) {
    if (!name) {
      this.pkgName.textContent = 'No package';
      this.pkgNote.textContent = 'Grab the next one at the depot chute!';
      this.rowCondition.style.display = 'none';
      this.rowShake.style.display = 'none';
      return;
    }
    this.pkgName.textContent = name;
    this.pkgNote.textContent = note;
    this.rowCondition.style.display = 'block';
    this.rowShake.style.display = hasShake ? 'block' : 'none';
  }

  setCondition(pct) {
    this.barCondition.style.width = `${pct}%`;
    this.barCondition.style.background = pct > 55
      ? 'linear-gradient(90deg, #45d17a, #a8e063)'
      : pct > 25
        ? 'linear-gradient(90deg, #ffb347, #ffd166)'
        : 'linear-gradient(90deg, #ff4d6d, #ff8080)';
    this.barCondition.parentElement.classList.toggle('crit', pct <= 25 && pct > 0);
  }

  setShake(pct) { this.barShake.style.width = `${pct}%`; }

  // Score counts up instead of teleporting — small numbers feel earned too.
  setScore(n) {
    cancelAnimationFrame(this._scoreRaf);
    const from = this._scoreShown;
    const t0 = performance.now();
    const dur = 500;
    const tick = (now) => {
      const k = Math.min((now - t0) / dur, 1);
      this._scoreShown = Math.round(from + (n - from) * (1 - Math.pow(1 - k, 3)));
      this.score.textContent = String(this._scoreShown);
      if (k < 1) this._scoreRaf = requestAnimationFrame(tick);
    };
    this._scoreRaf = requestAnimationFrame(tick);
  }

  setDeliveries(n) { this.deliveries.textContent = `${n} deliver${n === 1 ? 'y' : 'ies'}`; }

  setChain(chain) {
    const mult = 1 + 0.5 * Math.min(chain, 4);
    if (chain < 2) { this.chainEl.style.display = 'none'; return; }
    this.chainEl.style.display = 'block';
    this.chainEl.textContent = `🔥 ×${mult.toFixed(1)} ON A ROLL`;
    this.chainEl.classList.remove('pop');
    void this.chainEl.offsetWidth; // restart the pop animation
    this.chainEl.classList.add('pop');
  }

  // Itemized floating score receipt (delivery breakdown, bonuses).
  scorePop(lines) {
    const el = document.createElement('div');
    el.className = 'score-pop';
    for (const line of lines) {
      const row = document.createElement('div');
      row.textContent = line;
      el.appendChild(row);
    }
    this.popHolder.appendChild(el);
    setTimeout(() => el.remove(), 2600);
    while (this.popHolder.children.length > 3) this.popHolder.firstChild.remove();
  }

  setAlt(y, zoneName) {
    this.alt.textContent = `ALT ${Math.max(0, Math.round(y))} m · ${zoneName}`;
  }

  setTarget(relBearing, dist, name) {
    // World bearings are counter-clockwise, CSS rotation is clockwise —
    // negate or the arrow mirrors left/right.
    this.targetArrow.style.transform = `rotate(${-relBearing - Math.PI / 2}rad)`;
    this.targetDist.textContent = dist > 999 ? `${(dist / 1000).toFixed(1)} km` : `${Math.round(dist)} m`;
    this.targetLabel.textContent = `DELIVER TO · ${name.toUpperCase()}`;
  }

  toast(text, small = false) {
    const el = document.createElement('div');
    el.className = small ? 'toast small' : 'toast';
    el.textContent = text;
    this.toastHolder.appendChild(el);
    setTimeout(() => el.remove(), 3300);
    while (this.toastHolder.children.length > 3) this.toastHolder.firstChild.remove();
  }

  showSlip(num, def, targetName) {
    this.slip.dataset.num = String(num).padStart(3, '0');
    this.slipBody.innerHTML = `<b>${def.name}</b><br/>${def.note}<br/>→ Deliver to: <b>${targetName}</b>`;
    this.slipWarning.textContent = `⚠ ${def.warning}`;
    this.slip.style.display = 'block';
    clearTimeout(this._slipTimer);
    this._slipTimer = setTimeout(() => this.hideSlip(), 9000);
  }

  hideSlip() { this.slip.style.display = 'none'; }

  damageFlash() {
    this.vignette.style.opacity = '1';
    clearTimeout(this._vt);
    this._vt = setTimeout(() => { this.vignette.style.opacity = '0'; }, 130);
  }
}
