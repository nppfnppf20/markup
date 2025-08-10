<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import Konva from 'konva';
  import type { LockAdapter } from '../../lib/adapters/lock';
  import type { StorageAdapter } from '../../lib/adapters/storage';
  import type { DocState, UserRef, Layer, Shape, FreehandShape, ArrowShape, TextShape, Point, Tool } from '../../lib/types';
  import { applyState, createEmptyState, docImage, docVersion, getStateSnapshot, layers, updateLayer, currentTool, upsertShape, deleteShape, undo, redo, canUndo, canRedo } from '../../lib/stores/board';
  import { fileToDataUrlResized } from '../../lib/image';

  export let docId: string;
  export let currentUser: UserRef;
  export let storageAdapter: StorageAdapter;
  export let lockAdapter: LockAdapter;

  let imgEl: HTMLImageElement | null = null;
  let stageContainerEl: HTMLDivElement | null = null;
  let stage: Konva.Stage | null = null;
  let shapesLayer: Konva.Layer | null = null;
  let uiLayer: Konva.Layer | null = null;
  let transformer: Konva.Transformer | null = null;
  const nodeById = new Map<string, Konva.Group | Konva.Shape>();

  let strokeColor = '#2f6feb';
  let strokeWidth = 3;
  let activeLayerId: string | null = null;
  let drawingPath: Point[] = [];
  let drawingArrowStart: Point | null = null;
  let isPointerDown = false;
  // Text box drafting and editing
  let textBoxStart: Point | null = null;
  let textDraftRect: { x: number; y: number; w: number; h: number } | null = null;
  let tempDraftRect: Konva.Rect | null = null;
  let editingTextId: string | null = null;
  let editingTextValue = '';
  let selectedId: string | null = null;
  let isEditor = false;
  let activeTool: Tool = 'select';
  let lockHeartbeat: any;
  let pollInterval: any;
  let saving = false;
  let lastSavedImageDataUrl: string | undefined;

  const HEARTBEAT_MS = 15000;
  const READONLY_POLL_MS = 12000;
  const AUTOSAVE_MS = 1200;
  const MIN_TEXT_SIZE = 20; // px required to create a text box
  const widthOptions = [2, 4, 6, 8, 12];
  const colorOptions = [
    '#111827', // near-black
    '#ef4444', // red
    '#f97316', // orange
    '#eab308', // yellow
    '#10b981', // emerald
    '#06b6d4', // cyan
    '#3b82f6', // blue
    '#8b5cf6', // violet
    '#ec4899', // pink
    '#64748b', // slate
  ];
  let colorDropdownOpen = false;
  let colorDropdownEl: HTMLDivElement | null = null;
  let widthDropdownOpen = false;
  let widthDropdownEl: HTMLDivElement | null = null;

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

  function ensureStage() {
    if (!$docImage || !stageContainerEl) return;
    const width = $docImage.width;
    const height = $docImage.height;
    if (stage) {
      stage.size({ width, height });
      return;
    }
    stage = new Konva.Stage({ container: stageContainerEl, width, height });
    shapesLayer = new Konva.Layer();
    uiLayer = new Konva.Layer();
    transformer = new Konva.Transformer({ rotateEnabled: false });
    uiLayer.add(transformer);
    stage.add(shapesLayer, uiLayer);

    // Stage-level input handling for tools
    stage.on('mousedown touchstart', onStagePointerDown);
    stage.on('mousemove touchmove', onStagePointerMove);
    stage.on('mouseup touchend', onStagePointerUp);
    stage.on('click tap', (evt) => {
      if (evt.target === stage && activeTool === 'select') {
        selectedId = null;
        transformer?.nodes([]);
        uiLayer?.batchDraw();
      }
    });

    rebuildShapes();
  }

  function rebuildShapes() {
    if (!shapesLayer) return;
    nodeById.clear();
    shapesLayer.destroyChildren();
    // First add non-text shapes (freehand, arrow)
    for (const layer of $layers) {
      if (!layer.visible) continue;
      for (const shape of layer.shapes) {
        if (shape.kind === 'text') continue;
        const node = createNodeForShape(shape);
        if (node) {
          nodeById.set(shape.id, node);
          shapesLayer.add(node);
        }
      }
    }
    // Then add text shapes on top
    for (const layer of $layers) {
      if (!layer.visible) continue;
      for (const shape of layer.shapes) {
        if (shape.kind !== 'text') continue;
        const node = createNodeForShape(shape);
        if (node) {
          nodeById.set(shape.id, node);
          shapesLayer.add(node);
        }
      }
    }
    shapesLayer.batchDraw();
  }

  function createNodeForShape(shape: Shape): Konva.Group | Konva.Shape | null {
    if (shape.kind === 'freehand') {
      const pts = shape.points.flatMap((p) => [p.x, p.y]);
      const line = new Konva.Line({
        points: pts,
        stroke: shape.stroke || '#2f6feb',
        strokeWidth: shape.strokeWidth || 3,
        lineCap: 'round',
        lineJoin: 'round',
        listening: true,
        draggable: false,
      });
      line.on('click tap', () => { if (activeTool === 'select') selectNode(shape.id); });
      return line;
    }
    if (shape.kind === 'arrow') {
      const [a, b] = shape.points;
      const arrow = new Konva.Arrow({
        points: [a.x, a.y, b.x, b.y],
        stroke: shape.stroke || '#2f6feb',
        strokeWidth: shape.strokeWidth || 3,
        pointerLength: 10,
        pointerWidth: 10,
        draggable: false,
      });
      arrow.on('click tap', () => { if (activeTool === 'select') selectNode(shape.id); });
      return arrow;
    }
    if (shape.kind === 'text') {
      const group = new Konva.Group({ x: shape.position.x, y: shape.position.y, draggable: isEditor && activeTool === 'select' });
      const rect = new Konva.Rect({
        x: 0,
        y: 0,
        width: (shape.width || 200),
        height: (shape.height || 60),
        fill: 'white',
        stroke: shape.fill || '#2f6feb',
        cornerRadius: 6,
      });
      const text = new Konva.Text({
        x: 6,
        y: 6,
        width: Math.max(0, (shape.width || 200) - 12),
        height: Math.max(0, (shape.height || 60) - 12),
        text: shape.text,
        fontSize: shape.fontSize || 16,
        fill: shape.fill || '#2f6feb',
        wrap: 'word',
        align: 'left',
        verticalAlign: 'top',
        listening: false,
      });
      group.add(rect);
      group.add(text);
      group.on('click tap', () => { if (activeTool === 'select') selectNode(shape.id); });
      group.on('dblclick dbltap', () => startEditText(shape.id));
      group.on('dragend', () => {
        const pos = group.position();
        upsertShape(shape.layerId, { ...shape, position: { x: pos.x, y: pos.y }, updatedAt: Date.now() });
      });
      group.on('transformend', () => {
        const newW = Math.max(40, rect.width() * group.scaleX());
        const newH = Math.max(30, rect.height() * group.scaleY());
        group.scale({ x: 1, y: 1 });
        rect.width(newW); rect.height(newH);
        text.width(Math.max(0, newW - 12));
        text.height(Math.max(0, newH - 12));
        text.fontSize(shape.fontSize || 16); // keep font size consistent
        upsertShape(shape.layerId, { ...shape, width: newW, height: newH, updatedAt: Date.now() });
        shapesLayer?.batchDraw();
      });
      return group;
    }
    return null;
  }

  function selectNode(id: string) {
    selectedId = id;
    if (!transformer || !uiLayer) return;
    const node = nodeById.get(id);
    if (node) {
      transformer.nodes([node as any]);
      uiLayer.batchDraw();
    }
  }

  function startEditText(id: string) {
    const shape = findTextShapeById(id);
    if (!shape || !stage) return;
    editingTextId = id;
    editingTextValue = shape.text;
    positionEditorOverShape(shape);
  }

  function positionEditorOverShape(shape: TextShape) {
    if (!stageContainerEl) return;
    const node = nodeById.get(shape.id) as Konva.Group | undefined;
    if (!node) return;
    const abs = node.getClientRect({ relativeTo: stage! });
    const containerRect = stageContainerEl.getBoundingClientRect();
    const x = abs.x + containerRect.left;
    const y = abs.y + containerRect.top;
    const w = abs.width;
    const h = abs.height;
    editorStyle = {
      display: 'block',
      left: `${x}px`,
      top: `${y}px`,
      width: `${w}px`,
      height: `${h}px`,
      fontSize: `${shape.fontSize || 16}px`,
      color: shape.fill || '#2f6feb',
    };
    // focus will be handled via bind: this when rendered
  }

  let editorEl: HTMLTextAreaElement | null = null;
  let editorStyle: Record<string, string> = { display: 'none' };

  function commitEditor() {
    if (!editingTextId) return;
    const shape = findTextShapeById(editingTextId);
    if (!shape) return;
    upsertShape(shape.layerId, { ...shape, text: editingTextValue.trim(), updatedAt: Date.now() });
    closeEditor();
  }

  function closeEditor() {
    editingTextId = null;
    editingTextValue = '';
    editorStyle = { display: 'none' };
  }

  function handleTextAreaKeydown(e: KeyboardEvent) {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      commitEditor();
    } else if (e.key === 'Escape') {
      closeEditor();
    }
  }

  function findTextShapeById(id: string): TextShape | null {
    for (const layer of $layers) {
      const s = layer.shapes.find((sh) => sh.id === id && sh.kind === 'text');
      if (s) return s as TextShape;
    }
    return null;
  }

  function onStagePointerDown() {
    if (!isEditor || !stage) return;
    activeLayerId = getActiveLayerId();
    if (!activeLayerId) return;
    isPointerDown = true;
    const p = stage.getPointerPosition();
    if (!p) return;
    if (activeTool === 'draw') {
      drawingPath = [{ x: p.x, y: p.y }];
      // temp line
      const temp = new Konva.Line({ points: [p.x, p.y], stroke: strokeColor, strokeWidth, lineCap: 'round', lineJoin: 'round' });
      shapesLayer?.add(temp);
      tempLineRef = temp;
      // keep text above temp drawings
      shapesLayer?.getChildren().forEach((child) => { if (child instanceof Konva.Group) child.moveToTop(); });
      shapesLayer?.batchDraw();
    } else if (activeTool === 'arrow') {
      drawingArrowStart = { x: p.x, y: p.y };
      const temp = new Konva.Arrow({ points: [p.x, p.y, p.x, p.y], stroke: strokeColor, strokeWidth, pointerLength: 10, pointerWidth: 10 });
      shapesLayer?.add(temp);
      tempArrowRef = temp;
      // keep text above temp drawings
      shapesLayer?.getChildren().forEach((child) => { if (child instanceof Konva.Group) child.moveToTop(); });
      shapesLayer?.batchDraw();
    } else if (activeTool === 'text') {
      if (editingTextId) return;
      textBoxStart = { x: p.x, y: p.y };
      tempDraftRect = new Konva.Rect({ x: p.x, y: p.y, width: 0, height: 0, stroke: strokeColor, dash: [4, 4] });
      shapesLayer?.add(tempDraftRect);
      shapesLayer?.batchDraw();
    } else if (activeTool === 'erase') {
      eraseAtPoint({ x: p.x, y: p.y });
    }
  }

  let tempLineRef: Konva.Line | null = null;
  let tempArrowRef: Konva.Arrow | null = null;

  function onStagePointerMove() {
    if (!isEditor || !isPointerDown || !stage) return;
    const p = stage.getPointerPosition();
    if (!p) return;
    if (activeTool === 'draw' && tempLineRef) {
      drawingPath.push({ x: p.x, y: p.y });
      tempLineRef.points(drawingPath.flatMap((pt) => [pt.x, pt.y]));
      shapesLayer?.batchDraw();
    } else if (activeTool === 'text' && textBoxStart && tempDraftRect) {
      const x = Math.min(textBoxStart.x, p.x);
      const y = Math.min(textBoxStart.y, p.y);
      const w = Math.abs(p.x - textBoxStart.x);
      const h = Math.abs(p.y - textBoxStart.y);
      tempDraftRect.position({ x, y });
      tempDraftRect.size({ width: w, height: h });
      shapesLayer?.batchDraw();
    } else if (activeTool === 'arrow' && drawingArrowStart && tempArrowRef) {
      tempArrowRef.points([drawingArrowStart.x, drawingArrowStart.y, p.x, p.y]);
      shapesLayer?.batchDraw();
    } else if (activeTool === 'erase') {
      eraseAtPoint({ x: p.x, y: p.y });
    }
  }

  function onStagePointerUp() {
    if (!isEditor || !stage) return;
    const p = stage.getPointerPosition();
    if (!p) return;
    if (activeTool === 'draw' && drawingPath.length > 1 && activeLayerId) {
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
    } else if (activeTool === 'arrow' && drawingArrowStart && activeLayerId) {
      const shape: ArrowShape = {
        id: createId('arr'),
        kind: 'arrow',
        layerId: activeLayerId,
        createdAt: Date.now(),
        createdBy: currentUser.id,
        updatedAt: Date.now(),
        points: [drawingArrowStart, { x: p.x, y: p.y }],
        stroke: strokeColor,
        strokeWidth,
        arrowHead: 'triangle',
      };
      addShape(shape);
    } else if (activeTool === 'text' && textBoxStart && activeLayerId) {
      const x = Math.min(textBoxStart.x, p.x);
      const y = Math.min(textBoxStart.y, p.y);
      const w = Math.abs(p.x - textBoxStart.x);
      const h = Math.abs(p.y - textBoxStart.y);
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
        // After creating a textbox, switch back to select tool automatically
        currentTool.set('select');
        activeTool = 'select';
        // editor will position on next rebuild
      }
    }
    // cleanup temp visuals
    tempLineRef?.destroy(); tempLineRef = null;
    tempArrowRef?.destroy(); tempArrowRef = null;
    tempDraftRect?.destroy(); tempDraftRect = null;
    drawingPath = [];
    drawingArrowStart = null;
    isPointerDown = false;
    textBoxStart = null;
  }

  // Rebuild Konva nodes whenever layers change
  $: {
    const _layersDep = $layers; // establish reactive dependency
    if (stage && shapesLayer) {
      rebuildShapes();
      // ensure text nodes draggable only in select mode
      const enableDrag = isEditor && activeTool === 'select';
      nodeById.forEach((node) => {
        if (node instanceof Konva.Group) node.draggable(enableDrag);
      });
      // restore selection
      if (selectedId) selectNode(selectedId);
      // if currently editing, reposition editor
      if (editingTextId) {
        const s = findTextShapeById(editingTextId);
        if (s) positionEditorOverShape(s);
      }
    }
  }

  function handleKeydown(e: KeyboardEvent) {
    if (!isEditor) return;
    // Undo / Redo shortcuts
    if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      undo();
      return;
    }
    if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      redo();
      return;
    }
    if ((e.key === 'Backspace' || e.key === 'Delete') && selectedId) {
      const layer = $layers.find((l) => l.shapes.some((s) => s.id === selectedId));
      if (layer) {
        deleteShape(layer.id, selectedId);
        selectedId = null;
        transformer?.nodes([]);
        uiLayer?.batchDraw();
      }
    }
  }

  onMount(() => {
    loadInitial();
    const unsub = currentTool.subscribe((v) => {
      activeTool = v;
      // toggle draggability of text groups based on tool
      const enableDrag = isEditor && activeTool === 'select';
      nodeById.forEach((node) => {
        if (node instanceof Konva.Group) node.draggable(enableDrag);
      });
      if (activeTool !== 'select') {
        selectedId = null;
        transformer?.nodes([]);
        uiLayer?.batchDraw();
      }
    });
    window.addEventListener('keydown', handleKeydown);
    // Close width dropdown on outside click
    const onDocClick = (e: MouseEvent) => {
      const t = e.target as Node;
      if (widthDropdownOpen && widthDropdownEl && !widthDropdownEl.contains(t)) widthDropdownOpen = false;
      if (colorDropdownOpen && colorDropdownEl && !colorDropdownEl.contains(t)) colorDropdownOpen = false;
    };
    document.addEventListener('click', onDocClick);
    // cleanup
    return () => document.removeEventListener('click', onDocClick);
  });
  onDestroy(async () => {
    window.removeEventListener('keydown', handleKeydown);
    clearInterval(lockHeartbeat);
    clearInterval(pollInterval);
    if (isEditor) {
      try { await lockAdapter.release(docId, currentUser.id); } catch {}
    }
    transformer?.destroy();
    shapesLayer?.destroy();
    uiLayer?.destroy();
    stage?.destroy();
  });

  // Ensure stage existence when image becomes available and container is bound
  $: if ($docImage && stageContainerEl) ensureStage();
