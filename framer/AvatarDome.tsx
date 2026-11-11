import * as React from "react"
import type { CSSProperties } from "react"
import { addPropertyControls, ControlType, useIsStaticRenderer } from "framer"

/* ---------- Defaults (same values as the standalone demo) ---------- */

const DEFAULT_IMAGE = {
    src: "https://framerusercontent.com/images/b5xlX8MJJGzRv7Xv3TYrxwr7G6E.jpg",
    alt: "Omotayo Taiwo",
}

// DialKit (Josh Puckett, MIT): vanilla ES module build, pinned. Loaded only on the live site and in Preview.
const DIALKIT_JS = "https://cdn.jsdelivr.net/npm/dialkit@2.1.0/dist/vanilla/index.js"
const DIALKIT_CSS = "https://cdn.jsdelivr.net/npm/dialkit@2.1.0/dist/vanilla/styles.css"

const DEFAULTS = {
    inspector: true,
    inspectorPosition: "top-right" as "top-right" | "top-left" | "bottom-right" | "bottom-left",
    avatarSize: 240,
    label: "Avatar. Press to send a ripple",
    hint: "Click the avatar",
    previewInEditor: true,
    ring: { duration: 2.4, easeOut: 2.5, fadeStart: 0.6, startWidth: 0.22, endWidth: 150 },
    refraction: { bend: 0.55, colourSplit: 0.1 },
    band: {
        coreWidth: 0.22,
        featherWidth: 0.6,
        featherAmount: 0.22,
        brightness: 0.7,
        rainbowRepeats: 1.6,
        rainbowDrift: 0.25,
    },
    background: { ground: "#1b1b1c", dotSpacing: 7, dotBrightness: 0.075 },
    avatar: {
        maxTilt: 12,
        pressScale: 0.93,
        tiltSpring: { type: "spring" as const, stiffness: 170, damping: 22, mass: 1 },
        releaseSpring: { type: "spring" as const, stiffness: 420, damping: 16, mass: 1 },
        foilOpacity: 0.55,
        glareOpacity: 1,
    },
}

type SpringValue = { type?: string; stiffness?: number; damping?: number; mass?: number; duration?: number; bounce?: number }

interface AvatarDomeProps {
    inspector?: boolean
    inspectorPosition?: "top-right" | "top-left" | "bottom-right" | "bottom-left"
    image?: { src?: string; srcSet?: string; alt?: string }
    avatarSize?: number
    label?: string
    hint?: string
    previewInEditor?: boolean
    ring?: Partial<typeof DEFAULTS.ring>
    refraction?: Partial<typeof DEFAULTS.refraction>
    band?: Partial<typeof DEFAULTS.band>
    background?: Partial<typeof DEFAULTS.background>
    avatar?: Partial<Omit<typeof DEFAULTS.avatar, "tiltSpring" | "releaseSpring">> & {
        tiltSpring?: SpringValue
        releaseSpring?: SpringValue
    }
    style?: CSSProperties
}

/* ---------- Shader ---------- */

const MAX = 4 // rings alive at once

const VERT = `
attribute vec2 a;
void main() { gl_Position = vec4(a, 0.0, 1.0); }
`

