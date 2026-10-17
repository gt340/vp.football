const PLAYER_RENDER = {
  shadowRX: 11 * WORLD_RADIAL_SCALE, shadowRY: 4.5 * WORLD_RADIAL_SCALE,
  legOffX1: 6 * WORLD_RADIAL_SCALE, legOffX2: 1.5 * WORLD_RADIAL_SCALE, legY: 1 * WORLD_RADIAL_SCALE, legW: 4.5 * WORLD_RADIAL_SCALE, legH: 10 * WORLD_RADIAL_SCALE,
  bodyOffX: 9 * WORLD_RADIAL_SCALE, bodyOffY: 11 * WORLD_RADIAL_SCALE, bodyW: 18 * WORLD_RADIAL_SCALE, bodyH: 16 * WORLD_RADIAL_SCALE, bodyRadius: 5 * WORLD_RADIAL_SCALE,
  numOffX: 2.5 * WORLD_RADIAL_SCALE, numOffY: 7 * WORLD_RADIAL_SCALE, numW: 5 * WORLD_RADIAL_SCALE, numH: 9 * WORLD_RADIAL_SCALE,
  gloveOffX1: 11 * WORLD_RADIAL_SCALE, gloveOffX2: 7 * WORLD_RADIAL_SCALE, gloveOffY: 2 * WORLD_RADIAL_SCALE, gloveW: 4 * WORLD_RADIAL_SCALE, gloveH: 5 * WORLD_RADIAL_SCALE,
  headGradOffX: 2 * WORLD_RADIAL_SCALE, headGradOffY: 17 * WORLD_RADIAL_SCALE, headGradR0: 1 * WORLD_RADIAL_SCALE, headOffY: 15 * WORLD_RADIAL_SCALE, headR: 7.5 * WORLD_RADIAL_SCALE,
  eyeOffX: 2.2 * WORLD_RADIAL_SCALE, eyeOffY: 16 * WORLD_RADIAL_SCALE, eyeR: 1.3 * WORLD_RADIAL_SCALE,
  ringOffY: 3 * WORLD_RADIAL_SCALE, ringR: 16 * WORLD_RADIAL_SCALE, ringLW: 2.5 * WORLD_RADIAL_SCALE,
  gkLabelFontPx: Math.round(8 * WORLD_RADIAL_SCALE), gkLabelOffY: 18 * WORLD_RADIAL_SCALE,
  stunFontPx: Math.round(11 * WORLD_RADIAL_SCALE), stunOffX: 4 * WORLD_RADIAL_SCALE, stunOffY: 26 * WORLD_RADIAL_SCALE,
  ballShadowOffX: 1 * WORLD_RADIAL_SCALE, ballShadowOffY: 5 * WORLD_RADIAL_SCALE, ballShadowRX: 8 * WORLD_RADIAL_SCALE, ballShadowRY: 3.5 * WORLD_RADIAL_SCALE,
  ballGradOffX: 2 * WORLD_RADIAL_SCALE, ballGradOffY: 2 * WORLD_RADIAL_SCALE, ballGradR0: 1 * WORLD_RADIAL_SCALE,
  ballDotOffY: 1.5 * WORLD_RADIAL_SCALE, ballDotR: 2.5 * WORLD_RADIAL_SCALE,
};
function drawPlayer(p) {
  const R = PLAYER_RENDER;
  const controlled = p.id === state.controlledId;
  ctx.fillStyle = 'rgba(0,0,0,0.32)';
  ctx.beginPath(); ctx.ellipse(p.x + 1, p.y + R.shadowRY * 2, R.shadowRX, R.shadowRY, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#1e1e2e';
  ctx.fillRect(p.x - R.legOffX1, p.y + R.legY, R.legW, R.legH); ctx.fillRect(p.x + R.legOffX2, p.y + R.legY, R.legW, R.legH);
  const g = ctx.createLinearGradient(p.x - R.bodyOffX, p.y - R.bodyOffY, p.x + R.bodyOffX, p.y + 6 * WORLD_RADIAL_SCALE);
  g.addColorStop(0, lighten(p.team.primary, 28)); g.addColorStop(1, p.team.primary);
  ctx.fillStyle = g; roundRect(p.x - R.bodyOffX, p.y - R.bodyOffY, R.bodyW, R.bodyH, R.bodyRadius); ctx.fill();
  ctx.fillStyle = p.team.secondary === '#ffffff' ? '#ddd' : p.team.secondary;
  ctx.fillRect(p.x - R.numOffX, p.y - R.numOffY, R.numW, R.numH);
  if (p.isGK) {
    ctx.fillStyle = '#f8fafc';
    ctx.fillRect(p.x - R.gloveOffX1, p.y - R.gloveOffY, R.gloveW, R.gloveH); ctx.fillRect(p.x + R.gloveOffX2, p.y - R.gloveOffY, R.gloveW, R.gloveH);
  }
  const hg = ctx.createRadialGradient(p.x - R.headGradOffX, p.y - R.headGradOffY, R.headGradR0, p.x, p.y - R.headOffY, R.headR);
  hg.addColorStop(0, '#fde68a'); hg.addColorStop(1, '#b45309');
  ctx.fillStyle = hg; ctx.beginPath(); ctx.arc(p.x, p.y - R.headOffY, R.headR, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#111';
  ctx.beginPath(); ctx.arc(p.x - R.eyeOffX, p.y - R.eyeOffY, R.eyeR, 0, Math.PI * 2);
  ctx.arc(p.x + R.eyeOffX, p.y - R.eyeOffY, R.eyeR, 0, Math.PI * 2); ctx.fill();
  if (controlled) {
    ctx.strokeStyle = '#00e5b0'; ctx.lineWidth = R.ringLW;
    ctx.beginPath(); ctx.arc(p.x, p.y - R.ringOffY, R.ringR, 0, Math.PI * 2); ctx.stroke();
  }
  if (p.isGK) {
    ctx.fillStyle = 'rgba(255,255,255,0.85)'; ctx.font = `bold ${R.gkLabelFontPx}px sans-serif`;
    ctx.textAlign = 'center'; ctx.fillText('GK', p.x, p.y + R.gkLabelOffY); ctx.textAlign = 'left';
  }
  if (p.stunned > 0) {
    ctx.fillStyle = '#fbbf24'; ctx.font = `${R.stunFontPx}px sans-serif`; ctx.fillText('z', p.x - R.stunOffX, p.y - R.stunOffY);
  }
}
function drawBall() {
  const R = PLAYER_RENDER;
  const b = state.ball;
  ctx.fillStyle = 'rgba(0,0,0,0.28)';
  ctx.beginPath(); ctx.ellipse(b.x + R.ballShadowOffX, b.y + R.ballShadowOffY, R.ballShadowRX, R.ballShadowRY, 0, 0, Math.PI * 2); ctx.fill();
  const g = ctx.createRadialGradient(b.x - R.ballGradOffX, b.y - R.ballGradOffY, R.ballGradR0, b.x, b.y, b.r);
  g.addColorStop(0, '#fff'); g.addColorStop(0.75, '#e2e2e2'); g.addColorStop(1, '#aaa');
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#222'; ctx.beginPath(); ctx.arc(b.x, b.y - R.ballDotOffY, R.ballDotR, 0, Math.PI * 2); ctx.fill();
}
function roundRect(x, y, w, h, r) {
  ctx.beginPath(); ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}
function lighten(hex, amt) {
  const n = parseInt(hex.replace('#', ''), 16);
  return `rgb(${Math.min(255,(n>>16)+amt)},${Math.min(255,((n>>8)&255)+amt)},${Math.min(255,(n&255)+amt)})`;
}

