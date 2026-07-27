import * as THREE from 'three';

// One InstancedMesh behind a proxy Object3D per instance.
//
// The proxy matters: physics.track() takes a mesh and writes position AND
// rotation into it every step, and an InstancedMesh has neither per instance.
// Handing it a plain Object3D that the pool reads back from keeps rotation
// intact — which is why crates and gondolas can be instanced at all, contrary
// to what one of the design specs claimed.

export class InstancedPool {
  constructor(scene, geometry, material, capacity, { castShadow = true, receiveShadow = false, dynamic = false } = {}) {
    this.mesh = new THREE.InstancedMesh(geometry, material, capacity);
    this.mesh.count = 0;
    this.mesh.castShadow = castShadow;
    this.mesh.receiveShadow = receiveShadow;
    this.mesh.frustumCulled = !dynamic;
    if (dynamic) this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.dynamic = dynamic;
    this.proxies = [];
    scene.add(this.mesh);
  }

  // Returns a proxy to position/rotate/scale. Call flush() when done.
  obtain() {
    if (this.proxies.length >= this.mesh.instanceMatrix.count) {
      throw new Error(`InstancedPool full (capacity ${this.mesh.instanceMatrix.count})`);
    }
    const p = new THREE.Object3D();
    this.proxies.push(p);
    this.mesh.count = this.proxies.length;
    return p;
  }

  flush() {
    for (let i = 0; i < this.proxies.length; i++) {
      const p = this.proxies[i];
      // World matrix, not local: a proxy may be parented to a transform group
      // (a gondola cabin, say) that moves as a unit. For a parentless proxy
      // this is identical to updateMatrix().
      p.updateWorldMatrix(true, false);
      this.mesh.setMatrixAt(i, p.matrixWorld);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    if (!this.dynamic) this.mesh.computeBoundingSphere();
  }
}
