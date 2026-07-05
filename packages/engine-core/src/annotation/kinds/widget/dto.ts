import type { AnnotationBase } from '../../base';
import type { WidgetStyleFields } from '../widget.shared';

/**
 * A form widget annotation: the page-scoped VIEW of a logical form field.
 * The value, options, and field semantics live on `doc.forms`; this DTO
 * carries the widget plane only — geometry, appearance, and the join key.
 *
 * Widgets are readable and patchable like every kind, and creatable as
 * INERT annotations (no field). Adoption by a field — and deletion while
 * adopted — go through `doc.forms` (`attachWidget` / `deleteField`), which
 * own the field-tree bookkeeping.
 */
export interface WidgetAnnotationDTO extends AnnotationBase, WidgetStyleFields {
  subtype: 'widget';
  /**
   * Object number of the owning field's dictionary, or `0` when the
   * widget is unattached (inert). Join key to `FormFieldDTO.ref` /
   * `FormFieldWidget.annotObjectNumber` on the forms side.
   */
  fieldObjectNumber: number;
}
