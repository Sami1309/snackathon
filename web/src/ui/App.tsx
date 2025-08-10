import React, {useMemo, useRef, useState, DragEvent, ChangeEvent, useEffect} from 'react';
import {Player} from '@remotion/player';
import * as Remotion from 'remotion';
import JSZip from 'jszip';
import {transpileTSX} from './transpile';

type Project = {
  kind: 'remotion-project';
  files: Record<string, string>;
  compositionId: string;
  width: number; height: number; fps: number; durationInFrames: number;
};

type ParamDef = { key: string; label: string; type: 'color'|'text'|'number'|'select'; default: any; description?: string };
type BlockDef = { id: string; name: string; params: ParamDef[]; hue?: number };
type Block = { def: BlockDef; project: Project };
type TextSeg = { type: 'text'; id: string; value: string };
type BlockSeg = { type: 'block'; id: string; blockId: string; values: Record<string, any>; contextUrl?: string; contextData?: string };
type PromptSeg = TextSeg | BlockSeg;

const fallbackProject: Project = {
  kind: 'remotion-project',
  files: {
    'src/index.ts': "import {registerRoot} from 'remotion';\nimport {Root} from './Root';\nregisterRoot(Root);\n",
    'src/Root.tsx': "import React from 'react';\nimport {Composition} from 'remotion';\nimport {MyComp} from './MyComp';\nexport const Root: React.FC = () => (<>\n  <Composition id=\"MyComp\" component={MyComp} durationInFrames={180} width={1920} height={1080} fps={30} defaultProps={{}} />\n</>);\n",
    'src/MyComp.tsx': `import React from 'react';
import {AbsoluteFill, useCurrentFrame, useVideoConfig, interpolate} from 'remotion';
export const MyComp: React.FC = () => {
  const frame = useCurrentFrame();
  const {durationInFrames} = useVideoConfig();
  const progress = interpolate(frame, [0, durationInFrames], [0,100], {extrapolateLeft:'clamp', extrapolateRight:'clamp'});
  return (<AbsoluteFill style={{background:'#0b0f14', color:'#e9eef5'}}>
    <div style={{display:'flex',height:'100%',alignItems:'center',justifyContent:'center'}}>\n      <div style={{fontSize:64, fontWeight:800}}>Remotion Demo</div>\n    </div>
    <div style={{position:'absolute', left:20, right:20, bottom:30, height:12, border:'1px solid rgba(255,255,255,0.3)', borderRadius:8}}><div style={{height:'100%', width:progress+'%', background:'#6ea8fe', borderRadius:8}}/></div>
  </AbsoluteFill>);
};
`
  },
  compositionId: 'MyComp', width: 1920, height: 1080, fps: 30, durationInFrames: 180
};

