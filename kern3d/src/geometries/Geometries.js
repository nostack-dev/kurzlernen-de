let _gid = 0;

export class BufferGeometry {
  constructor() {
    this.id = _gid++;
    this.attributes = {};
    this.index = null;
    this.groups = [];
    this.boundingSphere = null;
    this._gl = null;
    this.version = 0;
  }

  setAttribute(name, attribute) {
    this.attributes[name] = attribute;
    this.version++;
    return this;
  }

  setIndex(array) {
    this.index = array instanceof BufferAttribute ? array : new BufferAttribute(array, 1);
    this.version++;
    return this;
  }

  dispose() {
    this.version++;
    this._disposed = true;
  }

  computeVertexNormals() {
    const pos = this.attributes.position;
    if (!pos) return;
    const normals = new Float32Array(pos.array.length);
    const index = this.index ? this.index.array : null;
    const count = index ? index.length : pos.count;
    const p = pos.array;
    const ax = 0, ay = 1, az = 2;
    for (let i = 0; i < count; i += 3) {
      const ia = (index ? index[i] : i) * 3;
      const ib = (index ? index[i + 1] : i + 1) * 3;
      const ic = (index ? index[i + 2] : i + 2) * 3;
      const abx = p[ib] - p[ia], aby = p[ib + 1] - p[ia + 1], abz = p[ib + 2] - p[ia + 2];
      const acx = p[ic] - p[ia], acy = p[ic + 1] - p[ia + 1], acz = p[ic + 2] - p[ia + 2];
      const nx = aby * acz - abz * acy;
      const ny = abz * acx - abx * acz;
      const nz = abx * acy - aby * acx;
      normals[ia] += nx; normals[ia + 1] += ny; normals[ia + 2] += nz;
      normals[ib] += nx; normals[ib + 1] += ny; normals[ib + 2] += nz;
      normals[ic] += nx; normals[ic + 1] += ny; normals[ic + 2] += nz;
      void ax; void ay; void az;
    }
    for (let i = 0; i < normals.length; i += 3) {
      const x = normals[i], y = normals[i + 1], z = normals[i + 2];
      const len = Math.hypot(x, y, z) || 1;
      normals[i] = x / len;
      normals[i + 1] = y / len;
      normals[i + 2] = z / len;
    }
    this.setAttribute("normal", new BufferAttribute(normals, 3));
  }
}

export class BufferAttribute {
  constructor(array, itemSize) {
    this.array = array;
    this.itemSize = itemSize;
    this.count = array.length / itemSize;
    this.needsUpdate = true;
  }
}

export class BoxGeometry extends BufferGeometry {
  constructor(width = 1, height = 1, depth = 1) {
    super();
    const w = width / 2, h = height / 2, d = depth / 2;
    const positions = [];
    const normals = [];
    const uvs = [];
    const faces = [
      [0, 0, 1,  -1, -1, 1,  1, 0, 0],
      [0, 0, -1, -1, -1, -1, -1, 0, 0],
      [0, 1, 0,  -1, 1, -1,  0, 1, 0],
      [0, -1, 0, -1, -1, 1,  0, -1, 0],
      [1, 0, 0,  1, -1, 1,   1, 0, 0],
      [-1, 0, 0, -1, -1, -1, -1, 0, 0],
    ];
    // Each face: normal + a corner, then build a quad
    const corners = [
      // +Z
      [[-w, -h, d], [w, -h, d], [w, h, d], [-w, h, d], [0, 0, 1]],
      // -Z
      [[w, -h, -d], [-w, -h, -d], [-w, h, -d], [w, h, -d], [0, 0, -1]],
      // +Y
      [[-w, h, d], [w, h, d], [w, h, -d], [-w, h, -d], [0, 1, 0]],
      // -Y
      [[-w, -h, -d], [w, -h, -d], [w, -h, d], [-w, -h, d], [0, -1, 0]],
      // +X
      [[w, -h, d], [w, -h, -d], [w, h, -d], [w, h, d], [1, 0, 0]],
      // -X
      [[-w, -h, -d], [-w, -h, d], [-w, h, d], [-w, h, -d], [-1, 0, 0]],
    ];
    void faces;
    const indices = [];
    let offset = 0;
    for (const face of corners) {
      const n = face[4];
      const uv = [[0, 0], [1, 0], [1, 1], [0, 1]];
      for (let i = 0; i < 4; i++) {
        positions.push(face[i][0], face[i][1], face[i][2]);
        normals.push(n[0], n[1], n[2]);
        uvs.push(uv[i][0], uv[i][1]);
      }
      indices.push(offset, offset + 1, offset + 2, offset, offset + 2, offset + 3);
      offset += 4;
    }
    this.setAttribute("position", new BufferAttribute(new Float32Array(positions), 3));
    this.setAttribute("normal", new BufferAttribute(new Float32Array(normals), 3));
    this.setAttribute("uv", new BufferAttribute(new Float32Array(uvs), 2));
    this.setIndex(new Uint16Array(indices));
  }
}

