import type { PageObjectNumber, RevisionToken } from '@embedpdf/engine-core';
import { EngineError, EngineErrorCode, revisionTokensEqual } from '@embedpdf/engine-core';

/**
 * Per-page generation counter. Backs `RevisionToken` so weak
 * `AnnotationRef.kind === 'index'` references can be validated against the
 * exact page state they were minted from.
 *
 * `bump()` is the only mutator; mutation services call it after a
 * structural change to the page (annotation create/delete/reorder).
 * Read paths never mutate the store.
 */
export class RevisionStore {
  private readonly generations = new Map<PageObjectNumber, number>();

  constructor(public readonly docSessionId: string) {}

  /** Returns the current generation, defaulting to 0 for first read. */
  current(pageObjectNumber: PageObjectNumber): number {
    return this.generations.get(pageObjectNumber) ?? 0;
  }

  /** Mints a fresh `RevisionToken` for the page's current generation. */
  token(pageObjectNumber: PageObjectNumber): RevisionToken {
    return {
      docSessionId: this.docSessionId,
      pageObjectNumber,
      generation: this.current(pageObjectNumber),
    };
  }

  /**
   * Increments the generation counter for a page. Returns the new token.
   * Called by mutation services after every structural change.
   */
  bump(pageObjectNumber: PageObjectNumber): RevisionToken {
    const next = this.current(pageObjectNumber) + 1;
    this.generations.set(pageObjectNumber, next);
    return this.token(pageObjectNumber);
  }

  /**
   * Strict equality check. Throws `EngineError(InvalidReference)` when the
   * caller's token does not match what the store currently holds.
   */
  validate(token: RevisionToken): void {
    if (token.docSessionId !== this.docSessionId) {
      throw new EngineError(
        EngineErrorCode.InvalidReference,
        'revision token belongs to a different document session',
        { details: { token } },
      );
    }
    const current = this.token(token.pageObjectNumber);
    if (!revisionTokensEqual(current, token)) {
      throw new EngineError(EngineErrorCode.InvalidReference, 'revision token is stale', {
        details: { provided: token, current },
      });
    }
  }
}