const FRAG = `
precision highp float;
uniform vec2  uRes;      // device px
uniform float uDpr;
uniform vec2  uCenter;   // avatar centre, css px from the component's top-left, y down
uniform float uAvatarR;  // css px
uniform float uMaxR;     // css px
uniform float uTime;
uniform float uDur;
uniform float uReduce;   // 1 = reduced motion: ring holds still and only fades
uniform float uStarts[${MAX}];

uniform float uEase, uFadeStart, uThickStart, uThickEnd;
uniform float uRefract, uChroma;
uniform float uBandW, uHaloW, uHaloAmt, uGlow, uHueSpread, uHueSpeed;
uniform vec3  uGround;
uniform float uDotSpacing, uDotAmt;

// Dark ground, dot grid, faded by a blurred ellipse up and left of the avatar.
vec3 background(vec2 p) {
  float frameSize = uAvatarR * 2.0 * (1257.0 / 325.0);
  vec2 q = (p - uCenter) / frameSize + 0.5;
  float e = length((q - vec2(0.406, 0.173)) / vec2(0.387, 0.443));
  float mask = 1.0 - smoothstep(0.55, 1.35, e);

  vec2 g = mod(p, uDotSpacing) - uDotSpacing * 0.5;
  float dot = 1.0 - smoothstep(0.55, 1.25, length(g));

  vec3 base = uGround + 0.012 * (1.0 - clamp(p.y / (uRes.y / uDpr), 0.0, 1.0));
  return base + dot * mask * vec3(uDotAmt, uDotAmt, uDotAmt * 1.07);
}

vec3 iridescent(float t) {
  return 0.5 + 0.5 * cos(6.28318 * (t + vec3(0.0, 0.33, 0.67)));
}

void main() {
  vec2 p = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y) / uDpr;

  vec2 offR = vec2(0.0), offG = vec2(0.0), offB = vec2(0.0);
  vec3 glow = vec3(0.0);

  for (int i = 0; i < ${MAX}; i++) {
    float start = uStarts[i];
    if (start < 0.0) continue;
    float prog = (uTime - start) / uDur;
    if (prog < 0.0 || prog > 1.0) continue;

    float grow = mix(1.0 - pow(1.0 - prog, uEase), 0.35, uReduce);
    // Starts as a point at the avatar centre; the tube thickens as the ring travels
    float w = mix(uAvatarR * uThickStart, max(uAvatarR * 0.9, uThickEnd), grow);
    float R = mix(0.0, uMaxR + w, grow);

    vec2 v = p - uCenter;
    float dist = length(v);
    vec2 dir = dist > 0.0 ? v / dist : vec2(0.0);
    float ang = atan(v.y, v.x);

    float s = (dist - R) / w;   // -1 inner edge, 0 crest, +1 outer edge
    float as = abs(s);
    if (as > 1.0) continue;

    float h = sqrt(max(0.0, 1.0 - as * as));
    float feather = 1.0 - smoothstep(0.45, 1.0, as);
    float life = smoothstep(0.0, 0.012, prog) * (1.0 - smoothstep(uFadeStart, 1.0, prog));
    float k = feather * life;

    // The tube acts like a convex lens, pulling the background toward its crest
    float amp = min(w, 140.0) * uRefract;
    vec2 o = -dir * s * (0.6 + (1.0 - h) * 1.2) * amp * k;
    offR += o * (1.0 + uChroma);
    offG += o;
    offB += o * (1.0 - uChroma);

    // Tight rainbow core on the crest, feathered toward both edges
    float band = exp(-pow(s / uBandW, 2.0));
    float halo = exp(-pow(s / uHaloW, 2.0)) * uHaloAmt;
    float phase = s * uHueSpread + ang * 0.159 + uTime * uHueSpeed + float(i) * 0.37;
    glow += iridescent(phase) * (band + halo) * life;
  }

  vec3 col;
  col.r = background(p + offR).r;
  col.g = background(p + offG).g;
  col.b = background(p + offB).b;
  col += glow * uGlow;

  gl_FragColor = vec4(col, 1.0);
}
`

const UNIFORMS = [
    "uRes", "uDpr", "uCenter", "uAvatarR", "uMaxR", "uTime", "uDur", "uReduce", "uStarts",
    "uEase", "uFadeStart", "uThickStart", "uThickEnd", "uRefract", "uChroma",
    "uBandW", "uHaloW", "uHaloAmt", "uGlow", "uHueSpread", "uHueSpeed",
    "uGround", "uDotSpacing", "uDotAmt",
] as const

/* ---------- Helpers ---------- */

// Framer colours can be hex, rgb() or rgba(); let the browser normalise them.
let colorCtx: CanvasRenderingContext2D | null = null
function colorToRgb(color: string): [number, number, number] {
    if (!colorCtx) colorCtx = document.createElement("canvas").getContext("2d")
    if (!colorCtx) return [0.106, 0.106, 0.11]
    colorCtx.fillStyle = "#000"
    colorCtx.fillStyle = color
    const c = colorCtx.fillStyle as string
    if (c.startsWith("#")) {
        const n = parseInt(c.slice(1), 16)
        return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]
    }
    const m = c.match(/[\d.]+/g) || ["27", "27", "28"]
    return [Number(m[0]) / 255, Number(m[1]) / 255, Number(m[2]) / 255]
}

type Physics = { stiffness: number; damping: number; mass: number }

// Framer's transition control returns physics (stiffness/damping/mass)
// or time-based (duration/bounce) springs. Turn both into physics.
function toPhysics(sp: any, fallback: Physics): Physics {
    if (!sp) return fallback
    if (sp.stiffness != null) {
        return { stiffness: sp.stiffness, damping: sp.damping ?? fallback.damping, mass: sp.mass ?? 1 }
    }
    const d = sp.visualDuration ?? sp.duration
    if (d != null && d > 0) {
        const root = (2 * Math.PI) / (d * 1.2)
        const stiffness = root * root
        const damping = 2 * Math.min(1, Math.max(0.05, 1 - (sp.bounce ?? 0))) * Math.sqrt(stiffness)
        return { stiffness, damping, mass: 1 }
    }
    return fallback
}

