const COMPUTE_SHADER = `
  const PI = 3.14159265358979;
  const MAX_BOUNCES = 5;

  @group(0) @binding(0) var accumWrite: texture_storage_2d<rgba32float, write>;
  @group(0) @binding(1) var accumRead: texture_2d<f32>;
  @group(0) @binding(2) var<uniform> frameCount: u32;

  struct Camera {
    origin: vec3f,
    bottomLeft: vec3f,
    horizontal: vec3f,
    vertical: vec3f,
  }

  @group(0) @binding(3) var<uniform> camera: Camera;

  struct Sphere {
    center: vec3f,
    radius: f32,
    albedo: vec3f,
    metallic: f32,
    roughness: f32,
    pad0: f32,
    pad1: f32,
    pad2: f32,
  }

  @group(0) @binding(4) var<storage, read> spheres: array<Sphere>;

  struct Light {
    pos: vec3f,
    pad1: f32,
    color: vec3f,
    pad2: f32,
  }

  @group(0) @binding(5) var<uniform> light: Light;

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

  fn buildFrame(N: vec3f) -> mat3x3f {
    var up = vec3f(0.0, 1.0, 0.0);
    if (abs(N.y) > 0.999) {
      up = vec3f(1.0, 0.0, 0.0);
    }
      let T = normalize(cross(up, N));
      let B = cross(N, T);
      return mat3x3f(T, B, N);
  }

  fn cosineHemisphere(N: vec3f, r1: f32, r2: f32) -> vec3f {
    let phi = 2.0 * PI * r1;
    let x = cos(phi) * sqrt(r2);
    let y = sin(phi) * sqrt(r2);
    let z = sqrt(1.0 - r2);
    let d = vec3f(x, y, z);

    let frame = buildFrame(N);
    return frame * d;
  }

  fn hash(seed: u32) -> f32 {
    var s = seed;
    s ^= s << 13u;
    s ^= s >> 17u;
    s ^= s << 5u;
    return f32(s) / f32(0xffffffffu);
  }

  fn skyColor(dir: vec3f) -> vec3f {
    let t = max(dir.y, 0.0) * 0.5 + 0.5;
    let horizon = vec3f(1.0, 1.0, 1.0);
    let zenith = vec3f(0.3, 0.5, 1.0);
    return mix(horizon, zenith, t);
  }

  @compute @workgroup_size(8, 8)
  fn main(@builtin(global_invocation_id) id: vec3u) {
    let dims = textureDimensions(accumWrite);
    if (id.x >= dims.x || id.y >= dims.y) { return; }

    let uv = vec2f(f32(id.x) / f32(dims.x), f32(id.y) / f32(dims.y));
    let flippedUV = vec2f(uv.x, 1.0 - uv.y);
    
    var rayOrigin = camera.origin;
    var rayDir = camera.bottomLeft + flippedUV.x * camera.horizontal + flippedUV.y * camera.vertical - camera.origin;
    var throughput = vec3f(1.0);
    var color = vec3f(0.0);

    for (var bounce = 0; bounce < MAX_BOUNCES; bounce++) {
      var closestHit = -1.0;
      var closestSphere = 0u;
      for (var i = 0u; i < arrayLength(&spheres); i++) {
        let t = hitSphere(spheres[i], rayOrigin, rayDir);
        if (t > 0.0 && (closestHit < 0.0 || t < closestHit)) {
          closestHit = t;
          closestSphere = i;
        }
      }
      
      if (closestHit > 0.0) {
        let sphere = spheres[closestSphere];
        let hitPoint = rayOrigin + closestHit * rayDir;
        let N = normalize(hitPoint - sphere.center);

        let lightDir = normalize(light.pos - hitPoint);
        let lightDist = length(light.pos - hitPoint);
        var occluded = false;
        for (var j = 0u; j < arrayLength(&spheres); j++) {
          let t = hitSphere(spheres[j], hitPoint + N * 0.001, lightDir);
          if (t > 0.0 && t < lightDist) {
            occluded = true;
            break;
          }
        }

        if (!occluded) {
          let V = normalize(rayOrigin - hitPoint);
          let direct = cook_torrance(N, V, lightDir, sphere.albedo, sphere.metallic, sphere.roughness);
          color += throughput * direct;
        }

        throughput *= sphere.albedo;

        let seed = id.x + id.y * dims.x + frameCount * dims.x * dims.y + u32(bounce) * 2u;
        let r1 = hash(seed);
        let r2 = hash(seed + 1u);
        rayDir = cosineHemisphere(N, r1, r2);
        rayOrigin = hitPoint;
      } else {
        color += throughput * skyColor(rayDir);
        break;
      }
    }
    
    let clamped = min(color, vec3f(10.0));
    let prev = textureLoad(accumRead, vec2i(id.xy), 0).rgb;
    let accumulated = (prev * f32(frameCount) + clamped) / f32(frameCount + 1);
    textureStore(accumWrite, vec2i(id.xy), vec4f(accumulated, 1.0));
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
    let hdr = textureSample(screen_texture, screen_sampler, in.uv).rgb;
    let tonemapped = hdr / (hdr + vec3f(1.0));
    return vec4f(tonemapped, 1.0);
  }
`;

import { Scene, Camera } from "./scene";

