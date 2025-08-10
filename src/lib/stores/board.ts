import { writable, derived } from 'svelte/store';
import type { DocState, Layer, Shape, Tool, UserRef, VersionSnapshot } from '../types';

export const currentTool = writable<Tool>('select');
export const layers = writable<Layer[]>([]);
export const selectedShapeIds = writable<string[]>([]);
export const docImage = writable<DocState['image']>(undefined);
export const docVersion = writable<number>(0);
export const updatedBy = writable<string>('');
export const updatedAt = writable<number>(Date.now());

export const hasImage = derived(docImage, (img) => !!img);

export function createEmptyState(docId: string, user: UserRef): DocState {
  return {
    docId,
    image: undefined,
    layers: [
      { id: 'layer-1', name: 'Layer 1', visible: true, zIndex: 0, shapes: [] },
    ],
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
    version: _version,
    updatedAt: _updatedAt,
    updatedBy: userId,
  };
}

export function updateLayer(updater: (prev: Layer[]) => Layer[]) {
  layers.update(updater);
  updatedAt.set(Date.now());
}

export function upsertShape(layerId: string, shape: Shape) {
  updateLayer((prev) => prev.map((l) => (l.id === layerId ? { ...l, shapes: upsertById(l.shapes, shape) } : l)));
}

export function deleteShape(layerId: string, shapeId: string) {
  updateLayer((prev) => prev.map((l) => (l.id === layerId ? { ...l, shapes: l.shapes.filter((s) => s.id !== shapeId) } : l)));
}

function upsertById<T extends { id: string }>(arr: T[], item: T): T[] {
  const idx = arr.findIndex((x) => x.id === item.id);
  if (idx === -1) return [...arr, item];
  const copy = arr.slice();
  copy[idx] = item;
  return copy;
}

