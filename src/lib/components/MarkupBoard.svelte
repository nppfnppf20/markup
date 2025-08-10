<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import type { LockAdapter } from '../../lib/adapters/lock';
  import type { StorageAdapter } from '../../lib/adapters/storage';
  import type { DocState, UserRef, Layer, Shape, FreehandShape, ArrowShape, TextShape, Point } from '../../lib/types';
  import { applyState, createEmptyState, docImage, docVersion, getStateSnapshot, layers, updateLayer, currentTool, upsertShape, deleteShape } from '../../lib/stores/board';
  import { fileToDataUrlResized } from '../../lib/image';

  export let docId: string;
  export let currentUser: UserRef;
  export let storageAdapter: StorageAdapter;
  export let lockAdapter: LockAdapter;

  let imgEl: HTMLImageElement | null = null;
  let strokeColor = '#2f6feb';
  let strokeWidth = 3;
  let activeLayerId: string | null = null;
  let drawingPath: Point[] = [];
  let drawingArrowStart: Point | null = null;
  let pointerPos: Point | null = null;
  let isPointerDown = false;
  // Text box drafting and editing
  let textBoxStart: Point | null = null;
  let textDraftRect: { x: number; y: number; w: number; h: number } | null = null;
  let editingTextId: string | null = null;
  let editingTextValue = '';
  import Textbox from './Textbox.svelte';
  let selectedTextId: string | null = null;
  let isEditor = false;
  let lockHeartbeat: any;
  let pollInterval: any;
  let saving = false;
  let lastSavedImageDataUrl: string | undefined;

  const HEARTBEAT_MS = 15000;
  const READONLY_POLL_MS = 12000;
  const AUTOSAVE_MS = 1200;
  const MIN_TEXT_SIZE = 20; // px required to create a text box

  let autosaveTimer: any;
  function scheduleAutosave() {
    if (!isEditor) return;
    clearTimeout(autosaveTimer);
    autosaveTimer = setTimeout(saveStatePartial, AUTOSAVE_MS);
  }

  async function loadInitial() {
    try {
      const state = await storageAdapter.getDocument(docId).catch(() => createEmptyState(docId, currentUser));
      applyState(state);
      lastSavedImageDataUrl = state.image?.dataUrl;
      await tryAcquire();
    } catch (e) {
      console.error(e);
    }
  }

  async function tryAcquire() {
    try {
      const res = await lockAdapter.acquire(docId, currentUser.id);
      if (res.ok) {
        isEditor = true;
        startHeartbeat();
      } else {
        isEditor = false;
        startPolling();
      }
    } catch (e) {
      console.error(e);
      isEditor = false;
      startPolling();
    }
  }

  function startHeartbeat() {
    clearInterval(pollInterval);
    clearInterval(lockHeartbeat);
    lockHeartbeat = setInterval(async () => {
      try {
        const r = await lockAdapter.renew(docId, currentUser.id);
        if (!r.ok) {
          isEditor = false;
          clearInterval(lockHeartbeat);
          startPolling();
        }
      } catch (e) {
        console.warn('renew failed', e);
      }
    }, HEARTBEAT_MS);
  }

  function startPolling() {
    clearInterval(lockHeartbeat);
    clearInterval(pollInterval);
    pollInterval = setInterval(async () => {
      try {
        const info = await lockAdapter.get(docId);
        if (!info.locked) {
          clearInterval(pollInterval);
          await tryAcquire();
        } else {
          // refresh latest doc while waiting
          const latest = await storageAdapter.getDocument(docId);
          applyState(latest);
          lastSavedImageDataUrl = latest.image?.dataUrl;
        }
      } catch {}
    }, READONLY_POLL_MS);
  }

  async function saveStatePartial() {
    if (!isEditor || saving) return;
    saving = true;
    try {
      const snapshot = getStateSnapshot(docId, currentUser.id);
      // avoid resending image if unchanged
      if (snapshot.image?.dataUrl === lastSavedImageDataUrl) {
        snapshot.image = undefined;
      }
      const { version } = await storageAdapter.saveDocument(docId, snapshot, snapshot.version);
      docVersion.set(version);
      if (snapshot.image && snapshot.image.dataUrl) {
        lastSavedImageDataUrl = snapshot.image.dataUrl;
      }
    } catch (e) {
      if ((e as Error).message === 'version_conflict') {
        // reload latest and flip to readonly
        const latest = await storageAdapter.getDocument(docId);
        applyState(latest);
        lastSavedImageDataUrl = latest.image?.dataUrl;
        isEditor = false;
        startPolling();
      } else {
        console.error(e);
      }
    } finally {
      saving = false;
    }
  }

  async function onFileChange(e: Event) {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    const { dataUrl, width, height } = await fileToDataUrlResized(file);
    const now = Date.now();
    docImage.set({ dataUrl, width, height, updatedAt: now, updatedBy: currentUser.id });
    lastSavedImageDataUrl = undefined; // force sending image once
    scheduleAutosave();
  }

  // React to state changes for autosave
  $: $layers, scheduleAutosave();
  $: $docImage, scheduleAutosave();

  function createId(prefix: string) {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }

  function getActiveLayerId(): string | null {
    let _layers: Layer[] = [];
    layers.subscribe((v) => (_layers = v))();
    const layer = _layers.find((l) => l.visible) || _layers[0];
    return layer?.id ?? null;
  }

  function addShape(shape: Shape) {
    updateLayer((prev) => prev.map((l) => (l.id === shape.layerId ? { ...l, shapes: [...l.shapes, shape] } : l)));
  }

  function toSvgPath(points: Point[]): string {
    if (points.length === 0) return '';
    const [p0, ...rest] = points;
    return `M ${p0.x} ${p0.y} ` + rest.map((p) => `L ${p.x} ${p.y}`).join(' ');
  }

  function getRelativePoint(evt: PointerEvent): Point {
    const rect = (evt.currentTarget as SVGElement).getBoundingClientRect();
    return { x: evt.clientX - rect.left, y: evt.clientY - rect.top };
  }

  function distancePointToSegment(p: Point, a: Point, b: Point): number {
    const vx = b.x - a.x; const vy = b.y - a.y;
    const wx = p.x - a.x; const wy = p.y - a.y;
    const c1 = vx * wx + vy * wy;
    if (c1 <= 0) return Math.hypot(p.x - a.x, p.y - a.y);
    const c2 = vx * vx + vy * vy;
    if (c2 <= c1) return Math.hypot(p.x - b.x, p.y - b.y);
    const t = c1 / c2;
    const proj = { x: a.x + t * vx, y: a.y + t * vy };
    return Math.hypot(p.x - proj.x, p.y - proj.y);
  }

  function shouldEraseShapeAt(shape: Shape, p: Point, tolerance = 8): boolean {
    if (shape.kind === 'freehand') {
      const pts = shape.points;
      for (let i = 1; i < pts.length; i++) {
        if (distancePointToSegment(p, pts[i - 1], pts[i]) <= (shape.strokeWidth || 3) + tolerance) return true;
      }
      return false;
    }
    if (shape.kind === 'arrow') {
      const [a, b] = shape.points;
      return distancePointToSegment(p, a, b) <= (shape.strokeWidth || 3) + tolerance;
    }
    if (shape.kind === 'text') {
      // simple hit: near anchor point
      const dx = p.x - shape.position.x; const dy = p.y - shape.position.y;
      return Math.hypot(dx, dy) <= 10 + tolerance;
    }
    return false;
  }

  function eraseAtPoint(p: Point) {
    const lid = getActiveLayerId();
    if (!lid) return;
    updateLayer((prev) => prev.map((l) => (
      l.id === lid
        ? { ...l, shapes: l.shapes.filter((s) => !shouldEraseShapeAt(s, p)) }
        : l
    )));
  }

  function onOverlayPointerDown(e: PointerEvent) {
    if (!isEditor) return;
    if ($currentTool === 'select') {
      // Clicking background clears selection
      selectedTextId = null;
    }
    activeLayerId = getActiveLayerId();
    if (!activeLayerId) return;
    isPointerDown = true;
    const p = getRelativePoint(e);
    pointerPos = p;
    if ($currentTool === 'draw') {
      drawingPath = [p];
    } else if ($currentTool === 'arrow') {
      drawingArrowStart = p;
    } else if ($currentTool === 'text') {
      // If currently editing a text, clicking elsewhere should just finish editing (no new box)
      if (editingTextId) {
        isPointerDown = false;
        return;
      }
      textBoxStart = p;
      textDraftRect = { x: p.x, y: p.y, w: 0, h: 0 };
    } else if ($currentTool === 'erase') {
      eraseAtPoint(p);
    }
  }

  function onOverlayPointerMove(e: PointerEvent) {
    if (!isEditor || !isPointerDown) return;
    const p = getRelativePoint(e);
    pointerPos = p;
    if ($currentTool === 'draw') {
      drawingPath = [...drawingPath, p];
    } else if ($currentTool === 'text' && textBoxStart) {
      const x = Math.min(textBoxStart.x, p.x);
      const y = Math.min(textBoxStart.y, p.y);
      const w = Math.abs(p.x - textBoxStart.x);
      const h = Math.abs(p.y - textBoxStart.y);
      textDraftRect = { x, y, w, h };
    } else if ($currentTool === 'erase') {
      eraseAtPoint(p);
    }
  }

  function onOverlayPointerUp(e: PointerEvent) {
    if (!isEditor) return;
    const p = getRelativePoint(e);
    if ($currentTool === 'draw' && drawingPath.length > 1 && activeLayerId) {
      const shape: FreehandShape = {
        id: createId('fh'),
        kind: 'freehand',
        layerId: activeLayerId,
        createdAt: Date.now(),
        createdBy: currentUser.id,
        updatedAt: Date.now(),
        points: drawingPath,
        stroke: strokeColor,
        strokeWidth,
      };
      addShape(shape);
    } else if ($currentTool === 'arrow' && drawingArrowStart && activeLayerId) {
      const shape: ArrowShape = {
        id: createId('arr'),
        kind: 'arrow',
        layerId: activeLayerId,
        createdAt: Date.now(),
        createdBy: currentUser.id,
        updatedAt: Date.now(),
        points: [drawingArrowStart, p],
        stroke: strokeColor,
        strokeWidth,
        arrowHead: 'triangle',
      };
      addShape(shape);
    } else if ($currentTool === 'text' && textBoxStart && activeLayerId) {
      const x = Math.min(textBoxStart.x, p.x);
      const y = Math.min(textBoxStart.y, p.y);
      const w = Math.abs(p.x - textBoxStart.x);
      const h = Math.abs(p.y - textBoxStart.y);
      // Only create a text box if user dragged a reasonable size
      if (w >= MIN_TEXT_SIZE && h >= MIN_TEXT_SIZE) {
        const id = createId('txt');
        const shape: TextShape = {
          id,
          kind: 'text',
          layerId: activeLayerId,
          createdAt: Date.now(),
          createdBy: currentUser.id,
          updatedAt: Date.now(),
          position: { x, y },
          text: '',
          fontSize: 16,
          fill: strokeColor,
          width: w,
          height: h,
        };
        addShape(shape);
        editingTextId = id;
        editingTextValue = '';
      }
    }
    drawingPath = [];
    drawingArrowStart = null;
    pointerPos = null;
    isPointerDown = false;
    textBoxStart = null;
    textDraftRect = null;
  }

  function handleTextAreaKeydown(e: KeyboardEvent) {
    const el = e.target as HTMLTextAreaElement;
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      el.blur();
    }
  }

  onMount(() => {
    loadInitial();
  });
  onDestroy(async () => {
    clearInterval(lockHeartbeat);
    clearInterval(pollInterval);
    if (isEditor) {
      try { await lockAdapter.release(docId, currentUser.id); } catch {}
    }
  });
