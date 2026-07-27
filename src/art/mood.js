import * as THREE from 'three';
import { bandFloat, bandColor, bandNum } from './palette.js';

// Everything the atmosphere does: sky dome, fog, sun and hemisphere light.
//
// This replaces the hand-tuned RGB formulas that used to live inline in main.js,
// where the sky was lerped between two hardcoded colours by a single `storm`
// scalar. Those numbers had no relationship to the terrain palette, so climbing
// out of the pines into the cliffs changed the ground and left the sky behind.
// Now both read the same five bands and move together.
//
// Two inputs drive it: ALTITUDE (which band you are in) and SHIFT PROGRESS
// (how late in the working day it is — the sun sinks and warms as the shift
// wears on). Altitude owns hue and density; the shift owns the sun's angle.

// The sun rig and the sky dome both follow the courier. The dome has to clear
// the horizon range, which stands at up to 3 km out in world space while the
// dome is centred on a player who can be 800 m off the origin.
const SUN_DIST = 220;
const SKY_R = 4600;

export class Mood {
  constructor(ctx) {
    this.ctx = ctx;
    this.sunDir = new THREE.Vector3(0.45, 0.55, 0.3).normalize();
    this._c = new THREE.Color();

    this.uniforms = {
      topColor: { value: new THREE.Color(0x3e94e0) },
      horizonColor: { value: new THREE.Color(0xf5e7cc) },
      cloudColor: { value: new THREE.Color(0xffffff) },
      sunDir: { value: this.sunDir.clone() },
      flash: { value: 0 },
      uTime: { value: 0 },
      uNight: { value: 0 },   // star field fades in near the summit
      uCloud: { value: 0.75 }, // cloud band opacity, thins out up high
    };

    this.sky = new THREE.Mesh(
      new THREE.SphereGeometry(SKY_R, 32, 16),
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
        uniforms: this.uniforms,
        vertexShader: `
          varying vec3 vDir;
          void main() {
            vDir = normalize(position);
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }`,
        fragmentShader: `
          uniform vec3 topColor, horizonColor, cloudColor, sunDir;
          uniform float flash, uTime, uNight, uCloud;
          varying vec3 vDir;

          float hash21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
          float vnoise(vec2 p) {
            vec2 i = floor(p), f = fract(p);
            f = f * f * (3.0 - 2.0 * f);
            return mix(mix(hash21(i), hash21(i + vec2(1, 0)), f.x),
                       mix(hash21(i + vec2(0, 1)), hash21(i + vec2(1, 1)), f.x), f.y);
          }

          void main() {
            vec3 d = normalize(vDir);
            float h = clamp(d.y, 0.0, 1.0);
            vec3 col = mix(horizonColor, topColor, pow(h, 0.62));

            // Cloud band: a flat layer projected onto the dome, drifting with
            // the wind. Confined to the lower sky so it reads as weather at eye
            // level rather than a texture smeared over the zenith.
            vec2 cuv = d.xz / max(d.y, 0.06) * 0.30 + vec2(uTime * 0.004, uTime * 0.002);
            float c = vnoise(cuv) * 0.58 + vnoise(cuv * 2.4) * 0.28 + vnoise(cuv * 5.1) * 0.14;
            float layer = smoothstep(0.015, 0.11, d.y) * (1.0 - smoothstep(0.28, 0.62, d.y));
            col = mix(col, cloudColor, smoothstep(0.50, 0.80, c) * layer * uCloud);

            // Stars, only once the sky above the summit has gone dark enough
            // to hold them. Cell-hashed so they sit still while the player moves.
            if (uNight > 0.002) {
              vec3 cell = floor(d * 110.0);
              float r = hash21(cell.xy + cell.z * 31.7);
              float twinkle = 0.55 + 0.45 * sin(uTime * 2.7 + r * 60.0);
              col += vec3(step(0.9965, r) * uNight * twinkle * smoothstep(0.03, 0.35, d.y));
            }

            float sun = pow(max(dot(d, sunDir), 0.0), 350.0);
            float halo = pow(max(dot(d, sunDir), 0.0), 12.0);
            col += vec3(1.0, 0.93, 0.75) * sun * 1.4 + vec3(1.0, 0.9, 0.7) * halo * 0.22;
            col = mix(col, vec3(1.0), flash * 0.55);
            gl_FragColor = vec4(col, 1.0);
          }`,
      }),
    );
    this.sky.frustumCulled = false;
    this.sky.renderOrder = -1;
    ctx.scene.add(this.sky);

    ctx.scene.fog = new THREE.Fog(0xf1e2c6, 110, 640);

    this.hemi = new THREE.HemisphereLight(0xa5cde9, 0x6e964a, 1.0);
    ctx.scene.add(this.hemi);

    this.sun = new THREE.DirectionalLight(0xefc680, 2.3);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.camera.near = 10;
    this.sun.shadow.camera.far = 520;
    const S = 75;
    this.sun.shadow.camera.left = -S; this.sun.shadow.camera.right = S;
    this.sun.shadow.camera.top = S; this.sun.shadow.camera.bottom = -S;
    // Paired fix. bias alone at -0.0004 pushed shadows off their casters
    // (peter-panning) on the low-poly flat-shaded slopes; normalBias handles
    // the slanted-surface acne so the depth bias can stay small.
    this.sun.shadow.bias = -0.00018;
    this.sun.shadow.normalBias = 0.022;
    ctx.scene.add(this.sun, this.sun.target);
  }

  // alt01: player height / PEAK. shift01: 0 at clock-in, 1 at the last drop.
  update(playerPos, alt01, flash, gameTime, shift01 = 0.35) {
    const f = bandFloat(alt01);
    const u = this.uniforms;

    bandColor('skyTop', f, u.topColor.value);
    bandColor('skyHorizon', f, u.horizonColor.value);
    u.flash.value = flash;
    u.uTime.value = gameTime;
    // Above the frozen band the cloud layer is below you, not around you.
    u.uCloud.value = 0.8 * (1 - THREE.MathUtils.smoothstep(f, 2.6, 3.8));
    u.uNight.value = THREE.MathUtils.smoothstep(f, 3.2, 4.0);
    u.cloudColor.value.copy(u.horizonColor.value).lerp(WHITE, 0.55);

    // The sun sinks and swings west across the shift; low light is the cheapest
    // way to say "you have been at this a while".
    const elev = 0.95 - 0.5 * shift01;
    const azim = 0.62 + 1.35 * shift01;
    this.sunDir.set(Math.cos(azim) * Math.cos(elev), Math.sin(elev), Math.sin(azim) * Math.cos(elev));
    u.sunDir.value.copy(this.sunDir);

    // Sun rig follows the courier so the 150 m shadow box stays useful
    // everywhere on a 1600 m mountain.
    this.sun.position.set(
      playerPos.x + this.sunDir.x * SUN_DIST,
      playerPos.y + this.sunDir.y * SUN_DIST,
      playerPos.z + this.sunDir.z * SUN_DIST,
    );
    this.sun.target.position.set(playerPos.x, playerPos.y, playerPos.z);
    this.sky.position.set(playerPos.x, 0, playerPos.z);

    bandColor('sun', f, this._c);
    // Late shift: the light goes amber before it goes away.
    this.sun.color.copy(this._c).lerp(EVENING, 0.35 * shift01);
    this.sun.intensity = bandNum('sunI', f) + flash * 2;

    bandColor('hemiSky', f, this.hemi.color);
    bandColor('hemiGround', f, this.hemi.groundColor);
    this.hemi.intensity = bandNum('hemiI', f) + flash * 1.5;

    const fog = this.ctx.scene.fog;
    bandColor('fog', f, fog.color);
    fog.near = bandNum('fogNear', f);
    fog.far = bandNum('fogFar', f);
  }
}

const WHITE = new THREE.Color(0xffffff);
const EVENING = new THREE.Color(0xffb066);
