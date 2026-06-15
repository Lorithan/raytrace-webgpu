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