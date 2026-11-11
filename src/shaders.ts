export const vertexSource = `#version 300 es
precision highp float;
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

export const fragmentSource = `#version 300 es
precision highp float;
uniform vec2 uResolution;
uniform sampler2D uScene;
uniform sampler2D uLit;
uniform sampler2D uGlow;
uniform float uPosition;
uniform float uLight;
uniform float uStretch;
uniform float uWobble;
uniform vec4 uCursor;
out vec4 fragColor;

float capsule(vec2 p, vec2 halfSize) {
  float r = halfSize.x;
  return length(vec2(p.x, max(abs(p.y) - (halfSize.y - r), 0.0))) - r;
}
float pill(vec2 p) {
  vec2 q = abs(p - vec2(80.0, 42.0)) - vec2(40.0, 0.0);
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - 32.0;
}
vec2 sceneUV(vec2 p) {
  vec2 texel = clamp(floor(p - vec2(8.0, 4.0)), vec2(0.0), vec2(143.0, 75.0));
  return (texel + 0.5) / vec2(144.0, 76.0);
}
vec3 bloom(vec2 p) {
  vec2 uv = (p - vec2(8.0, 4.0)) / vec2(144.0, 76.0);
  vec2 d = 1.15 / vec2(144.0, 76.0);
  vec3 c = texture(uGlow, uv).rgb * 0.24;
  c += texture(uGlow, uv + vec2(d.x, 0.0)).rgb * 0.12;
  c += texture(uGlow, uv - vec2(d.x, 0.0)).rgb * 0.12;
  c += texture(uGlow, uv + vec2(0.0, d.y)).rgb * 0.12;
  c += texture(uGlow, uv - vec2(0.0, d.y)).rgb * 0.12;
  c += texture(uGlow, uv + d).rgb * 0.07;
  c += texture(uGlow, uv - d).rgb * 0.07;
  c += texture(uGlow, uv + vec2(d.x, -d.y)).rgb * 0.07;
  c += texture(uGlow, uv + vec2(-d.x, d.y)).rgb * 0.07;
  return c;
}
bool cursorShape(vec2 q) {
  q = floor(q);
  bool arrow = q.x >= 0.0 && q.y >= 0.0 && q.y <= 8.0 && q.x <= q.y * 0.7 && q.x <= 6.0;
  bool stem = q.x >= 2.0 && q.x <= 3.0 && q.y >= 6.0 && q.y <= 10.0;
  return arrow || stem;
}
void main() {
  vec2 p = vec2(gl_FragCoord.x / uResolution.x * 160.0, (1.0 - gl_FragCoord.y / uResolution.y) * 84.0);
  float aa = 160.0 / uResolution.x;
  float day = clamp(uLight, 0.0, 1.0);
  float trackD = pill(p);
  float trackA = 1.0 - smoothstep(-aa, aa, trackD);
  vec2 center = vec2(mix(45.0, 115.0, clamp(uPosition, 0.0, 1.0)), 42.0);
  float cs = cos(uWobble), sn = sin(uWobble);
  mat2 rot = mat2(cs, -sn, sn, cs);
  vec2 local = rot * (p - center);
  vec2 halfSize = vec2(21.0 * uStretch, 36.0 / uStretch);
  float lensD = capsule(local, halfSize);
  float lensA = 1.0 - smoothstep(-aa, aa, lensD);
  vec3 color = texture(uScene, sceneUV(p)).rgb + bloom(p) * 0.58;
  float shadowD = capsule(rot * (p - center - vec2(1.3, 1.9)), halfSize);
  float shadow = exp(-max(shadowD, 0.0) * 0.45) * 0.29;
  color *= 1.0 - shadow;
  vec3 rimTint = mix(vec3(0.54, 0.65, 0.79), vec3(0.98, 1.0, 0.88), day);
  float innerRim = exp(-abs(trackD + 0.65) * 2.2);
  color = mix(color, rimTint, innerRim * (p.y < 42.0 ? 0.64 : 0.24));
  color *= 1.0 - exp(-abs(trackD + 1.8) * 1.8) * 0.13;
  // A capsule lens: magnification, radial bend and separate RGB rim samples.
  vec2 axis = vec2(local.x, local.y - clamp(local.y, -(halfSize.y - halfSize.x), halfSize.y - halfSize.x));
  vec2 normal = normalize(axis + vec2(0.0001));
  float edge = pow(clamp(1.0 + lensD / 9.0, 0.0, 1.0), 2.0);
  vec2 bend = normal * edge * 2.2;
  vec2 lookup = center + transpose(rot) * (local / 1.28 + bend);
  vec2 split = transpose(rot) * normal * edge * 1.05;
  vec3 lens;
  lens.r = texture(uLit, sceneUV(lookup + split)).r;
  lens.g = texture(uLit, sceneUV(lookup)).g;
  lens.b = texture(uLit, sceneUV(lookup - split)).b;
  lens += bloom(lookup) * 0.7;
  float band = exp(-pow((lensD + 1.9) / 0.95, 2.0));
  lens *= 1.0 - band * 0.40;
  float fresnel = pow(clamp(1.0 + lensD / 6.0, 0.0, 1.0), 3.0);
  vec3 glassTint = mix(vec3(0.65, 0.77, 1.0), vec3(1.0, 0.94, 0.80), day);
  lens = mix(lens, glassTint, fresnel * 0.33);
  float brightEdge = exp(-pow((lensD + 0.45) / 0.43, 2.0));
  lens += glassTint * brightEdge * (0.29 + 0.40 * max(0.0, -normal.y * 0.7 - normal.x * 0.5));
  // Long upper-left soft streak plus a small lower-right pin of light.
  vec2 streak = (local - vec2(-halfSize.x * 0.68, -8.0)) / vec2(1.1, 13.0);
  float highlight = exp(-dot(streak, streak) * 1.6);
  vec2 dotPoint = (local - vec2(halfSize.x * 0.49, halfSize.y * 0.64)) / vec2(1.45, 2.0);
  float glint = exp(-dot(dotPoint, dotPoint) * 1.8);
  lens += vec3(1.0, 1.0, 0.95) * (highlight * 0.43 + glint * 0.72);
  float alpha = max(trackA, lensA);
  color = mix(color, lens, lensA);
  vec4 result = vec4(clamp(color, 0.0, 1.0) * alpha, alpha);
  if (uCursor.z > 0.0) {
    vec2 c = p - uCursor.xy;
    float ring = (1.0 - smoothstep(0.18, 0.6, abs(length(c) - 5.3))) * uCursor.w * 0.5;
    float pointer = cursorShape(c) ? 1.0 : 0.0;
    float border = 0.0;
    for (int y = -1; y <= 1; y++)
      for (int x = -1; x <= 1; x++)
        border = max(border, cursorShape(c + vec2(float(x), float(y))) ? 1.0 : 0.0);
    float cursorAlpha = max(border, ring) * uCursor.z;
    vec3 cursorColor = mix(vec3(0.16, 0.24, 0.27), vec3(1.0, 0.98, 0.88), pointer);
    result = vec4(cursorColor * cursorAlpha + result.rgb * (1.0 - cursorAlpha), cursorAlpha + result.a * (1.0 - cursorAlpha));
  }
  fragColor = result;
}`;
