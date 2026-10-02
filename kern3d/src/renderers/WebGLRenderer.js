import { Matrix4 } from "../math/Matrix4.js";
import { Vector3 } from "../math/Vector3.js";
import { Color } from "../math/Color.js";
import { FRAG, LINE_FRAG, LINE_VERT, VERT } from "./shaders.js";

const MAX_DIR = 4;
const MAX_POINT = 8;

export class WebGLRenderer {
  constructor(params = {}) {
    const canvas = params.canvas || document.createElement("canvas");
    this.domElement = canvas;
    const gl = canvas.getContext("webgl2", {
      antialias: params.antialias !== false,
      alpha: params.alpha === true,
      depth: true,
      stencil: false,
      premultipliedAlpha: false,
      powerPreference: "high-performance",
    });
    if (!gl) throw new Error("WebGL2 is not available");
    this.gl = gl;
    this.autoClear = true;
    this._clear = new Color(params.clearColor ?? 0x111111);
    this._pixelRatio = 1;
    this._width = canvas.width || 300;
    this._height = canvas.height || 150;
    this._programs = new Map();
    this._textures = new WeakMap();
    this._modelView = new Matrix4();
    this._normal = new Float32Array(9);
    this._camPos = new Vector3();
    this._dir = new Vector3();
    this._lightPos = new Vector3();
    this._targetPos = new Vector3();
    this._tmpColor = new Color();

    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);
    this._meshProgram = this._compile(VERT, FRAG);
    this._lineProgram = this._compile(LINE_VERT, LINE_FRAG);
    this.setSize(this._width, this._height, false);
  }

  setClearColor(color, alpha = 1) {
    if (typeof color === "number") this._clear.setHex(color);
    else this._clear.copy(color);
    this._clearAlpha = alpha;
  }

  setPixelRatio(ratio) {
    this._pixelRatio = ratio;
  }

  setSize(width, height, updateStyle = true) {
    this._width = width;
    this._height = height;
    const canvas = this.domElement;
    canvas.width = Math.floor(width * this._pixelRatio);
    canvas.height = Math.floor(height * this._pixelRatio);
    if (updateStyle) {
      canvas.style.width = width + "px";
      canvas.style.height = height + "px";
    }
    this.gl.viewport(0, 0, canvas.width, canvas.height);
  }

  getSize() {
    return { width: this._width, height: this._height };
  }

  render(scene, camera) {
    const gl = this.gl;
    scene.updateMatrixWorld(true);
    camera.updateMatrixWorld(true);

    if (this.autoClear) {
      const c = scene.background || this._clear;
      gl.clearColor(c.r, c.g, c.b, 1);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    }

    const lights = { ambient: [0, 0, 0], dir: [], point: [] };
    const meshes = [];
    const lines = [];
    scene.traverse((obj) => {
      if (!obj.visible) return;
      if (obj.isAmbientLight) {
        lights.ambient[0] += obj.color.r * obj.intensity;
        lights.ambient[1] += obj.color.g * obj.intensity;
        lights.ambient[2] += obj.color.b * obj.intensity;
      } else if (obj.isDirectionalLight && lights.dir.length < MAX_DIR) {
        lights.dir.push(obj);
      } else if (obj.isPointLight && lights.point.length < MAX_POINT) {
        lights.point.push(obj);
      } else if (obj.isMesh && obj.material && obj.material.visible !== false) {
        meshes.push(obj);
      } else if (obj.isLineSegments && obj.material) {
        lines.push(obj);
      }
    });

    this._camPos.setFromMatrixPosition(camera.matrixWorld);
    this._drawMeshes(meshes, camera, scene, lights);
    this._drawLines(lines, camera);
  }

  _drawMeshes(meshes, camera, scene, lights) {
    const gl = this.gl;
    const prog = this._meshProgram;
    gl.useProgram(prog.program);
    gl.uniformMatrix4fv(prog.u.viewMatrix, false, camera.matrixWorldInverse.elements);
    gl.uniformMatrix4fv(prog.u.projectionMatrix, false, camera.projectionMatrix.elements);
    gl.uniform3f(prog.u.cameraPosition, this._camPos.x, this._camPos.y, this._camPos.z);
    gl.uniform3fv(prog.u.ambient, lights.ambient);

    const dirDir = new Float32Array(MAX_DIR * 3);
    const dirCol = new Float32Array(MAX_DIR * 3);
    for (let i = 0; i < lights.dir.length; i++) {
      const light = lights.dir[i];
      this._lightPos.setFromMatrixPosition(light.matrixWorld);
      this._targetPos.setFromMatrixPosition(light.target.matrixWorld);
      this._dir.subVectors(this._targetPos, this._lightPos).normalize();
      dirDir[i * 3] = this._dir.x;
      dirDir[i * 3 + 1] = this._dir.y;
      dirDir[i * 3 + 2] = this._dir.z;
      dirCol[i * 3] = light.color.r * light.intensity;
      dirCol[i * 3 + 1] = light.color.g * light.intensity;
      dirCol[i * 3 + 2] = light.color.b * light.intensity;
    }
    gl.uniform1i(prog.u.numDir, lights.dir.length);
    gl.uniform3fv(prog.u.dirDirections, dirDir);
    gl.uniform3fv(prog.u.dirColors, dirCol);

    const pPos = new Float32Array(MAX_POINT * 3);
    const pCol = new Float32Array(MAX_POINT * 3);
    const pDist = new Float32Array(MAX_POINT);
    for (let i = 0; i < lights.point.length; i++) {
      const light = lights.point[i];
      this._lightPos.setFromMatrixPosition(light.matrixWorld);
      pPos[i * 3] = this._lightPos.x;
      pPos[i * 3 + 1] = this._lightPos.y;
      pPos[i * 3 + 2] = this._lightPos.z;
      pCol[i * 3] = light.color.r * light.intensity;
      pCol[i * 3 + 1] = light.color.g * light.intensity;
      pCol[i * 3 + 2] = light.color.b * light.intensity;
      pDist[i] = light.distance || 0;
    }
    gl.uniform1i(prog.u.numPoint, lights.point.length);
    gl.uniform3fv(prog.u.pointPositions, pPos);
    gl.uniform3fv(prog.u.pointColors, pCol);
    gl.uniform1fv(prog.u.pointDistances, pDist);

    const fog = scene.fog;
    gl.uniform1i(prog.u.useFog, fog ? 1 : 0);
    if (fog) {
      gl.uniform3f(prog.u.fogColor, fog.color.r, fog.color.g, fog.color.b);
      gl.uniform1f(prog.u.fogNear, fog.near);
      gl.uniform1f(prog.u.fogFar, fog.far);
    }

    for (let i = 0; i < meshes.length; i++) {
      const mesh = meshes[i];
      const mat = mesh.material;
      const geo = this._bindGeometry(mesh.geometry, prog);
      if (!geo) continue;

      gl.uniformMatrix4fv(prog.u.modelMatrix, false, mesh.matrixWorld.elements);
      this._modelView.multiplyMatrices(camera.matrixWorldInverse, mesh.matrixWorld);
      this._modelView.getNormalMatrix(this._normal);
      gl.uniformMatrix3fv(prog.u.normalMatrix, false, this._normal);

      const shaded = mat.isMeshPhongMaterial ? 1 : 0;
      gl.uniform1i(prog.u.shaded, shaded);
      gl.uniform3f(prog.u.diffuseColor, mat.color.r, mat.color.g, mat.color.b);
      if (shaded) {
        gl.uniform3f(prog.u.specularColor, mat.specular.r, mat.specular.g, mat.specular.b);
        gl.uniform3f(prog.u.emissiveColor, mat.emissive.r, mat.emissive.g, mat.emissive.b);
        gl.uniform1f(prog.u.shininess, Math.max(1, mat.shininess));
      } else {
        gl.uniform3f(prog.u.specularColor, 0, 0, 0);
        gl.uniform3f(prog.u.emissiveColor, 0, 0, 0);
        gl.uniform1f(prog.u.shininess, 1);
      }
      gl.uniform1f(prog.u.opacity, mat.opacity ?? 1);

      if (mat.map && mat.map.image) {
        const tex = this._getTexture(mat.map);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.uniform1i(prog.u.map, 0);
        gl.uniform1i(prog.u.useMap, 1);
      } else {
        gl.uniform1i(prog.u.useMap, 0);
      }

      if (mat.side === 2) gl.disable(gl.CULL_FACE);
      else {
        gl.enable(gl.CULL_FACE);
        gl.cullFace(mat.side === 1 ? gl.FRONT : gl.BACK);
      }
      gl.depthMask(mat.depthWrite !== false);
      if (mat.transparent) {
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      } else {
        gl.disable(gl.BLEND);
      }

      const mode = mat.wireframe ? gl.LINE_STRIP : gl.TRIANGLES;
      if (geo.index) gl.drawElements(mode, geo.count, geo.indexType, 0);
      else gl.drawArrays(mode, 0, geo.count);
    }
  }

  _drawLines(lines, camera) {
    if (!lines.length) return;
    const gl = this.gl;
    const prog = this._lineProgram;
    gl.useProgram(prog.program);
    gl.uniformMatrix4fv(prog.u.viewMatrix, false, camera.matrixWorldInverse.elements);
    gl.uniformMatrix4fv(prog.u.projectionMatrix, false, camera.projectionMatrix.elements);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    for (const line of lines) {
      const geo = this._bindGeometry(line.geometry, prog, true);
      if (!geo) continue;
      gl.uniformMatrix4fv(prog.u.modelMatrix, false, line.matrixWorld.elements);
      const c = line.material.color;
      gl.uniform3f(prog.u.diffuseColor, c.r, c.g, c.b);
      gl.uniform1f(prog.u.opacity, line.material.opacity ?? 1);
      gl.drawArrays(gl.LINES, 0, geo.count);
    }
    gl.disable(gl.BLEND);
  }

  _bindGeometry(geometry, prog, lines = false) {
    const gl = this.gl;
    if (!geometry._gl || geometry._gl.version !== geometry.version) {
      if (geometry._gl) this._deleteGeometry(geometry);
      geometry._gl = this._uploadGeometry(geometry);
    }
    const cache = geometry._gl;
    gl.bindVertexArray(cache.vao);
    return { index: !!geometry.index, indexType: cache.indexType, count: cache.count };
  }

  _uploadGeometry(geometry) {
    const gl = this.gl;
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const buffers = [];
    const bind = (name, loc) => {
      const attr = geometry.attributes[name];
      if (!attr || loc < 0) return;
      const buf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, attr.array, gl.STATIC_DRAW);
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, attr.itemSize, gl.FLOAT, false, 0, 0);
      buffers.push(buf);
    };
    bind("position", 0);
    bind("normal", 1);
    bind("uv", 2);
    let indexType = gl.UNSIGNED_SHORT;
    let count = geometry.attributes.position ? geometry.attributes.position.count : 0;
    if (geometry.index) {
      const ib = gl.createBuffer();
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, geometry.index.array, gl.STATIC_DRAW);
      buffers.push(ib);
      indexType = geometry.index.array instanceof Uint32Array ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT;
      count = geometry.index.count;
    }
    gl.bindVertexArray(null);
    return { vao, buffers, indexType, count, version: geometry.version };
  }

  _deleteGeometry(geometry) {
    const gl = this.gl;
    const cache = geometry._gl;
    if (!cache) return;
    for (const b of cache.buffers) gl.deleteBuffer(b);
    gl.deleteVertexArray(cache.vao);
    geometry._gl = null;
  }

  _getTexture(map) {
    const gl = this.gl;
    let tex = this._textures.get(map);
    if (tex) return tex;
    tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 1);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, map.image);
    gl.generateMipmap(gl.TEXTURE_2D);
    this._textures.set(map, tex);
    return tex;
  }

  _compile(vsSrc, fsSrc) {
    const gl = this.gl;
    const vs = this._shader(gl.VERTEX_SHADER, vsSrc);
    const fs = this._shader(gl.FRAGMENT_SHADER, fsSrc);
    const program = gl.createProgram();
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.bindAttribLocation(program, 0, "position");
    gl.bindAttribLocation(program, 1, "normal");
    gl.bindAttribLocation(program, 2, "uv");
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(gl.getProgramInfoLog(program) || "shader link failed");
    }
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    const u = {};
    const n = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i++) {
      const info = gl.getActiveUniform(program, i);
      const name = info.name.replace(/\[0\]$/, "");
      u[name] = gl.getUniformLocation(program, info.name);
    }
    return { program, u };
  }

  _shader(type, src) {
    const gl = this.gl;
    const shader = gl.createShader(type);
    gl.shaderSource(shader, src);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(shader);
      gl.deleteShader(shader);
      throw new Error(log || "shader compile failed");
    }
    return shader;
  }
}

export class Fog {
  constructor(color = 0x000000, near = 1, far = 100) {
    this.color = new Color(color);
    this.near = near;
    this.far = far;
  }
}

export class Texture {
  constructor(image) {
    this.image = image || null;
    this.needsUpdate = true;
  }
}