export const App: React.FC = () => {
  const [segments, setSegments] = useState<PromptSeg[]>([
    { type:'text', id: uid(), value: 'Create a 5-second intro with a bold title that fades in and a progress bar at the bottom.' }
  ]);
  const [prompt, setPrompt] = useState('');
  const [useMock, setUseMock] = useState(true);
  const [project, setProject] = useState<Project | null>(fallbackProject);
  const [code, setCode] = useState<string>(JSON.stringify(fallbackProject, null, 2));
  const [progress, setProgress] = useState(0);
  const [loading, setLoading] = useState(false);
  const [image, setImage] = useState<string | null>(null);
  const [blocks, setBlocks] = useState<Block[]>(() => {
    try { const s = localStorage.getItem('blocks_v1'); if (s) return JSON.parse(s); } catch {}
    return [];
  });
  const [blockLoading, setBlockLoading] = useState(false);
  const [editingBlock, setEditingBlock] = useState<null | { segmentId: string; blockId: string; values: Record<string, any>; contextUrl?: string; contextData?: string }>(null);
  const [editingToken, setEditingToken] = useState<null | { start: number; end: number; blockId: string; values: Record<string, any> }>(null);
  const [flashBlockId, setFlashBlockId] = useState<string | null>(null);
  const ticking = useRef<number | null>(null);
  const [hoveredDropIndex, setHoveredDropIndex] = useState<number | null>(null);
  const [secondsPerBlock, setSecondsPerBlock] = useState<number>(3);
  const promptRef = useRef<HTMLTextAreaElement | null>(null);
  const editorRef = useRef<HTMLDivElement | null>(null);
  const suppressSyncRef = useRef(false);
  const skipInputRef = useRef(false);

  const Comp = useMemo(() => {
    if (!project) return null;
    const tsx = project.files['src/MyComp.tsx'];
    if (!tsx) return null;
    try{
      const js = transpileTSX(tsx);
      const exports: any = {};
      const fn = new Function('exports','React','Remotion', js);
      fn(exports, React, Remotion);
      return exports.MyComp || exports.default;
    } catch(e){ console.error(e); return null; }
  }, [project]);

  const generate = async (fast = false) => {
    try{
      setLoading(true);
      setProgress(10);
      if (!useMock) {
        ticking.current = window.setInterval(()=>setProgress((p)=>Math.min(95, p + Math.random()*4)), 250);
      }
      const used = extractBlocksFromSegments(segments, blocks);
      const promptText = segments.filter(s=>s.type==='text').map(s => (s as TextSeg).value).join('\n\n');
      const durationHintSec = Math.max(1, Math.round((used.length || 1) * secondsPerBlock));
      let res: Project;
      if (useMock) {
        for (let p=10;p<=85;p+=5) { setProgress(p); await new Promise(r=>setTimeout(r,80)); }
        res = fallbackProject;
      } else {
        const resp = await fetch('/api/generate', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({prompt: promptText, guidanceImage: image, blocks: used, fast, durationHintSec})});
        if (!resp.ok) throw new Error('Backend error: ' + resp.status);
        res = await resp.json();
      }
      setProject(res);
      setCode(JSON.stringify(res, null, 2));
      setProgress(100);
    } catch(e){
      console.error(e);
      alert('Generation failed');
    } finally {
      if (ticking.current){ clearInterval(ticking.current); ticking.current = null; }
      setTimeout(()=>{ setProgress(0); setLoading(false); }, 800);
    }
  };

  const onImageDrop = async (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (file && file.type.startsWith('image/')) {
      const url = await fileToDataUrl(file);
      setImage(url);
    }
  };

  const onEditorDrop = async (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault(); e.stopPropagation();
    const blockId = e.dataTransfer.getData('application/x-block-id');
    if (blockId) {
      // Prevent the immediate input event from overwriting our programmatic insert
      skipInputRef.current = true;
      suppressSyncRef.current = true;
      insertTokenAtCaret(`[[Block:${blockId}]]`);
      // Re-enable input handler after microtask
      setTimeout(()=>{ skipInputRef.current = false; }, 0);
    }
  };

  const onFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && file.type.startsWith('image/')) {
      const url = await fileToDataUrl(file);
      setImage(url);
    }
  };

  const fileToDataUrl = (file: File) => new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });

  // --- Rich prompt editor (contenteditable) --------------------------------
  const renderPromptHTML = (text: string) => {
    const parts: string[] = [];
    const regex = /\[\[Block:([\w-]+)([^\]]*)\]\]/g; let last = 0; let i = 0; let m;
    while ((m = regex.exec(text))) {
      const start = m.index; const end = start + m[0].length;
      if (start > last) parts.push(escapeHTML(text.slice(last, start)));
      const id = m[1]; const params = (m[2]||'').trim();
      const blk = blocks.find(b => b.def.id === id) || null;
      const color = tokenColor(id, blk?.def?.hue);
      const label = (blk?.def?.name || blockLabelFor(id)) + (params ? '' : '');
      const token = `<span class="block-token" role="button" tabindex="0" data-token-index="${i}" data-token="${encodeAttr(m[0])}" data-block-id="${encodeAttr(id)}" contenteditable="false" style="cursor:pointer;display:inline-flex;align-items:center;gap:8px;padding:4px 10px;border-radius:999px;background:${color.bg};color:${color.fg};border:1px solid ${color.bd};">` +
        `<span style="font-weight:700;">${escapeHTML(label)}</span>` +
        `</span>`;
      parts.push(token); last = end; i++;
    }
    if (last < text.length) parts.push(escapeHTML(text.slice(last)));
    return parts.join('');
  };

  const syncEditorFromText = () => {
    const el = editorRef.current; if (!el) return;
    el.innerHTML = renderPromptHTML(prompt);
  };
  useEffect(() => {
    if (suppressSyncRef.current) { suppressSyncRef.current = false; return; }
    syncEditorFromText();
  }, [prompt, blocks.length]);

  const textFromEditor = () => {
    const el = editorRef.current; if (!el) return prompt;
    let out = '';
    const visit = (n: Node) => {
      if (n.nodeType === Node.ELEMENT_NODE) {
        const eln = n as HTMLElement;
        if (eln.classList.contains('block-token')) {
          const t = eln.getAttribute('data-token') || '';
          out += decodeAttr(t);
          return; // do not descend into children to avoid duplicating label text
        }
        // visit children
        for (const child of Array.from(eln.childNodes)) visit(child);
      } else if (n.nodeType === Node.TEXT_NODE) {
        out += n.textContent || '';
      }
    };
    for (const child of Array.from(el.childNodes)) visit(child);
    return out;
  };

  const insertTokenAtCaret = (token: string) => {
    const el = editorRef.current; if (!el) { setPrompt(prompt + token); return; }
    const sel = window.getSelection();
    // Ensure selection is within the editor; otherwise move caret to end
    if (!sel || sel.rangeCount === 0 || !el.contains(sel.anchorNode)) {
      const rangeToEnd = document.createRange();
      rangeToEnd.selectNodeContents(el);
      rangeToEnd.collapse(false);
      const s = window.getSelection(); if (s) { s.removeAllRanges(); s.addRange(rangeToEnd); }
    }
    const range = (window.getSelection() && window.getSelection()!.rangeCount>0) ? window.getSelection()!.getRangeAt(0) : null;
    if (!range) { setPrompt(prompt + token); return; }
    const marker = document.createTextNode('§§MARKER§§');
    range.insertNode(marker);
    // Rebuild text from editor including marker
    const textWithMarker = textFromEditor();
    const next = textWithMarker.replace('§§MARKER§§', token);
    setPrompt(next);
    // Reset selection after sync
    setTimeout(syncEditorFromText, 0);
  };

  const onEditorInput = () => {
    if (skipInputRef.current) return;
    const text = textFromEditor();
    suppressSyncRef.current = true;
    setPrompt(text);
  };

  const openTokenEditorFromEl = (tokenEl: HTMLElement) => {
    const idxAttr = tokenEl.getAttribute('data-token-index');
    const i = idxAttr ? Number(idxAttr) : -1;
    const info = findTokenByIndex(prompt, i);
    if (!info) return;
    const blk = blocks.find(b => b.def.id === info.blockId); if (!blk) return;
    setEditingToken({ start: info.start, end: info.end, blockId: info.blockId, values: { ...info.params } });
  };

  const onEditorDblClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    const tokenEl = target.closest('.block-token') as HTMLElement | null;
    if (!tokenEl) return;
    openTokenEditorFromEl(tokenEl);
  };

  const onEditorClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    const tokenEl = target.closest('.block-token') as HTMLElement | null;
    if (!tokenEl) return;
    openTokenEditorFromEl(tokenEl);
  };

  const saveEditingToken = () => {
    if (!editingToken) return;
    const blk = blocks.find(b => b.def.id === editingToken.blockId); if (!blk) return;
    const paramStr = blk.def.params.map(p => `${p.key}=${JSON.stringify(editingToken.values[p.key] ?? p.default)}`).join(' ');
    const tokenText = `[[Block:${blk.def.id} ${paramStr}]]`;
    const next = prompt.slice(0, editingToken.start) + tokenText + prompt.slice(editingToken.end);
    setPrompt(next); setEditingToken(null);
  };

  const createBlock = async () => {
    if (!project) return alert('No project to create a block from');
    try{
      setBlockLoading(true);
      const resp = await fetch('/api/blocks/params', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ project })});
      if (!resp.ok) throw new Error('Param service failed');
      const raw: any = await resp.json();
      // Normalize params where label = key = name
      const normalized: BlockDef = {
        id: raw.id,
        name: raw.name,
        params: (raw.params || []).map((p: any) => ({ key: p.name || p.key, label: p.name || p.label || p.key, type: p.type, default: p.default, describe: p.explain, explain: p.explain }))
      } as any;
      // Ensure unique id; keep visible name from LLM
      const uid = `blk_${Date.now().toString(36)}_${Math.random().toString(36).slice(2,6)}`;
      const hue = Math.floor(Math.random()*360);
      const blk: Block = { def: { ...normalized, id: uid, hue } as any, project };
      const next = [blk, ...blocks]; setBlocks(next); localStorage.setItem('blocks_v1', JSON.stringify(next));
    } catch(e){ console.error(e); alert('Failed to create block'); }
    finally { setBlockLoading(false); }
  };

  const downloadZip = async () => {
    if (!project) return;
    const zip = new JSZip();
    const folder = zip.folder('src')!;
    Object.entries(project.files).forEach(([file, content]) => {
      if (file.startsWith('src/')) folder.file(file.slice(4), content);
      else zip.file(file, content);
    });
    const blob = await zip.generateAsync({type:'blob'});
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'remotion-project.zip';
    a.click();
    setTimeout(()=>URL.revokeObjectURL(a.href), 1000);
  };

  // Segmented composer ops
  const updateTextSeg = (id: string, value: string) => {
    setSegments(prev => prev.map(s => s.id === id ? ({ ...(s as TextSeg), value }) : s));
  };
  const removeSeg = (id: string) => {
    setSegments(prev => {
      let next = prev.filter(s => s.id !== id);
      // merge adjacent text segments
      const merged: PromptSeg[] = [];
      for (const s of next) {
        const last = merged[merged.length-1];
        if (last && last.type==='text' && s.type==='text') (last as TextSeg).value += (s as TextSeg).value;
        else merged.push(s);
      }
      if (merged.length===0) merged.push({ type:'text', id: uid(), value:'' });
      return merged;
    });
  };
  // DnD helpers for drop zones
  const handleDragEnter = (index: number) => setHoveredDropIndex(index);
  const handleDragLeave = (index: number) => { if (hoveredDropIndex === index) setHoveredDropIndex(null); };
  const handleDragOver = (e: DragEvent<HTMLDivElement>, index: number) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; setHoveredDropIndex(index); };
  const moveSegment = (segId: string, index: number) => {
    setSegments(prev => {
      const next = [...prev];
      const from = next.findIndex(s => s.id === segId);
      if (from === -1) return prev;
      const [seg] = next.splice(from, 1);
      // adjust index if removing before target
      const to = from < index ? Math.max(0, index - 1) : index;
      next.splice(to, 0, seg);
      return next;
    });
  };
  const handleDrop = (e: DragEvent<HTMLDivElement>, index: number) => {
    e.preventDefault();
    e.stopPropagation();
    // Use the currently hovered drop index to decide target slot for insertion
    const targetIndex = (hoveredDropIndex !== null ? hoveredDropIndex : index);
    const existingSegId = e.dataTransfer.getData('application/x-seg-id');
    if (existingSegId) {
      moveSegment(existingSegId, targetIndex);
      setHoveredDropIndex(null);
      return;
    }
    const blockId = e.dataTransfer.getData('application/x-block-id');
    if (!blockId) return;
    const blk = blocks.find(b => b.def.id === blockId); if (!blk) return;
    const values: Record<string, any> = {}; blk.def.params.forEach(p => values[p.key] = p.default);
    setSegments(prev => {
      const next = [...prev];
      const insertAt = Math.max(0, Math.min(targetIndex, next.length));
      next.splice(insertAt, 0, { type:'block', id: uid(), blockId, values } as BlockSeg);
      // Ensure a text segment exists before and after the inserted block
      if (insertAt === 0 || next[insertAt-1].type !== 'text') next.splice(insertAt, 0, { type:'text', id: uid(), value:'' });
      const afterIndex = insertAt + 1; // block now at insertAt+1 if we added a text before, else at insertAt
      const blockPos = next.findIndex(s => s.type==='block' && (s as BlockSeg).id === (next[insertAt].type==='block' ? (next[insertAt] as BlockSeg).id : (next[insertAt+1] as BlockSeg).id));
      const ensureAfter = blockPos + 1;
      if (ensureAfter >= next.length || next[ensureAfter].type !== 'text') next.splice(ensureAfter + 1, 0, { type:'text', id: uid(), value:'' });
      return next;
    });
    setHoveredDropIndex(null);
  };
  const saveEditingBlock = () => {
    if (!editingBlock) return;
    setSegments(prev => prev.map(s => s.id === editingBlock.segmentId ? ({ ...(s as BlockSeg), values: editingBlock.values, contextUrl: editingBlock.contextUrl, contextData: editingBlock.contextData }) : s));
    setEditingBlock(null);
  };

  const [codeCollapsed, setCodeCollapsed] = useState(false);

  const gridStyle = useMemo(() => ({
    ...gridMore,
    gridTemplateColumns: codeCollapsed ? '0.8fr 2fr 0fr 2.8fr' : '0.8fr 2fr 1.1fr 2fr',
  } as React.CSSProperties), [codeCollapsed]);

  return (
    <div style={page}>
      <div style={container}>
        <header style={header}>
          <div style={brandWrap}>
            <div style={logo} />
            <div>
              <div style={title}>VisuBlocks</div>
              <div style={subtitle}></div>
            </div>
          </div>
          <div style={pill}>Remotion Player · Live preview</div>
        </header>

        <div style={gridStyle}>
          <section style={{...panel, display:'flex', flexDirection:'column', height:'100%', position:'relative'}}>
            <div style={{display:'flex', justifyContent:'space-between', alignItems:'center'}}>
              <h3 style={h3}>Blocks</h3>
              <button onClick={createBlock} style={{...ghost, opacity:blockLoading?0.7:1}} disabled={blockLoading}>{blockLoading ? 'Creating…' : 'Create Block'}</button>
            </div>
            <div style={{display:'flex', flexDirection:'column', gap:10, overflow:'auto'}}>
              {blocks.length === 0 ? (
                <div style={{color:'#a7b1c2'}}>No blocks yet. Generate a project, then click Create Block.</div>
              ) : blocks.map((b)=> (
                <div key={b.def.id}
                  draggable
                onDragStart={(e)=>{ e.dataTransfer.setData('application/x-block-id', b.def.id); e.dataTransfer.setData('text/plain', `[[Block:${b.def.id}]]`); }}
                onClick={()=>{ setProject(b.project); setCode(JSON.stringify(b.project, null, 2)); setFlashBlockId(b.def.id); setTimeout(()=>setFlashBlockId(null), 200); }}
                style={{...blockTile,
                  transform: flashBlockId===b.def.id ? 'scale(0.98)' : 'scale(1)', transition:'transform .12s ease, box-shadow .2s ease',
                  boxShadow: flashBlockId===b.def.id ? '0 0 0 4px rgba(255,255,255,0.06)' : 'none',
                  borderColor: tokenColor(b.def.id, b.def.hue).bd, background: tokenColor(b.def.id, b.def.hue).bg, color: tokenColor(b.def.id, b.def.hue).fg}}
                >
                  <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', gap:8}}>
                    <div style={{fontWeight:800, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis'}}>{b.def.name}</div>
                    <button onClick={(e)=>{ e.stopPropagation(); const next = blocks.filter(x => x.def.id !== b.def.id); setBlocks(next); localStorage.setItem('blocks_v1', JSON.stringify(next)); }} style={{...ghost, padding:'6px 8px'}}>Delete</button>
                  </div>
                  <div style={{fontSize:12, color:'#a7b1c2'}}>{b.def.params.map(p=>p.label).join(' · ')}</div>
                </div>
              ))}
            </div>
            {blockLoading && <div style={overlay}><div style={spinner}/></div>}
          </section>
          <section style={{...panel, display:'flex', flexDirection:'column', height:'100%', minHeight:0}}>
            <div style={{display:'flex', justifyContent:'space-between', alignItems:'center'}}>
              <h3 style={h3}>Compose Prompt</h3>
              <div style={{display:'inline-flex', alignItems:'center', gap:8, color:'#a7b1c2'}}>
                <label>Secs/block</label>
                <input type="number" min={1} max={30} step={1} value={secondsPerBlock}
                  onChange={(e)=>setSecondsPerBlock(Math.max(1, Number(e.target.value||3)))}
                  style={{...input, width:80}}
                />
              </div>
            </div>
            <div style={{flex:1, minHeight:0, display:'flex', flexDirection:'column', gap:12}}>
              <div style={composerScroll}>
                {segments.map((seg, idx) => (
                  <div key={seg.id} style={{display:'flex', flexDirection:'column', gap:8}}>
                    {seg.type==='text' ? (
                      <textarea
                        value={(seg as TextSeg).value}
                        onChange={(e)=>updateTextSeg(seg.id, e.target.value)}
                        placeholder={idx===0? 'Describe the animation...' : 'More details...'}
                        style={{...ta, minHeight:100}}
                      />
                    ) : (
                      <div
                        style={{...blockChip(seg as BlockSeg, blocks)}}
                        draggable
                        onDragStart={(e)=>{ e.dataTransfer.setData('application/x-seg-id', (seg as BlockSeg).id); e.dataTransfer.effectAllowed='move'; }}
                      >
                        <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', gap:8}}>
                          <strong>{blockName((seg as BlockSeg).blockId, blocks)}</strong>
                          <div style={{display:'flex', gap:8}}>
                            <button style={ghost} onClick={()=>{ const s = seg as BlockSeg; setEditingBlock({ segmentId: s.id, blockId: s.blockId, values: { ...s.values }, contextUrl: s.contextUrl, contextData: s.contextData }); }}>Edit</button>
                            <button style={ghost} onClick={()=>removeSeg(seg.id)}>Remove</button>
                          </div>
                        </div>
                        <div style={{fontSize:12, color:'#a7b1c2'}}>{blockSummary((seg as BlockSeg), blocks)}</div>
                      </div>
                    )}
                    {/* Drop zone after this segment */}
                    <div onDragOver={(e)=>handleDragOver(e, idx+1)} onDragEnter={()=>handleDragEnter(idx+1)} onDragLeave={()=>handleDragLeave(idx+1)} onDrop={(e)=>handleDrop(e, idx+1)} style={{...dropZone, ...(hoveredDropIndex===(idx+1)? dropZoneHover: {})}}>Drop block here</div>
                  </div>
                ))}
              </div>
              <div onDragOver={(e)=>e.preventDefault()} onDrop={onImageDrop} style={uploader}> 
                <div style={{fontWeight:700, marginBottom:8}}>Guidance image</div>
                <label style={uploadBtn}>
                  <input type="file" accept="image/*" onChange={onFile} style={{display:'none'}} />
                  Upload
                </label>
                <div style={{fontSize:12, color:'#a7b1c2', marginTop:6}}>or drag & drop here</div>
                {image && (
                  <div style={{marginTop:12, position:'relative'}}>
                    <img src={image} alt="guidance" style={{maxWidth:'100%', borderRadius:10, border:'1px solid rgba(255,255,255,0.12)'}} />
                    <button onClick={()=>setImage(null)} style={removeChip}>Remove</button>
                  </div>
                )}
              </div>
            </div>
            <div style={{display:'flex', gap:10, alignItems:'center', marginTop:8}}>
              <button onClick={()=>generate(false)} style={{...primary, opacity: loading ? 0.8 : 1}} disabled={loading}>
                {loading ? 'Generating…' : 'Generate Remotion Project'}
              </button>
              <button onClick={()=>generate(true)} style={ghost} disabled={loading}>Generate Fast</button>
              <label style={{display:'inline-flex', alignItems:'center', gap:8, color:'#a7b1c2'}}>
                <input type="checkbox" checked={useMock} onChange={(e)=>setUseMock(e.target.checked)} /> Use mock backend
              </label>
            </div>
          </section>

          <section style={{...panel, display: codeCollapsed ? 'none' : 'flex', flexDirection:'column'}}>
            <div style={{display:'flex', justifyContent:'space-between', alignItems:'center'}}>
              <h3 style={h3}>Returned code</h3>
              <button onClick={()=>setCodeCollapsed(true)} style={ghost}>Collapse</button>
            </div>
            <textarea value={code} onChange={(e)=>setCode(e.target.value)} style={{...ta, flex:1, minHeight:280}} spellCheck={false} />
            <div style={{display:'flex', gap:10, marginTop:8}}>
              <button onClick={downloadZip} style={ghost}>Download Project</button>
            </div>
          </section>

          <section style={{...panel, position:'relative', gridColumn: codeCollapsed ? '3 / 5' as any : undefined}}>
            <div style={{display:'flex', justifyContent:'space-between', alignItems:'center'}}>
              <h3 style={h3}>Preview</h3>
              {codeCollapsed && <button onClick={()=>setCodeCollapsed(false)} style={ghost}>Expand Code</button>}
            </div>
            <div style={{position:'relative', width:'100%', aspectRatio:'16/9', background:'#0a0e15', borderRadius:18, overflow:'hidden', display:'grid', placeItems:'center', boxShadow:'0 12px 36px rgba(0,0,0,0.45)'}}>
              {!loading && Comp ? (
                <Player
                  component={Comp as any}
                  durationInFrames={project?.durationInFrames || 150}
                  fps={project?.fps || 30}
                  compositionWidth={project?.width || 1920}
                  compositionHeight={project?.height || 1080}
                  controls
                  loop
                  showPlaybackRateControl
                  style={{width:'100%', height:'100%'}}
                />
              ) : (
                <div style={{maxWidth:680, textAlign:'center', padding:'0 12px', color:'#a7b1c2'}}>
                  {loading ? 'Contacting backend and generating project…' : 'Generated Remotion composition will preview here.'}
                </div>
              )}
              <div style={{position:'absolute', left:16, right:16, bottom:12}}>
                <div style={{height:12, borderRadius:8, border:'1px solid rgba(255,255,255,0.12)', background:'rgba(0,0,0,0.35)'}}>
                  <div style={{height:'100%', width:`${progress}%`, background:'linear-gradient(90deg, #6ea8fe, #a07bff)', borderRadius:8, transition:'width .2s ease'}} />
                </div>
              </div>
              {loading && (
                <div style={overlay}>
                  <div style={spinner} />
                </div>
              )}
            </div>
          </section>
        </div>
      </div>
      {editingBlock && (
        <div style={editorOverlay}>
          <div style={editorCard}>
            <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:10}}>
              <div style={{fontWeight:800}}>{blockName(editingBlock.blockId, blocks)} · Parameters</div>
              <button onClick={()=>setEditingBlock(null)} style={ghost}>Close</button>
            </div>
            {(() => { const blk = blocks.find(b => b.def.id === editingBlock.blockId)!; return (
              <div style={{display:'grid', gap:10}}>
                <div style={{display:'grid', gap:6}}>
                  <label style={{fontSize:12, color:'#a7b1c2'}}>Context URL</label>
                  <input type="url" placeholder="https://..."
                    value={editingBlock.contextUrl || ''}
                    onChange={(e)=>setEditingBlock(s => s ? ({...s, contextUrl: e.target.value}) : s)}
                    style={input}
                  />
                </div>
                <div style={{display:'grid', gap:6}}>
                  <label style={{fontSize:12, color:'#a7b1c2'}}>Attach context file (image/document)</label>
                  <input type="file" accept="image/*,.pdf,.txt,.md"
                    onChange={async (e)=>{ const file = e.target.files?.[0]; if (!file) return; const data = await fileToDataUrl(file); setEditingBlock(s => s ? ({...s, contextData: data}) : s); }}
                  />
                  {editingBlock.contextData && (
                    <div style={{fontSize:12, color:'#a7b1c2'}}>Attached ({(editingBlock.contextData.length/1024).toFixed(1)} KB)</div>
                  )}
                </div>
                {blk.def.params.map(p => (
                  <div key={p.key} style={{display:'grid', gap:6}}>
                    <label style={{fontSize:12, color:'#a7b1c2'}}>{p.label || p.key}</label>
                    {p.type === 'number' ? (
                      <div style={{display:'flex', alignItems:'center', gap:8}}>
                        <input type="range" min={0} max={10} step={1}
                          value={Number(editingBlock.values[p.key] ?? p.default ?? 0)}
                          onChange={(e)=>setEditingBlock(s => s ? ({...s, values: {...s.values, [p.key]: Number(e.target.value) }}) : s)}
                          style={{flex:1}}
                        />
                        <span style={{fontSize:12, color:'#a7b1c2', width:28, textAlign:'right'}}>{String(editingBlock.values[p.key] ?? p.default ?? 0)}</span>
                      </div>
                    ) : (
                      <input
                        type={p.type === 'color' ? 'color' : 'text'}
                        value={String(editingBlock.values[p.key] ?? p.default ?? '')}
                        onChange={(e)=>setEditingBlock(s => s ? ({...s, values: {...s.values, [p.key]: e.target.value }}) : s)}
                        style={input}
                      />
                    )}
                  </div>
                ))}
                <div style={{marginTop:8, paddingTop:8, borderTop:'1px solid rgba(255,255,255,0.12)'}}>
                  <div style={{fontWeight:700, marginBottom:6}}>Add custom parameter</div>
                  <CustomParamForm onAdd={(param)=>{
                    const blkIdx = blocks.findIndex(b => b.def.id === editingBlock.blockId);
                    if (blkIdx>=0){
                      const nextBlocks = [...blocks];
                      nextBlocks[blkIdx] = { ...nextBlocks[blkIdx], def: { ...nextBlocks[blkIdx].def, params: [...nextBlocks[blkIdx].def.params, param] } };
                      setBlocks(nextBlocks); localStorage.setItem('blocks_v1', JSON.stringify(nextBlocks));
                      setEditingBlock(s => s ? ({...s, values: { ...s.values, [param.key]: param.default } }) : s);
                    }
                  }} />
                </div>
                <div style={{display:'flex', gap:8, justifyContent:'flex-end'}}>
                  <button onClick={saveEditingBlock} style={primary}>Save</button>
                </div>
              </div>
            ); })()}
          </div>
        </div>
      )}
      {editingToken && (
        <div style={editorOverlay}>
          <div style={editorCard}>
            <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:10}}>
              <div style={{fontWeight:800}}>Edit Block Parameters</div>
              <button onClick={()=>setEditingToken(null)} style={ghost}>Close</button>
            </div>
            {(() => { const blk = blocks.find(b => b.def.id === editingToken.blockId)!; return (
              <div style={{display:'grid', gap:10}}>
                {blk.def.params.map(p => (
                  <div key={p.key} style={{display:'grid', gap:6}}>
                    <label style={{fontSize:12, color:'#a7b1c2', wordBreak:'break-word'}}>{p.label}</label>
                    <input
                      type={p.type === 'number' ? 'number' : (p.type === 'color' ? 'color' : 'text')}
                      value={String(editingToken.values[p.key] ?? p.default ?? '')}
                      onChange={(e)=>setEditingToken(s => s ? ({...s, values: {...s.values, [p.key]: p.type==='number' ? Number(e.target.value) : e.target.value }}) : s)}
                      style={{...input, width:'100%', maxWidth:'100%'}}
                    />
                  </div>
                ))}
                {/* Add custom parameter */}
                <div style={{marginTop:8, paddingTop:8, borderTop:'1px solid rgba(255,255,255,0.12)'}}>
                  <div style={{fontWeight:700, marginBottom:6}}>Add custom parameter</div>
                  <CustomParamForm onAdd={(param)=>{
                    const blkIdx = blocks.findIndex(b => b.def.id === editingToken.blockId);
                    if (blkIdx>=0){
                      const nextBlocks = [...blocks];
                      nextBlocks[blkIdx] = { ...nextBlocks[blkIdx], def: { ...nextBlocks[blkIdx].def, params: [...nextBlocks[blkIdx].def.params, param] } };
                      setBlocks(nextBlocks); localStorage.setItem('blocks_v1', JSON.stringify(nextBlocks));
                      setEditingToken(s => s ? ({...s, values: { ...s.values, [param.key]: param.default } }) : s);
                    }
                  }} />
                </div>
                <div style={{display:'flex', gap:8, justifyContent:'flex-end'}}>
                  <button onClick={saveEditingToken} style={primary}>Save</button>
                </div>
              </div>
            ); })()}
          </div>
        </div>
      )}
    </div>
  );
};