export class Renderer {
  private canvas: HTMLCanvasElement;
  private device!: GPUDevice;
  private context!: GPUCanvasContext;
  private computePipeline!: GPUComputePipeline;
  private blitPipeline!: GPURenderPipeline;
  private accumTextureA!: GPUTexture;
  private accumTextureB!: GPUTexture;
  private computeBindGroupA!: GPUBindGroup;
  private computeBindGroupB!: GPUBindGroup;
  private blitBindGroupA!: GPUBindGroup;
  private blitBindGroupB!: GPUBindGroup;
  private scene!: Scene;
  private cameraBuffer!: GPUBuffer;
  private sceneBuffer!: GPUBuffer;
  private lightBuffer!: GPUBuffer;
  private frameCount!: number;
  private frameBuffer!: GPUBuffer;


  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
  }

  async init() {

    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) throw new Error('No GPU adapter found.');
    this.device = await adapter.requestDevice({
      requiredFeatures: ['float32-filterable'],
    });

    this.context = this.canvas.getContext('webgpu') as GPUCanvasContext;
    const canvasFormat = navigator.gpu.getPreferredCanvasFormat();
    this.context.configure({ device: this.device, format: canvasFormat });

    // Accumulated textures
    const accumDesc = {
      size: [this.canvas.width, this.canvas.height],
      format: 'rgba32float' as GPUTextureFormat,
      usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    };
    this.accumTextureA = this.device.createTexture(accumDesc);
    this.accumTextureB = this.device.createTexture(accumDesc);

    // Scene buffer
    this.scene = new Scene();
    const cameraBuffer = this.scene.camera.toBuffer();
    this.cameraBuffer = this.device.createBuffer({
      size: cameraBuffer.byteLength,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.device.queue.writeBuffer(this.cameraBuffer, 0, cameraBuffer);

    const sceneBuffer = this.scene.toBuffer();
    this.sceneBuffer = this.device.createBuffer({
      size: sceneBuffer.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
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

    this.frameCount = 0;
    const frameBuffer = new Uint32Array([0]);
    this.frameBuffer = this.device.createBuffer({
      size: 16,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.device.queue.writeBuffer(this.frameBuffer, 0, frameBuffer);

    this.computeBindGroupA = this.device.createBindGroup({
      layout: this.computePipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: this.accumTextureA.createView() },
        { binding: 1, resource: this.accumTextureB.createView() },
        { binding: 2, resource: { buffer: this.frameBuffer } },
        { binding: 3, resource: { buffer: this.cameraBuffer } },
        { binding: 4, resource: { buffer: this.sceneBuffer } },
        { binding: 5, resource: { buffer: this.lightBuffer } },
      ],
    });

    this.computeBindGroupB = this.device.createBindGroup({
      layout: this.computePipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: this.accumTextureB.createView() },
        { binding: 1, resource: this.accumTextureA.createView() },
        { binding: 2, resource: { buffer: this.frameBuffer } },
        { binding: 3, resource: { buffer: this.cameraBuffer } },
        { binding: 4, resource: { buffer: this.sceneBuffer } },
        { binding: 5, resource: { buffer: this.lightBuffer } },
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

    const sampler = this.device.createSampler({ magFilter: 'nearest', minFilter: 'nearest' });
    this.blitBindGroupA = this.device.createBindGroup({
      layout: this.blitPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: this.accumTextureA.createView() },
        { binding: 1, resource: sampler },
      ],
    });
    this.blitBindGroupB = this.device.createBindGroup({
      layout: this.blitPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: this.accumTextureB.createView() },
        { binding: 1, resource: sampler },
      ],
    });
  }

  render() {
    const encoder = this.device.createCommandEncoder();

    // Update frame counter
    this.device.queue.writeBuffer(this.frameBuffer, 0, new Uint32Array([this.frameCount]));

    // Pick bind group based on frame parity
    const computeBindGroup = this.frameCount % 2 === 0
      ? this.computeBindGroupA
      : this.computeBindGroupB;

    const blitBindGroup = this.frameCount % 2 === 0
      ? this.blitBindGroupA
      : this.blitBindGroupB;

    // Compute pass
    const compute = encoder.beginComputePass();
    compute.setPipeline(this.computePipeline);
    compute.setBindGroup(0, computeBindGroup);
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
    blit.setBindGroup(0, blitBindGroup);
    blit.draw(6);
    blit.end();

    this.device.queue.submit([encoder.finish()]);
    this.frameCount++;
  }

  updateCamera(camera: Camera) {
    const buffer = camera.toBuffer();
    this.device.queue.writeBuffer(this.cameraBuffer, 0, buffer);
    this.resetAccumulation();
  }

  resetAccumulation() {
    const zeros = new Float32Array(this.canvas.width * this.canvas.height * 4);
    this.device.queue.writeTexture(
      { texture: this.accumTextureA },
      zeros,
      { bytesPerRow: this.canvas.width * 4 * 4 },
      [this.canvas.width, this.canvas.height]
    );
    this.device.queue.writeTexture(
      { texture: this.accumTextureB },
      zeros,
      { bytesPerRow: this.canvas.width * 4 * 4 },
      [this.canvas.width, this.canvas.height]
    );
    this.frameCount = 0;
  }
}