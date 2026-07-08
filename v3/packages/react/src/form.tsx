// One-line-per-feature (ADAPTERS.md): registration travels with the UI.
export * from '@embedpdf-x/plugin-form';

import * as React from 'react';
import { useEffect, useState } from 'react';
import { FormToken } from '@embedpdf-x/plugin-form';
import type { FillItem, FormFieldDTO } from '@embedpdf-x/plugin-form';

import { useAnnotationSelected } from './annotation';
import { useTool } from './interaction';
import { shallowArray, useCapability, usePage, useSelector } from './runtime';
import type { PageContextValue } from './runtime';

/** Content-space box → view px, through the page transform (same idiom as
 *  the annotation layer — never re-derive `x * scale`). */
function boxToCss(item: FillItem, page: PageContextValue) {
  const tl = page.transform.pageToContent({ x: item.box.x, y: item.box.y });
  const br = page.transform.pageToContent({
    x: item.box.x + item.box.width,
    y: item.box.y + item.box.height,
  });
  return { left: tl.x, top: tl.y, width: br.x - tl.x, height: br.y - tl.y };
}

const controlBase: React.CSSProperties = {
  position: 'absolute',
  boxSizing: 'border-box',
  border: '1px solid rgba(56, 88, 233, 0.55)',
  background: 'rgba(255, 255, 255, 0.92)',
  borderRadius: 2,
  font: 'inherit',
};

/** Text control: keystrokes stay LOCAL (the input is the draft store);
 *  the engine write happens on blur or Enter. */
function FillText({
  item,
  page,
}: {
  item: Extract<FillItem, { control: 'text' }>;
  page: PageContextValue;
}) {
  const form = useCapability(FormToken);
  const [draft, setDraft] = useState(item.value);
  // Adopt engine truth whenever it changes under us (remote edit, reset).
  useEffect(() => setDraft(item.value), [item.value]);

  const css = boxToCss(item, page);
  const fontSize = Math.max(9, Math.min(css.height * 0.62, 24));
  const commit = () => {
    if (draft !== item.value) void form.setText(item.key, draft).catch(() => setDraft(item.value));
  };
  const shared: React.CSSProperties = {
    ...controlBase,
    ...css,
    fontSize,
    padding: '0 3px',
    ...(item.comb ? { letterSpacing: css.width / Math.max(1, item.maxLength ?? 1) / 2 } : {}),
  };
  return item.multiline ? (
    <textarea
      aria-label={item.label}
      value={draft}
      disabled={item.disabled}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      style={{ ...shared, resize: 'none' }}
    />
  ) : (
    <input
      aria-label={item.label}
      type={item.password ? 'password' : 'text'}
      value={draft}
      maxLength={item.maxLength ?? undefined}
      disabled={item.disabled}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
      }}
      style={shared}
    />
  );
}

function FillToggle({
  item,
  page,
}: {
  item: Extract<FillItem, { control: 'toggle' }>;
  page: PageContextValue;
}) {
  const form = useCapability(FormToken);
  const css = boxToCss(item, page);
  const glyphSize = Math.min(css.width, css.height) * 0.72;
  return (
    <button
      role={item.kind}
      aria-checked={item.checked}
      aria-label={item.label}
      disabled={item.disabled}
      onClick={() =>
        // Checkbox re-click clears; radio click always selects its state.
        void form.toggle(item.key, item.kind === 'checkbox' && item.checked ? null : item.onState)
      }
      style={{
        ...controlBase,
        ...css,
        cursor: item.disabled ? 'default' : 'pointer',
        display: 'grid',
        placeItems: 'center',
        padding: 0,
        borderRadius: item.kind === 'radio' ? '50%' : 2,
        fontSize: glyphSize,
        lineHeight: 1,
        color: '#1f2a44',
      }}
    >
      {item.checked ? (item.kind === 'radio' ? '●' : '✓') : ''}
    </button>
  );
}

function FillChoice({
  item,
  page,
}: {
  item: Extract<FillItem, { control: 'choice' }>;
  page: PageContextValue;
}) {
  const form = useCapability(FormToken);
  const css = boxToCss(item, page);
  return (
    <select
      aria-label={item.label}
      multiple={item.multi}
      disabled={item.disabled}
      value={item.multi ? item.selected : (item.selected[0] ?? '')}
      onChange={(e) => {
        const values = item.multi
          ? Array.from(e.target.selectedOptions).map((o) => o.value)
          : [e.target.value];
        void form.choose(item.key, values);
      }}
      style={{ ...controlBase, ...css, fontSize: Math.max(9, Math.min(css.height * 0.55, 18)) }}
    >
      {!item.multi && item.selected.length === 0 && <option value="" />}
      {item.options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

/**
 * Fill-mode form controls for one page. Active only while the `form-fill`
 * tool is — the single-active-tool hub is the mode switch: any other tool
 * hands the widgets back to the annotation plane.
 */

export function FormLayer() {
  const page = usePage();
  const form = useCapability(FormToken);
  const { activeToolId } = useTool();
  const active = activeToolId === 'form-fill';

  useEffect(() => {
    if (active) form.ensureGeom(page.pon);
  }, [active, form, page.pon]);

  const items = useSelector(FormToken, (c) => c.fillItems(page.pon), shallowArray);
  if (!active) return null;

  return (
    <div style={{ position: 'absolute', inset: 0 }}>
      {items.map((item) =>
        item.control === 'text' ? (
          <FillText key={`${item.key}:${item.annotObjectNumber}`} item={item} page={page} />
        ) : item.control === 'toggle' ? (
          <FillToggle key={`${item.key}:${item.annotObjectNumber}`} item={item} page={page} />
        ) : item.control === 'choice' ? (
          <FillChoice key={`${item.key}:${item.annotObjectNumber}`} item={item} page={page} />
        ) : null,
      )}
    </div>
  );
}

/** The form capability — values, interchange, repair. */
export function useForm() {
  return useCapability(FormToken);
}

/**
 * The FIELD behind the currently selected widget annotation (single
 * selection), or null. The design-mode join: widget selection lives in the
 * annotation plane, field properties live here.
 */
export function useFormField(): FormFieldDTO | null {
  const selected = useAnnotationSelected();
  const widget = selected.length === 1 && selected[0]!.subtype === 'widget' ? selected[0]! : null;
  const objnum = widget && widget.ref.kind === 'objectNumber' ? widget.ref.annotObjectNumber : 0;
  return useSelector(FormToken, (c) => (objnum > 0 ? c.fieldForWidget(objnum) : null));
}
