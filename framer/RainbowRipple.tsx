import * as React from "react"
import type { CSSProperties } from "react"
import { addPropertyControls, ControlType, useIsStaticRenderer } from "framer"

/* ---------- Defaults (ring values from the Homepage Shaders V3 demo) ---------- */

// DialKit (Josh Puckett, MIT): vanilla ES module build, pinned. Loaded only on the live site and in Preview.
const DIALKIT_JS = "https://cdn.jsdelivr.net/npm/dialkit@2.1.0/dist/vanilla/index.js"
const DIALKIT_CSS = "https://cdn.jsdelivr.net/npm/dialkit@2.1.0/dist/vanilla/styles.css"

type PanelPosition = "top-right" | "top-left" | "bottom-right" | "bottom-left"
type LensMode = "Auto" | "Refract" | "Blur" | "Off"

const DEFAULTS = {
    inspector: true,
    inspectorPosition: "top-right" as PanelPosition,
    previewInEditor: true,
    ring: { duration: 2.4, easeOut: 3, reach: 0.8, fadeStart: 0.58 },
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
    lens: { mode: "Auto" as LensMode, strength: 24, fringe: 0.35, blur: 3 },
}

interface RainbowRippleProps {
    inspector?: boolean
    inspectorPosition?: PanelPosition
    previewInEditor?: boolean
    ring?: Partial<typeof DEFAULTS.ring>
    band?: Partial<typeof DEFAULTS.band>
    lens?: Partial<typeof DEFAULTS.lens>
    style?: CSSProperties
}

// Flat settings the renderer reads every frame.
type Cfg = {
    dur: number; ease: number; reach: number; fadeStart: number
    w0: number; w1: number; core: number; featherW: number; featherAmt: number; bright: number
    repeats: number; hueDrift: number; hue: number; sat: number
    mode: LensMode; strength: number; fringe: number; blur: number
}

function mergeProps(props: RainbowRippleProps) {
    return {
        ...DEFAULTS,
        ...props,
        ring: { ...DEFAULTS.ring, ...props.ring },
        band: { ...DEFAULTS.band, ...props.band },
        lens: { ...DEFAULTS.lens, ...props.lens },
    }
}
function toCfg(p: ReturnType<typeof mergeProps>): Cfg {
    const { ring, band, lens } = p
    return {
        dur: ring.duration, ease: ring.easeOut, reach: ring.reach, fadeStart: ring.fadeStart,
        w0: band.startWidth, w1: band.endWidth, core: band.coreWidth, featherW: band.featherWidth,
        featherAmt: band.featherAmount, bright: band.brightness, repeats: band.repeats, hueDrift: band.drift,
        hue: band.hueShift, sat: band.saturation,
        mode: lens.mode, strength: lens.strength, fringe: lens.fringe, blur: lens.blur,
    }
}

function smooth(a: number, b: number, x: number) {
    const t = Math.min(Math.max((x - a) / (b - a), 0), 1)
    return t * t * (3 - 2 * t)
}

/* ---------- Shader: just the rainbow band, on a transparent canvas ---------- */

const VS = `
attribute vec2 a;
void main(){ gl_Position = vec4(a, 0.0, 1.0); }`

const FS = `
precision highp float;
uniform vec2 uRes;      // drawing buffer, device px
uniform float uDpr;
uniform float uTime;
uniform vec4 uRings[4]; // x, y (css px from top-left), start time (-1 = empty)
uniform vec4 uRingA;    // duration, ease-out, reach, fade start
uniform vec4 uRingB;    // start width, end width, core width, feather width
uniform vec4 uRingC;    // feather amount, brightness, rainbow repeats per 1000px, rainbow drift
uniform vec2 uRingD;    // hue shift, saturation
vec3 pal(float t){ return 0.55 + 0.45 * cos(6.2831853 * (t + vec3(0.0, 0.33, 0.67))); }
vec3 palS(float t){ vec3 c = pal(t); float l = dot(c, vec3(0.299, 0.587, 0.114)); return max(mix(vec3(l), c, uRingD.y), 0.0); }
void main(){
  vec2 css = uRes / uDpr;
  vec2 p = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y) / uDpr;
  float maxR = length(css) * uRingA.z;
  float dur = uRingA.x, life = dur * 1.15;
  vec3 acc = vec3(0.0);
  for (int i = 0; i < 4; i++){
    vec4 g = uRings[i];
    if (g.z < 0.0) continue;
    float t = uTime - g.z;
    if (t < 0.0 || t > life) continue;
    float k = clamp(t / dur, 0.0, 1.0);
    float R = maxR * (1.0 - pow(1.0 - k, uRingA.y));
    float L = length(p - g.xy);
    float s = (L - R) / mix(uRingB.x, uRingB.y, k);
    float fade = 1.0 - smoothstep(uRingA.w * dur, life, t);
    float core = exp(-pow(s / uRingB.z, 2.0));
    float halo = exp(-pow(s / uRingB.w, 2.0)) * uRingC.x;
    acc += palS(L * uRingC.z * 0.001 - t * uRingC.w + s * 0.12 + uRingD.x) * (core + halo) * fade * uRingC.y;
  }
  acc = min(acc, vec3(1.0));
  // Premultiplied: alpha follows the brightest channel, so the band is see-through elsewhere
  gl_FragColor = vec4(acc, max(acc.r, max(acc.g, acc.b)));
}`

