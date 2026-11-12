import * as React from "react"
import type { CSSProperties, ReactNode } from "react"
import { addPropertyControls, ControlType, useIsStaticRenderer } from "framer"

/* ---------- Defaults (same values as the Homepage Shaders V3 demo) ---------- */

// DialKit (Josh Puckett, MIT): vanilla ES module build, pinned. Loaded only on the live site and in Preview.
const DIALKIT_JS = "https://cdn.jsdelivr.net/npm/dialkit@2.1.0/dist/vanilla/index.js"
const DIALKIT_CSS = "https://cdn.jsdelivr.net/npm/dialkit@2.1.0/dist/vanilla/styles.css"

type PanelPosition = "top-right" | "top-left" | "bottom-right" | "bottom-left"
type RippleMode = "Auto" | "Refract" | "Nudge" | "Both" | "Off"

const DEFAULTS = {
    inspector: true,
    inspectorPosition: "top-right" as PanelPosition,
    previewInEditor: true,
    align: "left" as "left" | "center" | "right",
    padding: 64,
    ground: "#0d0d0f",
    dots: { spacing: 22, size: 1, swell: 1.3, brightness: 0.68, colour: "#e8e8f2", push: 10 },
    trail: { width: 85, fade: 0.8, fullSpeed: 350, edge: 0.7, follow: 18, drift: true },
    ring: { duration: 2.4, easeOut: 3, reach: 0.8, fadeStart: 0.58, bend: 16 },
    band: {
        startWidth: 24,
        endWidth: 78,
        coreWidth: 0.45,
        featherWidth: 1.12,
        featherAmount: 0.22,
        brightness: 0.55,
        repeats: 3.5,
        drift: 0.35,
        hueShift: 0,
        saturation: 1,
    },
    ripple: { mode: "Auto" as RippleMode, strength: 24, fringe: 0.35, nudgeScale: 0.05 },
}

interface ReactiveDotsProps {
    content?: ReactNode
    align?: "left" | "center" | "right"
    padding?: number
    inspector?: boolean
    inspectorPosition?: PanelPosition
    previewInEditor?: boolean
    ground?: string
    dots?: Partial<typeof DEFAULTS.dots>
    trail?: Partial<typeof DEFAULTS.trail>
    ring?: Partial<typeof DEFAULTS.ring>
    band?: Partial<typeof DEFAULTS.band>
    ripple?: Partial<typeof DEFAULTS.ripple>
    style?: CSSProperties
}

// Flat settings the renderer reads every frame.
type Cfg = {
    spacing: number; size: number; swell: number; dotBright: number; dotCol: string; push: number
    trailW: number; fade: number; fullSpeed: number; maskEdge: number; follow: number; drift: boolean
    dur: number; ease: number; reach: number; fadeStart: number; bend: number
    w0: number; w1: number; core: number; featherW: number; featherAmt: number; ringBright: number
    repeats: number; hueDrift: number; hue: number; sat: number
    ground: string
    rippleMode: RippleMode; rippleStrength: number; fringe: number; nudgeScale: number
}

function toCfg(p: ReturnType<typeof mergeProps>): Cfg {
    const { dots, trail, ring, band, ripple } = p
    return {
        spacing: dots.spacing, size: dots.size, swell: dots.swell, dotBright: dots.brightness, dotCol: dots.colour, push: dots.push,
        trailW: trail.width, fade: trail.fade, fullSpeed: trail.fullSpeed, maskEdge: trail.edge, follow: trail.follow, drift: trail.drift,
        dur: ring.duration, ease: ring.easeOut, reach: ring.reach, fadeStart: ring.fadeStart, bend: ring.bend,
        w0: band.startWidth, w1: band.endWidth, core: band.coreWidth, featherW: band.featherWidth, featherAmt: band.featherAmount,
        ringBright: band.brightness, repeats: band.repeats, hueDrift: band.drift, hue: band.hueShift, sat: band.saturation,
        ground: p.ground,
        rippleMode: ripple.mode, rippleStrength: ripple.strength, fringe: ripple.fringe, nudgeScale: ripple.nudgeScale,
    }
}

function mergeProps(props: ReactiveDotsProps) {
    return {
        ...DEFAULTS,
        ...props,
        dots: { ...DEFAULTS.dots, ...props.dots },
        trail: { ...DEFAULTS.trail, ...props.trail },
        ring: { ...DEFAULTS.ring, ...props.ring },
        band: { ...DEFAULTS.band, ...props.band },
        ripple: { ...DEFAULTS.ripple, ...props.ripple },
    }
}

/* ---------- Helpers ---------- */

// Framer colours can be hex, rgb() or rgba(); let the browser normalise them.
let colorCtx: CanvasRenderingContext2D | null = null
function colorToRgb(color: string): [number, number, number] {
    if (typeof document === "undefined") return [0.05, 0.05, 0.06]
    if (!colorCtx) colorCtx = document.createElement("canvas").getContext("2d")
    if (!colorCtx) return [0.05, 0.05, 0.06]
    colorCtx.fillStyle = "#000"
    colorCtx.fillStyle = color
    const c = colorCtx.fillStyle as string
    if (c.startsWith("#")) {
        const n = parseInt(c.slice(1, 7), 16)
        return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]
    }
    const m = c.match(/[\d.]+/g) || ["13", "13", "15"]
    return [Number(m[0]) / 255, Number(m[1]) / 255, Number(m[2]) / 255]
}
function colorToHex(color: string) {
    return "#" + colorToRgb(color).map((v) => Math.round(v * 255).toString(16).padStart(2, "0")).join("")
}
function smooth(a: number, b: number, x: number) {
    const t = Math.min(Math.max((x - a) / (b - a), 0), 1)
    return t * t * (3 - 2 * t)
}

