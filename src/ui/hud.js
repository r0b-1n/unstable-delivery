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
    this._vignetteT = 0;
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
  }

  setShake(pct) { this.barShake.style.width = `${pct}%`; }
  setScore(n) { this.score.textContent = String(n); }
  setDeliveries(n) { this.deliveries.textContent = `${n} deliver${n === 1 ? 'y' : 'ies'}`; }

  setAlt(y, zoneName) {
    this.alt.textContent = `ALT ${Math.max(0, Math.round(y))} m · ${zoneName}`;
  }

  setTarget(relBearing, dist, name) {
    this.targetArrow.style.transform = `rotate(${relBearing - Math.PI / 2}rad)`;
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
