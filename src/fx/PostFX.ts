import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';

const GradeShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uTime: { value: 0 },
    uVignette: { value: 1.0 },
    uDesat: { value: 0.0 },
    uHurt: { value: 0.0 },
  },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse; uniform float uTime; uniform float uVignette; uniform float uDesat; uniform float uHurt;
    varying vec2 vUv;
    float rand(vec2 c){ return fract(sin(dot(c, vec2(12.9898,78.233))) * 43758.5453); }
    void main(){
      vec4 c = texture2D(tDiffuse, vUv);
      vec3 col = c.rgb;
      float l = dot(col, vec3(0.299, 0.587, 0.114));
      // Muted, slightly cold palette with warm highlights.
      col = mix(col, vec3(l), 0.18 + uDesat * 0.8);
      col *= mix(vec3(0.92, 0.97, 1.05), vec3(1.08, 1.0, 0.9), smoothstep(0.2, 0.8, l));
      // Vignette
      vec2 d = vUv - 0.5;
      float v = 1.0 - dot(d, d) * 1.5 * uVignette;
      col *= clamp(v, 0.0, 1.0);
      // Red damage edge
      float edge = smoothstep(0.15, 0.55, length(d));
      col = mix(col, vec3(0.5, 0.0, 0.0), edge * uHurt * 0.6);
      // Film grain
      col += (rand(vUv * 1000.0 + uTime) - 0.5) * 0.035;
      gl_FragColor = vec4(col, c.a);
    }`,
};

export class PostFX {
  readonly composer: EffectComposer;
  readonly bloom: UnrealBloomPass;
  private grade: ShaderPass;

  constructor(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera, w: number, h: number) {
    this.composer = new EffectComposer(renderer);
    this.composer.addPass(new RenderPass(scene, camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(w, h), 0.7, 0.55, 0.82);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    this.grade = new ShaderPass(GradeShader);
    this.composer.addPass(this.grade);
  }

  setSize(w: number, h: number): void {
    this.composer.setSize(w, h);
  }

  set desaturate(v: number) {
    this.grade.uniforms.uDesat.value = v;
  }

  set hurt(v: number) {
    this.grade.uniforms.uHurt.value = v;
  }

  render(time: number): void {
    this.grade.uniforms.uTime.value = time;
    this.composer.render();
  }
}
