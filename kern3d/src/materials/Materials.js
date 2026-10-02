import { Color } from "../math/Color.js";

let _mid = 0;

export class Material {
  constructor() {
    this.id = _mid++;
    this.transparent = false;
    this.opacity = 1;
    this.side = 0; // 0 front, 1 back, 2 double
    this.depthTest = true;
    this.depthWrite = true;
    this.wireframe = false;
    this.visible = true;
  }
}

export class MeshBasicMaterial extends Material {
  constructor(params = {}) {
    super();
    this.isMeshBasicMaterial = true;
    this.type = "MeshBasicMaterial";
    this.color = new Color(params.color ?? 0xffffff);
    this.map = params.map ?? null;
    this.fog = params.fog !== false;
    Object.assign(this, pick(params, ["transparent", "opacity", "side", "wireframe", "depthWrite"]));
  }
}

export class MeshPhongMaterial extends Material {
  constructor(params = {}) {
    super();
    this.isMeshPhongMaterial = true;
    this.type = "MeshPhongMaterial";
    this.color = new Color(params.color ?? 0xffffff);
    this.specular = new Color(params.specular ?? 0x111111);
    this.emissive = new Color(params.emissive ?? 0x000000);
    this.shininess = params.shininess ?? 30;
    this.map = params.map ?? null;
    this.fog = params.fog !== false;
    Object.assign(this, pick(params, ["transparent", "opacity", "side", "wireframe", "depthWrite"]));
  }
}

function pick(src, keys) {
  const out = {};
  for (const k of keys) if (src[k] !== undefined) out[k] = src[k];
  return out;
}
