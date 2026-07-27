import * as THREE from 'three';

// onBeforeCompile injections. These patch three's built-in MeshStandardMaterial
// rather than replacing it, so shadows, fog and the light rig keep working.
//
// ONE entry point on purpose. onBeforeCompile is a single assignable slot, not
// a listener list — two helpers each setting it would leave only the second,
// and the loss is silent (no error, the effect just never appears). Everything
// that needs injecting goes through this call.

export function patchMaterial(material, { rim = null, emissiveFloor = 0 } = {}) {
  const uniforms = {};
  if (rim) {
    uniforms.uRimColor = { value: new THREE.Color(rim.color ?? 0xffe9c9) };
    uniforms.uRimPower = { value: rim.power ?? 2.6 };
    uniforms.uRimStrength = { value: rim.strength ?? 0.55 };
  }
  if (emissiveFloor > 0) uniforms.uEmFloor = { value: emissiveFloor };

  material.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms);
    let head = '#include <common>';
    let body = '#include <dithering_fragment>';
    if (rim) {
      head += '\nuniform vec3 uRimColor;\nuniform float uRimPower, uRimStrength;';
      // Fresnel against the view vector. The courier and the hazards are both
      // mid-grey figures against a mid-grey mountain from the cliffs upward;
      // a rim is the only thing that keeps a silhouette readable up there
      // without lighting the whole scene brighter.
      //
      // `normal`, not `vNormal`: with flatShading three derives the normal per
      // fragment and never declares the varying, so vNormal is a compile error
      // on exactly the materials this game is built from. The local `normal`
      // from normal_fragment_begin is in scope here and correct either way.
      body += `
        float rimF = 1.0 - clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0);
        gl_FragColor.rgb += uRimColor * pow(rimF, uRimPower) * uRimStrength;`;
    }
    if (emissiveFloor > 0) {
      head += '\nuniform float uEmFloor;';
      // A hazard silhouetted against bright snow must never read as a hole in
      // the world — the player has to see it is a rock, at speed, from behind.
      body += '\n        gl_FragColor.rgb = max(gl_FragColor.rgb, diffuseColor.rgb * uEmFloor);';
    }
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', head)
      .replace('#include <dithering_fragment>', body);
  };
  material.needsUpdate = true;
  return uniforms;
}