/* ---------- DialKit inspector ---------- */

type Settings = Pick<typeof DEFAULTS, "ring" | "refraction" | "band" | "background"> & {
    avatar: typeof DEFAULTS.avatar & { tiltSpring: any; releaseSpring: any }
}

// Same labels and ranges as the standalone demo's panel. DialKit uses keys as labels.
function dialConfig(s: Settings) {
    return {
        "Send a ring": { type: "action" },
        "Ring motion": {
            "Duration (s)": [s.ring.duration, 0.6, 6, 0.1],
            "Ease-out strength": [s.ring.easeOut, 1, 6, 0.1],
            "Fade starts at": [s.ring.fadeStart, 0, 0.95, 0.01],
            "Start width (× avatar)": [s.ring.startWidth, 0.05, 1, 0.01],
            "End width (px)": [s.ring.endWidth, 40, 400, 1],
        },
        Refraction: {
            "Bend strength": [s.refraction.bend, 0, 2, 0.01],
            "Colour split": [s.refraction.colourSplit, 0, 0.5, 0.01],
        },
        "Colour band": {
            "Core width": [s.band.coreWidth, 0.03, 1, 0.01],
            "Feather width": [s.band.featherWidth, 0.1, 1.5, 0.01],
            "Feather amount": [s.band.featherAmount, 0, 1, 0.01],
            Brightness: [s.band.brightness, 0, 2, 0.01],
            "Rainbow repeats": [s.band.rainbowRepeats, 0, 6, 0.05],
            "Rainbow drift": [s.band.rainbowDrift, 0, 2, 0.01],
        },
        Background: {
            Ground: s.background.ground.startsWith("#") ? s.background.ground : "#1b1b1c",
            "Dot spacing (px)": [s.background.dotSpacing, 3, 24, 0.5],
            "Dot brightness": [s.background.dotBrightness, 0, 0.3, 0.005],
        },
        Avatar: {
            "Max tilt (°)": [s.avatar.maxTilt, 0, 30, 0.5],
            "Press scale": [s.avatar.pressScale, 0.8, 1, 0.005],
            "Tilt spring": { type: "spring", ...toPhysics(s.avatar.tiltSpring, DEFAULTS.avatar.tiltSpring) },
            "Release spring": { type: "spring", ...toPhysics(s.avatar.releaseSpring, DEFAULTS.avatar.releaseSpring) },
            "Foil opacity": [s.avatar.foilOpacity, 0, 1, 0.01],
            "Glare opacity": [s.avatar.glareOpacity, 0, 1, 0.01],
        },
        "Reset to defaults": { type: "action" },
    }
}

function fromPanel(v: any): Settings {
    const ring = v["Ring motion"], lens = v["Refraction"], band = v["Colour band"]
    const bg = v["Background"], av = v["Avatar"]
    return {
        ring: {
            duration: ring["Duration (s)"],
            easeOut: ring["Ease-out strength"],
            fadeStart: ring["Fade starts at"],
            startWidth: ring["Start width (× avatar)"],
            endWidth: ring["End width (px)"],
        },
        refraction: { bend: lens["Bend strength"], colourSplit: lens["Colour split"] },
        band: {
            coreWidth: band["Core width"],
            featherWidth: band["Feather width"],
            featherAmount: band["Feather amount"],
            brightness: band["Brightness"],
            rainbowRepeats: band["Rainbow repeats"],
            rainbowDrift: band["Rainbow drift"],
        },
        background: { ground: bg["Ground"], dotSpacing: bg["Dot spacing (px)"], dotBrightness: bg["Dot brightness"] },
        avatar: {
            maxTilt: av["Max tilt (°)"],
            pressScale: av["Press scale"],
            tiltSpring: av["Tilt spring"],
            releaseSpring: av["Release spring"],
            foilOpacity: av["Foil opacity"],
            glareOpacity: av["Glare opacity"],
        },
    }
}

