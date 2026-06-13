const COMPUTE_SHADER = `
  const PI = 3.14159265358979;

  @group(0) @binding(0) var output: texture_storage_2d<rgba8unorm, write>;

  struct Camera {
    origin: vec3f,
    bottomLeft: vec3f,
    horizontal: vec3f,
    vertical: vec3f,
  }

  @group(0) @binding(1) var<uniform> camera: Camera;

  struct Sphere {
    center: vec3f,
    radius: f32,
    albedo: vec3f,
    metallic: f32,
    roughness: f32,
  }
  
  @group(0) @binding(2) var<uniform> sphere: Sphere;

  struct Light {
    pos: vec3f,
    pad1: f32,
    color: vec3f,
    pad2: f32,
  }

  @group(0) @binding(3) var<uniform> light: Light;

  fn hitSphere(sphere: Sphere, rayOrigin: vec3f, rayDir: vec3f) -> f32 {
    let oc = sphere.center - rayOrigin;
    let a = dot(rayDir, rayDir);
    let b = -2.0 * dot(rayDir, oc);
    let c = dot(oc, oc) - sphere.radius * sphere.radius;
    let discriminant = b * b - 4 * a * c;
    if (discriminant < 0.0) { return -1.0; }
    return (-b - sqrt(discriminant)) / (2.0 * a);
  }

  fn D_GGX(N: vec3f, H: vec3f, roughness: f32) -> f32 {
    let a = roughness * roughness;
    let a2 = a * a;
    let NdotH = max(dot(N, H), 0.0);
    let denom = (NdotH * NdotH * (a2 - 1.0) + 1.0);
    return a2 / (PI * denom * denom);
  }

  fn F_schlick(HdotV: f32, F0: vec3f) -> vec3f {
    return F0 + (1.0 - F0) * pow(1.0 - HdotV, 5.0);
  }

  fn G_sub(N: vec3f, X: vec3f, roughness: f32) -> f32 {
    let k = pow(roughness + 1.0, 2.0) / 8.0;
    let NdotX = max(dot(N, X), 0.0);
    return NdotX / (NdotX * (1.0 - k) + k);
  }

  fn G_smith(N: vec3f, V: vec3f, L: vec3f, roughness: f32) -> f32 {
    return G_sub(N, V, roughness) * G_sub(N, L, roughness);
  }

  fn cook_torrance(N: vec3f, V: vec3f, L: vec3f, albedo: vec3f, metallic: f32, roughness: f32) -> vec3f {
    let H = normalize(V + L);
    let NdotL = max(dot(N, L), 0.0);
    let NdotV = max(dot(N, V), 0.0);

    let F0 = mix(vec3f(0.04), albedo, metallic);

    let D = D_GGX(N, H, roughness);
    let F = F_schlick(max(dot(H, V), 0.0), F0);
    let G = G_smith(N, V, L, roughness);

    let specular = (D * F * G) / max(4.0 * NdotL * NdotV, 0.001);
    let diffuse = (1.0 - metallic) * ( albedo / PI);

    return (diffuse + specular) * NdotL * light.color;
  }

  @compute @workgroup_size(8, 8)
  fn main(@builtin(global_invocation_id) id: vec3u) {
    let dims = textureDimensions(output);
    if (id.x >= dims.x || id.y >= dims.y) { return; }

    let uv = vec2f(f32(id.x) / f32(dims.x), f32(id.y) / f32(dims.y));
    let flippedUV = vec2f(uv.x, 1.0 - uv.y);
    
    let rayOrigin = camera.origin;
    let rayDir = camera.bottomLeft + flippedUV.x * camera.horizontal + flippedUV.y * camera.vertical - camera.origin;
    let hit = hitSphere(sphere, rayOrigin, rayDir);
    if (hit > 0.0) {
      let hitPoint = rayOrigin + hit * rayDir;
      let N = normalize(hitPoint - sphere.center);
      let V = normalize(rayOrigin - hitPoint);
      let L = normalize(light.pos - hitPoint);
      let ambient = sphere.albedo * 0.1;
      let color = cook_torrance(N, V, L, sphere.albedo, sphere.metallic, sphere.roughness) + ambient;
      textureStore(output, vec2i(id.xy), vec4f(color, 1.0));
    } else {
      textureStore(output, vec2i(id.xy), vec4f(0.52, 0.8, 0.92, 1.0));  
    }
  }
`;