const page: React.CSSProperties = { minHeight:'100vh', background:'radial-gradient(1200px 800px at 10% -10%, rgba(110,168,254,0.20), transparent 60%), radial-gradient(1000px 700px at 110% 10%, rgba(160,123,255,0.18), transparent 55%), #0b0f14', color:'#e9eef5', fontFamily:'Inter, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial' };
const container: React.CSSProperties = { maxWidth:1680, margin:'28px auto 40px', padding:'0 18px' };
const header: React.CSSProperties = { display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:14 };
const brandWrap: React.CSSProperties = { display:'flex', alignItems:'center', gap:14 };
const logo: React.CSSProperties = { width:42, height:42, borderRadius:14, background:'conic-gradient(from 220deg, #6ea8fe, #a07bff)', boxShadow:'inset 0 0 0 2px rgba(255,255,255,0.25), 0 10px 30px rgba(0,0,0,0.35)' };
const title: React.CSSProperties = { fontSize:28, fontWeight:800 };
const subtitle: React.CSSProperties = { color:'#a7b1c2' };
const pill: React.CSSProperties = { padding:'10px 14px', borderRadius:999, background:'rgba(255,255,255,0.06)', border:'1px solid rgba(255,255,255,0.12)', color:'#a7b1c2', fontWeight:600 };
const gridMore: React.CSSProperties = { display:'grid', gap:18, gridTemplateColumns:'0.8fr 2fr 1.1fr 2fr', alignItems:'stretch', height:'calc(100vh - 120px)' };
const panel: React.CSSProperties = { background:'linear-gradient(180deg, rgba(255,255,255,0.06), rgba(255,255,255,0.03))', border:'1px solid rgba(255,255,255,0.12)', borderRadius:18, boxShadow:'0 10px 30px rgba(0,0,0,0.35)', padding:18, backdropFilter:'blur(10px)' };
const h3: React.CSSProperties = { margin:'4px 0 8px', fontSize:18 };
const ta: React.CSSProperties = { width:'100%', minHeight:180, padding:'12px', background:'rgba(0,0,0,0.35)', color:'#e9eef5', border:'1px solid rgba(255,255,255,0.12)', borderRadius:12, fontFamily:'ui-monospace, SFMono-Regular, Menlo, Monaco, "Roboto Mono", Consolas, monospace' };
const editor: React.CSSProperties = { whiteSpace:'pre-wrap', overflowWrap:'anywhere', wordBreak:'break-word', padding:'12px', minHeight:280, borderRadius:12, background:'rgba(0,0,0,0.35)', border:'1px solid rgba(255,255,255,0.12)', color:'#e9eef5', outline:'none', fontFamily:'Inter, system-ui, -apple-system, Segoe UI' };
const primary: React.CSSProperties = { padding:'11px 16px', borderRadius:12, fontWeight:800, letterSpacing:0.2, color:'#fff', background:'linear-gradient(135deg, #6ea8fe, #a07bff)', border:0, cursor:'pointer', boxShadow:'0 6px 20px rgba(110,168,254,0.35), 0 2px 8px rgba(160,123,255,0.25)' };
const ghost: React.CSSProperties = { padding:'10px 14px', borderRadius:12, fontWeight:700, color:'#e9eef5', background:'rgba(255,255,255,0.06)', border:'1px solid rgba(255,255,255,0.12)', cursor:'pointer' };
const overlay: React.CSSProperties = { position:'absolute', inset:0, display:'grid', placeItems:'center', background:'rgba(0,0,0,0.25)', backdropFilter:'blur(2px)' };
const spinner: React.CSSProperties = { width:36, height:36, borderRadius:'50%', border:'3px solid rgba(255,255,255,0.25)', borderTopColor:'#6ea8fe', animation:'spin 0.9s linear infinite' } as any;

