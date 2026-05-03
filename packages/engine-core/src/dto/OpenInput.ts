export interface OpenInputBytes {
  kind: 'bytes';
  /** Caller-supplied stable id; doubles as docId at the engine boundary. */
  id: string;
  bytes: Uint8Array | ArrayBuffer;
  password?: string | null;
}

export interface OpenInputPreuploaded {
  kind: 'preuploaded';
  /** docId of a document already known to the cloud server. */
  id: string;
  password?: string | null;
}

export type OpenInput = OpenInputBytes | OpenInputPreuploaded;

export interface OpenOptions {
  password?: string | null;
}
