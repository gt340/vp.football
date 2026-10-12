/* ---------- CAMERA FOUNDATION (Step 15) ----------
   Isolates the pitch-to-canvas fit calculation from drawing itself, so
   future follow/zoom/broadcast cameras only need to change this. */
// Reserved for a future follow/zoom camera (Pitch Size patch, Step 8).
// defaultZoom/minZoom/maxZoom are currently all 1 — Camera.computeTransform()
// below always fits the ENTIRE world-space pitch into the canvas
// (same behavior as before the pitch was enlarged), which is what
// keeps this a low-risk, fully-tested change: the pitch itself is
// bigger and more realistically proportioned, but there is no new
// pan/zoom logic that could clip the ball or a player off-screen.
// followStrength is unused while zoom is locked at 1. See the Pitch
// Size Patch report for why panning/zoom was left out of this patch.
const CAMERA_CONFIG = { defaultZoom: 1, minZoom: 1, maxZoom: 1, followStrength: 0 };
const Camera = {
  computeTransform() {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    const pitchAspect = PITCH.w / PITCH.h, canvasAspect = w / h;
    let drawW, drawH, offX = 0, offY = 0;
    if (canvasAspect > pitchAspect) { drawH = h; drawW = h * pitchAspect; offX = (w - drawW) / 2; }
    else { drawW = w; drawH = w / pitchAspect; offY = (h - drawH) / 2; }
    return { w, h, sx: (drawW / PITCH.w) * CAMERA_CONFIG.defaultZoom, sy: (drawH / PITCH.h) * CAMERA_CONFIG.defaultZoom, offX, offY };
  },
};

function resize() {
  const wrap = document.getElementById('game-wrap');
  const r = wrap.getBoundingClientRect();
  canvas.width = r.width * devicePixelRatio;
  canvas.height = r.height * devicePixelRatio;
  ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
}
window.addEventListener('resize', resize);

