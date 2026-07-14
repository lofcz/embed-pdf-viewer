/**
 * THIS viewer's tool badge: the toolbar's own icon riding the cursor. The
 * library positions the badge (a screen-constant chip at the pointer's top
 * right — see <ToolBadge/> in the Stage overlay); this component only decides
 * what it shows. It reuses the SAME icon set and the SAME accent derivation as
 * the toolbar buttons (TOOL_ICONS is recorded by the command definitions), so
 * the chip is pixel-identical to the button the user just pressed — recolor
 * the tool and both follow. Every draw tool in this viewer has a command
 * icon; an unmapped tool renders nothing (omit the renderer prop entirely to
 * get the library's built-in scene glyph instead).
 */
import { useAnnotationDefaults } from '@embedpdf-x/react/annotation';
import type { ToolBadgeRendererProps } from '@embedpdf-x/react/annotation';
import { TOOL_ICONS } from '../config/commands';
import { Icon } from './icons';

export function ToolBadgeIcon({ toolId, size }: ToolBadgeRendererProps) {
  const entry = TOOL_ICONS[toolId];
  const d = useAnnotationDefaults(toolId);
  if (!entry) return null;
  const accent = entry.accent
    ? {
        primary: d[entry.accent.primary] ?? undefined,
        secondary: entry.accent.secondary ? (d[entry.accent.secondary] ?? undefined) : undefined,
      }
    : undefined;
  return (
    <div className="bg-surface border-border text-fg grid place-items-center rounded-md border p-0.5 shadow-md">
      <Icon name={entry.icon} size={size - 2} accent={accent} />
    </div>
  );
}
