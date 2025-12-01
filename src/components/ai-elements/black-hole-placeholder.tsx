"use client";
import React, { useEffect, useRef } from "react";

// Vertex shader: full screen triangle
const vertSrc = `#version 300 es\nprecision highp float;\nconst vec2 verts[3] = vec2[3](\n  vec2(-1.0,-1.0),\n  vec2(3.0,-1.0),\n  vec2(-1.0,3.0)\n);\nout vec2 vUV;\nvoid main(){\n  vec2 p = verts[gl_VertexID];\n  vUV = p * 0.5 + 0.5;\n  gl_Position = vec4(p,0.0,1.0);\n}`;

// Fragment shader – vibrant palette inspired by reference (hot orange / white disk, teal deep space)
const fragSrc = `#version 300 es\nprecision highp float;\nout vec4 fragColor;\nin vec2 vUV;\nuniform vec2 u_resolution;\nuniform float u_time;\nuniform vec2 u_mouse;\nuniform float u_intensity;\n// --- Helpers ---\nfloat hash(vec2 p){ p=fract(p*vec2(123.34,345.45)); p+=dot(p,p+34.345); return fract(p.x*p.y);}\nfloat noise(vec2 p){ vec2 i=floor(p); vec2 f=fract(p); float a=hash(i); float b=hash(i+vec2(1.,0.)); float c=hash(i+vec2(0.,1.)); float d=hash(i+vec2(1.,1.)); vec2 u=f*f*(3.-2.*f); return mix(a,b,u.x)+(c-a)*u.y*(1.-u.x)+(d-b)*u.x*u.y;}\nfloat ringWeight(float r,float c,float w){ return exp(-pow((r-c)/w,2.0)); }\nvec3 stars(vec2 uv){ vec2 g=uv*vec2(115.0,66.0); float s=step(0.997,hash(floor(g))); float tw=fract(u_time*0.55+hash(floor(g))); float twinkle=smoothstep(0.0,0.32,abs(tw-0.5)); return vec3(s*twinkle); }\n// Particle layer (orbital dust)\nfloat particleLayer(vec2 baseP, vec2 flow, float scale, float t){ float acc=0.0; for(int i=0;i<4;i++){ vec2 jitter=vec2(float(i)*19.17,float(i)*11.11); vec2 p=baseP*scale + flow*t*0.15 + jitter; vec2 cell=floor(p); vec2 f=fract(p); float h=hash(cell); float gate=step(0.77,h); float size=mix(0.12,0.36,fract(h*5.7)); float d=length(f-0.5); float core=exp(-pow(d/size,2.15)); float smear=0.70 + 0.30*dot(normalize(flow+1e-5), normalize(baseP+1e-5)); acc+=core*gate*smear;} return acc/4.0; }\nfloat particles(vec2 p, vec2 mouse, float t){ float r=length(p)+1e-4; vec2 dirIn=-normalize(p); vec2 tang=vec2(-dirIn.y,dirIn.x); float orbit=0.95/sqrt(r+0.05); float inward=0.05*(0.42-r); vec2 pm=p-mouse; float rm=length(pm)+1e-4; vec2 dirMouse=-pm/rm; float mouseMass=3.4; vec2 flow=tang*orbit + dirIn*inward + dirMouse*(mouseMass/(rm*2.0+0.12)); float l1=particleLayer(p,flow,26.0,t); float l2=particleLayer(p*1.19+3.7,flow*1.06,38.0,t*1.14); float l3=particleLayer(p*0.89-2.5,flow*0.94,17.0,t*0.80); float accRing=ringWeight(r,0.33,0.055)+0.85*ringWeight(r,0.42,0.04); float radialFade=smoothstep(0.88,0.10,r); float acc=(l1+0.85*l2+0.6*l3)*(0.32+0.68*accRing)*radialFade; acc*= (0.62+0.38*sin(t*0.9 + r*7.5)); return acc;}\nvoid main(){ vec2 uv=vUV; vec2 res=u_resolution; vec2 p=(uv-0.5); p.x*=res.x/res.y; vec2 m=u_mouse-0.5; m.x*=res.x/res.y; float r=length(p); float theta=atan(p.y,p.x); float lensStrength=0.13+0.4*u_intensity; float swirl=lensStrength/(r*r+0.05); vec2 pm=p-m; float rm=length(pm)+1e-4; float mouseSwirl=1.2/(rm*rm+0.10); swirl+=mouseSwirl*1.40; theta+=swirl; vec2 warped=vec2(cos(theta),sin(theta))*r; // Disk + photon sphere
 float diskR=0.33; float diskWidth=0.055 + 0.035*sin(u_time*0.65+u_intensity*3.5); float ring=exp(-pow((r-diskR)/diskWidth,2.0)); float turbulence=0.0; if(ring>0.001){ vec2 nUV=warped*8.0 + vec2(u_time*0.23,u_time*0.18); turbulence=noise(nUV)*noise(nUV*1.7+20.0);} float disk=ring*(0.55+0.45*turbulence)*(1.0+u_intensity*0.85); float horizon=smoothstep(0.27,0.25,r); // Background color field (deep teal to desaturated orange gradient)
 vec2 bgCoord=warped*0.9+0.5; vec3 starBG=stars(bgCoord); float neb=noise(warped*2.0+u_time*0.05); vec3 deepTeal=vec3(0.02,0.10,0.14); vec3 farOrange=vec3(0.25,0.10,0.02); vec3 grad=mix(deepTeal, farOrange, smoothstep(-0.3,0.7,p.y)); vec3 nebula=grad + vec3(0.12,0.04,0.20)*neb*0.5; vec3 spaceCol=nebula + starBG*1.2; // Hot disk colors
 vec3 warmCore=vec3(2.6,1.3,0.45); vec3 hotWhite=vec3(5.0); float beaming=0.55+0.45*sin(theta+u_time*0.8); vec3 diskCol=mix(warmCore, hotWhite, clamp(beaming*0.9,0.0,1.0))*disk; // Relativistic shift
 float shift=clamp(swirl*0.18,-0.55,0.55); vec3 shifted=vec3(spaceCol.r*(1.0+shift*0.7), spaceCol.g, spaceCol.b*(1.0-shift*0.7)); // Orbital dust
 float t=u_time; float dust=particles(p,m,t)*(0.8+0.8*u_intensity); vec3 dustCol=vec3(1.8,1.2,0.6)*pow(dust,0.85); // Lensing halo / arcs
 float photonHalo=ringWeight(r,0.42,0.035); vec3 haloCol=vec3(3.0,2.0,0.9)*photonHalo*(0.6+0.4*u_intensity); float arc = smoothstep(0.02,0.0, abs(r-0.48+0.02*sin(theta*5.0+u_time*0.4)) ) * 0.22; vec3 arcCol=vec3(1.4,0.9,0.4)*arc; // Composite
 vec3 col=shifted + diskCol + dustCol + haloCol + arcCol; col*=(1.0-horizon); // Radial glow feather
 col += vec3(1.6,1.0,0.55) * smoothstep(0.38,0.30,r) * 0.25; // Vignette
 float vign=smoothstep(0.97,0.25,length(uv-0.5)); col*=vign; // Tone map & gamma
 col=col/(1.0+col*0.65); col=pow(col, vec3(0.92)); // Fading guide text highlight
 float guide=1.0-smoothstep(0.0,0.5,u_intensity); col += vec3(1.4,1.1,0.8)*guide*smoothstep(0.0,0.22,r)*0.18; fragColor=vec4(col,1.0); }`;

