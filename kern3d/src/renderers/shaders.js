export const VERT = `#version 300 es
precision highp float;

layout(location = 0) in vec3 position;
layout(location = 1) in vec3 normal;
layout(location = 2) in vec2 uv;

uniform mat4 modelMatrix;
uniform mat4 viewMatrix;
uniform mat4 projectionMatrix;
uniform mat3 normalMatrix;

out vec3 vNormal;
out vec3 vWorldPos;
out vec2 vUv;

void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorldPos = world.xyz;
  vNormal = normalMatrix * normal;
  vUv = uv;
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

export const FRAG = `#version 300 es
precision highp float;

in vec3 vNormal;
in vec3 vWorldPos;
in vec2 vUv;

uniform vec3 diffuseColor;
uniform vec3 specularColor;
uniform vec3 emissiveColor;
uniform float shininess;
uniform float opacity;
uniform int shaded;
uniform int useMap;
uniform sampler2D map;

uniform vec3 ambient;
uniform vec3 cameraPosition;

uniform int numDir;
uniform vec3 dirDirections[4];
uniform vec3 dirColors[4];

uniform int numPoint;
uniform vec3 pointPositions[8];
uniform vec3 pointColors[8];
uniform float pointDistances[8];

uniform int useFog;
uniform vec3 fogColor;
uniform float fogNear;
uniform float fogFar;

out vec4 fragColor;

void main() {
  vec3 N = normalize(vNormal);
  vec3 albedo = diffuseColor;
  if (useMap == 1) albedo *= texture(map, vUv).rgb;

  vec3 color = emissiveColor;
  if (shaded == 0) {
    color += albedo;
  } else {
    vec3 V = normalize(cameraPosition - vWorldPos);
    color += albedo * ambient;
    for (int i = 0; i < 4; i++) {
      if (i >= numDir) break;
      vec3 L = normalize(-dirDirections[i]);
      float ndotl = max(dot(N, L), 0.0);
      vec3 H = normalize(L + V);
      float spec = pow(max(dot(N, H), 0.0), shininess);
      color += albedo * dirColors[i] * ndotl + specularColor * dirColors[i] * spec * ndotl;
    }
    for (int i = 0; i < 8; i++) {
      if (i >= numPoint) break;
      vec3 toL = pointPositions[i] - vWorldPos;
      float dist = length(toL);
      vec3 L = toL / max(dist, 1e-4);
      float range = pointDistances[i];
      float atten = 1.0;
      if (range > 0.0) {
        float t = clamp(1.0 - dist / range, 0.0, 1.0);
        atten = t * t;
      } else {
        atten = 1.0 / (1.0 + dist * dist * 0.05);
      }
      float ndotl = max(dot(N, L), 0.0);
      vec3 H = normalize(L + V);
      float spec = pow(max(dot(N, H), 0.0), shininess);
      vec3 lc = pointColors[i] * atten;
      color += albedo * lc * ndotl + specularColor * lc * spec * ndotl;
    }
  }

  if (useFog == 1) {
    float fogFactor = clamp((fogFar - length(cameraPosition - vWorldPos)) / (fogFar - fogNear), 0.0, 1.0);
    color = mix(fogColor, color, fogFactor);
  }

  color = pow(max(color, 0.0), vec3(1.0 / 2.2));
  fragColor = vec4(color, opacity);
}
`;

export const LINE_VERT = `#version 300 es
precision highp float;
layout(location = 0) in vec3 position;
uniform mat4 modelMatrix;
uniform mat4 viewMatrix;
uniform mat4 projectionMatrix;
void main() {
  gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.0);
}
`;

export const LINE_FRAG = `#version 300 es
precision highp float;
uniform vec3 diffuseColor;
uniform float opacity;
out vec4 fragColor;
void main() {
  fragColor = vec4(pow(diffuseColor, vec3(1.0 / 2.2)), opacity);
}
`;
