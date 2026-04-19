import { MouseEvent } from '@framework';
import { PDF_FORM_FIELD_TYPE, PdfWidgetAnnoObject } from '@embedpdf/models';
import { AnnotationRendererProps } from '@embedpdf/plugin-annotation/@framework';
import { useFormWidgetState } from '../../hooks/use-form-widget-state';
import { RenderWidget } from '../render-widget';

export function SignatureFieldFillMode(props: AnnotationRendererProps<PdfWidgetAnnoObject>) {
  const { annotation, scale, pageIndex, renderKey, scope, isReadOnly } = useFormWidgetState(props);
  const isSigned =
    annotation.field.type === PDF_FORM_FIELD_TYPE.SIGNATURE && annotation.field.isSigned;

  const handleRequestSignature = (event: MouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();

    if (isReadOnly || isSigned) return;
    scope?.requestSignatureField(annotation.id);
  };

  return (
    <div
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        overflow: 'hidden',
        pointerEvents: 'auto',
      }}
    >
      <RenderWidget
        pageIndex={pageIndex}
        annotation={annotation}
        scaleFactor={scale}
        renderKey={renderKey}
        style={{ pointerEvents: 'none' }}
      />
      {!isSigned && !isReadOnly && (
        <div
          onPointerDown={handleRequestSignature}
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'rgba(66, 133, 244, 0.06)',
            border: '1px dashed rgba(66, 133, 244, 0.45)',
            color: '#1a73e8',
            fontSize: `${Math.max(10, 12 * scale)}px`,
            fontWeight: 600,
            cursor: 'pointer',
            userSelect: 'none',
            boxSizing: 'border-box',
          }}
        >
          Click to sign
        </div>
      )}
    </div>
  );
}