/* ---------- DialKit inspector ---------- */

// Same labels as the V3 demo panel where the setting is the same. DialKit uses keys as labels.
function dialConfig(c: Cfg) {
    return {
        "Send a ring": { type: "action" },
        "Ring motion": {
            "Duration (s)": [c.dur, 0.6, 6, 0.1],
            "Ease-out strength": [c.ease, 1, 6, 0.1],
            "Reach (× screen)": [c.reach, 0.2, 1.5, 0.01],
            "Fade starts at": [c.fadeStart, 0, 1, 0.01],
        },
        "Rainbow band": {
            "Start width (px)": [c.w0, 4, 200, 1],
            "End width (px)": [c.w1, 4, 400, 1],
            "Core width": [c.core, 0.05, 2, 0.01],
            "Feather width": [c.featherW, 0.1, 4, 0.01],
            "Feather amount": [c.featherAmt, 0, 1, 0.01],
            Brightness: [c.bright, 0, 2, 0.01],
            "Rainbow repeats": [c.repeats, 0, 12, 0.05],
            "Rainbow drift": [c.hueDrift, 0, 2, 0.01],
            "Hue shift": [c.hue, 0, 1, 0.01],
            Saturation: [c.sat, 0, 1.5, 0.01],
        },
        "Refraction": {
            Mode: { type: "select", options: ["Auto", "Refract", "Blur", "Off"], default: c.mode },
            "Strength (px)": [c.strength, 0, 80, 0.5],
            "Rainbow fringe": [c.fringe, 0, 1, 0.01],
            "Blur (px)": [c.blur, 0, 20, 0.5],
        },
        "Reset to defaults": { type: "action" },
    }
}
function fromPanel(v: any): Cfg {
    const r = v["Ring motion"], b = v["Rainbow band"], l = v["Refraction"]
    return {
        dur: r["Duration (s)"], ease: r["Ease-out strength"], reach: r["Reach (× screen)"], fadeStart: r["Fade starts at"],
        w0: b["Start width (px)"], w1: b["End width (px)"], core: b["Core width"], featherW: b["Feather width"],
        featherAmt: b["Feather amount"], bright: b["Brightness"], repeats: b["Rainbow repeats"],
        hueDrift: b["Rainbow drift"], hue: b["Hue shift"], sat: b["Saturation"],
        mode: l["Mode"], strength: l["Strength (px)"], fringe: l["Rainbow fringe"], blur: l["Blur (px)"],
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

/* ---------- Component ---------- */

/**
 * Rainbow Ripple
 * A transparent overlay. Place it above everything (Fixed, full screen, high z-index,
 * pointer events off). Any click sends an iridescent ring that refracts whatever is underneath.
 *
 * @framerIntrinsicWidth 1200
 * @framerIntrinsicHeight 800
 *
 * @framerSupportedLayoutWidth any-prefer-fixed
 * @framerSupportedLayoutHeight any-prefer-fixed
 */
export default function RainbowRipple(props: RainbowRippleProps) {
    const p = mergeProps(props)

    const rootRef = React.useRef<HTMLDivElement>(null)
    const lensRef = React.useRef<HTMLDivElement>(null)
    const canvasRef = React.useRef<HTMLCanvasElement>(null)
    const filterRef = React.useRef<SVGFilterElement>(null)
    const mapRef = React.useRef<SVGFEImageElement>(null)
    const dRRef = React.useRef<SVGFEDisplacementMapElement>(null)
    const dGRef = React.useRef<SVGFEDisplacementMapElement>(null)
    const dBRef = React.useRef<SVGFEDisplacementMapElement>(null)

    // A unique filter id per instance (useId output contains ":" which url(#...) dislikes)
    const filterId = "rr-lens-" + React.useId().replace(/[^a-zA-Z0-9_-]/g, "")

    // The loop reads the latest settings from here, so changing a control never restarts WebGL
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
        const lens = lensRef.current!
        const canvas = canvasRef.current!
        const fil = filterRef.current!, feMap = mapRef.current!
        const dR = dRRef.current!, dG = dGRef.current!, dB = dBRef.current!

        const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches
        const C = () => (panelRef.current ? { ...cfgRef.current, ...panelRef.current } : cfgRef.current)

        /* WebGL: one program that draws only the band */
        const maybeGl = canvas.getContext("webgl", { alpha: true, premultipliedAlpha: true, antialias: false })
        const gl: WebGLRenderingContext | null = maybeGl
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
            gl.attachShader(prog, compile(gl.VERTEX_SHADER, VS))
            gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FS))
            gl.bindAttribLocation(prog, 0, "a")
            gl.linkProgram(prog)
            gl.useProgram(prog)
            gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer())
            gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)
            gl.enableVertexAttribArray(0)
            gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)
            for (const n of ["uRes", "uDpr", "uTime", "uRings", "uRingA", "uRingB", "uRingC", "uRingD"]) u[n] = gl.getUniformLocation(prog, n)
        }

        /* Size, in css px of the component (offset sizes, so Framer's canvas zoom doesn't skew them) */
        let W = 1, H = 1
        function resize() {
            const w = Math.max(1, root.offsetWidth), h = Math.max(1, root.offsetHeight)
            const d = Math.min(window.devicePixelRatio || 1, 1.5)
            W = w
            H = h
            canvas.width = Math.round(w * d)
            canvas.height = Math.round(h * d)
            gl?.viewport(0, 0, canvas.width, canvas.height)
        }

        /* Rings */
        const rings = new Float32Array(16).fill(-1)
        let slot = 0
        let time = 0
        const life = () => C().dur * 1.15
        function ringsAlive() {
            for (let i = 0; i < 4; i++) {
                const st = rings[i * 4 + 2]
                if (st >= 0 && time - st >= 0 && time - st <= life()) return true
            }
            return false
        }

        function draw() {
            if (!gl) return
            const c = C()
            gl.clearColor(0, 0, 0, 0)
            gl.clear(gl.COLOR_BUFFER_BIT)
            gl.uniform2f(u.uRes, canvas.width, canvas.height)
            gl.uniform1f(u.uDpr, canvas.width / W)
            gl.uniform1f(u.uTime, time)
            gl.uniform4fv(u.uRings, rings)
            gl.uniform4f(u.uRingA, c.dur, c.ease, c.reach, c.fadeStart)
            gl.uniform4f(u.uRingB, c.w0, c.w1, c.core, c.featherW)
            gl.uniform4f(u.uRingC, c.featherAmt, c.bright, c.repeats, c.hueDrift)
            gl.uniform2f(u.uRingD, c.hue, c.sat)
            gl.drawArrays(gl.TRIANGLES, 0, 3)
        }
        function clear() {
            if (!gl) return
            gl.clearColor(0, 0, 0, 0)
            gl.clear(gl.COLOR_BUFFER_BIT)
        }

        /* Lens: bends the page behind the overlay along the band.
           Refract: backdrop-filter with an SVG displacement map redrawn from the ring each frame.
           Only Chromium browsers apply SVG filters to the backdrop.
           Blur: a blurred, saturated backdrop masked to the band. Works in Safari and Firefox. */
        const ua = navigator.userAgent
        const chromium = /Chrome\/|Chromium\/|Edg\//.test(ua) && !/CriOS|FxiOS|EdgiOS/.test(ua)
        const mapC = document.createElement("canvas")
        const mapX = mapC.getContext("2d")
        let mapImg: ImageData | null = null
        let lensOn = ""
        const tmp = [0, 0, 0]

        // Same maths as the shader. Writes [x offset, y offset, band] in component px; offsets in -1..1.
        function field(x: number, y: number, o: number[]) {
            const c = C()
            o[0] = o[1] = o[2] = 0
            const maxR = Math.hypot(W, H) * c.reach, dur = c.dur, lf = dur * 1.15
            for (let i = 0; i < 4; i++) {
                const st = rings[i * 4 + 2]
                if (st < 0) continue
                const t = time - st
                if (t < 0 || t > lf) continue
                const k = Math.min(t / dur, 1), R = maxR * (1 - Math.pow(1 - k, c.ease))
                const dx = x - rings[i * 4], dy = y - rings[i * 4 + 1]
                const L = Math.hypot(dx, dy) + 1e-4
                const s = (L - R) / (c.w0 + (c.w1 - c.w0) * k)
                const fade = 1 - smooth(c.fadeStart * dur, lf, t)
                const n = (-s * Math.exp(-1.5 * s * s)) / 0.35 * fade
                o[0] += (dx / L) * n
                o[1] += (dy / L) * n
                o[2] += Math.exp(-((s / c.core) ** 2)) * fade
            }
        }
        function setLens(kind: string) {
            if (kind === lensOn) return
            lensOn = kind
            const st = lens.style as any
            if (kind === "refract") {
                st.backdropFilter = `url(#${filterId})`
                st.webkitBackdropFilter = ""
                st.maskImage = st.webkitMaskImage = ""
            } else if (kind === "blur") {
                // backdrop-filter and the mask are set per frame in updateLens
            } else {
                st.backdropFilter = st.webkitBackdropFilter = ""
                st.maskImage = st.webkitMaskImage = ""
            }
        }
        function updateLens(alive: boolean) {
            const c = C()
            const mode = reduce ? "Off" : c.mode === "Auto" ? (chromium ? "Refract" : "Blur") : c.mode
            if (!alive || mode === "Off") return setLens("")

            if (mode === "Refract" && mapX && c.strength > 0) {
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
                const S = c.strength * 2, f = c.fringe * 0.35
                dR.setAttribute("scale", String(S * (1 + f)))
                dG.setAttribute("scale", String(S))
                dB.setAttribute("scale", String(S * (1 - f)))
                return setLens("refract")
            }

            if (mode === "Blur" && c.blur > 0) {
                setLens("blur")
                const maxR = Math.hypot(W, H) * c.reach, dur = c.dur, lf = dur * 1.15
                const masks: string[] = []
                for (let i = 0; i < 4; i++) {
                    const st = rings[i * 4 + 2]
                    if (st < 0) continue
                    const t = time - st
                    if (t < 0 || t > lf) continue
                    const k = Math.min(t / dur, 1), R = maxR * (1 - Math.pow(1 - k, c.ease))
                    const w = (c.w0 + (c.w1 - c.w0) * k) * Math.max(0.6, c.featherW)
                    const a = (1 - smooth(c.fadeStart * dur, lf, t)).toFixed(3)
                    const x = rings[i * 4].toFixed(1), y = rings[i * 4 + 1].toFixed(1)
                    masks.push(
                        `radial-gradient(circle at ${x}px ${y}px, transparent ${Math.max(0, R - w).toFixed(1)}px, rgba(0,0,0,${a}) ${R.toFixed(1)}px, transparent ${(R + w).toFixed(1)}px)`
                    )
                }
                const st = lens.style as any
                const bf = `blur(${c.blur}px) saturate(1.6)`
                st.backdropFilter = bf
                st.webkitBackdropFilter = bf
                st.maskImage = st.webkitMaskImage = masks.length ? masks.join(",") : "none"
                return
            }
            setLens("")
        }

        function sendRing(x = W / 2, y = H / 2) {
            const o = slot * 4
            rings[o] = x
            rings[o + 1] = y
            rings[o + 2] = time
            rings[o + 3] = 0
            slot = (slot + 1) % 4
            start()
        }
        sendRingRef.current = sendRing

        /* Loop runs only while a ring is alive, so the overlay costs nothing at rest */
        let raf = 0, last = 0
        function frame(nowMs: number) {
            const dt = Math.min((nowMs - (last || nowMs - 16)) / 1000, 1 / 30)
            last = nowMs
            time += dt * (reduce ? 0.6 : 1)
            const alive = ringsAlive()
            if (alive) draw()
            else clear()
            updateLens(alive)
            raf = alive ? requestAnimationFrame(frame) : 0
            if (!alive) last = 0
        }
        function start() {
            if (!raf) raf = requestAnimationFrame(frame)
        }

        // Any click on the page (inside this overlay's area) sends a ring. The overlay itself
        // ignores the pointer, so the click still reaches the link or button underneath.
        const onDown = (e: PointerEvent) => {
            const target = e.target as Element | null
            if (target && target.closest && target.closest(".dialkit-panel, .dialkit-root, [data-dialkit]")) return
            const r = root.getBoundingClientRect()
            if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) return
            const scale = r.width / W || 1
            sendRing((e.clientX - r.left) / scale, (e.clientY - r.top) / scale)
        }

        /* Editor: a still ring part-way out */
        function freezePreview() {
            resize()
            rings.fill(-1)
            time = 10
            if (previewRef.current) {
                rings[0] = W * 0.5
                rings[1] = H * 0.5
                // Pick the moment the ring's radius is about a third of the frame
                const c = C()
                const maxR = Math.hypot(W, H) * c.reach
                const frac = Math.min(0.95, (Math.min(W, H) * 0.34) / Math.max(1, maxR))
                const k = 1 - Math.pow(1 - frac, 1 / Math.max(1, c.ease))
                rings[2] = time - c.dur * Math.min(k, Math.max(0, c.fadeStart - 0.02))
                draw()
            } else clear()
        }

        const ro = new ResizeObserver(() => {
            if (isEditor) freezePreview()
            else {
                resize()
                if (!raf) clear()
            }
        })
        ro.observe(root)

        if (isEditor) {
            freezePreview()
            redrawRef.current = freezePreview
        } else {
            resize()
            window.addEventListener("pointerdown", onDown, true)
            redrawRef.current = () => {}
        }

        return () => {
            cancelAnimationFrame(raf)
            raf = 0
            ro.disconnect()
            window.removeEventListener("pointerdown", onDown, true)
            setLens("")
            redrawRef.current = () => {}
            sendRingRef.current = () => {}
            gl?.getExtension("WEBGL_lose_context")?.loseContext()
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
                kit = DialKit.createDialKit("Rainbow ripple", dialConfig(cfgRef.current), {
                    onAction: (path: string) => {
                        if (path === "Send a ring") sendRingRef.current()
                        if (path === "Reset to defaults") kit?.resetValues()
                    },
                })
                kit.subscribe((values: any) => {
                    panelRef.current = fromPanel(values)
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
        }
    }, [showInspector, p.inspectorPosition])

    return (
        <div
            ref={rootRef}
            aria-hidden="true"
            style={{
                position: "relative",
                width: "100%",
                height: "100%",
                overflow: "hidden",
                pointerEvents: "none",
                ...props.style,
            }}
        >
            <style>{CSS}</style>
            <svg width="0" height="0" focusable="false" style={{ position: "absolute" }}>
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
            {/* Lens layer: its backdrop is the page underneath */}
            <div ref={lensRef} style={{ position: "absolute", inset: 0 }} />
            {/* Rainbow band, composited with its own transparency. No mix-blend-mode here: a blended
                child isolates this layer, and the lens would then only see this layer, not the page. */}
            <canvas
                ref={canvasRef}
                style={{ position: "absolute", inset: 0, width: "100%", height: "100%", display: "block" }}
            />
        </div>
    )
}