const uploader: React.CSSProperties = { width:220, minWidth:220, alignSelf:'stretch', background:'rgba(255,255,255,0.04)', border:'1px dashed rgba(255,255,255,0.16)', borderRadius:14, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', padding:12 };
const uploadBtn: React.CSSProperties = { padding:'8px 12px', borderRadius:10, border:'1px solid rgba(255,255,255,0.16)', background:'rgba(255,255,255,0.06)', color:'#e9eef5', cursor:'pointer', fontWeight:700 };
const removeChip: React.CSSProperties = { position:'absolute', top:6, right:6, padding:'6px 8px', fontSize:12, borderRadius:999, border:'1px solid rgba(255,255,255,0.2)', background:'rgba(0,0,0,0.45)', color:'#e9eef5', cursor:'pointer' };
const blockTile: React.CSSProperties = { padding:12, borderRadius:12, border:'1px solid rgba(255,255,255,0.12)', background:'rgba(255,255,255,0.05)', cursor:'grab' };
const editorOverlay: React.CSSProperties = { position:'fixed', inset:0, display:'grid', placeItems:'center', background:'rgba(0,0,0,0.45)', zIndex:50 };
const editorCard: React.CSSProperties = { width:520, maxWidth:'95vw', maxHeight:'80vh', overflow:'auto', background:'#0f1622', border:'1px solid rgba(255,255,255,0.12)', borderRadius:12, padding:16, boxShadow:'0 20px 60px rgba(0,0,0,0.5)' };
const input: React.CSSProperties = { padding:'10px 12px', borderRadius:10, border:'1px solid rgba(255,255,255,0.16)', background:'rgba(255,255,255,0.06)', color:'#e9eef5', maxWidth:'100%' };

// --- Helpers: Block tokens in prompt --------------------------------------
function findTokenAt(text: string, pos: number): null | { start: number; end: number; blockId: string; params: Record<string, any> } {
  const regex = /\[\[Block:([\w-]+)([^\]]*)\]\]/g;
  let m; while ((m = regex.exec(text))) {
    const start = m.index; const end = start + m[0].length;
    if (pos >= start && pos <= end) {
      const id = m[1]; const paramsStr = (m[2] || '').trim();
      const params: Record<string, any> = {};
      paramsStr.split(/\s+/).filter(Boolean).forEach(kv => {
        const eq = kv.indexOf('='); if (eq>0) { const k = kv.slice(0,eq); let v = kv.slice(eq+1); try { params[k] = JSON.parse(v); } catch { params[k] = v; } }
      });
      return { start, end, blockId: id, params };
    }
  }
  return null;
}

