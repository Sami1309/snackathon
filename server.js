// Minimal dependency-free backend server that proxies prompts to OpenAI (gpt-5 by default)
// Requires Node.js 18+ (for global fetch) and OPENAI_API_KEY in env.

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.PORT || 3003);
const HOST = process.env.HOST || '0.0.0.0';
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-5';
const DEV_FALLBACK = String(process.env.DEV_FALLBACK || '').toLowerCase();

// Example spec used for optional dev fallback (neutral scene)
const exampleSpec = {
  version: '1.0',
  description: 'Three squares bouncing with stagger.',
  scene: {
    html: `
      <div class="row" style="position:absolute; inset:0; display:flex; gap:16px; align-items:center; justify-content:center;">
        <div class="box one" style="width:48px;height:48px;border-radius:10px;background:#6ea8fe;"></div>
        <div class="box two" style="width:48px;height:48px;border-radius:10px;background:#a07bff;"></div>
        <div class="box three" style="width:48px;height:48px;border-radius:10px;background:#56d364;"></div>
      </div>
    `
  },
  animations: [
    { targets: ['.box.one', '.box.two', '.box.three'], keyframes: { transform: ['translateY(0px)', 'translateY(-40px)', 'translateY(0px)'] }, options: { duration: 900, easing: 'ease-in-out', repeat: -1, stagger: 0.12 } },
    { targets: '.box.two', keyframes: { rotate: [0, 360] }, options: { duration: 3000, easing: 'linear', repeat: -1 } }
  ]
};

const workspaceRoot = __dirname; // repo root
const webDist = path.join(workspaceRoot, 'web', 'dist');

function sendJSON(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body)
  });
  res.end(body);
}

