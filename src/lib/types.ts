export type Tool = 'select' | 'arrow' | 'draw' | 'text' | 'erase';

export type Point = { x: number; y: number };

export type BaseShape = {
  id: string;
  layerId: string;
  createdBy: string;
  createdAt: number;
  updatedAt: number;
  rotation?: number;
  locked?: boolean;
  stroke?: string;
  strokeWidth?: number;
  opacity?: number;
};

export type ArrowShape = BaseShape & {
  kind: 'arrow';
  points: Point[]; // [start, end]
  arrowHead?: 'none' | 'triangle' | 'line';
};

export type FreehandShape = BaseShape & {
  kind: 'freehand';
  points: Point[]; // path points
  smoothing?: number;
};

export type TextShape = BaseShape & {
  kind: 'text';
  position: Point;
  text: string;
  fontSize?: number;
  fontFamily?: string;
  fill?: string;
  width?: number; // wrap
  height?: number;
};

export type Shape = ArrowShape | FreehandShape | TextShape;

export type Layer = {
  id: string;
  name: string;
  visible: boolean;
  locked?: boolean;
  zIndex: number;
  shapes: Shape[];
};

export type DocImage = {
  dataUrl: string;
  width: number;
  height: number;
  updatedAt: number;
  updatedBy: string;
};

export type DocState = {
  docId: string;
  image?: DocImage;
  layers: Layer[];
  comments?: Comment[];
  version: number;
  updatedAt: number;
  updatedBy: string;
};

export type VersionSnapshot = {
  id: string;
  name: string;
  createdAt: number;
  createdBy: string;
  image?: DocImage;
  layers: Layer[];
};

export type UserRef = { id: string; name?: string; color?: string };

export type Comment = {
  id: string;
  text: string;
  createdAt: number;
  createdBy: string;
};

