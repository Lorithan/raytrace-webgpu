export class Vec3 {
  public x: number = 0;
  public y: number = 0;
  public z: number = 0;

  constructor(x: number = 0, y: number = 0, z: number = 0) {
    this.x = x;
    this.y = y;
    this.z = z;
  }

  add(other: Vec3) {
    return new Vec3(this.x + other.x, this.y + other.y, this.z + other.z);
  }

  sub(other: Vec3) {
    return new Vec3(this.x - other.x, this.y - other.y, this.z - other.z);
  }

  length_squared() {
    return this.x * this.x + this.y * this.y + this.z * this.z;
  }

  length() {
    return Math.sqrt(this.length_squared());
  }

  normalize() {
    const length = this.length();
    return new Vec3(this.x / length, this.y / length, this.z / length);
  }

  scale(scalar: number) {
    return new Vec3(this.x * scalar, this.y * scalar, this.z * scalar);
  }

  cross(other: Vec3) {
    const x = this.y * other.z - this.z * other.y;
    const y = this.z * other.x - this.x * other.z;
    const z = this.x * other.y - this.y * other.x;
    return new Vec3(x, y, z);
  }
}

const UP = new Vec3(0, 1, 0);

export class Material {
  public albedo: Vec3;
  public metallic: number;
  public roughness: number;

  constructor(albedo: Vec3, metallic: number, roughness: number) {
    this.albedo = albedo;
    this.metallic = metallic;
    this.roughness = roughness;
  }
}

export class Sphere {
  center: Vec3;
  radius: number;
  material: Material;

  constructor(center: Vec3 = new Vec3(), radius: number = 1, material: Material) {
    this.center = center;
    this.radius = radius;
    this.material = material;
  }

  public toBuffer() {
    let buffer = new Float32Array(12);

    // Sphere data
    buffer[0] = this.center.x;
    buffer[1] = this.center.y;
    buffer[2] = this.center.z;
    buffer[3] = this.radius;

    // Material
    buffer[4] = this.material.albedo.x;
    buffer[5] = this.material.albedo.y;
    buffer[6] = this.material.albedo.z;

    buffer[7] = this.material.metallic;
    buffer[8] = this.material.roughness;

    return buffer;
  }
}

export class Camera {
  origin: Vec3;
  bottomLeft: Vec3;
  horizontal: Vec3;
  vertical: Vec3;

  constructor(origin = new Vec3(-1.0, 0.0, 0.0), lookAt = new Vec3(1.0, 0.0, 0.0), fov = 80.0, aspectRatio = 1.0) {
    this.origin = origin;

    const forward = lookAt.sub(origin).normalize();
    const right = forward.cross(UP);
    const up = right.cross(forward);
    const fovRadians = fov * (Math.PI / 180);
    const halfH = Math.tan(fovRadians / 2);
    const halfW = halfH * aspectRatio;
    this.horizontal = right.scale(2 * halfW);
    this.vertical = up.scale(2 * halfH);
    this.bottomLeft = origin.sub(right.scale(halfW)).sub(up.scale(halfH)).add(forward);
  }

  public toBuffer() {
    let buffer = new Float32Array(16);

    // Origin
    buffer[0] = this.origin.x;
    buffer[1] = this.origin.y;
    buffer[2] = this.origin.z;
    buffer[3] = 1.0; // Padding

    // Bottom Left
    buffer[4] = this.bottomLeft.x;
    buffer[5] = this.bottomLeft.y;
    buffer[6] = this.bottomLeft.z;
    buffer[7] = 1.0; // Padding

    // horizontal
    buffer[8] = this.horizontal.x;
    buffer[9] = this.horizontal.y;
    buffer[10] = this.horizontal.z;
    buffer[11] = 1.0; // Padding

    // vertical
    buffer[12] = this.vertical.x;
    buffer[13] = this.vertical.y;
    buffer[14] = this.vertical.z;
    buffer[15] = 1.0; // Last padding

    return buffer;
  }
}

export class Light {
  position: Vec3;
  color: Vec3;

  constructor(position: Vec3, color: Vec3) {
    this.position = position;
    this.color = color;
  }

  toBuffer() {
    let buffer = new Float32Array(8);

    // Position
    buffer[0] = this.position.x;
    buffer[1] = this.position.y;
    buffer[2] = this.position.z;
    buffer[3] = 1.0;

    // Color
    buffer[4] = this.color.x;
    buffer[5] = this.color.y;
    buffer[6] = this.color.z;
    buffer[7] = 1.0;

    return buffer;
  }
}

export class Scene {
  spheres: Sphere[] = [
    new Sphere(
      new Vec3(0, 0, -1),                               // Center
      0.5,                                              // Radius
      new Material(new Vec3(0.0, 0.7, 0.4), 0.1, 0.9),  // Material
    ),
    new Sphere(
      new Vec3(-1, -1, -1),                               // Center
      0.5,                                              // Radius
      new Material(new Vec3(0.1, 0.1, 0.4), 0.25, 0.3),  // Material
    ),
  ];
  camera: Camera = new Camera(
    new Vec3(0, 0, 1),   // origin
    new Vec3(0, 0, -1),  // lookAt
    60,                  // fov
    800 / 600            // aspectRatio
  );
  light: Light = new Light(
    new Vec3(1.0, 1.0, 0.5),
    new Vec3(3.0, 3.0, 3.0),
  );

  toBuffer() {
    const floatsPerSphere = 12;
    const buffer = new Float32Array(this.spheres.length * floatsPerSphere);
    this.spheres.forEach((sphere, i) => {
      buffer.set(sphere.toBuffer(), i * floatsPerSphere);
    });
    return buffer;
  }
}