function extractBlocksFromPrompt(text: string, blocks: Block[]) {
  const regex = /\[\[Block:([\w-]+)([^\]]*)\]\]/g; const used: any[] = [];
  let m; while ((m = regex.exec(text))) {
    const id = m[1]; const blk = blocks.find(b => b.def.id === id); if (!blk) continue;
    const paramsStr = (m[2] || '').trim(); const values: Record<string, any> = {};
    paramsStr.split(/\s+/).filter(Boolean).forEach(kv => { const eq = kv.indexOf('='); if (eq>0){ const k = kv.slice(0,eq); let v = kv.slice(eq+1); try { values[k] = JSON.parse(v); } catch { values[k] = v; } } });
    used.push({
      id: blk.def.id,
      name: blk.def.name,
      def: { params: blk.def.params.map(p => ({ key: p.key, label: p.label, type: p.type, default: p.default, explain: (p as any).explain })) },
      params: blk.def.params.map(p => ({ key: p.key, default: p.default, value: values[p.key] })),
      project: blk.project
    });
  }
  return used;
}

function findTokenByIndex(text: string, index: number): null | { start: number; end: number; blockId: string; params: Record<string, any> } {
  if (index < 0) return null;
  const regex = /\[\[Block:([\w-]+)([^\]]*)\]\]/g; let m; let i = 0;
  while ((m = regex.exec(text))) {
    if (i === index) {
      const start = m.index; const end = start + m[0].length; const id = m[1];
      const params: Record<string, any> = {};
      const rest = (m[2] || '').trim();
      rest.split(/\s+/).filter(Boolean).forEach(kv => { const eq = kv.indexOf('='); if (eq>0){ const k = kv.slice(0,eq); let v = kv.slice(eq+1); try { params[k] = JSON.parse(v); } catch { params[k] = v; } } });
      return { start, end, blockId: id, params };
    }
    i++;
  }
  return null;
}

