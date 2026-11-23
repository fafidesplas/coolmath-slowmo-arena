import * as THREE from 'three';

/**
 * Single full-screen grading pass: tone mapping, slow-motion desaturation
 * (reds are preserved), vignette + heartbeat pulse, chromatic fringe and flashes.
 */
export class Post {
  readonly uniforms = {
    tDiffuse: { value: null as THREE.Texture | null },
    uSlow: { value: 0 },
    uFlash: { value: 0 },
    uFlashColor: { value: new THREE.Color(1, 1, 1) },
    uHeart: { value: 0 },
    uDead: { value: 0 },
  };
  private rt: THREE.WebGLRenderTarget;
  private scene = new THREE.Scene();
  private cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  constructor(renderer: THREE.WebGLRenderer, mobile: boolean) {
    const half = renderer.extensions.has('EXT_color_buffer_half_float') || renderer.extensions.has('EXT_color_buffer_float');
    this.rt = new THREE.WebGLRenderTarget(1, 1, {
      type: half ? THREE.HalfFloatType : THREE.UnsignedByteType,
      samples: mobile ? 0 : 4,
    });
    this.uniforms.tDiffuse.value = this.rt.texture;
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      depthTest: false,
      depthWrite: false,
      vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D tDiffuse;
        uniform float uSlow, uFlash, uHeart, uDead;
        uniform vec3 uFlashColor;
        varying vec2 vUv;
        void main() {
          vec2 c = vUv - 0.5;
          float r2 = dot(c, c);
          float ab = (0.0015 + 0.0055 * uSlow + 0.01 * uFlash) * r2 * 4.0;
          vec3 col;
          col.r = texture2D(tDiffuse, vUv + c * ab).r;
          col.g = texture2D(tDiffuse, vUv).g;
          col.b = texture2D(tDiffuse, vUv - c * ab).b;
          gl_FragColor = vec4(col, 1.0);
          #include <tonemapping_fragment>
          col = gl_FragColor.rgb;
          float l = dot(col, vec3(0.299, 0.587, 0.114));
          float redness = clamp((col.r - max(col.g, col.b)) * 2.5, 0.0, 1.0);
          vec3 cool = vec3(l) * vec3(0.9, 0.97, 1.08);
          float desat = uSlow * 0.8 * (1.0 - redness * 0.9);
          col = mix(col, cool, desat);
          col = mix(col, col * vec3(1.06, 0.95, 0.92), redness * uSlow * 0.4);
          float vig = smoothstep(0.95, 0.25, length(c) * (1.0 + 0.3 * uSlow + 0.12 * uHeart));
          col *= mix(1.0, vig, 0.25 + 0.45 * uSlow);
          col = mix(col, vec3(l * 1.15, l * 0.12, l * 0.14), uDead * 0.75);
          col = mix(col, uFlashColor, uFlash);
          gl_FragColor = vec4(col, 1.0);
          #include <colorspace_fragment>
        }`,
    });
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
    quad.frustumCulled = false;
    this.scene.add(quad);
  }

  setSize(w: number, h: number): void {
    this.rt.setSize(w, h);
  }

  render(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera): void {
    renderer.setRenderTarget(this.rt);
    renderer.render(scene, camera);
    renderer.setRenderTarget(null);
    renderer.render(this.scene, this.cam);
  }
}
