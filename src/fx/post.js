import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

// ONE pipeline: RenderPass -> UnrealBloomPass -> GradePass.
//
// GradePass does tone mapping, the colour grade, the vignette, the damage pulse
// and film grain in a single fullscreen shader, and encodes to sRGB itself —
// which is exactly what OutputPass would otherwise do in a pass of its own.
// `renderer.toneMapping` is therefore NoToneMapping: the mapping happens here,
// after bloom has seen the real HDR values.
//
// No FXAA. It smears the low-poly silhouettes that ARE the look; anti-aliasing
// comes from a multisampled render target instead. Running both, as one of the
// design specs proposed, cancels out — MSAA resolves the edge, FXAA blurs it
// again.

const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    uExposure: { value: 1.0 },
    uSaturation: { value: 1.05 },
    uContrast: { value: 1.02 },
    uSplit: { value: 0.32 },     // warm highlights / cool shadows
    uVignette: { value: 0.5 },
    uGrain: { value: 0.012 },
    uDamage: { value: 0 },       // red edge pulse when cargo takes a hit
    uTime: { value: 0 },
  },
  vertexShader: `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform float uExposure, uSaturation, uContrast, uSplit, uVignette, uGrain, uDamage, uTime;
    varying vec2 vUv;

    // Narkowicz ACES fit: filmic shoulder, and it keeps saturated emissives
    // from clipping to white before the bloom has a chance to read them.
    vec3 aces(vec3 x) {
      return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
    }

    vec3 toSRGB(vec3 c) {
      return mix(pow(c, vec3(0.41666)) * 1.055 - vec3(0.055), c * 12.92,
                 vec3(lessThanEqual(c, vec3(0.0031308))));
    }

    void main() {
      vec3 c = aces(texture2D(tDiffuse, vUv).rgb * uExposure);

      float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
      c = mix(vec3(l), c, uSaturation);
      // Split tone: sunlight warms what it hits, the shade goes blue. This is
      // most of what separates "storybook" from "flat-shaded programmer art".
      c += (vec3(0.055, 0.022, -0.030) * l - vec3(0.020, 0.008, -0.038) * (1.0 - l)) * uSplit;
      c = (c - 0.5) * uContrast + 0.5;

      vec2 d = vUv - 0.5;
      float r2 = dot(d, d);
      // The ONLY vignette in the game. A second one in the DOM used to stack
      // with this and take the screen near-black at low condition on the summit.
      c *= 1.0 - r2 * uVignette;
      c = mix(c, vec3(0.62, 0.05, 0.05), smoothstep(0.10, 0.48, r2) * uDamage);

      float g = fract(sin(dot(vUv + fract(uTime), vec2(12.9898, 78.233))) * 43758.5453) - 0.5;
      c += g * uGrain;

      gl_FragColor = vec4(toSRGB(clamp(c, 0.0, 1.0)), 1.0);
    }`,
};

export class Post {
  constructor(ctx, { samples = 4, bloom = true } = {}) {
    this.ctx = ctx;
    const { renderer, scene, camera } = ctx;

    // The grade owns tone mapping now; leaving the renderer's on would apply
    // the curve twice, once before bloom and once after.
    renderer.toneMapping = THREE.NoToneMapping;

    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    this.target = new THREE.WebGLRenderTarget(size.x, size.y, {
      type: THREE.HalfFloatType,
      samples,
    });
    this.composer = new EffectComposer(renderer, this.target);

    this.composer.addPass(new RenderPass(scene, camera));

    // threshold 1.0 in linear HDR: nothing lit by the sun reaches it (a white
    // surface under intensity 2.3 lands near 0.7 after the Lambert divide), so
    // only genuine emissives bloom — lanterns, crystals, the beacon, gold cargo.
    this.bloomPass = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.55, 0.5, 1.0);
    this.bloomPass.enabled = bloom;
    this.composer.addPass(this.bloomPass);

    this.grade = new ShaderPass(GradeShader);
    this.grade.renderToScreen = true;
    this.composer.addPass(this.grade);

    this._damage = 0;
  }

  setSize(w, h) {
    this.composer.setSize(w, h);
    this.bloomPass.setSize(w, h);
  }

  setSamples(n) {
    if (this.target.samples === n) return;
    this.target.samples = n;
    this.target.dispose(); // forces reallocation with the new sample count
  }

  setBloom(on) { this.bloomPass.enabled = on; }

  // Replaces the DOM vignette flash. A uniform pulse costs nothing; a DOM
  // repaint over a live WebGL composite costs a full-screen layer recomposite.
  damageFlash() { this._damage = 1; }

  render(dt, gameTime) {
    this._damage = Math.max(0, this._damage - dt * 6);
    const u = this.grade.uniforms;
    u.uDamage.value = this._damage;
    u.uTime.value = gameTime;
    // With autoReset on, renderer.info would be wiped by each pass and end the
    // frame reporting the grade quad's single draw call. Reset once per frame
    // so the counter covers the whole chain and stays a usable budget signal.
    const info = this.ctx.renderer.info;
    info.autoReset = false;
    info.reset();
    this.composer.render(dt);
  }
}
