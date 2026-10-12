/* ---------- AUDIO FOUNDATION (Step 16) ----------
   All Web Audio + speech-synthesis code lives behind this namespace.
   Behavior/tones are unchanged from the original implementation. */
const AudioManager = (() => {
  let audioCtx = null;
  function ensure() {
    if (!audioCtx) {
      try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { /* unsupported */ }
    }
    if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
    return audioCtx;
  }
  function playTone(freq, dur, type, vol, slideTo) {
    if (!state.soundOn || !SettingsManager.current.audio.sfx) return;
    const c = ensure();
    if (!c) return;
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = type || 'sine';
    osc.frequency.setValueAtTime(freq, c.currentTime);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, c.currentTime + dur);
    gain.gain.setValueAtTime(vol || 0.15, c.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, c.currentTime + dur);
    osc.connect(gain); gain.connect(c.destination);
    osc.start(); osc.stop(c.currentTime + dur);
  }
  function noiseBurst(seconds, amp, envelopeExp, gainVal) {
    if (!state.soundOn || !SettingsManager.current.audio.sfx) return;
    const c = ensure();
    if (!c) return;
    const bufferSize = c.sampleRate * seconds;
    const buffer = c.createBuffer(1, bufferSize, c.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = (Math.random() * 2 - 1) * amp * (envelopeExp ? Math.exp(-i / (bufferSize * envelopeExp)) : 1);
    }
    const noise = c.createBufferSource();
    noise.buffer = buffer;
    const g = c.createGain();
    g.gain.value = gainVal;
    noise.connect(g); g.connect(c.destination);
    noise.start();
  }
  return {
    ensure,
    kick() { playTone(120, 0.08, 'triangle', 0.2, 60); playTone(80, 0.12, 'sine', 0.12, 40); },
    pass() { playTone(200, 0.06, 'sine', 0.12, 140); },
    tackle() { playTone(90, 0.1, 'sawtooth', 0.1, 50); },
    whistle() { playTone(880, 0.25, 'sine', 0.15); setTimeout(() => playTone(880, 0.15, 'sine', 0.12), 280); },
    goal() {
      playTone(440, 0.15, 'square', 0.12);
      setTimeout(() => playTone(554, 0.15, 'square', 0.12), 120);
      setTimeout(() => playTone(659, 0.2, 'square', 0.14), 240);
      setTimeout(() => playTone(880, 0.35, 'sine', 0.16), 400);
      noiseBurst(1.2, 0.08, 0.4, 0.35);
    },
    crowdLow() { noiseBurst(0.4, 0.03, 0, 0.2); },
    // Phase 2, Step 29: short referee's-whistle variants for stoppages,
    // built from the same playTone/noiseBurst primitives as Phase 1.
    foulWhistle() { playTone(1000, 0.14, 'sine', 0.14); setTimeout(() => playTone(1000, 0.1, 'sine', 0.11), 180); },
    card(isRed) { playTone(isRed ? 220 : 330, 0.22, 'sawtooth', 0.13, isRed ? 160 : 260); },
    offside() { playTone(760, 0.1, 'square', 0.1); setTimeout(() => playTone(600, 0.12, 'square', 0.1), 110); },
    setPieceWhistle() { playTone(1000, 0.16, 'sine', 0.13); },
    speak(text) {
      if (!(state.soundOn && SettingsManager.current.audio.commentary) || !window.speechSynthesis) return;
      try {
        window.speechSynthesis.cancel();
        const u = new SpeechSynthesisUtterance(text);
        u.rate = AUDIO_CONFIG.voiceRate; u.pitch = AUDIO_CONFIG.voicePitch; u.volume = AUDIO_CONFIG.voiceVolume;
        const voices = window.speechSynthesis.getVoices();
        const en = voices.find(v => v.lang.startsWith('en') && /male|daniel|david|james/i.test(v.name))
          || voices.find(v => v.lang.startsWith('en'));
        if (en) u.voice = en;
        window.speechSynthesis.speak(u);
      } catch (e) { /* speech synthesis unsupported/blocked */ }
    },
    cancelSpeech() { if (window.speechSynthesis) window.speechSynthesis.cancel(); },
  };
})();

/* ---------- COMMENTARY ---------- */
const COMMENT_LINES = {
  kickoff: ["And we're underway!", "The referee blows the whistle — kick off!", "Here we go, the match begins!"],
  goalHome: ["GOAL! What a finish!", "It's in the back of the net!", "They score! The crowd goes wild!", "Brilliant strike! Goal!", "He's done it! Absolute scenes!"],
  goalAway: ["Oh no, they've scored!", "Goal for the opposition!", "Conceded... that hurts.", "They find the net. Frustrating."],
  nearMiss: ["Just wide!", "So close!", "That was nearly a goal!"],
  goodPass: ["Lovely pass.", "Great vision there.", "Nice ball!"],
  tackle: ["Strong challenge!", "Won the ball cleanly.", "Good defensive work."],
  time: ["The clock is ticking.", "Time running out now.", "Final minutes approaching."],
  foul: ["That's a foul.", "The referee's whistle goes.", "Free kick given away there."],
  yellow: ["That's a booking.", "Yellow card shown.", "The referee reaches for his pocket."],
  red: ["Red card! He's off!", "Sent off! Down to ten men.", "That's a straight red!"],
  offside: ["Offside! Flag's up.", "The linesman's flag goes up.", "Caught offside there."],
  penalty: ["Penalty! This could be crucial.", "The referee points to the spot!"],
  corner: ["Corner kick.", "It's out for a corner."],
  goalKick: ["Goal kick.", "It's a goal kick."],
  throwIn: ["Throw-in.", "Out for a throw."],
};
let commentHideTimer = null;
function showCommentary(text, ms = UI_CONFIG.commentaryDefaultMs) {
  const el = document.getElementById('commentary');
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(commentHideTimer);
  commentHideTimer = setTimeout(() => el.classList.remove('show'), ms);
  AudioManager.speak(text);
}
// Phase 2, Step 28: minimal reusable notification banner for rules
// events (fouls, cards, offside, set pieces, halftime) — same visual
// language as the existing goal banner, no new screen or redesign.
let rulesBannerTimer = null;
function showRulesBanner(text, color, ms = 1500) {
  const el = document.getElementById('rules-banner');
  el.textContent = text;
  el.style.color = color || '#f8fafc';
  el.classList.add('show');
  clearTimeout(rulesBannerTimer);
  rulesBannerTimer = setTimeout(() => el.classList.remove('show'), ms);
}
function randomLine(key) {
  const arr = COMMENT_LINES[key];
  return arr[Math.floor(Math.random() * arr.length)];
}

document.getElementById('sound-toggle').onclick = () => {
  state.soundOn = !state.soundOn;
  document.getElementById('sound-toggle').textContent = state.soundOn ? '🔊 Sound' : '🔇 Muted';
  if (state.soundOn) AudioManager.ensure(); else AudioManager.cancelSpeech();
  SettingsManager.persist();
};

