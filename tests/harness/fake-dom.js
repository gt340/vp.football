'use strict';
/* Minimal DOM/canvas stand-ins so the game's inline script can run headless.
 * This is NOT a browser: it proves logic and draw-call behaviour, not pixels, touch, audio or Android. */

// A canvas 2D context that accepts anything and does nothing.
function makeNoopContext() {
  const gradient = { addColorStop() {} };
  const store = {};
  return new Proxy(store, {
    get(t, k) {
      if (k === 'createRadialGradient' || k === 'createLinearGradient') return () => gradient;
      if (k === 'measureText') return () => ({ width: 10 });
      if (k in t) return t[k];
      return () => {};
    },
    set(t, k, v) { t[k] = v; return true; },
  });
}

// A generic element: stores plain properties, and any unknown method is a harmless function.
function makeElement(id, ctx2d) {
  const props = { id, _text: '', _html: '', _value: '', style: {}, dataset: {}, children: [] };
  const classes = new Set();
  const classList = {
    add: (...c) => c.forEach((x) => classes.add(x)), remove: (...c) => c.forEach((x) => classes.delete(x)),
    toggle: (c, f) => { const on = f === undefined ? !classes.has(c) : !!f; on ? classes.add(c) : classes.delete(c); return on; },
    contains: (c) => classes.has(c),
  };
  const noop = () => {};
  return new Proxy(props, {
    get(t, k) {
      if (typeof k === 'symbol') return undefined;
      if (k === 'classList') return classList;
      if (k === 'textContent') return t._text;
      if (k === 'innerHTML') return t._html;
      if (k === 'value') return t._value;
      if (k === 'clientWidth' || k === 'offsetWidth') return 1280;
      if (k === 'clientHeight' || k === 'offsetHeight') return 720;
      if (k === 'getContext') return () => ctx2d;
      if (k === 'getBoundingClientRect') return () => ({ left: 0, top: 0, width: 1280, height: 720, right: 1280, bottom: 720 });
      if (k === 'querySelectorAll' || k === 'getElementsByClassName') return () => [];
      if (k === 'querySelector') return () => makeElement(null, ctx2d);
      if (k === 'appendChild' || k === 'append' || k === 'removeChild' || k === 'remove') return noop;
      if (k === 'addEventListener' || k === 'removeEventListener' || k === 'setAttribute' || k === 'focus' || k === 'blur') return noop;
      if (k in t) return t[k];
      return noop;
    },
    set(t, k, v) {
      if (k === 'textContent') t._text = String(v); else if (k === 'innerHTML') t._html = String(v);
      else if (k === 'value') t._value = String(v); else t[k] = v;
      return true;
    },
  });
}

function makeDocument(ctx2d) {
  const byId = new Map();
  const get = (id) => { if (!byId.has(id)) byId.set(id, makeElement(id, ctx2d)); return byId.get(id); };
  const root = makeElement('root', ctx2d);
  return {
    getElementById: get, createElement: () => makeElement(null, ctx2d), querySelector: () => makeElement(null, ctx2d),
    querySelectorAll: () => [], addEventListener() {}, removeEventListener() {}, body: root, documentElement: root,
  };
}

module.exports = { makeNoopContext, makeElement, makeDocument };
