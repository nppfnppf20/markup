import { writable, derived } from 'svelte/store';
import type { DocState, Layer, Shape, Tool, UserRef, VersionSnapshot, Comment } from '../types';

export const currentTool = writable<Tool>('select');
export const layers = writable<Layer[]>([]);
export const selectedShapeIds = writable<string[]>([]);
export const docImage = writable<DocState['image']>(undefined);
export const docVersion = writable<number>(0);
export const updatedBy = writable<string>('');
export const updatedAt = writable<number>(Date.now());

export const hasImage = derived(docImage, (img) => !!img);

// --- Undo / Redo state ---
export const undoStack = writable<Layer[][]>([]);
export const redoStack = writable<Layer[][]>([]);
export const canUndo = derived(undoStack, (s) => s.length > 0);
export const canRedo = derived(redoStack, (s) => s.length > 0);

function deepCloneLayers(ls: Layer[]): Layer[] {
  return JSON.parse(JSON.stringify(ls)) as Layer[];
}

export function createEmptyState(docId: string, user: UserRef): DocState {
  return {
    docId,
    image: undefined,
    layers: [
      { id: 'layer-1', name: 'Layer 1', visible: true, zIndex: 0, shapes: [] },
    ],
    comments: [],
    version: 0,
    updatedAt: Date.now(),
    updatedBy: user.id,
  };
}

export function applyState(state: DocState) {
  layers.set(state.layers);
  docImage.set(state.image);
  docVersion.set(state.version);
  updatedAt.set(state.updatedAt);
  updatedBy.set(state.updatedBy);
}

export function getStateSnapshot(docId: string, userId: string): DocState {
  let _layers: Layer[] = [];
  let _image: DocState['image'] = undefined;
  let _version = 0;
  let _updatedAt = Date.now();
  layers.subscribe((v) => (_layers = v))();
  docImage.subscribe((v) => (_image = v))();
  docVersion.subscribe((v) => (_version = v))();
  updatedAt.subscribe((v) => (_updatedAt = v))();
  return {
    docId,
    image: _image,
    layers: _layers,
    comments: undefined, // not persisted in this snapshot path (UI local only) for now
    version: _version,
    updatedAt: _updatedAt,
    updatedBy: userId,
  };
}

export function updateLayer(updater: (prev: Layer[]) => Layer[]) {
  // Capture previous state for undo
  let prevLayers: Layer[] = [];
  layers.subscribe((v) => (prevLayers = v))();
  const prevClone = deepCloneLayers(prevLayers);

  layers.update((current) => {
    const next = updater(current);
    // Push previous to undo stack and clear redo stack
    undoStack.update((s) => [...s, prevClone]);
    redoStack.set([]);
    return next;
  });
  updatedAt.set(Date.now());
}

export function upsertShape(layerId: string, shape: Shape) {
  updateLayer((prev) => prev.map((l) => (l.id === layerId ? { ...l, shapes: upsertById(l.shapes, shape) } : l)));
}

export function deleteShape(layerId: string, shapeId: string) {
  console.log('deleteShape called with layerId:', layerId, 'shapeId:', shapeId);
  updateLayer((prev) => prev.map((l) => (l.id === layerId ? { ...l, shapes: l.shapes.filter((s) => s.id !== shapeId) } : l)));
}

// Comments kept in a lightweight local store for now
export const comments = writable<Comment[]>([]);
export function addComment(text: string, user: UserRef) {
  const c: Comment = { id: `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, text, createdAt: Date.now(), createdBy: user.id };
  comments.update((prev) => [c, ...prev]);
}
export function deleteComment(id: string) {
  comments.update((prev) => prev.filter((c) => c.id !== id));
}

export function undo() {
  let _undo: Layer[][] = [];
  let _redo: Layer[][] = [];
  let _current: Layer[] = [];
  undoStack.subscribe((v) => (_undo = v))();
  redoStack.subscribe((v) => (_redo = v))();
  layers.subscribe((v) => (_current = v))();
  if (_undo.length === 0) return;
  const previous = _undo[_undo.length - 1];
  undoStack.set(_undo.slice(0, -1));
  // push current into redo
  redoStack.set([..._redo, deepCloneLayers(_current)]);
  layers.set(previous);
  updatedAt.set(Date.now());
}

export function redo() {
  let _redo: Layer[][] = [];
  let _undo: Layer[][] = [];
  let _current: Layer[] = [];
  redoStack.subscribe((v) => (_redo = v))();
  undoStack.subscribe((v) => (_undo = v))();
  layers.subscribe((v) => (_current = v))();
  if (_redo.length === 0) return;
  const next = _redo[_redo.length - 1];
  redoStack.set(_redo.slice(0, -1));
  // push current into undo
  undoStack.set([..._undo, deepCloneLayers(_current)]);
  layers.set(next);
  updatedAt.set(Date.now());
}

function upsertById<T extends { id: string }>(arr: T[], item: T): T[] {
  const idx = arr.findIndex((x) => x.id === item.id);
  if (idx === -1) return [...arr, item];
  const copy = arr.slice();
  copy[idx] = item;
  return copy;
}

