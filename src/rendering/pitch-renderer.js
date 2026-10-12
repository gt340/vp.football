/* ---------- RENDERER ---------- */
function draw() {
  const { w, h, sx, sy, offX, offY } = Camera.computeTransform();
  ctx.fillStyle = '#0a1620'; ctx.fillRect(0, 0, w, h);
  ctx.save(); ctx.translate(offX, offY); ctx.scale(sx, sy);

  const sky = ctx.createLinearGradient(0, 0, 0, PITCH.h);
  sky.addColorStop(0, '#1a3555'); sky.addColorStop(0.28, '#1e4a32'); sky.addColorStop(1, '#163d28');
  ctx.fillStyle = sky; ctx.fillRect(0, 0, PITCH.w, PITCH.h);
  ctx.fillStyle = '#0d2a1a';
  ctx.beginPath(); ctx.moveTo(0, 100);
  for (let x = 0; x <= PITCH.w; x += 50) ctx.lineTo(x, 75 + Math.sin(x * 0.015) * 22);
  ctx.lineTo(PITCH.w, 0); ctx.lineTo(0, 0); ctx.fill();
  ctx.fillStyle = 'rgba(18,22,35,0.85)'; ctx.fillRect(0, 0, PITCH.w, 58);
  ctx.fillStyle = 'rgba(45,55,75,0.5)';
  for (let i = 0; i < 14; i++) ctx.fillRect(40 + i * 90, 12, 55, 32);

  ctx.fillStyle = '#278a48';
  ctx.fillRect(PITCH.margin - 4, PITCH.margin - 4, PITCH.w - 2 * PITCH.margin + 8, PITCH.h - 2 * PITCH.margin + 8);
  const stripe = (PITCH.w - 2 * PITCH.margin) / 14;
  for (let i = 0; i < 14; i++) {
    ctx.fillStyle = i % 2 === 0 ? '#2d9450' : '#247a42';
    ctx.fillRect(PITCH.margin + i * stripe, PITCH.margin, stripe, PITCH.h - 2 * PITCH.margin);
  }
  ctx.strokeStyle = 'rgba(255,255,255,0.92)'; ctx.lineWidth = 3;
  ctx.strokeRect(PITCH.margin, PITCH.margin, PITCH.w - 2 * PITCH.margin, PITCH.h - 2 * PITCH.margin);
  ctx.beginPath(); ctx.moveTo(PITCH.w / 2, PITCH.margin); ctx.lineTo(PITCH.w / 2, PITCH.h - PITCH.margin); ctx.stroke();
  ctx.beginPath(); ctx.arc(PITCH.w / 2, PITCH.h / 2, PITCH_CONFIG.centerCircleRadius, 0, Math.PI * 2); ctx.stroke();
  ctx.beginPath(); ctx.arc(PITCH.w / 2, PITCH.h / 2, PITCH_CONFIG.centerMarkRadius, 0, Math.PI * 2); ctx.fillStyle = '#fff'; ctx.fill();
  const penW = PITCH_CONFIG.penaltyAreaDepth, penH = PITCH_CONFIG.penaltyAreaWidth;
  ctx.strokeRect(PITCH.margin, PITCH.h / 2 - penH / 2, penW, penH);
  ctx.strokeRect(PITCH.w - PITCH.margin - penW, PITCH.h / 2 - penH / 2, penW, penH);
  const gaW = PITCH_CONFIG.sixYardAreaDepth, gaH = PITCH_CONFIG.sixYardAreaWidth;
  ctx.strokeRect(PITCH.margin, PITCH.h / 2 - gaH / 2, gaW, gaH);
  ctx.strokeRect(PITCH.w - PITCH.margin - gaW, PITCH.h / 2 - gaH / 2, gaW, gaH);
  ctx.fillStyle = 'rgba(255,255,255,0.14)';
  ctx.fillRect(PITCH.margin - GOAL_D, PITCH.h / 2 - GOAL_W / 2, GOAL_D, GOAL_W);
  ctx.fillRect(PITCH.w - PITCH.margin, PITCH.h / 2 - GOAL_W / 2, GOAL_D, GOAL_W);
  ctx.strokeStyle = '#fff'; ctx.lineWidth = 4;
  ctx.strokeRect(PITCH.margin - GOAL_D, PITCH.h / 2 - GOAL_W / 2, GOAL_D, GOAL_W);
  ctx.strokeRect(PITCH.w - PITCH.margin, PITCH.h / 2 - GOAL_W / 2, GOAL_D, GOAL_W);

  if (state.goalFlash > 0) {
    ctx.fillStyle = `rgba(255,215,40,${Math.min(0.35, state.goalFlash / 100)})`;
    ctx.fillRect(0, 0, PITCH.w, PITCH.h);
  }
  const sorted = activePlayers().slice().sort((a, b) => a.y - b.y);
  for (const p of sorted) drawPlayer(p);
  drawBall();
  ctx.restore();
}

// Cosmetic sprite dimensions, computed once (not per-frame — Step 19
// perf guidance) from the original hand-tuned pixel values so drawn
// players/ball keep the same visual proportions on the larger pitch
// instead of shrinking relative to it.
