/**
 * Host half of `dsh-right`.
 *
 * A Cordis function plugin: it owns the `/dsh-right` routes and nothing else.
 * The browser half is a separate bundle declared by this package's
 * `dsh.client` manifest.
 */
import { registerRoutes } from "./routes.js";

/** Cordis function-plugin name. */
export const name = "dsh-right";

/**
 * Register the routes behind a scoped injection, so a composition without a
 * `webServer` or `connection` simply leaves this plugin inert instead of
 * parking its fiber in `pending`.
 */
export function apply(ctx) {
  ctx.inject(["webServer", "connection"], (scope) => registerRoutes(scope));
}