export class PlaneGeometry extends BufferGeometry {
  constructor(width = 1, height = 1, widthSegments = 1, heightSegments = 1) {
    super();
    const ws = Math.max(1, widthSegments);
    const hs = Math.max(1, heightSegments);
    const positions = [];
    const normals = [];
    const uvs = [];
    const indices = [];
    for (let y = 0; y <= hs; y++) {
      for (let x = 0; x <= ws; x++) {
        const u = x / ws;
        const v = y / hs;
        positions.push(width * (u - 0.5), height * (v - 0.5), 0);
        normals.push(0, 0, 1);
        uvs.push(u, v);
      }
    }
    const row = ws + 1;
    for (let y = 0; y < hs; y++) {
      for (let x = 0; x < ws; x++) {
        const a = y * row + x;
        const b = a + 1;
        const c = a + row;
        const d = c + 1;
        indices.push(a, b, d, a, d, c);
      }
    }
    const IndexArray = positions.length / 3 > 65535 ? Uint32Array : Uint16Array;
    this.setAttribute("position", new BufferAttribute(new Float32Array(positions), 3));
    this.setAttribute("normal", new BufferAttribute(new Float32Array(normals), 3));
    this.setAttribute("uv", new BufferAttribute(new Float32Array(uvs), 2));
    this.setIndex(new IndexArray(indices));
  }
}

export class SphereGeometry extends BufferGeometry {
  constructor(radius = 1, widthSegments = 32, heightSegments = 16) {
    super();
    const ws = Math.max(3, widthSegments);
    const hs = Math.max(2, heightSegments);
    const positions = [];
    const normals = [];
    const uvs = [];
    const indices = [];
    for (let y = 0; y <= hs; y++) {
      const v = y / hs;
      const phi = v * Math.PI;
      for (let x = 0; x <= ws; x++) {
        const u = x / ws;
        const theta = u * Math.PI * 2;
        const nx = Math.sin(phi) * Math.cos(theta);
        const ny = Math.cos(phi);
        const nz = Math.sin(phi) * Math.sin(theta);
        normals.push(nx, ny, nz);
        positions.push(nx * radius, ny * radius, nz * radius);
        uvs.push(u, 1 - v);
      }
    }
    const row = ws + 1;
    for (let y = 0; y < hs; y++) {
      for (let x = 0; x < ws; x++) {
        const a = y * row + x;
        const b = a + 1;
        const c = a + row;
        const d = c + 1;
        if (y !== 0) indices.push(a, c, b);
        if (y !== hs - 1) indices.push(b, c, d);
      }
    }
    const IndexArray = positions.length / 3 > 65535 ? Uint32Array : Uint16Array;
    this.setAttribute("position", new BufferAttribute(new Float32Array(positions), 3));
    this.setAttribute("normal", new BufferAttribute(new Float32Array(normals), 3));
    this.setAttribute("uv", new BufferAttribute(new Float32Array(uvs), 2));
    this.setIndex(new IndexArray(indices));
  }
}

export class TorusGeometry extends BufferGeometry {
  constructor(radius = 1, tube = 0.4, radialSegments = 16, tubularSegments = 48) {
    super();
    const rs = Math.max(3, radialSegments);
    const ts = Math.max(3, tubularSegments);
    const positions = [];
    const normals = [];
    const uvs = [];
    const indices = [];
    for (let j = 0; j <= rs; j++) {
      for (let i = 0; i <= ts; i++) {
        const u = i / ts * Math.PI * 2;
        const v = j / rs * Math.PI * 2;
        const cx = (radius + tube * Math.cos(v)) * Math.cos(u);
        const cy = tube * Math.sin(v);
        const cz = (radius + tube * Math.cos(v)) * Math.sin(u);
        const nx = Math.cos(v) * Math.cos(u);
        const ny = Math.sin(v);
        const nz = Math.cos(v) * Math.sin(u);
        positions.push(cx, cy, cz);
        normals.push(nx, ny, nz);
        uvs.push(i / ts, j / rs);
      }
    }
    const row = ts + 1;
    for (let j = 0; j < rs; j++) {
      for (let i = 0; i < ts; i++) {
        const a = j * row + i;
        const b = a + 1;
        const c = a + row;
        const d = c + 1;
        indices.push(a, c, b, b, c, d);
      }
    }
    const IndexArray = positions.length / 3 > 65535 ? Uint32Array : Uint16Array;
    this.setAttribute("position", new BufferAttribute(new Float32Array(positions), 3));
    this.setAttribute("normal", new BufferAttribute(new Float32Array(normals), 3));
    this.setAttribute("uv", new BufferAttribute(new Float32Array(uvs), 2));
    this.setIndex(new IndexArray(indices));
  }
}
