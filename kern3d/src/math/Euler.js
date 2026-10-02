export class Euler {
  constructor(x = 0, y = 0, z = 0, order = "XYZ") {
    this.x = x;
    this.y = y;
    this.z = z;
    this.order = order;
  }

  set(x, y, z, order) {
    this.x = x;
    this.y = y;
    this.z = z;
    if (order) this.order = order;
    return this;
  }

  copy(e) {
    this.x = e.x;
    this.y = e.y;
    this.z = e.z;
    this.order = e.order;
    return this;
  }
}