</script>

<style>
  .board-root { display: grid; grid-template-rows: auto 1fr; height: 100%; }
  .toolbar {
    display: flex; gap: var(--space-2); padding: var(--space-2);
    border-bottom: 1px solid var(--color-border); background: var(--color-surface);
  }
  .stage-wrap { position: relative; }
  .busy-banner { position: absolute; top: 10px; right: 10px; background: #8a2c2c; color: white; padding: 4px 8px; border-radius: 6px; opacity: 0.9; }
  .image-input { margin-left: auto; }
</style>

<div class="board-root">
  <div class="toolbar">
    <div>
      <button disabled={!isEditor} on:click={() => currentTool.set('select')}>Select</button>
      <button disabled={!isEditor} on:click={() => currentTool.set('arrow')}>Arrow</button>
      <button disabled={!isEditor} on:click={() => currentTool.set('draw')}>Draw</button>
      <button disabled={!isEditor} on:click={() => currentTool.set('text')}>Text</button>
      <button disabled={!isEditor} on:click={() => currentTool.set('erase')}>Eraser</button>
    </div>
    <div style="display:flex; gap:10px; align-items:center; padding-left: 16px;">
      <label>Color <input type="color" bind:value={strokeColor} disabled={!isEditor} /></label>
      <label>Width <input type="number" min="1" max="12" bind:value={strokeWidth} disabled={!isEditor} style="width:60px" /></label>
    </div>
    <input class="image-input" type="file" accept="image/*" on:change={onFileChange} disabled={!isEditor} />
  </div>
  <div class="stage-wrap">
    {#if !isEditor}
      <div class="busy-banner">Read-only: in use by another editor</div>
    {/if}
    {#if $docImage}
      <div style="display:inline-block; position: relative;">
        <img bind:this={imgEl} src={$docImage.dataUrl} width={$docImage.width} height={$docImage.height} alt="Markup base" style="display:block; max-width:100%; height:auto;" />
        <svg
          width={$docImage.width}
          height={$docImage.height}
          style="position:absolute; inset:0;"
          on:pointerdown={onOverlayPointerDown}
          on:pointermove={onOverlayPointerMove}
          on:pointerup={onOverlayPointerUp}
        >
          {#if textDraftRect}
            <rect x={textDraftRect.x} y={textDraftRect.y} width={textDraftRect.w} height={textDraftRect.h} fill="none" stroke={strokeColor} stroke-dasharray="4 4" />
          {/if}
          {#each $layers as layer (layer.id)}
            {#if layer.visible}
              {#each layer.shapes as shape (shape.id)}
                {#if shape.kind === 'freehand'}
                  <path d={toSvgPath(shape.points)} fill="none" stroke={shape.stroke || '#2f6feb'} stroke-width={shape.strokeWidth || 3} stroke-linecap="round" stroke-linejoin="round" />
                {:else if shape.kind === 'arrow'}
                  <line x1={shape.points[0].x} y1={shape.points[0].y} x2={shape.points[1].x} y2={shape.points[1].y} stroke={shape.stroke || '#2f6feb'} stroke-width={shape.strokeWidth || 3} />
                 {:else if shape.kind === 'text'}
                   <Textbox
                     x={shape.position.x}
                     y={shape.position.y}
                     width={shape.width || 200}
                     height={shape.height || 60}
                     text={shape.text}
                     color={shape.fill || strokeColor}
                     fontSize={shape.fontSize || 16}
                     isEditing={editingTextId === shape.id}
                     selected={selectedTextId === shape.id}
                     on:select={() => { if ($currentTool === 'select') selectedTextId = shape.id; }}
                     on:delete={() => { deleteShape(shape.layerId, shape.id); selectedTextId = null; }}
                     on:save={(e) => { upsertShape(shape.layerId, { ...shape, text: e.detail.text, updatedAt: Date.now() }); editingTextId = null; editingTextValue = ''; }}
                     on:resize={(e) => { upsertShape(shape.layerId, { ...shape, width: e.detail.width, height: e.detail.height, updatedAt: Date.now() }); }}
                   />
                {/if}
              {/each}
            {/if}
          {/each}
          {#if $currentTool === 'draw' && drawingPath.length > 0}
            <path d={toSvgPath(drawingPath)} fill="none" stroke={strokeColor} stroke-width={strokeWidth} stroke-linecap="round" stroke-linejoin="round" />
          {/if}
          {#if $currentTool === 'arrow' && drawingArrowStart && pointerPos}
            <line x1={drawingArrowStart.x} y1={drawingArrowStart.y} x2={pointerPos.x} y2={pointerPos.y} stroke={strokeColor} stroke-width={strokeWidth} />
          {/if}
          {#if $currentTool === 'text' && textDraftRect}
            <rect x={textDraftRect.x} y={textDraftRect.y} width={textDraftRect.w} height={textDraftRect.h} fill="none" stroke={strokeColor} stroke-dasharray="4 4" />
          {/if}
        </svg>
      </div>
    {:else}
      <div style="padding: 24px;">No image loaded yet. Use the file picker above.</div>
    {/if}
  </div>
</div>


