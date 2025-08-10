import {transform} from 'sucrase';

export function transpileTSX(tsx: string) {
  // Remove import lines because we'll inject React & Remotion manually at runtime
  const noImports = tsx.replace(/^\s*import[^;]*;\s*$/gm, '');
  const out = transform(noImports, {transforms:['typescript','jsx']}).code;
  // Hoist commonly used Remotion APIs into scope so identifiers like useCurrentFrame resolve
  const inject = `// Inject common React + Remotion APIs into scope for generated code without import lines\n` +
                 `const { useState, useEffect, useMemo, useRef, useCallback, useLayoutEffect, Fragment, createElement, Suspense } = React;\n` +
                 `const { useCurrentFrame, useVideoConfig, AbsoluteFill, Img, Audio, OffthreadVideo, staticFile, continueRender, delayRender } = Remotion;\n` +
                 `const { interpolate, spring, random, Easing } = Remotion;\n` +
                 `const { Sequence, Series } = Remotion;\n`;
  // Convert ESM exports to assignments
  const adjusted = out
    .replace(/export\s+const\s+/g, 'const ')
    .replace(/export\s+default\s+/g, 'exports.default = ');
  return inject + adjusted + '\n;exports.MyComp = typeof MyComp!=="undefined" ? MyComp : (exports.default||undefined);';
}