function sendText(res, status, text, contentType = 'text/plain; charset=utf-8') {
  res.writeHead(status, { 'Content-Type': contentType });
  res.end(text);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => {
      data += chunk;
      // rudimentary protection against very large bodies
      if (data.length > 512 * 1024) {
        reject(Object.assign(new Error('Payload too large'), { code: 'PAYLOAD_TOO_LARGE' }));
        req.destroy();
      }
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

async function callOpenAI(prompt, opts) {
  if (!OPENAI_API_KEY) {
    const err = new Error('OPENAI_API_KEY is not set');
    err.expose = true; err.status = 503;
    throw err;
  }

  const system = `# About Remotion

Remotion is a framework that can create videos programmatically.
It is based on React.js. All output should be valid React code and be written in TypeScript.

# Project structure

A Remotion Project consists of an entry file, a Root file and any number of React component files.
A project can be scaffolded using the "npx create-video@latest --blank" command.
The entry file is usually named "src/index.ts" and looks like this:

import {registerRoot} from 'remotion';
import {Root} from './Root';

registerRoot(Root);

The Root file is usually named "src/Root.tsx" and looks like this:

import {Composition} from 'remotion';
import {MyComp} from './MyComp';

export const Root: React.FC = () => {
  return (
    <>
      <Composition
        id="MyComp"
        component={MyComp}
        durationInFrames={120}
        width={1920}
        height={1080}
        fps={30}
        defaultProps={{}}
      />
    </>
  );
};

A <Composition> defines a video that can be rendered. It consists of a React "component", an "id", a "durationInFrames", a "width", a "height" and a frame rate "fps".
The default frame rate should be 30.
The default height should be 1080 and the default width should be 1920.
The default "id" should be "MyComp".
The "defaultProps" must be in the shape of the React props the "component" expects.

Inside a React "component", one can use the "useCurrentFrame()" hook to get the current frame number.
Frame numbers start at 0.

export const MyComp: React.FC = () => {
  const frame = useCurrentFrame();
  return <div>Frame {frame}</div>;
};

# Component Rules

Inside a component, regular HTML and SVG tags can be returned.
There are special tags for video and audio.
Those special tags accept regular CSS styles.

If a video is included in the component it should use the "<OffthreadVideo>" tag.

import {OffthreadVideo} from 'remotion';

export const MyComp: React.FC = () => {
  return (
    <div>
      <OffthreadVideo
        src="https://remotion.dev/bbb.mp4"
        style={{width: '100%'}}
      />
    </div>
  );
};

If an non-animated image is included In the component it should use the "<Img>" tag.

import {Img} from 'remotion';

export const MyComp: React.FC = () => {
  return <Img src="https://remotion.dev/logo.png" style={{width: '100%'}} />;
};

If an animated GIF is included, the "@remotion/gif" package should be installed and the "<Gif>" tag should be used.

import {Gif} from '@remotion/gif';

export const MyComp: React.FC = () => {
  return (
    <Gif
      src="https://media.giphy.com/media/l0MYd5y8e1t0m/giphy.gif"
      style={{width: '100%'}}
    />
  );
};

If audio is included, the "<Audio>" tag should be used.

import {Audio} from 'remotion';

export const MyComp: React.FC = () => {
  return <Audio src="https://remotion.dev/audio.mp3" />;
};

Asset sources can be specified as either a Remote URL or an asset that is referenced from the "public/" folder of the project.
If an asset is referenced from the "public/" folder, it should be specified using the "staticFile" API from Remotion

import {Audio, staticFile} from 'remotion';

export const MyComp: React.FC = () => {
  return <Audio src={staticFile('audio.mp3')} />;
};

Audio has a "trimBefore" prop that trims the left side of a audio by a number of frames.
Audio has a "trimAfter" prop that limits how long a audio is shown.
Audio has a "volume" prop that sets the volume of the audio. It accepts values between 0 and 1.

If two elements should be rendered on top of each other, they should be layered using the "AbsoluteFill" component from "remotion".

import {AbsoluteFill} from 'remotion';

export const MyComp: React.FC = () => {
  return (
    <AbsoluteFill>
      <AbsoluteFill style={{background: 'blue'}}>
        <div>This is in the back</div>
      </AbsoluteFill>
      <AbsoluteFill style={{background: 'blue'}}>
        <div>This is in front</div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

Any Element can be wrapped in a "Sequence" component from "remotion" to place the element later in the video.

import {Sequence} from 'remotion';

export const MyComp: React.FC = () => {
  return (
    <Sequence from={10} durationInFrames={20}>
      <div>This only appears after 10 frames</div>
    </Sequence>
  );
};

For displaying multiple elements after another, the "Series" component from "remotion" can be used.

import {Series} from 'remotion';

export const MyComp: React.FC = () => {
  return (
    <Series>
      <Series.Sequence durationInFrames={20}>
        <div>This only appears immediately</div>
      </Series.Sequence>
      <Series.Sequence durationInFrames={30}>
        <div>This only appears after 20 frames</div>
      </Series.Sequence>
      <Series.Sequence durationInFrames={30} offset={-8}>
        <div>This only appears after 42 frames</div>
      </Series.Sequence>
    </Series>
  );
};

Remotion needs all of the React code to be deterministic. Therefore, it is forbidden to use the Math.random() API.
If randomness is requested, use random(seed) from 'remotion'.

import {random} from 'remotion';

export const MyComp: React.FC = () => {
  return <div>Random number: {random('my-seed')}</div>;
};

Use interpolate() and spring() helpers as needed.

# Output Schema
Return ONLY a JSON object with this exact shape:
{
  "kind": "remotion-project",
  "files": {
    "src/index.ts": string,
    "src/Root.tsx": string,
    "src/MyComp.tsx": string
  },
  "compositionId": "MyComp",
  "width": 1920,
  "height": 1080,
  "fps": 30,
  "durationInFrames": 120
}

  // (moved) buildParamFallback defined after callOpenAI

No markdown code fences or comments outside code. Only JSON.

# Robustness rules (avoid runtime errors)
- Do not reference identifiers that are not declared (e.g., brandOpacity). Declare every variable and constant you use within the returned files.
- If using arrays such as colors, declare them locally (e.g., const colors = ['#6ea8fe', '#a07bff', '#56d364']).
- Avoid reading properties of possibly undefined variables (e.g., colors[i % colors.length] requires colors to be defined and non-empty).
- The returned files must be self-contained and compile in strict TypeScript without additional imports. Keep it single-file for MyComp unless explicitly asked otherwise.`;

  const body = {
    model: (opts && opts.modelOverride) || OPENAI_MODEL || "gpt-5",
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: prompt }
    ],
    response_format: { type: 'json_object' },
  };

  const resp = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${OPENAI_API_KEY}`
    },
    body: JSON.stringify(body)
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    const err = new Error(`OpenAI error: ${resp.status} ${resp.statusText} ${text}`.trim());
    err.status = 502;
    throw err;
  }

  const data = await resp.json();
  const message = data.choices?.[0]?.message?.content;
  if (!message) {
    const err = new Error('OpenAI returned no content');
    err.status = 502;
    throw err;
  }

  let spec;
  try {
    spec = JSON.parse(message);
  } catch (e) {
    const err = new Error('Failed to parse JSON from model');
    err.status = 502;
    throw err;
  }
  return spec;
}

function buildParamFallback(project) {
  const code = (project && project.files && project.files['src/MyComp.tsx']) || '';
  const m = code.match(/>([^<]{3,40})<\//);
  const name = m ? ('Block: ' + m[1].trim()) : 'Quick Block';
  return {
    id: 'blk_' + Math.random().toString(36).slice(2,10),
    name,
    params: [
      { name: 'colorPrimary', type: 'color', default: '#6ea8fe', explain: 'make the primary color {value}' },
      { name: 'title', type: 'text', default: 'Hello', explain: 'set the title text to {value}' },
      { name: 'speed', type: 'number', default: 1, explain: 'set the animation speed to {value}' }
    ]
  };
}

function serveStatic(req, res) {
  // Serve Vite build if present, otherwise legacy index.html at repo root
  let reqPath = decodeURIComponent(new URL(req.url, `http://${req.headers.host}`).pathname);
  const useWeb = fs.existsSync(webDist);
  if (reqPath === '/') reqPath = '/index.html';

  // Prevent path traversal
  const safePath = path.normalize(reqPath).replace(/^\/+/, '');
  const absPath = useWeb ? path.join(webDist, safePath) : path.join(workspaceRoot, safePath);
  if (!absPath.startsWith(workspaceRoot) && !absPath.startsWith(webDist)) {
    sendText(res, 403, 'Forbidden');
    return;
  }

  fs.readFile(absPath, (err, buf) => {
    if (err) {
      sendText(res, 404, 'Not Found');
      return;
    }
    const ext = path.extname(absPath).toLowerCase();
    const type = (
      ext === '.html' ? 'text/html; charset=utf-8' :
      ext === '.css' ? 'text/css; charset=utf-8' :
      ext === '.js' ? 'application/javascript; charset=utf-8' :
      ext === '.json' ? 'application/json; charset=utf-8' :
      ext === '.svg' ? 'image/svg+xml' :
      'application/octet-stream'
    );
    res.writeHead(200, { 'Content-Type': type });
    res.end(buf);
  });
}

