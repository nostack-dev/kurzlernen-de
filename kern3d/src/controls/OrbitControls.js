import { Vector3 } from "../math/Vector3.js";

const STATE = { NONE: -1, ROTATE: 0, DOLLY: 1, PAN: 2 };

export class OrbitControls {
  constructor(camera, domElement) {
    this.camera = camera;
    this.domElement = domElement;
    this.target = new Vector3();
    this.enableDamping = true;
    this.dampingFactor = 0.08;
    this.minDistance = 0.5;
    this.maxDistance = 200;
    this.minPolar = 0.05;
    this.maxPolar = Math.PI - 0.05;
    this.enabled = true;

    this._spherical = { radius: 1, phi: 1, theta: 0 };
    this._sphericalDelta = { radius: 1, phi: 0, theta: 0 };
    this._pan = new Vector3();
    this._state = STATE.NONE;
    this._pointer = { x: 0, y: 0 };
    this._scale = 1;

    this._offset = new Vector3();
    this._onPointerDown = (e) => this._pointerDown(e);
    this._onPointerMove = (e) => this._pointerMove(e);
    this._onPointerUp = () => { this._state = STATE.NONE; };
    this._onWheel = (e) => this._wheel(e);
    this._onContext = (e) => e.preventDefault();

    domElement.addEventListener("pointerdown", this._onPointerDown);
    domElement.addEventListener("pointermove", this._onPointerMove);
    domElement.addEventListener("pointerup", this._onPointerUp);
    domElement.addEventListener("pointerleave", this._onPointerUp);
    domElement.addEventListener("wheel", this._onWheel, { passive: false });
    domElement.addEventListener("contextmenu", this._onContext);
    this.update();
  }

  update() {
    const offset = this._offset.copy(this.camera.position).sub(this.target);
    const spherical = this._spherical;
    spherical.radius = offset.length();
    spherical.theta = Math.atan2(offset.x, offset.z);
    spherical.phi = Math.acos(Math.min(1, Math.max(-1, offset.y / (spherical.radius || 1))));

    if (this.enableDamping) {
      spherical.theta += this._sphericalDelta.theta * this.dampingFactor;
      spherical.phi += this._sphericalDelta.phi * this.dampingFactor;
      this._sphericalDelta.theta *= 1 - this.dampingFactor;
      this._sphericalDelta.phi *= 1 - this.dampingFactor;
      this.target.addScaledVector(this._pan, this.dampingFactor);
      this._pan.multiplyScalar(1 - this.dampingFactor);
    } else {
      spherical.theta += this._sphericalDelta.theta;
      spherical.phi += this._sphericalDelta.phi;
      this._sphericalDelta.theta = 0;
      this._sphericalDelta.phi = 0;
      this.target.add(this._pan);
      this._pan.set(0, 0, 0);
    }
    spherical.radius = Math.max(this.minDistance, Math.min(this.maxDistance, spherical.radius * this._scale));
    this._scale = 1;
    spherical.phi = Math.max(this.minPolar, Math.min(this.maxPolar, spherical.phi));

    const sinPhi = Math.sin(spherical.phi);
    offset.set(
      spherical.radius * sinPhi * Math.sin(spherical.theta),
      spherical.radius * Math.cos(spherical.phi),
      spherical.radius * sinPhi * Math.cos(spherical.theta),
    );
    this.camera.position.copy(this.target).add(offset);
    this.camera.lookAt(this.target);
    return this;
  }

  dispose() {
    const el = this.domElement;
    el.removeEventListener("pointerdown", this._onPointerDown);
    el.removeEventListener("pointermove", this._onPointerMove);
    el.removeEventListener("pointerup", this._onPointerUp);
    el.removeEventListener("pointerleave", this._onPointerUp);
    el.removeEventListener("wheel", this._onWheel);
    el.removeEventListener("contextmenu", this._onContext);
  }

  _pointerDown(e) {
    if (!this.enabled) return;
    this.domElement.setPointerCapture?.(e.pointerId);
    this._pointer.x = e.clientX;
    this._pointer.y = e.clientY;
    this._state = e.button === 2 || e.shiftKey ? STATE.PAN : e.button === 1 ? STATE.DOLLY : STATE.ROTATE;
  }

  _pointerMove(e) {
    if (!this.enabled || this._state === STATE.NONE) return;
    const dx = e.clientX - this._pointer.x;
    const dy = e.clientY - this._pointer.y;
    this._pointer.x = e.clientX;
    this._pointer.y = e.clientY;
    if (this._state === STATE.ROTATE) {
      const h = this.domElement.clientHeight || 1;
      this._sphericalDelta.theta -= (2 * Math.PI * dx) / h;
      this._sphericalDelta.phi -= (2 * Math.PI * dy) / h;
    } else if (this._state === STATE.PAN) {
      this._panOffset(dx, dy);
    }
  }

  _panOffset(dx, dy) {
    const el = this.domElement;
    const targetDistance = this._offset.copy(this.camera.position).sub(this.target).length();
    const fov = (this.camera.fov || 50) * Math.PI / 180;
    const height = 2 * Math.tan(fov / 2) * targetDistance;
    const factor = height / (el.clientHeight || 1);
    const x = -dx * factor;
    const y = dy * factor;
    const te = this.camera.matrix.elements;
    this._pan.x += te[0] * x + te[4] * y;
    this._pan.y += te[1] * x + te[5] * y;
    this._pan.z += te[2] * x + te[6] * y;
  }

  _wheel(e) {
    if (!this.enabled) return;
    e.preventDefault();
    this._scale *= e.deltaY > 0 ? 1.08 : 0.92;
  }
}