const CSS = `
.ad-avatar { position: relative; display: block; width: 100%; height: 100%; border-radius: 50%;
  border: 0; padding: 0; overflow: hidden; cursor: pointer; will-change: transform; touch-action: manipulation;
  box-shadow: 0 0 0 1px rgba(255,255,255,0.1), 0 30px 60px -20px rgba(0,0,0,0.7), 0 0 80px -10px rgba(140,200,70,0.18);
  -webkit-mask-image: -webkit-radial-gradient(white, black); -webkit-tap-highlight-color: transparent; }
.ad-avatar:focus-visible { outline: 2px solid #b9a7ff; outline-offset: 6px; }
.ad-holo, .ad-glare { position: absolute; inset: 0; border-radius: 50%; pointer-events: none; opacity: 0;
  transition: opacity 220ms cubic-bezier(0.23, 1, 0.32, 1); --mx: 50%; --my: 50%; }
.ad-holo {
  background: repeating-linear-gradient(var(--angle, 120deg),
    #ff6fd8 0%, #ffd56b 3%, #7dffb6 6%, #6fd6ff 9%, #a98bff 12%, #ff6fd8 15%);
  background-size: 200% 200%; background-position: var(--bx, 50%) var(--by, 50%);
  mix-blend-mode: hard-light;
  -webkit-mask-image: radial-gradient(circle at var(--mx) var(--my), #000 0%, rgba(0,0,0,0.6) 28%, transparent 68%);
          mask-image: radial-gradient(circle at var(--mx) var(--my), #000 0%, rgba(0,0,0,0.6) 28%, transparent 68%); }
.ad-glare {
  background: radial-gradient(circle at var(--mx) var(--my), rgba(255,255,255,0.65) 0%, rgba(255,255,255,0.18) 18%, transparent 46%);
  mix-blend-mode: overlay; }
.ad-avatar.is-lit .ad-holo { opacity: var(--holo-opacity, 0.55); }
.ad-avatar.is-lit .ad-glare { opacity: var(--glare-opacity, 1); }
.ad-hint { position: absolute; left: 0; right: 0; bottom: 28px; margin: 0; text-align: center;
  font: 500 12px/1.4 ui-sans-serif, -apple-system, "Helvetica Neue", sans-serif;
  letter-spacing: 0.08em; text-transform: uppercase; color: #8a8791; pointer-events: none;
  transition: opacity 300ms cubic-bezier(0.23, 1, 0.32, 1); }
.ad-hint.is-gone { opacity: 0; }
`

/* ---------- Component ---------- */

/**
 * Avatar Dome
 * Hover tilts the avatar like a holographic sticker. Click sends an
 * iridescent liquid ring out from behind it, bending the dotted background.
 *
 * @framerIntrinsicWidth 1200
 * @framerIntrinsicHeight 800
 *
 * @framerSupportedLayoutWidth any-prefer-fixed
 * @framerSupportedLayoutHeight any-prefer-fixed
 */
