import { BufferAttribute, BufferGeometry } from "../geometries/Geometries.js";
import { MeshBasicMaterial } from "../materials/Materials.js";
import { LineSegments } from "../objects/Mesh.js";

export class GridHelper extends LineSegments {
  constructor(size = 10, divisions = 10, color1 = 0x444444, color2 = 0x222222) {
    const geometry = new BufferGeometry();
    const step = size / divisions;
    const half = size / 2;
    const vertices = [];
    const colors = [];
    const c1 = hexToRgb(color1);
    const c2 = hexToRgb(color2);
    for (let i = 0; i <= divisions; i++) {
      const p = -half + i * step;
      const c = i === divisions / 2 ? c1 : c2;
      vertices.push(-half, 0, p, half, 0, p);
      vertices.push(p, 0, -half, p, 0, half);
      colors.push(...c, ...c, ...c, ...c);
    }
    geometry.setAttribute("position", new BufferAttribute(new Float32Array(vertices), 3));
    super(geometry, new MeshBasicMaterial({ color: color1 }));
    this.material.color.setRGB(c1[0], c1[1], c1[2]);
  }
}

function hexToRgb(hex) {
  return [((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255];
}