function blockLabelFor(id: string){ return 'Block ' + id.slice(-4); }
function tokenColor(id: string, hue?: number){
  // Prefer provided hue; otherwise hash id to hue
  let h = typeof hue === 'number' ? hue : 0; if (typeof hue !== 'number'){ for (let i=0;i<id.length;i++){ h = (h*31 + id.charCodeAt(i)) % 360; } }
  const bg = `hsla(${h}, 70%, 28%, 0.40)`; const bd = `hsla(${h}, 85%, 62%, 0.60)`; const fg = '#e9eef5';
  return { bg, bd, fg };
}
function escapeHTML(s: string){ return s.replace(/[&<>]/g, (c)=> ({'&':'&amp;','<':'&lt;','>':'&gt;'} as any)[c]); }
function encodeAttr(s: string){ return btoa(unescape(encodeURIComponent(s))); }
function decodeAttr(s: string){ try { return decodeURIComponent(escape(atob(s))); } catch { return s; } }
function parseToken(token: string){
  const m = token.match(/^\[\[Block:([\w-]+)([^\]]*)\]\]$/); if (!m) return null; const id = m[1]; const rest = (m[2]||'').trim();
  const start = prompt.indexOf(token); const end = start + token.length;
  const params: Record<string, any> = {}; rest.split(/\s+/).filter(Boolean).forEach(kv=>{ const eq=kv.indexOf('='); if(eq>0){ const k=kv.slice(0,eq); let v=kv.slice(eq+1); try{ params[k]=JSON.parse(v);}catch{params[k]=v;} } });
  return { id, start, end, params };
}