RainbowRipple.displayName = "Rainbow Ripple"

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

addPropertyControls(RainbowRipple, {
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
        hidden: (props: RainbowRippleProps) => props.inspector === false,
    },
    previewInEditor: { type: ControlType.Boolean, title: "Editor Preview", defaultValue: true },
    ring: {
        type: ControlType.Object,
        title: "Ring Motion",
        controls: {
            duration: slider("Duration", DEFAULTS.ring.duration, 0.6, 6, 0.1, "s"),
            easeOut: slider("Ease-out", DEFAULTS.ring.easeOut, 1, 6, 0.1),
            reach: slider("Reach", DEFAULTS.ring.reach, 0.2, 1.5, 0.01, "×"),
            fadeStart: slider("Fade Starts", DEFAULTS.ring.fadeStart, 0, 1, 0.01),
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
    lens: {
        type: ControlType.Object,
        title: "Refraction",
        controls: {
            mode: {
                type: ControlType.Enum,
                title: "Mode",
                defaultValue: DEFAULTS.lens.mode,
                options: ["Auto", "Refract", "Blur", "Off"],
                description: "Auto: Refract in Chrome and Edge, Blur in Safari and Firefox.",
            },
            strength: slider("Strength", DEFAULTS.lens.strength, 0, 80, 0.5, "px"),
            fringe: slider("Fringe", DEFAULTS.lens.fringe, 0, 1, 0.01),
            blur: slider("Blur", DEFAULTS.lens.blur, 0, 20, 0.5, "px"),
        },
    },
})