interface BlackHolePlaceholderProps {
  input: string;
}

// A fancy WebGL fragment shader simulating a black hole event horizon with
// gravitational lensing, accretion disk glow, star field and mild chromatic aberration.
// Reacts to mouse (moves lens center) and input length (intensity / turbulence).
export const BlackHolePlaceholder: React.FC<BlackHolePlaceholderProps> = ({ input }) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const mouseRef = useRef({ x: 0.5, y: 0.5 });
  const rafRef = useRef<number | null>(null);
  const programRef = useRef<WebGLProgram | null>(null);
  const uniformsRef = useRef<Record<string, WebGLUniformLocation | null>>({});
  const startRef = useRef<number>(performance.now());

  // (Moved shader source constants outside component scope for stable references)

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const gl = canvas.getContext("webgl2", { antialias: false, depth: false, stencil: false });
    if (!gl) {
      // Fallback: simple CSS gradient background
      canvas.style.background = "radial-gradient(circle at 50% 50%, #222 0%, #000 70%)";
      return;
    }

    const compile = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
        console.error("Shader compile error", gl.getShaderInfoLog(s));
      }
      return s;
    };
    const vs = compile(gl.VERTEX_SHADER, vertSrc);
    const fs = compile(gl.FRAGMENT_SHADER, fragSrc);
    const prog = gl.createProgram();
    if (!prog) return;
    gl.attachShader(prog, vs); gl.attachShader(prog, fs); gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      console.error("Program link error", gl.getProgramInfoLog(prog));
      return;
    }
    programRef.current = prog;
    gl.useProgram(prog);
    uniformsRef.current = {
      u_resolution: gl.getUniformLocation(prog, "u_resolution"),
      u_time: gl.getUniformLocation(prog, "u_time"),
      u_mouse: gl.getUniformLocation(prog, "u_mouse"),
      u_intensity: gl.getUniformLocation(prog, "u_intensity"),
    };

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      gl.viewport(0, 0, canvas.width, canvas.height);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    const render = () => {
      const t = (performance.now() - startRef.current) / 1000;
      gl.useProgram(programRef.current);
      gl.uniform2f(uniformsRef.current.u_resolution, canvas.width, canvas.height);
      gl.uniform1f(uniformsRef.current.u_time, t);
      gl.uniform2f(uniformsRef.current.u_mouse, mouseRef.current.x, 1.0 - mouseRef.current.y); // flip Y
      const len = input.length;
      const intensity = Math.min(1, len / 120);
      gl.uniform1f(uniformsRef.current.u_intensity, intensity * (0.4 + 0.6 * Math.abs(Math.sin(t * 0.75))));
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      rafRef.current = requestAnimationFrame(render);
    };
    rafRef.current = requestAnimationFrame(render);

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      ro.disconnect();
      gl.deleteProgram(programRef.current!);
      gl.deleteShader(vs); gl.deleteShader(fs);
    };
  }, [input]);

  useEffect(() => {
    const handleMove = (e: MouseEvent) => {
      const rect = canvasRef.current?.getBoundingClientRect();
      if (!rect) return;
      mouseRef.current.x = (e.clientX - rect.left) / rect.width;
      mouseRef.current.y = (e.clientY - rect.top) / rect.height;
    };
    window.addEventListener("mousemove", handleMove);
    return () => window.removeEventListener("mousemove", handleMove);
  }, []);

  return (
    <div className="absolute inset-0 flex items-center justify-center select-none overflow-hidden pointer-events-none ring-1 ring-primary/20 shadow-[0_0_0_1px_rgba(255,255,255,0.03),0_4px_30px_-6px_rgba(0,0,0,0.6),0_0_40px_-10px_hsl(var(--primary)/0.35)] bg-[radial-gradient(circle_at_50%_50%,hsl(var(--secondary)/0.15),transparent_65%),linear-gradient(140deg,hsl(var(--primary)/0.15),hsl(var(--chart-2)/0.08),hsl(var(--chart-3)/0.05))] backdrop-blur-sm">
      <canvas ref={canvasRef} className="w-full h-full block rounded-[inherit]" />
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-6 rounded-[inherit]">
        <h2 className="text-lg md:text-2xl font-semibold tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-[hsl(var(--primary))] via-[hsl(var(--secondary))] to-[hsl(var(--chart-2))] drop-shadow-[0_2px_6px_rgba(0,0,0,0.6)]">
          Enter the Event Horizon
        </h2>
        <p className="mt-3 max-w-md text-s md:text-sm text-[hsl(var(--secondary-foreground))] font-semibold leading-relaxed">
          Your conversation singularity awaits. Type to energize the accretion disk or move your cursor to bend spacetime.
        </p>
        <div className="mt-5 flex gap-2 opacity-70">
          <span className="h-1 w-16 rounded-full bg-gradient-to-r from-[hsl(var(--primary))] via-[hsl(var(--secondary))] to-[hsl(var(--chart-2))] animate-pulse" />
        </div>
      </div>
    </div>
  );
};

export default BlackHolePlaceholder;
