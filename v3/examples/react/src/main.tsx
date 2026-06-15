import * as React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { LayerLab } from './LayerLab';

// `?demo=layers` → the focused layer-document demo; otherwise the full viewer.
const demo = new URLSearchParams(window.location.search).get('demo');

createRoot(document.getElementById('root')!).render(demo === 'layers' ? <LayerLab /> : <App />);