export default function AvatarDome(props: AvatarDomeProps) {
    const { image = DEFAULT_IMAGE } = props
    // Merge each group so a missing field never breaks the shader
    const p = {
        ...DEFAULTS,
        ...props,
        image,
        ring: { ...DEFAULTS.ring, ...props.ring },
        refraction: { ...DEFAULTS.refraction, ...props.refraction },
        band: { ...DEFAULTS.band, ...props.band },
        background: { ...DEFAULTS.background, ...props.background },
        avatar: { ...DEFAULTS.avatar, ...props.avatar },
    }

    const rootRef = React.useRef<HTMLDivElement>(null)
    const canvasRef = React.useRef<HTMLCanvasElement>(null)
    const tiltRef = React.useRef<HTMLDivElement>(null)
    const avatarRef = React.useRef<HTMLButtonElement>(null)
    const holoRef = React.useRef<HTMLSpanElement>(null)
    const glareRef = React.useRef<HTMLSpanElement>(null)
    const hintRef = React.useRef<HTMLParagraphElement>(null)

    // The render loop reads the latest props from here, so changing a control never restarts WebGL
    const propsRef = React.useRef(p)
    propsRef.current = p
    const redrawRef = React.useRef<() => void>(() => {})
    // Values from the DialKit panel, when it's showing. They override the Framer controls.
    const panelRef = React.useRef<Settings | null>(null)

    // Canvas, export and thumbnails get a still frame; preview and the live site are interactive
    const isEditor = useIsStaticRenderer()

    React.useEffect(() => {
        const root = rootRef.current!
        const canvas = canvasRef.current!
        const tiltBox = tiltRef.current!
        const avatar = avatarRef.current!
        const holo = holoRef.current!
        const glare = glareRef.current!

        const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches
        const finePointer = matchMedia("(hover: hover) and (pointer: fine)").matches
        const P = () => (panelRef.current ? { ...propsRef.current, ...panelRef.current } : propsRef.current)
        const duration = () => (reduceMotion ? Math.min(P().ring.duration, 0.9) : P().ring.duration)

        /* WebGL setup */
        const gl = canvas.getContext("webgl", { antialias: false })
        const u: Record<string, WebGLUniformLocation | null> = {}
        if (gl) {
            const compile = (type: number, src: string) => {
                const s = gl.createShader(type)!
                gl.shaderSource(s, src)
                gl.compileShader(s)
                if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) || "shader")
                return s
            }
            const prog = gl.createProgram()!
            gl.attachShader(prog, compile(gl.VERTEX_SHADER, VERT))
            gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FRAG))
            gl.linkProgram(prog)
            gl.useProgram(prog)
            gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer())
            gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)
            const loc = gl.getAttribLocation(prog, "a")
            gl.enableVertexAttribArray(loc)
            gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0)
            for (const name of UNIFORMS) u[name] = gl.getUniformLocation(prog, name)
            gl.uniform1f(u.uReduce, reduceMotion ? 1 : 0)
        }

        const starts = new Float32Array(MAX).fill(-1)
        let slot = 0
        let dpr = 1
        let geo = { cx: 0, cy: 0, ar: 1, maxR: 1, rect: tiltBox.getBoundingClientRect() }
        const t0 = performance.now()
        let frozenTime: number | null = null
        const now = () => frozenTime ?? (performance.now() - t0) / 1000

        // Layout is read on resize only. The tilt box is never transformed.
        function measure() {
            const r = root.getBoundingClientRect()
            const t = tiltBox.getBoundingClientRect()
            // Use offset sizes so Framer's canvas zoom doesn't skew the numbers
            const w = root.offsetWidth || 1
            const h = root.offsetHeight || 1
            const scale = r.width / w || 1
            const cx = (t.left - r.left) / scale + tiltBox.offsetWidth / 2
            const cy = (t.top - r.top) / scale + tiltBox.offsetHeight / 2
            const far = Math.max(Math.hypot(cx, cy), Math.hypot(w - cx, cy), Math.hypot(cx, h - cy), Math.hypot(w - cx, h - cy))
            geo = { cx, cy, ar: tiltBox.offsetWidth / 2, maxR: far, rect: t }
            return { w, h }
        }

        function resize() {
            dpr = Math.min(window.devicePixelRatio || 1, 2)
            const { w, h } = measure()
            canvas.width = Math.round(w * dpr)
            canvas.height = Math.round(h * dpr)
            if (gl) {
                gl.viewport(0, 0, canvas.width, canvas.height)
                gl.uniform2f(u.uRes, canvas.width, canvas.height)
                gl.uniform1f(u.uDpr, dpr)
                gl.uniform2f(u.uCenter, geo.cx, geo.cy)
                gl.uniform1f(u.uAvatarR, geo.ar)
                gl.uniform1f(u.uMaxR, geo.maxR)
            }
            drawGL()
        }

        function pushSettings() {
            if (!gl) return
            const { ring, refraction, band, background } = P()
            gl.uniform1f(u.uDur, duration())
            gl.uniform1f(u.uEase, ring.easeOut)
            gl.uniform1f(u.uFadeStart, Math.min(ring.fadeStart, 0.99))
            gl.uniform1f(u.uThickStart, ring.startWidth)
            gl.uniform1f(u.uThickEnd, ring.endWidth)
            gl.uniform1f(u.uRefract, refraction.bend)
            gl.uniform1f(u.uChroma, refraction.colourSplit)
            gl.uniform1f(u.uBandW, band.coreWidth)
            gl.uniform1f(u.uHaloW, band.featherWidth)
            gl.uniform1f(u.uHaloAmt, band.featherAmount)
            gl.uniform1f(u.uGlow, band.brightness)
            gl.uniform1f(u.uHueSpread, band.rainbowRepeats)
            gl.uniform1f(u.uHueSpeed, band.rainbowDrift)
            gl.uniform3fv(u.uGround, colorToRgb(background.ground))
            gl.uniform1f(u.uDotSpacing, Math.max(1, background.dotSpacing))
            gl.uniform1f(u.uDotAmt, background.dotBrightness)
        }

        function drawGL() {
            if (!gl) return
            pushSettings()
            gl.uniform1f(u.uTime, now())
            gl.uniform1fv(u.uStarts, starts)
            gl.drawArrays(gl.TRIANGLES, 0, 3)
        }

        const ringsAlive = () => {
            const t = now()
            return frozenTime == null && starts.some((s) => s >= 0 && t - s < duration())
        }

        /* Avatar springs: tilt + press scale */
        const tiltX = { x: 0, v: 0, target: 0 }
        const tiltY = { x: 0, v: 0, target: 0 }
        const scale = { x: 1, v: 0, target: 1 }
        let pressed = false

        function stepSpring(s: typeof tiltX, k: number, c: number, dt: number, m = 1) {
            const a = (-k * (s.x - s.target) - c * s.v) / m
            s.v += a * dt
            s.x += s.v * dt
        }
        const settled = (s: typeof tiltX) => Math.abs(s.x - s.target) < 0.0005 && Math.abs(s.v) < 0.0005

        function stepAvatar(dt: number) {
            const ts = toPhysics(P().avatar.tiltSpring, DEFAULTS.avatar.tiltSpring as Physics)
            const rs = toPhysics(P().avatar.releaseSpring, DEFAULTS.avatar.releaseSpring as Physics)
            stepSpring(tiltX, ts.stiffness, ts.damping, dt, ts.mass)
            stepSpring(tiltY, ts.stiffness, ts.damping, dt, ts.mass)
            if (pressed) stepSpring(scale, 900, 50, dt)
            else stepSpring(scale, rs.stiffness, rs.damping, dt, rs.mass)
            avatar.style.transform = `perspective(700px) rotateX(${tiltX.x.toFixed(3)}deg) rotateY(${tiltY.x.toFixed(3)}deg) scale(${scale.x.toFixed(4)})`
            return !(settled(tiltX) && settled(tiltY) && settled(scale))
        }

        /* One frame loop for everything */
        let raf = 0
        let last = 0
        function tick(ts: number) {
            const dt = Math.min(0.032, last ? (ts - last) / 1000 : 0.016)
            last = ts
            const avatarMoving = stepAvatar(dt)
            const rings = ringsAlive()
            if (rings) drawGL()
            if (avatarMoving || rings) raf = requestAnimationFrame(tick)
            else {
                raf = 0
                last = 0
                drawGL()
            }
        }
        const wake = () => {
            if (!raf) raf = requestAnimationFrame(tick)
        }

        /* Pointer: tilt and sticker light */
        function setLight(px: number, py: number) {
            const mx = `${(px * 100).toFixed(2)}%`
            const my = `${(py * 100).toFixed(2)}%`
            for (const el of [holo, glare]) {
                el.style.setProperty("--mx", mx)
                el.style.setProperty("--my", my)
            }
            holo.style.setProperty("--bx", mx)
            holo.style.setProperty("--by", my)
            holo.style.setProperty("--angle", `${(100 + (px - 0.5) * 60).toFixed(1)}deg`)
        }

        const onEnter = () => {
            geo.rect = tiltBox.getBoundingClientRect()
        }
        const onMove = (e: PointerEvent) => {
            const r = geo.rect
            const px = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width))
            const py = Math.min(1, Math.max(0, (e.clientY - r.top) / r.height))
            setLight(px, py)
            avatar.classList.add("is-lit")
            if (!reduceMotion) {
                const max = P().avatar.maxTilt
                tiltY.target = (px - 0.5) * 2 * max
                tiltX.target = -(py - 0.5) * 2 * max
                wake()
            }
        }
        const onLeave = () => {
            avatar.classList.remove("is-lit")
            tiltX.target = 0
            tiltY.target = 0
            wake()
        }

        /* Press + ring */
        const press = () => {
            pressed = true
            scale.target = reduceMotion ? 0.98 : P().avatar.pressScale
            wake()
        }
        const release = () => {
            pressed = false
            scale.target = 1
            wake()
        }
        const onClick = (e: MouseEvent) => {
            if (e.detail === 0) {
                press()
                setTimeout(release, 120)
            }
            starts[slot] = now()
            slot = (slot + 1) % MAX
            hintRef.current?.classList.add("is-gone")
            wake()
        }

        // Editor preview: pick the moment when the ring's crest sits just outside the avatar,
        // so the still frame shows a ring at any frame size.
        function freezePreview() {
            starts.fill(-1)
            frozenTime = null
            if (!P().previewInEditor) return
            const { ring } = P()
            const target = geo.ar * 1.9
            let g = 0.3
            for (let i = 0; i < 8; i++) {
                const w = geo.ar * ring.startWidth + (Math.max(geo.ar * 0.9, ring.endWidth) - geo.ar * ring.startWidth) * g
                g = Math.min(0.95, target / (geo.maxR + w))
            }
            const prog = 1 - Math.pow(1 - g, 1 / ring.easeOut)
            frozenTime = 10
            starts[0] = frozenTime - duration() * Math.min(prog, Math.max(0, ring.fadeStart - 0.01))
        }

        // In the Framer editor, show a still frame; on the live site, wire up interaction.
        if (isEditor) {
            measure()
            freezePreview()
        } else {
            if (finePointer) {
                tiltBox.addEventListener("pointerenter", onEnter)
                tiltBox.addEventListener("pointermove", onMove)
                tiltBox.addEventListener("pointerleave", onLeave)
            }
            avatar.addEventListener("pointerdown", press)
            avatar.addEventListener("pointerup", release)
            avatar.addEventListener("pointerleave", release)
            avatar.addEventListener("pointercancel", release)
            avatar.addEventListener("blur", release)
            avatar.addEventListener("click", onClick)
        }

        const onResize = () => {
            if (isEditor) {
                measure()
                freezePreview()
            }
            resize()
        }
        const ro = new ResizeObserver(onResize)
        ro.observe(root)
        ro.observe(tiltBox)
        onResize()

        redrawRef.current = () => {
            if (isEditor) onResize()
            else if (!raf) drawGL()
        }

        return () => {
            cancelAnimationFrame(raf)
            ro.disconnect()
            tiltBox.removeEventListener("pointerenter", onEnter)
            tiltBox.removeEventListener("pointermove", onMove)
            tiltBox.removeEventListener("pointerleave", onLeave)
            avatar.removeEventListener("pointerdown", press)
            avatar.removeEventListener("pointerup", release)
            avatar.removeEventListener("pointerleave", release)
            avatar.removeEventListener("pointercancel", release)
            avatar.removeEventListener("blur", release)
            avatar.removeEventListener("click", onClick)
            redrawRef.current = () => {}
            gl?.getExtension("WEBGL_lose_context")?.loseContext()
        }
    }, [isEditor])

    // Redraw after any prop change (cheap; WebGL is not rebuilt)
    React.useEffect(() => {
        redrawRef.current()
    })

    // DialKit inspector: live site and Preview only. Starts from the Framer control values.
    const showInspector = p.inspector && !isEditor
    React.useEffect(() => {
        if (!showInspector || typeof window === "undefined") return
        let cancelled = false
        let kit: any = null
        let dialRoot: any = null

        if (!document.getElementById("dialkit-styles")) {
            const link = document.createElement("link")
            link.id = "dialkit-styles"
            link.rel = "stylesheet"
            link.href = DIALKIT_CSS
            document.head.appendChild(link)
        }

        const src = DIALKIT_JS // a variable, so Framer's bundler leaves the URL to the browser
        import(/* webpackIgnore: true */ src)
            .then((DialKit: any) => {
                if (cancelled) return
                const start = propsRef.current
                dialRoot = DialKit.createDialRoot({
                    position: start.inspectorPosition,
                    theme: "dark",
                    defaultOpen: window.innerWidth >= 520,
                })
                kit = DialKit.createDialKit("Avatar Dome", dialConfig(start as Settings), {
                    onAction: (path: string) => {
                        if (path === "Send a ring") avatarRef.current?.click()
                        if (path === "Reset to defaults") kit?.resetValues()
                    },
                    shortcuts: {
                        "Colour band.Core width": { key: "w", mode: "fine" },
                        "Refraction.Bend strength": { key: "b" },
                    },
                })
                kit.subscribe((values: any) => {
                    const s = fromPanel(values)
                    panelRef.current = s
                    const el = avatarRef.current
                    if (el) {
                        el.style.setProperty("--holo-opacity", String(s.avatar.foilOpacity))
                        el.style.setProperty("--glare-opacity", String(s.avatar.glareOpacity))
                    }
                    redrawRef.current()
                })
            })
            .catch(() => {
                // Panel is optional: if the CDN is unreachable, the effect still runs on the Framer values
            })

        return () => {
            cancelled = true
            kit?.destroy()
            dialRoot?.destroy()
            panelRef.current = null
            redrawRef.current()
        }
    }, [showInspector, p.inspectorPosition])

    const src = p.image?.src
    const avatarStyle = {
        background: src ? `#6fb53a url("${src}") center 18% / cover no-repeat` : "radial-gradient(circle at 50% 35%, #9bd36b, #4f8f2a)",
        "--holo-opacity": p.avatar.foilOpacity,
        "--glare-opacity": p.avatar.glareOpacity,
    } as React.CSSProperties

    return (
        <div
            ref={rootRef}
            style={{
                position: "relative",
                width: "100%",
                height: "100%",
                overflow: "hidden",
                display: "grid",
                placeItems: "center",
                background: p.background.ground,
                ...props.style,
            }}
        >
            <style>{CSS}</style>
            <canvas
                ref={canvasRef}
                aria-hidden="true"
                style={{ position: "absolute", inset: 0, width: "100%", height: "100%", display: "block" }}
            />
            <div
                ref={tiltRef}
                style={{ position: "relative", width: p.avatarSize, height: p.avatarSize, maxWidth: "100%", borderRadius: "50%" }}
            >
                <button
                    ref={avatarRef}
                    className="ad-avatar"
                    type="button"
                    aria-label={p.image?.alt || p.label}
                    style={avatarStyle}
                >
                    <span ref={holoRef} className="ad-holo" />
                    <span ref={glareRef} className="ad-glare" />
                </button>
            </div>
            {p.hint ? (
                <p ref={hintRef} className="ad-hint">
                    {p.hint}
                </p>
            ) : null}
        </div>
    )
}

