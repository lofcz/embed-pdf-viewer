/**
 * Outline/bookmark shapes the chrome helpers operate on.
 *
 * v3 has no bookmark plugin and no catalog outline DTO yet, so these stay
 * local — a 1:1 of v2's `PdfBookmarkObject` / `PdfLinkTarget` enough for
 * destination resolution. Action `type` accepts both v2 numeric enums
 * (`Goto = 1`, `RemoteGoto = 2`) and v3 string arms (`goto`, `goto-remote`).
 */

export type OutlineDestination = {
  readonly pageIndex: number;
};

export type OutlineAction =
  | { type: 1 | 2 | 'goto' | 'goto-remote'; destination: OutlineDestination }
  | { type: 3 | 'uri'; uri: string }
  | { type: number | string };

export type OutlineTarget =
  | { type: 'destination'; destination: OutlineDestination }
  | { type: 'action'; action: OutlineAction };

export interface OutlineBookmark {
  readonly title: string;
  readonly target?: OutlineTarget;
  readonly children?: readonly OutlineBookmark[];
}

/** v2 `PdfActionType` numeric values, kept so ported tests stay literal. */
export const OutlineActionType = {
  Goto: 1,
  RemoteGoto: 2,
  URI: 3,
} as const;
