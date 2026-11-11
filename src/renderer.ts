import { fragmentSource, vertexSource } from './shaders';
import { PixelWorld, WORLD_H, WORLD_W } from './world';
import { clamp, Simulation } from './motion';

export interface Renderer {
  readonly kind: 'webgl2' | '2d';
  draw(world: PixelWorld, motion: Simulation): void;
  dispose(): void;
}

class GlassRenderer implements Renderer {
  readonly kind = 'webgl2' as const;
  private readonly program: WebGLProgram;
  private readonly vao: WebGLVertexArrayObject;
  private readonly textures: WebGLTexture[] = [];
  private readonly uniforms: Record<string, WebGLUniformLocation | null> = {};

  constructor(private readonly gl: WebGL2RenderingContext, private readonly canvas: HTMLCanvasElement) {
    const shaders: WebGLShader[] = [];
    const program = gl.createProgram();
    const vao = gl.createVertexArray();
    if (!program || !vao) {
      if (program) gl.deleteProgram(program);
      if (vao) gl.deleteVertexArray(vao);
      throw new Error('WebGL allocation failed');
    }
    this.program = program;
    this.vao = vao;
    try {
      for (const [type, source] of [[gl.VERTEX_SHADER, vertexSource], [gl.FRAGMENT_SHADER, fragmentSource]] as const) {
        const shader = gl.createShader(type);
        if (!shader) throw new Error('Shader allocation failed');
        shaders.push(shader);
        gl.shaderSource(shader, source);
        gl.compileShader(shader);
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) ?? 'Shader compilation failed');
        gl.attachShader(program, shader);
      }
      gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) ?? 'Shader linking failed');
      gl.useProgram(program);
      gl.bindVertexArray(vao);
      gl.disable(gl.DEPTH_TEST);
      gl.disable(gl.BLEND);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      for (const name of ['uResolution', 'uPosition', 'uLight', 'uStretch', 'uWobble', 'uCursor'])
        this.uniforms[name] = gl.getUniformLocation(program, name);
      for (const [i, name] of ['uScene', 'uLit', 'uGlow'].entries()) {
        const texture = gl.createTexture();
        if (!texture) throw new Error('Texture allocation failed');
        this.textures.push(texture);
        gl.activeTexture(gl.TEXTURE0 + i);
        gl.bindTexture(gl.TEXTURE_2D, texture);
        // Only the emissive buffer is filtered; both world buffers stay NEAREST.
        const filter = i === 2 ? gl.LINEAR : gl.NEAREST;
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, WORLD_W, WORLD_H, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
        gl.uniform1i(gl.getUniformLocation(program, name), i);
      }
    } catch (error) {
      this.dispose();
      throw error;
    } finally {
      for (const shader of shaders) {
        if (gl.isProgram(program)) gl.detachShader(program, shader);
        gl.deleteShader(shader);
      }
    }
  }

  draw(world: PixelWorld, motion: Simulation): void {
    const gl = this.gl;
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.useProgram(this.program);
    gl.bindVertexArray(this.vao);
    [world.scene, world.lit, world.glow].forEach((buffer, i) => {
      gl.activeTexture(gl.TEXTURE0 + i);
      gl.bindTexture(gl.TEXTURE_2D, this.textures[i]!);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, WORLD_W, WORLD_H, gl.RGBA, gl.UNSIGNED_BYTE, buffer);
    });
    gl.uniform2f(this.uniforms.uResolution!, this.canvas.width, this.canvas.height);
    gl.uniform1f(this.uniforms.uPosition!, motion.position);
    gl.uniform1f(this.uniforms.uLight!, motion.light);
    gl.uniform1f(this.uniforms.uStretch!, motion.stretch);
    gl.uniform1f(this.uniforms.uWobble!, motion.wobble);
    gl.uniform4f(this.uniforms.uCursor!, motion.cursor.x, motion.cursor.y, motion.cursor.opacity, motion.cursor.pressed);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  dispose(): void {
    this.textures.forEach(texture => this.gl.deleteTexture(texture));
    this.textures.length = 0;
    this.gl.deleteVertexArray(this.vao);
    this.gl.deleteProgram(this.program);
  }
}

class FlatRenderer implements Renderer {
  readonly kind = '2d' as const;
  private readonly context: CanvasRenderingContext2D;
  private readonly buffer = document.createElement('canvas');
  private readonly bufferContext: CanvasRenderingContext2D;
  constructor(private readonly canvas: HTMLCanvasElement) {
    const context = canvas.getContext('2d', { alpha: true });
    if (!context) throw new Error('Canvas 2D is unavailable');
    this.context = context;
    this.buffer.width = WORLD_W;
    this.buffer.height = WORLD_H;
    this.bufferContext = this.buffer.getContext('2d')!;
  }
  draw(world: PixelWorld, motion: Simulation): void {
    const ctx = this.context;
    this.bufferContext.putImageData(new ImageData(new Uint8ClampedArray(world.scene.buffer), WORLD_W, WORLD_H), 0, 0);
    ctx.resetTransform();
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.scale(this.canvas.width / 160, this.canvas.height / 84);
    ctx.imageSmoothingEnabled = false;
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(8, 10, 144, 64, 32);
    ctx.clip();
    ctx.drawImage(this.buffer, 8, 4);
    ctx.restore();
    ctx.lineWidth = 0.55;
    ctx.strokeStyle = 'rgba(245,250,231,0.65)';
    ctx.beginPath();
    ctx.roundRect(8, 10, 144, 64, 32);
    ctx.stroke();
    const x = 45 + clamp(motion.position) * 70;
    ctx.fillStyle = 'rgba(236,248,241,0.08)';
    ctx.strokeStyle = 'rgba(244,251,239,0.95)';
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.roundRect(x - 21, 6, 42, 72, 21);
    ctx.fill();
    ctx.stroke();
    ctx.strokeStyle = 'rgba(32,54,61,0.3)';
    ctx.lineWidth = 0.7;
    ctx.beginPath();
    ctx.roundRect(x - 20, 7, 40, 70, 20);
    ctx.stroke();
    if (motion.cursor.opacity > 0) {
      ctx.save();
      ctx.globalAlpha = motion.cursor.opacity;
      ctx.translate(motion.cursor.x, motion.cursor.y);
      ctx.fillStyle = '#fff9e1';
      ctx.strokeStyle = '#293c40';
      ctx.lineWidth = 0.75;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(0, 9);
      ctx.lineTo(2, 7);
      ctx.lineTo(3, 11);
      ctx.lineTo(5, 10);
      ctx.lineTo(3, 6);
      ctx.lineTo(7, 6);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }
  }
  dispose(): void {
    this.buffer.width = this.buffer.height = 0;
    this.context.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }
}

export function createRenderer(canvas: HTMLCanvasElement, force2d = false): { renderer: Renderer; canvas: HTMLCanvasElement } {
  if (!force2d) {
    const gl = canvas.getContext('webgl2', { alpha: true, antialias: false, premultipliedAlpha: true, preserveDrawingBuffer: true, depth: false, stencil: false });
    if (gl) {
      try {
        return { renderer: new GlassRenderer(gl, canvas), canvas };
      } catch {
        // A canvas cannot change context types; replace only the drawing surface.
        const replacement = canvas.cloneNode(false) as HTMLCanvasElement;
        canvas.replaceWith(replacement);
        canvas = replacement;
      }
    }
  }
  return { renderer: new FlatRenderer(canvas), canvas };
}