</script>

<style>
  .board-root { display: grid; grid-template-rows: auto 1fr; height: 100%; }
  .toolbar {
    display: flex; gap: var(--space-2); padding: var(--space-2);
    border-bottom: 1px solid var(--color-border); background: var(--color-surface);
  }
  .toolbar button.active {
    border-color: #2f6feb;
    background: rgba(47, 111, 235, 0.12);
    color: #1f4ed4;
  }
  .stage-wrap { position: relative; }
  .busy-banner { position: absolute; top: 10px; right: 10px; background: #8a2c2c; color: white; padding: 4px 8px; border-radius: 6px; opacity: 0.9; }
  .image-input { margin-left: auto; }
  .editor-overlay {
    position: fixed;
    z-index: 10;
    display: none;
  }
  .swatch-line { width:22px; border-radius:2px; }
  .width-dropdown { position: relative; }
  .dropdown-trigger { display:flex; align-items:center; gap:8px; border:1px solid var(--color-border); background:#fff; border-radius:4px; padding:4px 8px; cursor:pointer; }
  .dropdown-menu { position:absolute; top:100%; left:0; margin-top:6px; background:#fff; border:1px solid var(--color-border); border-radius:6px; box-shadow:0 4px 18px rgba(0,0,0,0.12); padding:6px; display:flex; flex-direction:column; gap:4px; z-index: 5; }
  .width-option { display:flex; align-items:center; gap:8px; padding:6px 8px; border-radius:4px; border:none; background:transparent; cursor:pointer; }
  .width-option[aria-selected="true"] { background: rgba(47,111,235,0.12); }
  .dropdown-caret { margin-left: 6px; transition: transform 120ms ease; font-size: 18px; color: #444; }
  .dropdown-trigger[aria-expanded="true"] .dropdown-caret { transform: rotate(180deg); }
  .color-swatch { width:22px; height:22px; border-radius:50%; border:1px solid var(--color-border); cursor:pointer; padding:0; }
  .color-swatch.active { outline: 2px solid #2f6feb; outline-offset: 2px; }
  .color-option { display:flex; align-items:center; gap:8px; padding:6px 8px; border-radius:4px; border:none; background:transparent; cursor:pointer; }
  .color-option[aria-selected="true"] { background: rgba(47,111,235,0.12); }
  .editor-overlay textarea {
    width: 100%;
    height: 100%;
    box-sizing: border-box;
    background: transparent;
    border: 0;
    outline: none;
    resize: none;
    padding: 6px;
  }
</style>

<div class="board-root">
  <div class="toolbar">
    <div>
      <button class:active={$currentTool === 'select'} aria-pressed={$currentTool === 'select'} disabled={!isEditor} on:click={() => currentTool.set('select')}>Select</button>
      <button class:active={$currentTool === 'arrow'} aria-pressed={$currentTool === 'arrow'} disabled={!isEditor} on:click={() => currentTool.set('arrow')}>Arrow</button>
      <button class:active={$currentTool === 'draw'} aria-pressed={$currentTool === 'draw'} disabled={!isEditor} on:click={() => currentTool.set('draw')}>Draw</button>
      <button class:active={$currentTool === 'text'} aria-pressed={$currentTool === 'text'} disabled={!isEditor} on:click={() => currentTool.set('text')}>Text box</button>
      <button class:active={$currentTool === 'erase'} aria-pressed={$currentTool === 'erase'} disabled={!isEditor} on:click={() => currentTool.set('erase')}>Eraser</button>
    </div>
    <div style="display:flex; gap:8px; align-items:center; padding-left: 12px; border-left:1px solid var(--color-border);">
      <button disabled={!$canUndo || !isEditor} title="Undo (⌘Z)" on:click={() => undo()}>Undo</button>
      <button disabled={!$canRedo || !isEditor} title="Redo (⇧⌘Z)" on:click={() => redo()}>Redo</button>
    </div>
    <div style="display:flex; gap:16px; align-items:center; padding-left: 16px;">
      <div class="width-dropdown" bind:this={colorDropdownEl}>
        <button class="dropdown-trigger" aria-haspopup="listbox" aria-expanded={colorDropdownOpen} disabled={!isEditor} on:click={() => colorDropdownOpen = !colorDropdownOpen}>
          <span class="color-swatch" style={`background:${strokeColor}; width:16px; height:16px;`}></span>
          <span class="dropdown-caret">▾</span>
        </button>
        {#if colorDropdownOpen}
          <div class="dropdown-menu" role="listbox">
            {#each colorOptions as c}
              <button class="color-option" role="option" aria-selected={strokeColor === c} aria-label={`Color ${c}`} on:click={() => { strokeColor = c; colorDropdownOpen = false; }}>
                <span class="color-swatch" style={`background:${c}`}></span>
              </button>
            {/each}
          </div>
        {/if}
      </div>
      <div class="width-dropdown" bind:this={widthDropdownEl}>
        <button class="dropdown-trigger" aria-haspopup="listbox" aria-expanded={widthDropdownOpen} disabled={!isEditor} on:click={() => widthDropdownOpen = !widthDropdownOpen}>
          <span class="swatch-line" style="height:{strokeWidth}px; background:{strokeColor}; width:24px;"></span>
          <span class="dropdown-caret">▾</span>
        </button>
        {#if widthDropdownOpen}
          <div class="dropdown-menu" role="listbox">
            {#each widthOptions as w}
              <button class="width-option" role="option" aria-selected={strokeWidth === w} aria-label={`Width ${w}px`} on:click={() => { strokeWidth = w; widthDropdownOpen = false; }}>
                <span class="swatch-line" style="height:{w}px; background:{strokeColor}; width:24px;"></span>
              </button>
            {/each}
          </div>
        {/if}
      </div>
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
        <div bind:this={stageContainerEl} style="position:absolute; inset:0; z-index:1; pointer-events:auto;"></div>
        {#if editingTextId}
          <div class="editor-overlay" style="display:{editorStyle.display}; left:{editorStyle.left}; top:{editorStyle.top}; width:{editorStyle.width}; height:{editorStyle.height};">
            <textarea
              bind:this={editorEl}
              bind:value={editingTextValue}
              style="font-size:{editorStyle.fontSize}; color:{editorStyle.color};"
              on:keydown={handleTextAreaKeydown}
              on:blur={commitEditor}
              autofocus
            />
          </div>
            {/if}
      </div>
    {:else}
      <div style="padding: 24px;">No image loaded yet. Use the file picker above.</div>
    {/if}
  </div>
</div>