// Small helper form for adding custom params
const CustomParamForm: React.FC<{ onAdd: (p: ParamDef) => void }> = ({ onAdd }) => {
  const [name, setName] = useState('parameter');
  const [type, setType] = useState<'color'|'text'|'number'|'select'>('text');
  const [def, setDef] = useState<any>('');
  return (
    <div style={{display:'grid', gap:8}}>
      <input placeholder="name" value={name} onChange={(e)=>setName(e.target.value)} style={input}/>
      <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:8}}>
        <select value={type} onChange={(e)=>setType(e.target.value as any)} style={input as any}>
          <option value="text">text</option>
          <option value="number">number</option>
          <option value="color">color</option>
          <option value="select">select</option>
        </select>
        <input placeholder="default" value={String(def)} onChange={(e)=>setDef(e.target.value)} style={input}/>
      </div>
      <div style={{display:'flex', justifyContent:'flex-end'}}>
        <button onClick={()=>onAdd({ key: name, label: name, type, default: type==='number' ? Number(def) : def })} style={ghost}>Add</button>
      </div>
    </div>
  );
};

// --- Segmented Composer utilities ------------------------------------------
function uid(){ return 'id_' + Math.random().toString(36).slice(2,9); }

function blockName(blockId: string, blocks: Block[]){
  const blk = blocks.find(b => b.def.id === blockId); return blk ? blk.def.name : 'Block';
}

