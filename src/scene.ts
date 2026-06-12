class Vec3 {
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

class Sphere {
  center: Vec3;
  radius: number;

  constructor(center: Vec3 = new Vec3(), radius: number = 1) {
    this.center = center;
    this.radius = radius;
  }

  toBuffer() {
    let buffer = new Float32Array(4);

    buffer[0] = this.center.x;
    buffer[1] = this.center.y;
    buffer[2] = this.center.z;
    buffer[3] = this.radius;

    return buffer;
  }
}

class Camera {
  origin: Vec3;
  lookAt: Vec3;
  forward: Vec3;
  right: Vec3;
  up: Vec3;
  fov: number;
  aspectRatio: number = 1.0;
  halfH: number;
  halfW: number;

  horizontal: Vec3;
  vertical: Vec3;
  bottomLeft: Vec3;

  constructor(origin = new Vec3(-1.0, 0.0, 0.0), lookAt = new Vec3(1.0, 0.0, 0.0), fov = 80.0, aspectRatio = 1.0) {
    this.origin = origin;
    this.lookAt = lookAt;
    this.fov = fov;
    this.aspectRatio = aspectRatio;
    this.forward = lookAt.sub(origin).normalize();
    this.right = UP.cross(this.forward);
    this.up = this.right.cross(this.forward);
    this.halfH = Math.tan(fov / 2);
    this.halfW = this.halfH * aspectRatio;
    this.horizontal = this.right.scale(2 * this.halfW);
    this.vertical = this.up.scale(2 * this.halfH);
    this.bottomLeft = origin.sub(this.right.scale(this.halfW)).sub(this.up.scale(this.halfH)).sub(this.forward);
  }

  toBuffer() {
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

class Scene {
  sphere: Sphere = new Sphere();
  camera: Camera = new Camera();
}