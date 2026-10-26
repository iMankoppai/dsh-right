/**
 * Bind the Session Remotes this plugin uses.
 *
 * Cordis treats `ctx.remote.workspaceFiles` as the virtual service
 * `remote.workspaceFiles`; a fiber that did not inject that dotted name throws
 * on property access. One scoped injection per namespace keeps a single absent
 * namespace from parking the whole plugin fiber in `pending`.
 */
import { bounded } from "./async.js";

export function createRemotes(ctx) {
  const remotes = {
    session: undefined,
    files: undefined,
    references: undefined,
    directoryPicker: undefined
  };

  /** Local field name ↔ the Remote namespace it comes from. */
  const bindings = [
    ["session", "session"],
    ["workspaceFiles", "files"],
    ["fileReferences", "references"],
    ["directoryPicker", "directoryPicker"]
  ];

  for (const [namespace, field] of bindings) {
    ctx.inject(["remote", `remote.${namespace}`], (scope) => {
      const service = scope.remote[namespace];
      remotes[field] = new Proxy(service, {
        get(target, key) {
          const value = target[key];
          return typeof value === "function" ? (...args) => namespace === "directoryPicker" ? value.apply(target, args) : bounded(() => value.apply(target, args), args.find(arg => arg instanceof AbortSignal)) : value;
        }
      });
      scope.effect?.(() => () => { remotes[field] = undefined; });
    });
  }

  return remotes;
}