const server = http.createServer(async (req, res) => {
  try {
    const { method, url } = req;
    // Basic CORS support for dev if served from a different origin
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

    if (method === 'GET' && url.startsWith('/api/health')) {
      sendJSON(res, 200, { ok: true, model: OPENAI_MODEL, hasKey: Boolean(OPENAI_API_KEY) });
      return;
    }

    if (method === 'POST' && url.startsWith('/api/blocks/params')) {
      const raw = await readBody(req);
      let json;
      try { json = JSON.parse(raw || '{}'); } catch { return sendJSON(res, 400, { error: 'Invalid JSON' }); }
      const project = json.project;
      if (!project || !project.files || typeof project.files['src/MyComp.tsx'] !== 'string') {
        return sendJSON(res, 400, { error: 'Missing project files' });
      }
      try {
        if (!OPENAI_API_KEY) {
          // No key configured: return a deterministic fallback so UX works in demos
          return sendJSON(res, 200, buildParamFallback(project));
        }
        // Use faster model via callOpenAI with a specialized prompt inline to keep code simple
        const fastModel = process.env.OPENAI_FAST_MODEL || 'gpt-5-nano';
        const sys = `Analyze the given Remotion project files and extract exactly 3 high-impact, user-facing parameters that best control the animation (for example: color, speed/duration, title/text, size). Return ONLY JSON in this shape:
{
  id: string,
  name: string, // concise human-readable block name
  params: [
    { name: string, type: 'color'|'text'|'number'|'select', default: any, explain: string }
  ]
}
Rules:
- The 3 parameters must be specific to the animation semantics found in the code.
- The explain string must be a short natural-language sentence template describing how the parameter modifies the block, and must include the placeholder {value} where the value will be substituted (e.g., "make the color of the square {value}" or "set the spin speed to {value}").`;
        const body = { model: fastModel, messages: [ {role:'system', content: sys}, {role:'user', content: JSON.stringify({ files: project.files }).slice(0,12000)} ], response_format: {type:'json_object'}};
        const resp = await fetch('https://api.openai.com/v1/chat/completions', { method:'POST', headers:{'Content-Type':'application/json','Authorization':`Bearer ${OPENAI_API_KEY}`}, body: JSON.stringify(body) });
        if (!resp.ok){
          // Always fallback to keep UX smooth
          return sendJSON(res, 200, buildParamFallback(project));
        }
        try {
          const data = await resp.json();
          const content = data.choices?.[0]?.message?.content;
          if (!content) return sendJSON(res, 200, buildParamFallback(project));
          let parsed = JSON.parse(content);
          if (!parsed || typeof parsed !== 'object') return sendJSON(res, 200, buildParamFallback(project));
          if (!parsed.id) parsed.id = `blk_${Math.random().toString(36).slice(2,10)}`;
          return sendJSON(res, 200, parsed);
        } catch {
          return sendJSON(res, 200, buildParamFallback(project));
        }
      } catch (e) {
        console.error('Param model error', e);
        return sendJSON(res, 200, buildParamFallback(project));
      }
    }

    if (method === 'POST' && url.startsWith('/api/generate')) {
      const raw = await readBody(req);
      let json;
      try { json = JSON.parse(raw || '{}'); }
      catch { return sendJSON(res, 400, { error: 'Invalid JSON' }); }

      const promptIn = String(json.prompt || '').trim();
      const guidanceImage = typeof json.guidanceImage === 'string' ? json.guidanceImage : '';
      if (guidanceImage && guidanceImage.length > 2 * 1024 * 1024) {
        return sendJSON(res, 413, { error: 'Guidance image too large (max ~2MB as data URL)' });
      }
      const blocksIn = Array.isArray(json.blocks) ? json.blocks : [];
      const durationHintSec = Number(json.durationHintSec || 0);
      const fast = Boolean(json.fast);

      // Optional: allow passing model override (supports fast model)
      const model = String(json.model || (fast ? (process.env.OPENAI_FAST_MODEL || 'gpt-5-nano') : OPENAI_MODEL));
      process.env.OPENAI_MODEL = model; // set for callOpenAI

      try {
        // Compose augmented prompt
        // If no prompt text but blocks exist, synthesize a concise base instruction
        const basePrompt = promptIn || (blocksIn.length ? 'Create a Remotion video based on the following blocks and effects. Combine them coherently.' : '');
        const blocksCtx = blocksIn.map((b, i) => {
          const p = (b.params || []).map(x => `${x.key}=${JSON.stringify(x.value ?? x.default ?? null)}`).join(', ');
          const files = (b.project && b.project.files) ? b.project.files : {};
          const filesDump = Object.entries(files).map(([path, content])=>`--- ${path} ---\n${content}`).join('\n\n');
          // Natural language effects based on explain templates (if provided)
          const explains = (b.def && Array.isArray(b.def.params)) ? b.def.params.map((defParam)=>{
            const val = (b.params || []).find(pp=>pp.key===defParam.key);
            const v = (val && (val.value!=null ? val.value : val.default)) ?? defParam.default;
            const tpl = String(defParam.explain || 'set ' + defParam.key + ' to {value}');
            return tpl.replace('{value}', JSON.stringify(v));
          }).join('\n') : '';
          // Include optional per-block context (URL or uploaded data)
          const ctxUrl = b.context && (b.context.url || '');
          const ctxData = b.context && (b.context.data || '');
          const ctxPart = ctxUrl ? `\nContext URL: ${ctxUrl}` : '';
          const dataPart = ctxData ? (`\nContext Attachment (data URL start):\n${String(ctxData).slice(0,500)}...`) : '';
          return `Block ${i+1}: ${b.name} (id:${b.id})\nParameters: ${p}${explains ? `\nEffects:\n${explains}` : ''}${ctxPart}${dataPart}${filesDump ? `\nFiles:\n${filesDump}` : ''}`;
        }).join('\n\n');
        // Build augmented system/user message with optional duration hint
        const augmented = [basePrompt,
          guidanceImage ? `Guidance image (data URL follows):\n${guidanceImage}` : '',
          blocksCtx ? `Blocks Context:\n${blocksCtx}` : '',
          durationHintSec ? `Target total duration: ~${durationHintSec} seconds. Use fps=${OPENAI_MODEL? '30' : '30'} to compute durationInFrames and allocate time proportionally across blocks.` : ''
        ].filter(Boolean).join('\n\n');

        let spec = await callOpenAI(augmented, { modelOverride: model });
        // Validate Remotion project shape
        const valid = spec && spec.kind === 'remotion-project' && spec.files && typeof spec.files === 'object' && typeof spec.files['src/index.ts'] === 'string' && typeof spec.files['src/Root.tsx'] === 'string';
        if (!valid) {
          return sendJSON(res, 502, { error: 'Model returned unexpected format' });
        }
        sendJSON(res, 200, spec);
      } catch (e) {
        // Log the full error server-side for debugging
        console.error('OpenAI proxy error:', e && (e.stack || e));
        // Optional dev fallback when upstream is unreachable or blocked
        if (DEV_FALLBACK === '1' || DEV_FALLBACK === 'true' || DEV_FALLBACK === 'on') {
          res.setHeader('X-Backend-Fallback', '1');
          const fallback = {
            kind: 'remotion-project',
            files: {
              'src/index.ts': "import {registerRoot} from 'remotion';\nimport {Root} from './Root';\nregisterRoot(Root);\n",
              'src/Root.tsx': "import React from 'react';\nimport {Composition} from 'remotion';\nimport {MyComp} from './MyComp';\nexport const Root: React.FC = () => {\n  return (\n    <>\n      <Composition id=\"MyComp\" component={MyComp} durationInFrames={150} width={1920} height={1080} fps={30} defaultProps={{}} />\n    </>\n  );\n};\n",
              'src/MyComp.tsx': "import React from 'react';\nimport {AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig} from 'remotion';\nexport const MyComp: React.FC = () => {\n  const frame = useCurrentFrame();\n  const {durationInFrames} = useVideoConfig();\n  const progress = interpolate(frame, [0, durationInFrames], [0, 100], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});\n  return (\n    <AbsoluteFill style={{background: 'linear-gradient(135deg,#0b0f14,#0a0e15)'}}>\n      <div style={{display:'flex',height:'100%',alignItems:'center',justifyContent:'center',gap:20}}>{[0,1,2].map(i=>{\n        const y = interpolate(frame + i*5, [0, 30, 60], [0, -40, 0], {extrapolateLeft:'clamp', extrapolateRight:'clamp'});\n        return <div key={i} style={{width:80,height:80,borderRadius:16,background:i===1?'#a07bff':'#6ea8fe', transform:`translateY(${y}px)`}}/>;})}</div>\n      <div style={{position:'absolute', left:20, right:20, bottom:30, height:10, border:'1px solid rgba(255,255,255,0.3)', borderRadius:6}}>\n        <div style={{height:'100%', width: progress + '%', background:'#6ea8fe', borderRadius:6}}/>\n      </div>\n    </AbsoluteFill>\n  );\n};\n"
            },
            compositionId: 'MyComp',
            width: 1920,
            height: 1080,
            fps: 30,
            durationInFrames: 150,
          };
          return sendJSON(res, 200, fallback);
        }
        const status = e.status || 500;
        const expose = e.expose || false;
        sendJSON(res, status === 500 ? 502 : status, { error: expose ? e.message : 'Upstream error' });
      }
      return;
    }

    // Fallback to static file serving
    if (method === 'GET') {
      serveStatic(req, res);
      return;
    }

    sendText(res, 405, 'Method Not Allowed');
  } catch (e) {
    try { sendJSON(res, 500, { error: 'Server error' }); } catch(_) {}
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Server listening on http://${HOST}:${PORT}`);
});
