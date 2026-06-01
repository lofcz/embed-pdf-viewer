'use client';

import { useState } from 'react';

/**
 * Placeholder demo standing in for the real <CloudPDFViewer />.
 * It mimics the viewer chrome (zoom + page controls) so docs examples
 * feel live until the CloudPDF viewer packages ship.
 */
export function Demo() {
  const [zoom, setZoom] = useState(100);
  const [page, setPage] = useState(1);
  const totalPages = 3;

  return (
    <div
      style={{
        height: 360,
        display: 'flex',
        flexDirection: 'column',
        borderRadius: 12,
        overflow: 'hidden',
        background: '#F4F7FD',
        fontFamily: 'Inter, system-ui, sans-serif',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
          padding: '10px 14px',
          background: '#fff',
          borderBottom: '1px solid #E4EAF4',
        }}
      >
        <strong style={{ fontSize: 14, color: '#0A1A4D' }}>proposal.pdf</strong>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button onClick={() => setZoom((z) => Math.max(50, z - 10))} style={btn}>
            −
          </button>
          <span style={{ width: 48, textAlign: 'center', fontSize: 13, color: '#5A6B92' }}>
            {zoom}%
          </span>
          <button onClick={() => setZoom((z) => Math.min(200, z + 10))} style={btn}>
            +
          </button>
        </div>
      </div>

      <div
        style={{ flex: 1, overflow: 'auto', display: 'grid', placeItems: 'center', padding: 20 }}
      >
        <div
          style={{
            width: 240,
            transform: `scale(${zoom / 100})`,
            transformOrigin: 'top center',
            background: '#fff',
            borderRadius: 6,
            boxShadow: '0 10px 30px -12px rgba(10,26,77,0.35)',
            padding: 22,
          }}
        >
          <div style={{ height: 10, width: '60%', borderRadius: 3, background: '#1677FF' }} />
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              style={{
                height: 7,
                marginTop: 12,
                width: `${90 - i * 7}%`,
                borderRadius: 3,
                background: '#E4EAF4',
              }}
            />
          ))}
          <div style={{ marginTop: 20, fontSize: 11, color: '#8C9BBA' }}>Page {page}</div>
        </div>
      </div>

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 14,
          padding: '10px 14px',
          background: '#fff',
          borderTop: '1px solid #E4EAF4',
        }}
      >
        <button onClick={() => setPage((p) => Math.max(1, p - 1))} style={btn}>
          ‹
        </button>
        <span style={{ fontSize: 13, color: '#5A6B92' }}>
          {page} / {totalPages}
        </span>
        <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} style={btn}>
          ›
        </button>
      </div>
    </div>
  );
}

const btn: React.CSSProperties = {
  width: 30,
  height: 30,
  borderRadius: 8,
  border: '1px solid #E4EAF4',
  background: '#fff',
  color: '#0A1A4D',
  fontSize: 16,
  cursor: 'pointer',
};