function blockSummary(seg: BlockSeg, blocks: Block[]) {
  const blk = blocks.find(b => b.def.id === seg.blockId); if (!blk) return '';
  return blk.def.params.map(p => `${p.label}: ${String(seg.values[p.key] ?? p.default ?? '')}`).join(' · ');
}

function blockChip(seg: BlockSeg, blocks: Block[]): React.CSSProperties {
  const blk = blocks.find(b => b.def.id === seg.blockId);
  const color = tokenColor(seg.blockId, blk?.def.hue);
  return { padding:12, borderRadius:12, border:`1px solid ${color.bd}`, background: color.bg, color: color.fg };
}

const dropZone: React.CSSProperties = { border:'1px dashed rgba(255,255,255,0.16)', borderRadius:10, padding:'8px 10px', color:'#a7b1c2', background:'rgba(255,255,255,0.04)', textAlign:'center' };
const dropZoneHover: React.CSSProperties = { borderColor:'rgba(110,168,254,0.8)', background:'rgba(110,168,254,0.12)', color:'#e9eef5' };
const composerScroll: React.CSSProperties = { display:'flex', flexDirection:'column', gap:8, overflowY:'auto', paddingRight:4, maxHeight:'100%' };

function extractBlocksFromSegments(segments: PromptSeg[], blocks: Block[]) {
  const used: any[] = [];
  for (const seg of segments) {
    if (seg.type !== 'block') continue;
    const bseg = seg as BlockSeg; const blk = blocks.find(b => b.def.id === bseg.blockId); if (!blk) continue;
    used.push({
      id: blk.def.id,
      name: blk.def.name,
      def: { params: blk.def.params.map(p => ({ key: p.key, label: p.label, type: p.type, default: p.default, explain: (p as any).explain })) },
      params: blk.def.params.map(p => ({ key: p.key, default: p.default, value: bseg.values[p.key] })),
      project: blk.project,
      context: { url: bseg.contextUrl || '', data: bseg.contextData || '' }
    });
  }
  return used;
}

function openBlockEditor(seg: BlockSeg){ /* implemented in component via setEditingBlock; placeholder */ return; }
