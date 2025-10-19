import type {
	Session,
	SessionMiddlewareOptions,
	SessionStorage,
	SessionVariables,
} from "./session";
import { useSession } from "./session";

export type { Session, SessionStorage, SessionMiddlewareOptions };
export { useSession };

declare module "hono" {
	interface ContextVariableMap extends SessionVariables {}
}
