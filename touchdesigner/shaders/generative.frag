// generative.frag — the core generative field for the dspm visual engine.
//
// Runs in a GLSL TOP (glslmultiTOP). It draws a domain-warped fBm "plasma"
// flow-field and colours it through a palette. Everything that makes it MOVE
// and REACT comes from four uniforms that the build script wires to live
// control signals:
//
//   uTime   : float        seconds, free-running (absTime.seconds)
//   uAudio  : vec4(low, mid, high, rms)   Overbridge audio analysis, 0..~1
//   uCtrlA  : vec4(speed, warp, scale, hue)      performer macros, 0..1 (some 0..2)
//   uCtrlB  : vec4(sat, contrast, colorMix, kaleido)  performer macros, 0..1
//
// If a uniform fails to bind (TD version differences), it reads 0 and the field
// still animates off uTime — you just lose that modulation until it is wired.
//
// Feedback/trails, bloom and chromatic aberration are done downstream in the TD
// network (Feedback TOP + post.frag), NOT here, so this stays a clean source.

uniform float uTime;
uniform vec4  uAudio;   // low, mid, high, rms
uniform vec4  uCtrlA;   // speed, warp, scale, hue
uniform vec4  uCtrlB;   // sat, contrast, colorMix, kaleido

out vec4 fragColor;

// ---- noise helpers -------------------------------------------------------

vec2 hash2(vec2 p) {
    p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
    return -1.0 + 2.0 * fract(sin(p) * 43758.5453123);
}

float gnoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(dot(hash2(i + vec2(0.0, 0.0)), f - vec2(0.0, 0.0)),
                   dot(hash2(i + vec2(1.0, 0.0)), f - vec2(1.0, 0.0)), u.x),
               mix(dot(hash2(i + vec2(0.0, 1.0)), f - vec2(0.0, 1.0)),
                   dot(hash2(i + vec2(1.0, 1.0)), f - vec2(1.0, 1.0)), u.x), u.y);
}

float fbm(vec2 p) {
    float v = 0.0;
    float a = 0.5;
    mat2 rot = mat2(0.8, 0.6, -0.6, 0.8);
    for (int i = 0; i < 6; i++) {
        v += a * gnoise(p);
        p = rot * p * 2.0 + 0.03;
        a *= 0.5;
    }
    return v;
}

// IQ-style cosine palette. colorMix shifts the phase for a hands-on colour knob.
vec3 palette(float t, float hueShift, float mix01) {
    vec3 a = vec3(0.5);
    vec3 b = vec3(0.5);
    vec3 c = vec3(1.0, 1.0, 1.0);
    vec3 d = vec3(0.00, 0.33, 0.67) + hueShift + mix01 * vec3(0.1, -0.2, 0.3);
    return a + b * cos(6.28318 * (c * t + d));
}

// Polar kaleidoscope fold. amt 0 = off, 1 = strong.
vec2 kaleido(vec2 uv, float amt) {
    if (amt < 0.001) return uv;
    vec2 c = uv - 0.5;
    float r = length(c);
    float a = atan(c.y, c.x);
    float seg = mix(6.2831853, 0.7853981, amt);   // fewer→more wedges
    a = abs(mod(a, seg) - seg * 0.5);
    return 0.5 + vec2(cos(a), sin(a)) * r;
}

void main() {
    // vUV.st is 0..1 across the output. Correct for aspect so motion is even.
    vec2 res = uTDOutputInfo.res.zw;           // (width, height)
    float aspect = res.x / max(res.y, 1.0);

    float speed    = uCtrlA.x;                  // 0..2
    float warp     = uCtrlA.y * 2.0;            // 0..2
    float scale    = mix(1.5, 7.0, uCtrlA.z);   // zoom of the noise field
    float hueShift = uCtrlA.w;                  // 0..1
    float sat      = uCtrlB.x * 1.5;
    float contrast = mix(0.6, 2.0, uCtrlB.y);
    float colorMix = uCtrlB.z;
    float kal      = uCtrlB.w;

    float low  = uAudio.x;
    float mid  = uAudio.y;
    float high = uAudio.z;
    float rms  = uAudio.w;

    float t = uTime * (0.05 + speed * 0.6);

    vec2 uv = vUV.st;
    uv = kaleido(uv, kal);
    vec2 p = (uv - 0.5) * vec2(aspect, 1.0) * scale;

    // Domain warp: two layers of fBm push the sample point around. Bass swells
    // the warp; highs add fine jitter so hats/cymbals sparkle the surface.
    float warpAmt = warp * (0.6 + low * 1.8);
    vec2 q = vec2(fbm(p + vec2(0.0, t)),
                  fbm(p + vec2(5.2, 1.3 - t)));
    vec2 r = vec2(fbm(p + warpAmt * q + vec2(1.7, 9.2) + 0.15 * t + high * 3.0),
                  fbm(p + warpAmt * q + vec2(8.3, 2.8) - 0.12 * t));
    float f = fbm(p + warpAmt * r);

    // Map field → colour. mid energy brightens the band that's "active".
    float v = f * 0.5 + 0.5;
    v = pow(clamp(v, 0.0, 1.0), contrast);
    float tone = v + 0.15 * mid + 0.25 * rms;

    vec3 col = palette(tone, hueShift, colorMix);

    // Saturation control around luma.
    float luma = dot(col, vec3(0.299, 0.587, 0.114));
    col = mix(vec3(luma), col, sat);

    // Bass push on overall brightness for a "breathing" pulse, gentle.
    col *= 0.85 + 0.5 * low + 0.3 * rms;

    fragColor = TDOutputSwizzle(vec4(col, 1.0));
}
