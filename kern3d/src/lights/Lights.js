import { Object3D } from "../core/Object3D.js";
import { Color } from "../math/Color.js";

export class Light extends Object3D {
  constructor(color = 0xffffff, intensity = 1) {
    super();
    this.isLight = true;
    this.color = new Color(color);
    this.intensity = intensity;
  }
}

export class AmbientLight extends Light {
  constructor(color = 0xffffff, intensity = 1) {
    super(color, intensity);
    this.isAmbientLight = true;
  }
}

export class DirectionalLight extends Light {
  constructor(color = 0xffffff, intensity = 1) {
    super(color, intensity);
    this.isDirectionalLight = true;
    this.target = new Object3D();
  }
}

export class PointLight extends Light {
  constructor(color = 0xffffff, intensity = 1, distance = 0) {
    super(color, intensity);
    this.isPointLight = true;
    this.distance = distance;
  }
}
