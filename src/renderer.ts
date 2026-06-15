import COMPUTE_SHADER from './shaders/compute.wgsl?raw';
import BLIT_SHADER from './shaders/blit.wgsl?raw';

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