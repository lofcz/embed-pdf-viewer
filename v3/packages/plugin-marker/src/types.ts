import { createCapabilityToken } from '@embedpdf/kernel';

export interface Marker {
  id: string;
  page: number;
  x: number; // page coordinates (PDF units)
  y: number;
}

export interface MarkerState {
  byPage: Record<number, Marker[]>;
  selected: string | null;
  seq: number;
}

export type MarkerAction =
  | { type: 'ADD'; marker: Marker }
  | { type: 'SELECT'; id: string | null }
  | { type: 'REMOVE'; id: string };

export interface MarkerCapability {
  forPage(pageIndex: number): Marker[];
  selectedId(): string | null;
  selectedMarker(): Marker | null;
  add(pageIndex: number, pt: { x: number; y: number }): void;
  select(id: string | null): void;
  remove(id: string): void;
}

export const MarkerToken = createCapabilityToken<MarkerCapability>('marker');
