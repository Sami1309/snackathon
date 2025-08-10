// Minimal Motion-like fallback using Web Animations API
// Provides window.motion.animate(el, keyframes, options)
// Supports rotate, scale, opacity, and generic CSS props.
(function(){
  if (window.motion) return; // Use CDN if available

  function normalizeKeyframes(kf) {
    // Accept array of keyframe objects or object of property -> array
    if (Array.isArray(kf)) {
      return kf.map(k => mapTransformProps(k));
    }
    if (kf && typeof kf === 'object') {
      const props = kf;
      const keys = Object.keys(props);
      const maxLen = keys.reduce((m, key) => Math.max(m, Array.isArray(props[key]) ? props[key].length : 1), 1);
      const frames = [];
      for (let i = 0; i < maxLen; i++) {
        const frame = {};
        for (const key of keys) {
          const v = Array.isArray(props[key]) ? props[key][Math.min(i, props[key].length - 1)] : props[key];
          frame[key] = v;
        }
        frames.push(mapTransformProps(frame));
      }
      return frames;
    }
    return [];
  }

  function mapTransformProps(frame){
    const out = { ...frame };
    const transforms = [];
    if (out.rotate !== undefined) {
      const val = Array.isArray(out.rotate) ? out.rotate[out.rotate.length-1] : out.rotate;
      transforms.push(`rotate(${Number(val)}deg)`);
      delete out.rotate;
    }
    if (out.scale !== undefined) {
      const val = Array.isArray(out.scale) ? out.scale[out.scale.length-1] : out.scale;
      transforms.push(`scale(${Number(val)})`);
      delete out.scale;
    }
    if (transforms.length) {
      out.transform = transforms.join(' ');
    }
    return out;
  }

  function animate(target, keyframes, options){
    const el = target;
    const frames = normalizeKeyframes(keyframes);
    const opts = { ...options };
    const repeat = opts.repeat;
    // WAAPI iterations = repeats + 1
    if (repeat === Infinity) opts.iterations = Infinity;
    else if (typeof repeat === 'number') opts.iterations = Math.max(0, repeat) + 1;
    delete opts.repeat;
    // duration in ms, delay in ms already
    const anim = el.animate(frames, opts);
    return anim; // has cancel()
  }

  window.motion = { animate };
})();

