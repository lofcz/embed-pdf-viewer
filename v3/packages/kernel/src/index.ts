export * from './types';
export * from './kernel';

import type { Action, CapabilityToken, PluginDef } from './types';

/** Create a typed capability token. `name` is for debugging only. */
export function createCapabilityToken<T>(name: string): CapabilityToken<T> {
  return { name };
}

/** Identity helper that pins a plugin's generics. The real win is inference. */
export function definePlugin<S = unknown, A extends Action = Action, C = unknown>(
  def: PluginDef<S, A, C>,
): PluginDef<S, A, C> {
  return def;
}