/* ---------- Shaders (WebGL 2) ---------- */

const VS = `#version 300 es
in vec2 a; void main(){ gl_Position = vec4(a, 0.0, 1.0); }`

const COMMON = `
vec3 pal(float t){ return 0.55 + 0.45 * cos(6.2831853 * (t + vec3(0.0, 0.33, 0.67))); }
`

const DOTS_FS = `#version 300 es
precision highp float;
uniform vec2 uRes;      // drawing buffer, device px
uniform float uDpr;
uniform float uTime;
uniform vec2 uMouse;    // css px, origin bottom-left
uniform vec4 uRings[4]; // x, y, start time (-1 = empty)
uniform vec3 uBg;
uniform vec4 uRingA;    // duration, ease-out, reach, fade start
uniform vec4 uRingB;    // start width, end width, core width, feather width
uniform vec4 uRingC;    // feather amount, brightness, rainbow repeats per 1000px, rainbow drift
uniform vec4 uRingD;    // bend, hue shift, saturation, unused
uniform sampler2D uTrail;
uniform vec4 uDotA;     // spacing, rest size, swell, brightness
uniform vec4 uDotB;     // push apart, mask edge, trail width, unused
uniform vec3 uDotCol;
out vec4 outColor;
${COMMON}
vec2 cssRes(){ return uRes / uDpr; }
vec3 palS(float t){ vec3 c = pal(t); float l = dot(c, vec3(0.299, 0.587, 0.114)); return max(mix(vec3(l), c, uRingD.z), 0.0); }
vec3 rings(vec2 p, out vec2 warp){
  warp = vec2(0.0); vec3 acc = vec3(0.0);
  float maxR = length(cssRes()) * uRingA.z;
  float dur = uRingA.x, life = dur * 1.15;
  for (int i = 0; i < 4; i++){
    vec4 g = uRings[i];
    if (g.z < 0.0) continue;
    float t = uTime - g.z;
    if (t < 0.0 || t > life) continue;
    float k = clamp(t / dur, 0.0, 1.0);
    float R = maxR * (1.0 - pow(1.0 - k, uRingA.y));
    vec2 d = p - g.xy; float L = length(d) + 1e-4;
    float s = (L - R) / mix(uRingB.x, uRingB.y, k);
    float fade = 1.0 - smoothstep(uRingA.w * dur, life, t);
    warp += d / L * (-s * exp(-s*s*1.5)) * uRingD.x * fade;
    float core = exp(-pow(s / uRingB.z, 2.0));
    float halo = exp(-pow(s / uRingB.w, 2.0)) * uRingC.x;
    acc += palS(L * uRingC.z * 0.001 - t * uRingC.w + s * 0.12 + uRingD.y) * (core + halo) * fade * uRingC.y;
  }
  return acc;
}
float trailAt(vec2 c){ return texture(uTrail, c * uDpr / uRes).r; }
void main(){
  vec2 p = gl_FragCoord.xy / uDpr;
  vec2 warp; vec3 rc = rings(p, warp);
  float SP = uDotA.x;
  // Dots part around the cursor, but only while it moves (scaled by the trail).
  vec2 toM = p - uMouse; float dm = length(toM) + 1e-4;
  float near = exp(-dm*dm / (2.0 * uDotB.z * uDotB.z)) * trailAt(p);
  vec2 q = p - toM/dm * near * uDotB.x + warp;
  vec2 c = (floor(q/SP) + 0.5) * SP;
  // The trail is the mask: no movement, no grid.
  float f = smoothstep(0.0, uDotB.y, trailAt(c));
  float r = uDotA.y + uDotA.z * f;
  float m = 1.0 - smoothstep(r-0.65, r+0.65, length(q-c));
  vec3 col = uBg + m * uDotCol * uDotA.w * f;
  outColor = vec4(col + rc, 1.0);
}`

const TRAIL_FS = `#version 300 es
precision highp float;
uniform vec2 uSimRes; uniform vec2 uCss; uniform vec2 uA; uniform vec2 uB;
uniform float uDt; uniform sampler2D uPrev; uniform float uAmt; uniform float uTrailW; uniform float uFade;
out vec4 outColor;
void main(){
  vec2 uv = gl_FragCoord.xy / uSimRes;
  float v = texture(uPrev, uv).r;
  v = max(v * exp(-uDt * 1.3 / uFade) - 0.5 / uFade * uDt, 0.0);
  vec2 p = uv * uCss, pa = p - uA, ba = uB - uA;
  float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-4), 0.0, 1.0);
  float d = length(pa - ba * h);
  v = max(v, exp(-d*d / (2.0 * uTrailW * uTrailW)) * uAmt);
  outColor = vec4(v, 0.0, 0.0, 1.0);
}`

/* ---------- DialKit inspector ---------- */