const BLIT_SHADER = `
  @group(0) @binding(0) var screen_texture: texture_2d<f32>;
  @group(0) @binding(1) var screen_sampler: sampler;

  @vertex
  fn vs_main(@builtin(vertex_index) idx: u32) -> @builtin(position) vec4f {
    var pos = array<vec2f, 6>(
      vec2f(-1.0, -1.0), vec2f( 1.0, -1.0), vec2f(-1.0,  1.0),
      vec2f(-1.0,  1.0), vec2f( 1.0, -1.0), vec2f( 1.0,  1.0)
    );
    return vec4f(pos[idx], 0.0, 1.0);
  }

  struct VertexOut {
    @builtin(position) pos: vec4f,
    @location(0) uv: vec2f,
  }
  
  @vertex
  fn vs_uv(@builtin(vertex_index) idx: u32) -> VertexOut {
    var pos = array<vec2f, 6>(
      vec2f(-1.0, -1.0), vec2f( 1.0, -1.0), vec2f(-1.0,  1.0),
      vec2f(-1.0,  1.0), vec2f( 1.0, -1.0), vec2f( 1.0,  1.0)
    );
    var uv = array<vec2f, 6>(
      vec2f(0.0, 1.0), vec2f(1.0, 1.0), vec2f(0.0, 0.0),
      vec2f(0.0, 0.0), vec2f(1.0, 1.0), vec2f(1.0, 0.0)
    );
    var out: VertexOut;
    out.pos = vec4f(pos[idx], 0.0, 1.0);
    out.uv  = uv[idx];
    return out;
  }

  @fragment
  fn fs_main(in: VertexOut) -> @location(0) vec4f {
    return textureSample(screen_texture, screen_sampler, in.uv);
  }
`;

import { Scene } from "./scene";

export class Renderer {
  private canvas: HTMLCanvasElement;
  private device!: GPUDevice;
  private context!: GPUCanvasContext;
  private computePipeline!: GPUComputePipeline;
  private blitPipeline!: GPURenderPipeline;
  private storageTexture!: GPUTexture;
  private computeBindGroup!: GPUBindGroup;
  private blitBindGroup!: GPUBindGroup;
  private scene!: Scene;
  private cameraBuffer!: GPUBuffer;
  private sceneBuffer!: GPUBuffer;
  private lightBuffer!: GPUBuffer;


  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
  }

  async init() {

    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) throw new Error('No GPU adapter found.');
    this.device = await adapter.requestDevice();

    this.context = this.canvas.getContext('webgpu') as GPUCanvasContext;
    const canvasFormat = navigator.gpu.getPreferredCanvasFormat();
    this.context.configure({ device: this.device, format: canvasFormat });

    // Storage texture — written by compute, read by blit
    this.storageTexture = this.device.createTexture({
      size: [this.canvas.width, this.canvas.height],
      format: 'rgba8unorm',
      usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING,
    });

    this.scene = new Scene();
    const cameraBuffer = this.scene.camera.toBuffer();
    this.cameraBuffer = this.device.createBuffer({
      size: cameraBuffer.byteLength,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.device.queue.writeBuffer(this.cameraBuffer, 0, cameraBuffer);

    const sceneBuffer = this.scene.sphere.toBuffer();
    this.sceneBuffer = this.device.createBuffer({
      size: sceneBuffer.byteLength,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.device.queue.writeBuffer(this.sceneBuffer, 0, sceneBuffer);

    const lightBuffer = this.scene.light.toBuffer();
    this.lightBuffer = this.device.createBuffer({
      size: lightBuffer.byteLength,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.device.queue.writeBuffer(this.lightBuffer, 0, lightBuffer);

    // Compute pipeline
    const computeModule = this.device.createShaderModule({ code: COMPUTE_SHADER });
    this.computePipeline = this.device.createComputePipeline({
      layout: 'auto',
      compute: { module: computeModule, entryPoint: 'main' },
    });

    this.computeBindGroup = this.device.createBindGroup({
      layout: this.computePipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: this.storageTexture.createView() },
        { binding: 1, resource: { buffer: this.cameraBuffer } },
        { binding: 2, resource: { buffer: this.sceneBuffer } },
        { binding: 3, resource: { buffer: this.lightBuffer } },
      ],
    });

    // Blit pipeline
    const blitModule = this.device.createShaderModule({ code: BLIT_SHADER });
    this.blitPipeline = this.device.createRenderPipeline({
      layout: 'auto',
      vertex: { module: blitModule, entryPoint: 'vs_uv' },
      fragment: {
        module: blitModule, entryPoint: 'fs_main',
        targets: [{ format: canvasFormat }]
      },
      primitive: { topology: 'triangle-list' },
    });

    const sampler = this.device.createSampler({ magFilter: 'linear', minFilter: 'linear' });
    this.blitBindGroup = this.device.createBindGroup({
      layout: this.blitPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: this.storageTexture.createView() },
        { binding: 1, resource: sampler },
      ],
    });
  }

  render() {
    const encoder = this.device.createCommandEncoder();

    // Compute pass
    const compute = encoder.beginComputePass();
    compute.setPipeline(this.computePipeline);
    compute.setBindGroup(0, this.computeBindGroup);
    compute.dispatchWorkgroups(
      Math.ceil(this.canvas.width / 8),
      Math.ceil(this.canvas.height / 8)
    );
    compute.end();

    // Blit pass
    const blit = encoder.beginRenderPass({
      colorAttachments: [{
        view: this.context.getCurrentTexture().createView(),
        clearValue: { r: 0, g: 0, b: 0, a: 1 },
        loadOp: 'clear',
        storeOp: 'store',
      }]
    });
    blit.setPipeline(this.blitPipeline);
    blit.setBindGroup(0, this.blitBindGroup);
    blit.draw(6);
    blit.end();

    this.device.queue.submit([encoder.finish()]);
  }
}