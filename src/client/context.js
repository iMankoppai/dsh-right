/**
 * Resolving which Session a DOM element belongs to, and whether the sidebar's
 * browser tab is available.
 *
 * Chat messages, composer chips, and sidebar panes all carry the same owner
 * attribute; a right-click can therefore resolve the workspace root before it
 * asks the Host about a path.
 */
export function createContextResolver(ctx) {
  /** The session row for one id, when the sidebar list has it. */
  const sessionRow = (sessionId) => {
    try {
      return ctx.get("sessions")?.list?.getSnapshot?.().byId?.[sessionId];
    } catch {
      return undefined;
    }
  };

  /** Session id and workspace root for the element under the pointer. */
  const contextOf = (element) => {
    const owners = [
      element.closest("[data-conversation-session]"),
      element.closest("[data-sidebar-right-session]")
    ];
    for (const owner of owners) {
      if (owner === null) continue;
      const sessionId = owner.dataset.conversationSession ?? owner.dataset.sidebarRightSession;
      if (sessionId !== undefined && sessionId !== "") {
        return { sessionId, cwd: sessionRow(sessionId)?.cwd };
      }
    }

    try {
      const target = ctx.get("sidebarRight")?.commandTarget?.(element);
      if (target !== undefined && target !== null && typeof target.sessionId === "string") {
        return { sessionId: target.sessionId, cwd: sessionRow(target.sessionId)?.cwd };
      }
    } catch {
      // A controller that refuses this element: treat the Session as unknown.
    }

    const uiSession = ctx.get("uiSession")?.adapter?.current?.getSnapshot?.();
    const sessionId = uiSession?.key ?? uiSession?.props?.sessionId;
    if (typeof sessionId === "string" && sessionId !== "") return { sessionId, cwd: sessionRow(sessionId)?.cwd };

    return undefined;
  };

  /** The Session context of an element, without failing the right-click. */
  const contextOfSafe = (element) => {
    try {
      return contextOf(element);
    } catch {
      return undefined;
    }
  };

  /** Whether the right Sidebar can host a browser tab. */
  const sidebarBrowserAvailable = () => {
    try {
      const tabs = ctx.get("sidebarRightTabs");
      if (tabs === undefined || typeof tabs.get !== "function") return false;
      return tabs.get("browser") !== undefined;
    } catch {
      return false;
    }
  };

  return { sessionRow, contextOf, contextOfSafe, sidebarBrowserAvailable };
}