// Same labels and ranges as the demo's panel, so "Copy parameters" output matches. DialKit uses keys as labels.
function dialConfig(c: Cfg) {
    return {
        "Send a ring": { type: "action" },
        "Dot grid": {
            "Spacing (px)": [c.spacing, 8, 48, 1],
            "Dot size (px)": [c.size, 0.3, 4, 0.05],
            "Swell when moving (px)": [c.swell, 0, 5, 0.05],
            Brightness: [c.dotBright, 0, 1, 0.01],
            "Dot colour": colorToHex(c.dotCol),
            "Push apart (px)": [c.push, 0, 40, 0.5],
        },
        "Trail mask": {
            "Trail width (px)": [c.trailW, 20, 300, 1],
            "Fade time (s)": [c.fade, 0.1, 4, 0.05],
            "Speed for full trail (px/s)": [c.fullSpeed, 50, 1500, 10],
            "Mask edge": [c.maskEdge, 0.05, 1, 0.01],
            "Cursor follow": [c.follow, 2, 40, 0.5],
            "Drift when idle": c.drift,
        },
        "Ring motion": {
            "Duration (s)": [c.dur, 0.6, 6, 0.1],
            "Ease-out strength": [c.ease, 1, 6, 0.1],
            "Reach (× screen)": [c.reach, 0.2, 1.5, 0.01],
            "Fade starts at": [c.fadeStart, 0, 1, 0.01],
            "Bend strength (px)": [c.bend, 0, 60, 0.5],
        },
        "Rainbow band": {
            "Start width (px)": [c.w0, 4, 200, 1],
            "End width (px)": [c.w1, 4, 400, 1],
            "Core width": [c.core, 0.05, 2, 0.01],
            "Feather width": [c.featherW, 0.1, 4, 0.01],
            "Feather amount": [c.featherAmt, 0, 1, 0.01],
            Brightness: [c.ringBright, 0, 2, 0.01],
            "Rainbow repeats": [c.repeats, 0, 12, 0.05],
            "Rainbow drift": [c.hueDrift, 0, 2, 0.01],
            "Hue shift": [c.hue, 0, 1, 0.01],
            Saturation: [c.sat, 0, 1.5, 0.01],
        },
        "Page ripple": {
            Mode: { type: "select", options: ["Auto", "Refract", "Nudge", "Both", "Off"], default: c.rippleMode },
            "Strength (px)": [c.rippleStrength, 0, 80, 0.5],
            "Rainbow fringe": [c.fringe, 0, 1, 0.01],
            "Nudge scale": [c.nudgeScale, 0, 0.3, 0.005],
        },
        Background: { Ground: colorToHex(c.ground) },
        "Reset to defaults": { type: "action" },
    }
}

function fromPanel(v: any): Cfg {
    const g = v["Dot grid"], t = v["Trail mask"], r = v["Ring motion"], b = v["Rainbow band"]
    const rp = v["Page ripple"], bg = v["Background"]
    return {
        spacing: g["Spacing (px)"], size: g["Dot size (px)"], swell: g["Swell when moving (px)"],
        dotBright: g["Brightness"], dotCol: g["Dot colour"], push: g["Push apart (px)"],
        trailW: t["Trail width (px)"], fade: t["Fade time (s)"], fullSpeed: t["Speed for full trail (px/s)"],
        maskEdge: t["Mask edge"], follow: t["Cursor follow"], drift: t["Drift when idle"],
        dur: r["Duration (s)"], ease: r["Ease-out strength"], reach: r["Reach (× screen)"],
        fadeStart: r["Fade starts at"], bend: r["Bend strength (px)"],
        w0: b["Start width (px)"], w1: b["End width (px)"], core: b["Core width"], featherW: b["Feather width"],
        featherAmt: b["Feather amount"], ringBright: b["Brightness"], repeats: b["Rainbow repeats"],
        hueDrift: b["Rainbow drift"], hue: b["Hue shift"], sat: b["Saturation"],
        ground: bg["Ground"],
        rippleMode: rp["Mode"], rippleStrength: rp["Strength (px)"], fringe: rp["Rainbow fringe"], nudgeScale: rp["Nudge scale"],
    }
}

const CSS = `
/* DialKit panel: 56px below the top of the viewport (DialKit's default is 16px), and at most
   100vh - 56px tall so it ends at the bottom edge; the rest scrolls inside the panel.
   DialKit sets the inner max-height inline, so these need !important. dvh follows mobile toolbars. */
html body .dialkit-panel[data-position="top-right"],
html body .dialkit-panel[data-position="top-left"] {
  top: 56px !important;
  max-height: calc(100vh - 56px) !important;
  max-height: calc(100dvh - 56px) !important;
}
html body .dialkit-panel[data-position="top-right"] .dialkit-panel-inner,
html body .dialkit-panel[data-position="top-left"] .dialkit-panel-inner {
  max-height: calc(100vh - 56px) !important;
  max-height: calc(100dvh - 56px) !important;
  overflow-y: auto !important;
}
`

// Elements in the Content slot that the Nudge ripple moves. Only the outermost match is moved,
// so a text block inside a link moves once, with its link.
const NUDGE_SELECTOR =
    'h1,h2,h3,h4,h5,h6,p,img,picture,video,svg,a,button,[data-framer-component-type="RichTextContainer"]'

/* ---------- Component ---------- */

/**
 * Reactive Dots
 * A dark dot grid that only shows in a trail behind the moving cursor. A click sends an
 * iridescent ring that bends the dots and ripples whatever you put in the Content slot.
 *
 * @framerIntrinsicWidth 1200
 * @framerIntrinsicHeight 800
 *
 * @framerSupportedLayoutWidth any-prefer-fixed
 * @framerSupportedLayoutHeight any-prefer-fixed
 */
