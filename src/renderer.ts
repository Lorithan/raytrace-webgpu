const COMPUTE_SHADER = `
  @group(0) @binding(0) var output: texture_storage_2d<rgba8unorm, write>;

  @compute @workgroup_size(8, 8)
  fn main(@builtin(global_invocation_id) id: vec3u) {
    let dims = textureDimensions(output);
    if (id.x >= dims.x || id.y >= dims.y) { return; }

    let uv = vec2f(f32(id.x) / f32(dims.x), f32(id.y) / f32(dims.y));
    textureStore(output, vec2i(id.xy), vec4f(uv.x, uv.y, 0.5, 1.0));
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

export class Renderer {
  private canvas: HTMLCanvasElement;
  private device!: GPUDevice;
  private context!: GPUCanvasContext;
  private computePipeline!: GPUComputePipeline;
  private blitPipeline!: GPURenderPipeline;
  private storageTexture!: GPUTexture;
  private computeBindGroup!: GPUBindGroup;
  private blitBindGroup!: GPUBindGroup;

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

    // Compute pipeline
    const computeModule = this.device.createShaderModule({ code: COMPUTE_SHADER });
    this.computePipeline = this.device.createComputePipeline({
      layout: 'auto',
      compute: { module: computeModule, entryPoint: 'main' },
    });

    this.computeBindGroup = this.device.createBindGroup({
      layout: this.computePipeline.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: this.storageTexture.createView() }],
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