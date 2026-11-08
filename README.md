# Avatar Dome

Hover the avatar to tilt it like a holographic sticker. Click it to send an iridescent liquid ring across the page. Tune everything in the DialKit panel.

Plain HTML, CSS and WebGL. No build step.

## Run locally

```bash
python3 -m http.server 5175
```

Then open http://localhost:5175.

## Files

- `index.html` — the whole demo
- `assets/avatar.jpg` — avatar photo
- `vendor/dialkit/` — [DialKit](https://joshpuckett.me/dialkit) 2.1.0 by Josh Puckett (MIT), vanilla build
- `build.py` — makes a single-file copy with everything inlined

## Deploy

Static site. On Vercel: import the repo, framework preset "Other", no build command, output directory `.` (repo root).