export default function ReactiveDots(props: ReactiveDotsProps) {
    const p = mergeProps(props)

    const rootRef = React.useRef<HTMLDivElement>(null)
    const canvasRef = React.useRef<HTMLCanvasElement>(null)
    const contentRef = React.useRef<HTMLDivElement>(null)
    const filterRef = React.useRef<SVGFilterElement>(null)
    const mapRef = React.useRef<SVGFEImageElement>(null)
    const dRRef = React.useRef<SVGFEDisplacementMapElement>(null)
    const dGRef = React.useRef<SVGFEDisplacementMapElement>(null)
    const dBRef = React.useRef<SVGFEDisplacementMapElement>(null)

    // A unique filter id per instance (useId output contains ":" which url(#...) dislikes)
    const filterId = "rd-ripple-" + React.useId().replace(/[^a-zA-Z0-9_-]/g, "")

    // The render loop reads the latest settings from here, so changing a control never restarts WebGL
    const cfgRef = React.useRef<Cfg>(toCfg(p))
    cfgRef.current = toCfg(p)
    // Values from the DialKit panel, when it's showing. They override the Framer controls.
    const panelRef = React.useRef<Cfg | null>(null)
    const previewRef = React.useRef(true)
    previewRef.current = p.previewInEditor !== false
    const redrawRef = React.useRef<() => void>(() => {})
    const sendRingRef = React.useRef<(x?: number, y?: number) => void>(() => {})

    // Canvas, export and thumbnails get a still frame; Preview and the live site are interactive
    const isEditor = useIsStaticRenderer()

    React.useEffect(() => {
        const root = rootRef.current!
        const canvas = canvasRef.current!
        const content = contentRef.current!
        const fil = filterRef.current!, feMap = mapRef.current!
        const dR = dRRef.current!, dG = dGRef.current!, dB = dBRef.current!

        const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches
        const C = () => (panelRef.current ? { ...cfgRef.current, ...panelRef.current } : cfgRef.current)

        const maybeGl = canvas.getContext("webgl2", { antialias: false, alpha: false, depth: false, stencil: false })
        // Without WebGL 2 the ground colour and the content still show; the effect is skipped.
        if (!maybeGl) return
        const gl: WebGL2RenderingContext = maybeGl
        let hasFloat = !!(gl.getExtension("EXT_color_buffer_float") || gl.getExtension("EXT_color_buffer_half_float"))

        /* Programs */
        const compile = (type: number, src: string) => {
            const s = gl.createShader(type)!
            gl.shaderSource(s, src)
            gl.compileShader(s)
            if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) || "shader")
            return s
        }
        const program = (fs: string) => {
            const prog = gl.createProgram()!
            gl.attachShader(prog, compile(gl.VERTEX_SHADER, VS))
            gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, fs))
            gl.bindAttribLocation(prog, 0, "a")
            gl.linkProgram(prog)
            const loc: Record<string, WebGLUniformLocation | null> = {}
            return { prog, u: (n: string) => (n in loc ? loc[n] : (loc[n] = gl.getUniformLocation(prog, n))) }
        }
        const dotsP = program(DOTS_FS)
        const trailP = program(TRAIL_FS)
        gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer())
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)
        gl.enableVertexAttribArray(0)
        gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)

        /* Trail buffer: ping-pong render targets */
        type Target = { t: WebGLTexture; f: WebGLFramebuffer; ok: boolean }
        const target = (w: number, h: number): Target => {
            const t = gl.createTexture()!
            gl.bindTexture(gl.TEXTURE_2D, t)
            if (hasFloat) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null)
            else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null)
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
            const f = gl.createFramebuffer()!
            gl.bindFramebuffer(gl.FRAMEBUFFER, f)
            gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0)
            return { t, f, ok: gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE }
        }
        const free = (x: Target) => {
            gl.deleteTexture(x.t)
            gl.deleteFramebuffer(x.f)
        }
        let trail: { a: Target; b: Target; w: number; h: number } | null = null
        function makeTrail(w: number, h: number) {
            if (trail) {
                free(trail.a)
                free(trail.b)
            }
            let a = target(w, h), b = target(w, h)
            if (hasFloat && !(a.ok && b.ok)) {
                free(a)
                free(b)
                hasFloat = false
                a = target(w, h)
                b = target(w, h)
            }
            trail = { a, b, w, h }
            gl.clearColor(0, 0, 0, 1)
            for (const x of [a, b]) {
                gl.bindFramebuffer(gl.FRAMEBUFFER, x.f)
                gl.clear(gl.COLOR_BUFFER_BIT)
            }
        }

        /* Size */
        let W = 1, H = 1
        function resize() {
            // offset sizes, so Framer's canvas zoom doesn't skew the numbers
            const w = Math.max(1, root.offsetWidth), h = Math.max(1, root.offsetHeight)
            const d = Math.min(window.devicePixelRatio || 1, 1.5)
            if (w === W && h === H && canvas.width === Math.round(w * d)) return false
            W = w
            H = h
            canvas.width = Math.round(w * d)
            canvas.height = Math.round(h * d)
            makeTrail(Math.max(2, Math.round(w / 2)), Math.max(2, Math.round(h / 2)))
            centers = null
            return true
        }

        /* Pointer, smoothed in component px (y down) */
        const ptr = { x: 0, y: 0, last: -1e9, over: false, touch: false }
        const sm = { x: 0, y: 0 }, prev = { x: 0, y: 0 }
        const rings = new Float32Array(16).fill(-1)
        let ringSlot = 0
        let time = 0

        function local(e: PointerEvent | MouseEvent) {
            const r = root.getBoundingClientRect()
            const scale = r.width / W || 1
            return { x: (e.clientX - r.left) / scale, y: (e.clientY - r.top) / scale, inside: e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom }
        }
        function sendRing(x = W / 2, y = H / 2) {
            const o = ringSlot * 4
            rings[o] = x
            rings[o + 1] = H - y
            rings[o + 2] = time
            rings[o + 3] = 0
            ringSlot = (ringSlot + 1) % 4
            centers = null // re-measure Nudge targets at the start of each ripple
        }
        sendRingRef.current = sendRing

        function updateInput(dt: number, nowMs: number) {
            const c = C()
            let tx = ptr.x, ty = ptr.y
            const idle = nowMs - ptr.last
            const auto = reduce || !c.drift ? false : ptr.touch ? idle > 3000 : !ptr.over && idle > 2500
            if (auto) {
                const t = time * 0.55
                tx = W * (0.55 + 0.26 * Math.cos(t))
                ty = H * (0.5 + 0.22 * Math.sin(t * 1.37))
            }
            prev.x = sm.x
            prev.y = sm.y
            const a = 1 - Math.exp(-dt * (auto ? 4 : c.follow))
            sm.x += (tx - sm.x) * a
            sm.y += (ty - sm.y) * a
        }

        /* Passes */
        const bindTex = (u: WebGLUniformLocation | null, unit: number, tex: WebGLTexture) => {
            gl.activeTexture(gl.TEXTURE0 + unit)
            gl.bindTexture(gl.TEXTURE_2D, tex)
            gl.uniform1i(u, unit)
        }
        function runTrail(dt: number) {
            if (!trail) return
            const c = C(), pr = trailP
            gl.useProgram(pr.prog)
            gl.uniform2f(pr.u("uSimRes"), trail.w, trail.h)
            gl.uniform2f(pr.u("uCss"), W, H)
            gl.uniform2f(pr.u("uA"), prev.x, H - prev.y)
            gl.uniform2f(pr.u("uB"), sm.x, H - sm.y)
            gl.uniform1f(pr.u("uDt"), dt)
            const speed = Math.hypot(sm.x - prev.x, sm.y - prev.y) / Math.max(dt, 1e-3)
            gl.uniform1f(pr.u("uAmt"), Math.min(speed / Math.max(1, c.fullSpeed), 1))
            gl.uniform1f(pr.u("uTrailW"), c.trailW)
            gl.uniform1f(pr.u("uFade"), Math.max(0.05, c.fade))
            bindTex(pr.u("uPrev"), 0, trail.a.t)
            gl.viewport(0, 0, trail.w, trail.h)
            gl.bindFramebuffer(gl.FRAMEBUFFER, trail.b.f)
            gl.drawArrays(gl.TRIANGLES, 0, 3)
            const t = trail.a
            trail.a = trail.b
            trail.b = t
        }
        function draw() {
            if (!trail) return
            const c = C(), pr = dotsP
            gl.bindFramebuffer(gl.FRAMEBUFFER, null)
            gl.viewport(0, 0, canvas.width, canvas.height)
            gl.useProgram(pr.prog)
            gl.uniform2f(pr.u("uRes"), canvas.width, canvas.height)
            gl.uniform1f(pr.u("uDpr"), canvas.width / W)
            gl.uniform1f(pr.u("uTime"), time)
            gl.uniform2f(pr.u("uMouse"), sm.x, H - sm.y)
            gl.uniform4fv(pr.u("uRings"), rings)
            gl.uniform3fv(pr.u("uBg"), colorToRgb(c.ground))
            gl.uniform4f(pr.u("uRingA"), c.dur, c.ease, c.reach, c.fadeStart)
            gl.uniform4f(pr.u("uRingB"), c.w0, c.w1, c.core, c.featherW)
            gl.uniform4f(pr.u("uRingC"), c.featherAmt, c.ringBright, c.repeats, c.hueDrift)
            gl.uniform4f(pr.u("uRingD"), c.bend, c.hue, c.sat, 0)
            bindTex(pr.u("uTrail"), 0, trail.a.t)
            gl.uniform4f(pr.u("uDotA"), c.spacing, c.size, c.swell, c.dotBright)
            gl.uniform4f(pr.u("uDotB"), c.push, c.maskEdge, c.trailW, 0)
            gl.uniform3fv(pr.u("uDotCol"), colorToRgb(c.dotCol))
            gl.drawArrays(gl.TRIANGLES, 0, 3)
        }

        /* Page ripple: bends the Content slot as the ring band passes.
           Refract: an SVG displacement filter fed a small map drawn from the ring (Chrome, Firefox).
           Nudge: moves each text block, image and button as the band reaches it (every browser). */
        const ua = navigator.userAgent
        const webkitOnly = /AppleWebKit/.test(ua) && !/Chrome\/|Chromium|Edg\/|OPR\//.test(ua)
        const mapC = document.createElement("canvas")
        const mapX = mapC.getContext("2d")
        let mapImg: ImageData | null = null
        let centers: [number, number][] | null = null
        let nudgeEls: HTMLElement[] = []
        let nudging = false, filtering = false
        const tmp = [0, 0, 0]

        function measureNudge() {
            const all = Array.from(content.querySelectorAll<HTMLElement>(NUDGE_SELECTOR))
            nudgeEls = all.filter((el) => {
                for (let a = el.parentElement; a && a !== content; a = a.parentElement) if (all.includes(a)) return false
                return true
            })
            const r = root.getBoundingClientRect()
            const scale = r.width / W || 1
            centers = nudgeEls.map((el) => {
                const b = el.getBoundingClientRect()
                return [(b.left - r.left + b.width / 2) / scale, (b.top - r.top + b.height / 2) / scale]
            })
        }
        // Same maths as the shader. Writes [x offset, y offset, band] in component px (y down); offsets in -1..1.
        function field(x: number, y: number, o: number[]) {
            const c = C()
            o[0] = o[1] = o[2] = 0
            const maxR = Math.hypot(W, H) * c.reach, dur = c.dur, life = dur * 1.15
            for (let i = 0; i < 4; i++) {
                const st = rings[i * 4 + 2]
                if (st < 0) continue
                const t = time - st
                if (t < 0 || t > life) continue
                const k = Math.min(t / dur, 1), R = maxR * (1 - Math.pow(1 - k, c.ease))
                const dx = x - rings[i * 4], dy = y - (H - rings[i * 4 + 1])
                const L = Math.hypot(dx, dy) + 1e-4
                const s = (L - R) / (c.w0 + (c.w1 - c.w0) * k)
                const fade = 1 - smooth(c.fadeStart * dur, life, t)
                const n = (-s * Math.exp(-1.5 * s * s)) / 0.35 * fade
                o[0] += (dx / L) * n
                o[1] += (dy / L) * n
                o[2] += Math.exp(-((s / c.core) ** 2)) * fade
            }
        }
        function ringsAlive() {
            const life = C().dur * 1.15
            for (let i = 0; i < 4; i++) {
                const st = rings[i * 4 + 2]
                if (st < 0) continue
                const t = time - st
                if (t >= 0 && t <= life) return true
            }
            return false
        }
        function updateRipple() {
            const c = C()
            const mode = reduce ? "Off" : c.rippleMode === "Auto" ? (webkitOnly ? "Nudge" : "Refract") : c.rippleMode
            const alive = mode !== "Off" && c.rippleStrength > 0 && ringsAlive()
            const doRefract = alive && (mode === "Refract" || mode === "Both") && !!mapX
            const doNudge = alive && (mode === "Nudge" || mode === "Both")

            if (doRefract && mapX) {
                const mw = Math.max(8, Math.ceil(W / 8)), mh = Math.max(8, Math.ceil(H / 8))
                if (mapC.width !== mw || mapC.height !== mh || !mapImg) {
                    mapC.width = mw
                    mapC.height = mh
                    mapImg = mapX.createImageData(mw, mh)
                }
                const d = mapImg.data, sx = W / mw, sy = H / mh
                for (let j = 0; j < mh; j++)
                    for (let i = 0; i < mw; i++) {
                        field((i + 0.5) * sx, (j + 0.5) * sy, tmp)
                        let wx = tmp[0], wy = tmp[1]
                        const l = Math.hypot(wx, wy)
                        if (l > 1) {
                            wx /= l
                            wy /= l
                        }
                        const k = (j * mw + i) * 4
                        d[k] = 128 + 127 * wx
                        d[k + 1] = 128 + 127 * wy
                        d[k + 2] = 128
                        d[k + 3] = 255
                    }
                mapX.putImageData(mapImg, 0, 0)
                feMap.setAttribute("href", mapC.toDataURL())
                for (const el of [fil, feMap]) {
                    el.setAttribute("width", String(W))
                    el.setAttribute("height", String(H))
                }
                const S = c.rippleStrength * 2, f = c.fringe * 0.35
                dR.setAttribute("scale", String(S * (1 + f)))
                dG.setAttribute("scale", String(S))
                dB.setAttribute("scale", String(S * (1 - f)))
                if (!filtering) {
                    content.style.filter = `url(#${filterId})`
                    filtering = true
                }
            } else if (filtering) {
                content.style.filter = ""
                filtering = false
            }

            if (doNudge) {
                if (!centers) measureNudge()
                nudging = true
                const S = c.rippleStrength
                nudgeEls.forEach((el, i) => {
                    field(centers![i][0], centers![i][1], tmp)
                    // translate/scale compose with any transform Framer already set on the layer.
                    // Content ahead of the band is pushed outward, behind it pulled back.
                    el.style.translate = `${(-tmp[0] * S).toFixed(2)}px ${(-tmp[1] * S).toFixed(2)}px`
                    el.style.scale = (1 + tmp[2] * c.nudgeScale).toFixed(4)
                })
            } else if (nudging) {
                nudgeEls.forEach((el) => {
                    el.style.translate = ""
                    el.style.scale = ""
                })
                nudging = false
            }
        }

        /* Editor: a still frame with a short trail and a ring part-way out */
        function freezePreview() {
            resize()
            makeTrail(trail!.w, trail!.h)
            rings.fill(-1)
            time = 10
            if (!previewRef.current) {
                sm.x = prev.x = -1e4
                sm.y = prev.y = -1e4
                draw()
                return
            }
            const path = (u: number) => ({ x: W * (0.38 + 0.34 * u), y: H * (0.62 - 0.3 * Math.sin(u * Math.PI * 0.8)) })
            const p0 = path(0)
            sm.x = prev.x = p0.x
            sm.y = prev.y = p0.y
            const steps = 36
            for (let i = 1; i <= steps; i++) {
                const q = path(i / steps)
                prev.x = sm.x
                prev.y = sm.y
                sm.x = q.x
                sm.y = q.y
                runTrail(1 / 60)
            }
            rings[0] = W * 0.72
            rings[1] = H - H * 0.4
            rings[2] = time - C().dur * 0.32
            draw()
        }

        /* Live loop */
        let raf = 0, last = 0, visible = true
        function frame(nowMs: number) {
            raf = requestAnimationFrame(frame)
            const dt = Math.min((nowMs - (last || nowMs - 16)) / 1000, 1 / 30)
            last = nowMs
            if (dt <= 0) return
            time += dt * (reduce ? 0.4 : 1)
            resize()
            updateInput(dt, nowMs)
            updateRipple()
            runTrail(dt)
            draw()
        }
        const start = () => {
            if (!raf && visible) {
                last = 0
                raf = requestAnimationFrame(frame)
            }
        }
        const stop = () => {
            cancelAnimationFrame(raf)
            raf = 0
        }

        const onMove = (e: PointerEvent) => {
            const l = local(e)
            ptr.x = l.x
            ptr.y = l.y
            ptr.last = performance.now()
            ptr.touch = e.pointerType === "touch"
            ptr.over = !ptr.touch && l.inside
        }
        const onOut = (e: MouseEvent) => {
            if (!e.relatedTarget) ptr.over = false
        }
        const onDown = (e: PointerEvent) => {
            const l = local(e)
            ptr.x = l.x
            ptr.y = l.y
            ptr.last = performance.now()
            ptr.touch = e.pointerType === "touch"
            sendRing(l.x, l.y)
        }

        let io: IntersectionObserver | null = null
        const ro = new ResizeObserver(() => {
            if (isEditor) freezePreview()
            else resize()
        })
        ro.observe(root)

        if (isEditor) {
            freezePreview()
            redrawRef.current = freezePreview
        } else {
            resize()
            ptr.x = sm.x = prev.x = W * 0.62
            ptr.y = sm.y = prev.y = H * 0.45
            window.addEventListener("pointermove", onMove, { passive: true })
            document.addEventListener("mouseout", onOut)
            root.addEventListener("pointerdown", onDown)
            // Pause while the component is scrolled out of view
            io = new IntersectionObserver((entries) => {
                visible = entries[0]?.isIntersecting ?? true
                if (visible) start()
                else stop()
            })
            io.observe(root)
            start()
            redrawRef.current = () => {}
        }

        return () => {
            stop()
            ro.disconnect()
            io?.disconnect()
            window.removeEventListener("pointermove", onMove)
            document.removeEventListener("mouseout", onOut)
            root.removeEventListener("pointerdown", onDown)
            content.style.filter = ""
            nudgeEls.forEach((el) => {
                el.style.translate = ""
                el.style.scale = ""
            })
            redrawRef.current = () => {}
            sendRingRef.current = () => {}
            gl.getExtension("WEBGL_lose_context")?.loseContext()
        }
    }, [isEditor, filterId])

    // In the editor, redraw the still frame after any prop change (WebGL is not rebuilt)
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
                dialRoot = DialKit.createDialRoot({
                    position: p.inspectorPosition,
                    theme: "dark",
                    defaultOpen: window.innerWidth >= 720,
                })
                kit = DialKit.createDialKit("Reactive dots", dialConfig(cfgRef.current), {
                    onAction: (path: string) => {
                        if (path === "Send a ring") sendRingRef.current()
                        if (path === "Reset to defaults") kit?.resetValues()
                    },
                })
                kit.subscribe((values: any) => {
                    panelRef.current = fromPanel(values)
                    if (rootRef.current) rootRef.current.style.background = panelRef.current.ground
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
            if (rootRef.current) rootRef.current.style.background = ""
        }
    }, [showInspector, p.inspectorPosition])

    const hasContent = React.Children.count(props.content) > 0
    const justify = p.align === "center" ? "center" : p.align === "right" ? "flex-end" : "flex-start"

    return (
        <div
            ref={rootRef}
            style={{
                position: "relative",
                width: "100%",
                height: "100%",
                overflow: "hidden",
                backgroundColor: p.ground,
                ...props.style,
            }}
        >
            <style>{CSS}</style>
            <svg width="0" height="0" aria-hidden="true" focusable="false" style={{ position: "absolute" }}>
                <filter
                    ref={filterRef}
                    id={filterId}
                    filterUnits="userSpaceOnUse"
                    primitiveUnits="userSpaceOnUse"
                    x="0"
                    y="0"
                    width="100"
                    height="100"
                    colorInterpolationFilters="sRGB"
                >
                    <feImage ref={mapRef} x="0" y="0" width="100" height="100" preserveAspectRatio="none" result="map" />
                    <feDisplacementMap ref={dRRef} in="SourceGraphic" in2="map" scale="0" xChannelSelector="R" yChannelSelector="G" result="r0" />
                    <feColorMatrix in="r0" type="matrix" values="1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 0.3333 0" result="r" />
                    <feDisplacementMap ref={dGRef} in="SourceGraphic" in2="map" scale="0" xChannelSelector="R" yChannelSelector="G" result="g0" />
                    <feColorMatrix in="g0" type="matrix" values="0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 0.3333 0" result="g" />
                    <feDisplacementMap ref={dBRef} in="SourceGraphic" in2="map" scale="0" xChannelSelector="R" yChannelSelector="G" result="b0" />
                    <feColorMatrix in="b0" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 0.3333 0" result="b" />
                    <feComposite in="r" in2="g" operator="arithmetic" k1="0" k2="1" k3="1" k4="0" result="rg" />
                    <feComposite in="rg" in2="b" operator="arithmetic" k1="0" k2="1" k3="1" k4="0" result="rgb" />
                    <feColorMatrix in="rgb" type="matrix" values="3 0 0 0 0  0 3 0 0 0  0 0 3 0 0  0 0 0 1 0" />
                </filter>
            </svg>
            <canvas
                ref={canvasRef}
                aria-hidden="true"
                style={{ position: "absolute", inset: 0, width: "100%", height: "100%", display: "block" }}
            />
            <div
                ref={contentRef}
                style={{
                    position: "absolute",
                    inset: 0,
                    display: "flex",
                    flexDirection: "column",
                    justifyContent: "center",
                    alignItems: justify,
                    padding: p.padding,
                    boxSizing: "border-box",
                }}
            >
                {props.content}
                {!hasContent && isEditor ? (
                    <p
                        style={{
                            margin: 0,
                            alignSelf: "center",
                            font: "500 13px/1.4 ui-sans-serif, -apple-system, sans-serif",
                            color: "rgba(255,255,255,0.45)",
                        }}
                    >
                        Connect your hero layers to Content to ripple them
                    </p>
                ) : null}
            </div>
        </div>
    )
}