AvatarDome.displayName = "Avatar Dome"

/* ---------- Framer property controls ---------- */

const slider = (title: string, defaultValue: number, min: number, max: number, step: number, unit?: string) => ({
    type: ControlType.Number as const,
    title,
    defaultValue,
    min,
    max,
    step,
    unit,
    displayStepper: false,
})

addPropertyControls(AvatarDome, {
    inspector: {
        type: ControlType.Boolean,
        title: "Inspector",
        defaultValue: DEFAULTS.inspector,
        description: "DialKit panel on the live site and in Preview. Its values override these controls.",
    },
    inspectorPosition: {
        type: ControlType.Enum,
        title: "Panel",
        defaultValue: DEFAULTS.inspectorPosition,
        options: ["top-right", "top-left", "bottom-right", "bottom-left"],
        optionTitles: ["Top Right", "Top Left", "Bottom Right", "Bottom Left"],
        hidden: (props: AvatarDomeProps) => props.inspector === false,
    },
    image: { type: ControlType.ResponsiveImage, title: "Photo" },
    avatarSize: slider("Size", DEFAULTS.avatarSize, 80, 480, 1, "px"),
    hint: { type: ControlType.String, title: "Hint", defaultValue: DEFAULTS.hint, placeholder: "Leave empty to hide" },
    label: { type: ControlType.String, title: "Label", defaultValue: DEFAULTS.label, description: "Read by screen readers when the photo has no alt text." },
    previewInEditor: {
        type: ControlType.Boolean,
        title: "Editor Ring",
        defaultValue: true,
        enabledTitle: "Show",
        disabledTitle: "Hide",
    },
    ring: {
        type: ControlType.Object,
        title: "Ring Motion",
        controls: {
            duration: slider("Duration", DEFAULTS.ring.duration, 0.6, 6, 0.1, "s"),
            easeOut: slider("Ease-out", DEFAULTS.ring.easeOut, 1, 6, 0.1),
            fadeStart: slider("Fade Starts", DEFAULTS.ring.fadeStart, 0, 0.95, 0.01),
            startWidth: slider("Start Width", DEFAULTS.ring.startWidth, 0.05, 1, 0.01, "×"),
            endWidth: slider("End Width", DEFAULTS.ring.endWidth, 40, 400, 1, "px"),
        },
    },
    refraction: {
        type: ControlType.Object,
        title: "Refraction",
        controls: {
            bend: slider("Bend", DEFAULTS.refraction.bend, 0, 2, 0.01),
            colourSplit: slider("Colour Split", DEFAULTS.refraction.colourSplit, 0, 0.5, 0.01),
        },
    },
    band: {
        type: ControlType.Object,
        title: "Colour Band",
        controls: {
            coreWidth: slider("Core Width", DEFAULTS.band.coreWidth, 0.03, 1, 0.01),
            featherWidth: slider("Feather Width", DEFAULTS.band.featherWidth, 0.1, 1.5, 0.01),
            featherAmount: slider("Feather Amount", DEFAULTS.band.featherAmount, 0, 1, 0.01),
            brightness: slider("Brightness", DEFAULTS.band.brightness, 0, 2, 0.01),
            rainbowRepeats: slider("Repeats", DEFAULTS.band.rainbowRepeats, 0, 6, 0.05),
            rainbowDrift: slider("Drift", DEFAULTS.band.rainbowDrift, 0, 2, 0.01),
        },
    },
    background: {
        type: ControlType.Object,
        title: "Background",
        controls: {
            ground: { type: ControlType.Color, title: "Ground", defaultValue: DEFAULTS.background.ground },
            dotSpacing: slider("Dot Spacing", DEFAULTS.background.dotSpacing, 3, 24, 0.5, "px"),
            dotBrightness: slider("Dot Brightness", DEFAULTS.background.dotBrightness, 0, 0.3, 0.005),
        },
    },
    avatar: {
        type: ControlType.Object,
        title: "Avatar Motion",
        controls: {
            maxTilt: slider("Max Tilt", DEFAULTS.avatar.maxTilt, 0, 30, 0.5, "°"),
            pressScale: slider("Press Scale", DEFAULTS.avatar.pressScale, 0.8, 1, 0.005),
            tiltSpring: { type: ControlType.Transition, title: "Tilt Spring", defaultValue: DEFAULTS.avatar.tiltSpring },
            releaseSpring: { type: ControlType.Transition, title: "Release", defaultValue: DEFAULTS.avatar.releaseSpring },
            foilOpacity: slider("Foil", DEFAULTS.avatar.foilOpacity, 0, 1, 0.01),
            glareOpacity: slider("Glare", DEFAULTS.avatar.glareOpacity, 0, 1, 0.01),
        },
    },
})
