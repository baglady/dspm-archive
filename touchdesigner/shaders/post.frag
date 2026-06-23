// post.frag — final-stage look for the dspm visual engine.
//
// Sits after the feedback/trails stage. Adds chromatic aberration, a soft
// vignette and a final contrast/brightness trim. Chromatic aberration tracks
// the high band so transients smear the colour fringes outward.
//
//   sTD2DInputs[0] : the composited generative + feedback image
//   uAudio  : vec4(low, mid, high, rms)
//   uCtrlC  : vec4(aberration, vignette, brightness, gamma)

uniform sampler2D sTD2DInputs[1];
uniform vec4 uAudio;   // low, mid, high, rms
uniform vec4 uCtrlC;   // aberration, vignette, brightness, gamma

out vec4 fragColor;

void main() {
    vec2 uv = vUV.st;
    vec2 c  = uv - 0.5;

    float aberration = uCtrlC.x * (0.004 + uAudio.z * 0.02);
    float vigAmt     = uCtrlC.y;
    float brightness = mix(0.5, 1.8, uCtrlC.z);
    float gamma      = mix(0.6, 1.8, uCtrlC.w);

    // Radial chromatic split.
    vec2 dir = c * aberration;
    float rC = texture(sTD2DInputs[0], uv + dir).r;
    float gC = texture(sTD2DInputs[0], uv).g;
    float bC = texture(sTD2DInputs[0], uv - dir).b;
    vec3 col = vec3(rC, gC, bC);

    // Vignette.
    float vig = smoothstep(0.9, 0.25, length(c) * (1.0 + vigAmt));
    col *= mix(1.0, vig, clamp(vigAmt, 0.0, 1.0));

    col = pow(max(col, 0.0), vec3(1.0 / gamma)) * brightness;

    fragColor = TDOutputSwizzle(vec4(col, 1.0));
}