ReactiveDots.displayName = "Reactive Dots"

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

addPropertyControls(ReactiveDots, {
    content: { type: ControlType.Slot, title: "Content" },
    align: {
        type: ControlType.Enum,
        title: "Align",
        defaultValue: DEFAULTS.align,
        options: ["left", "center", "right"],
        optionTitles: ["Left", "Center", "Right"],
        displaySegmentedControl: true,
    },
    padding: slider("Padding", DEFAULTS.padding, 0, 240, 1, "px"),
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
        hidden: (props: ReactiveDotsProps) => props.inspector === false,
    },
    previewInEditor: { type: ControlType.Boolean, title: "Editor Preview", defaultValue: true },
    ground: { type: ControlType.Color, title: "Ground", defaultValue: DEFAULTS.ground },
    dots: {
        type: ControlType.Object,
        title: "Dot Grid",
        controls: {
            spacing: slider("Spacing", DEFAULTS.dots.spacing, 8, 48, 1, "px"),
            size: slider("Dot Size", DEFAULTS.dots.size, 0.3, 4, 0.05, "px"),
            swell: slider("Swell", DEFAULTS.dots.swell, 0, 5, 0.05, "px"),
            brightness: slider("Brightness", DEFAULTS.dots.brightness, 0, 1, 0.01),
            colour: { type: ControlType.Color, title: "Colour", defaultValue: DEFAULTS.dots.colour },
            push: slider("Push Apart", DEFAULTS.dots.push, 0, 40, 0.5, "px"),
        },
    },
    trail: {
        type: ControlType.Object,
        title: "Trail Mask",
        controls: {
            width: slider("Width", DEFAULTS.trail.width, 20, 300, 1, "px"),
            fade: slider("Fade Time", DEFAULTS.trail.fade, 0.1, 4, 0.05, "s"),
            fullSpeed: slider("Full At Speed", DEFAULTS.trail.fullSpeed, 50, 1500, 10, "px/s"),
            edge: slider("Mask Edge", DEFAULTS.trail.edge, 0.05, 1, 0.01),
            follow: slider("Follow", DEFAULTS.trail.follow, 2, 40, 0.5),
            drift: { type: ControlType.Boolean, title: "Idle Drift", defaultValue: DEFAULTS.trail.drift },
        },
    },
    ring: {
        type: ControlType.Object,
        title: "Ring Motion",
        controls: {
            duration: slider("Duration", DEFAULTS.ring.duration, 0.6, 6, 0.1, "s"),
            easeOut: slider("Ease-out", DEFAULTS.ring.easeOut, 1, 6, 0.1),
            reach: slider("Reach", DEFAULTS.ring.reach, 0.2, 1.5, 0.01, "×"),
            fadeStart: slider("Fade Starts", DEFAULTS.ring.fadeStart, 0, 1, 0.01),
            bend: slider("Bend", DEFAULTS.ring.bend, 0, 60, 0.5, "px"),
        },
    },
    band: {
        type: ControlType.Object,
        title: "Rainbow Band",
        controls: {
            startWidth: slider("Start Width", DEFAULTS.band.startWidth, 4, 200, 1, "px"),
            endWidth: slider("End Width", DEFAULTS.band.endWidth, 4, 400, 1, "px"),
            coreWidth: slider("Core Width", DEFAULTS.band.coreWidth, 0.05, 2, 0.01),
            featherWidth: slider("Feather Width", DEFAULTS.band.featherWidth, 0.1, 4, 0.01),
            featherAmount: slider("Feather Amount", DEFAULTS.band.featherAmount, 0, 1, 0.01),
            brightness: slider("Brightness", DEFAULTS.band.brightness, 0, 2, 0.01),
            repeats: slider("Repeats", DEFAULTS.band.repeats, 0, 12, 0.05),
            drift: slider("Drift", DEFAULTS.band.drift, 0, 2, 0.01),
            hueShift: slider("Hue Shift", DEFAULTS.band.hueShift, 0, 1, 0.01),
            saturation: slider("Saturation", DEFAULTS.band.saturation, 0, 1.5, 0.01),
        },
    },
    ripple: {
        type: ControlType.Object,
        title: "Page Ripple",
        controls: {
            mode: {
                type: ControlType.Enum,
                title: "Mode",
                defaultValue: DEFAULTS.ripple.mode,
                options: ["Auto", "Refract", "Nudge", "Both", "Off"],
                description: "Auto: Refract in Chrome and Firefox, Nudge in Safari.",
            },
            strength: slider("Strength", DEFAULTS.ripple.strength, 0, 80, 0.5, "px"),
            fringe: slider("Fringe", DEFAULTS.ripple.fringe, 0, 1, 0.01),
            nudgeScale: slider("Nudge Scale", DEFAULTS.ripple.nudgeScale, 0, 0.3, 0.005),
        },
    },
})
