import { createCapabilityToken, type PageObjectNumber } from '@embedpdf-x/kernel';

export interface Marker {
  id: string;
  /** Durable page identity (pon) — markers survive page reorder/insert/delete. */
  pon: PageObjectNumber;
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
  forPage(pon: PageObjectNumber): Marker[];
  selectedId(): string | null;
  selectedMarker(): Marker | null;
  add(pon: PageObjectNumber, pt: { x: number; y: number }): void;
  select(id: string | null): void;
  remove(id: string): void;
}

export const MarkerToken = createCapabilityToken<MarkerCapability>('marker');
