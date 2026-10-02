import { Object3D } from "../core/Object3D.js";

export class Mesh extends Object3D {
  constructor(geometry, material) {
    super();
    this.isMesh = true;
    this.geometry = geometry;
    this.material = material;
  }
}

export class LineSegments extends Object3D {
  constructor(geometry, material) {
    super();
    this.isLineSegments = true;
    this.geometry = geometry;
    this.material = material;
  }
}
