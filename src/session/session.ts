import type { Context } from "hono";
import { getRuntimeKey } from "hono/adapter";
import { getSignedCookie, setSignedCookie } from "hono/cookie";
import { createMiddleware } from "hono/factory";
import type { CookieOptions } from "hono/utils/cookie";

type FlashDataKey<Key extends string> = `__flash_${Key}__`;
export function flash<Key extends string>(key: Key): FlashDataKey<Key> {
	return `__flash_${key}__`;
}

type SessionData = {
	// biome-ignore lint/suspicious/noExplicitAny: Session values are user-defined and can store arbitrary payloads
	[key: string]: any;
};

type FlashSessionData<Data, FlashData> = Partial<
	Data & {
		[Key in keyof FlashData as FlashDataKey<Key & string>]: FlashData[Key];
	}
>;

export type Session<Data = SessionData, FlashData = Data> = {
	/** Get session ID */
	readonly id: () => string;
	/** Get session data */
	readonly data: () => FlashSessionData<Data, FlashData>;
	/** Check if session has a key */
	has: (key: (keyof Data | keyof FlashData) & string) => boolean;
	/** Get session value */
	get<Key extends (keyof Data | keyof FlashData) & string>(
		key: Key
	):
		| (Key extends keyof Data ? Data[Key] : undefined)
		| (Key extends keyof FlashData ? FlashData[Key] : undefined)
		| undefined;
	/** Set session value */
	set: <Key extends keyof Data & string>(key: Key, value: Data[Key]) => void;
	/** Set flash session value */
	flash<Key extends keyof FlashData & string>(name: Key, value: FlashData[Key]): void;
	/** Unset session value */
	unset(name: keyof Data & string): void;
};

export type SessionStorage<Data = SessionData, FlashData = Data> = {
	/** Read session data */
	read: (sid: string) => Promise<FlashSessionData<Data, FlashData> | null>;
	/** Create or update session data */
	upsert: (sid: string, data: FlashSessionData<Data, FlashData>, expires?: Date) => Promise<void>;
	/** Delete session data */
	delete: (sid: string) => Promise<void>;
};

type CreateSessionStorage<Data = SessionData, FlashData = Data> = (
	c: Context
) => SessionStorage<Data, FlashData>;

export type SessionMiddlewareOptions<Data = SessionData, FlashData = Data> = {
	/** Initial session data object */
	initialData?: Partial<Data>;
	/** Cookie options */
	cookie?: CookieOptions & {
		name?: string;
		secret?: string;
	};
	/** Function to create session storage */
	storage: CreateSessionStorage<Data, FlashData>;
};

export interface SessionVariables<Data = SessionData, FlashData = Data> {
	session: Session<Data, FlashData>;
	storage: SessionStorage<Data, FlashData> | null;
}

/**
 * Hono session middleware
 * Session data is stored in a user-defined storage and session ID is stored in a signed cookie
 * @returns Hono middleware
 * @example
 * ```ts
 * import { Hono } from "hono";
 * import { useSession } from "@tknf/hono-utils/session";
 *
 * const app = new Hono();
 *
 * // In-memory session storage (for demonstration purposes only)
 * const sessionStore = new Map<string, any>();
 *
 * function createInMemorySessionStorage() {
 *   return {
 *     read: async (sid: string) => {
 *       return sessionStore.get(sid) || null;
 *     },
 *     upsert: async (sid: string, data: any) => {
 *       sessionStore.set(sid, data);
 *     },
 *     delete: async (sid: string) => {
 *       sessionStore.delete(sid);
 *     },
 *   };
 * }
 *
 * app.use(
 *   useSession({
 *     storage: () => createInMemorySessionStorage(),
 *   })
 * );
 *
 * app.get("/", (c) => {
 *   const session = c.get("session");
 *   let count = session.get("count") || 0;
 *   count++;
 *   session.set("count", count);
 *   return c.text(`You have visited ${count} times.`);
 * });
 *
 * export default app;
 * ```
 */
export function useSession<Data = SessionData, FlashData = Data>({
	initialData = {},
	cookie: { name = "__sessionid", secret: _secret, ...cookie } = {},
	storage: createStorage,
}: SessionMiddlewareOptions<Data, FlashData>) {
	return createMiddleware<{
		Variables: SessionVariables<Data, FlashData>;
		Bindings: {
			SESSION_SECRET?: string;
		};
	}>(async (c, next) => {
		/**
		 * Retrieve or generate session ID from/to signed cookie
		 */
		const secret = _secret || c.env.SESSION_SECRET;
		if (!secret) {
			throw new Error("SESSION_SECRET is not set");
		}
		let sid = await getSignedCookie(c, secret, name);
		if (!sid) {
			sid = crypto.randomUUID();
		}

		/**
		 * Initialize session store
		 */
		let storage = c.get("storage") as SessionStorage<Data, FlashData> | null;
		if (!storage) {
			storage = createStorage(c);
			c.set("storage", storage);
		}
		const fetchedData = await storage.read(sid);
		const data = {
			...initialData,
			...fetchedData,
		};
		const store = new Map(Object.entries(data)) as Map<
			keyof Data | FlashDataKey<keyof FlashData & string>,
			// biome-ignore lint/suspicious/noExplicitAny: Session map must handle arbitrary runtime values supplied by user code
			any
		>;
		if (!storage) {
			throw new Error("Session storage is not set");
		}

		/**
		 * Create session object
		 */
		const session: Session<Data, FlashData> = {
			id: () => sid,
			data: () => {
				return Object.fromEntries(store) as FlashSessionData<Data, FlashData>;
			},
			has: (key) => {
				return store.has(key as keyof Data) || store.has(flash(key as keyof FlashData & string));
			},
			get: (key) => {
				if (store.has(key as keyof Data)) {
					return store.get(key as keyof Data);
				}

				const flashKey = flash(key as keyof FlashData & string);
				if (store.has(flashKey)) {
					const value = store.get(flashKey);
					store.delete(flashKey);
					return value;
				}
				return undefined;
			},
			set: (key, value) => {
				store.set(key, value);
			},
			flash: (key, value) => {
				store.set(flash(key), value);
			},
			unset: (key) => {
				store.delete(key);
			},
		};
		c.set("session", session);

		await next();

		/**
		 * Update session and set response headers
		 */
		const newData = Object.fromEntries(store) as FlashSessionData<Data, FlashData>;
		if (JSON.stringify(data) !== JSON.stringify(newData)) {
			const expires =
				cookie.maxAge != null
					? new Date(Date.now() + cookie.maxAge * 1000)
					: cookie.expires != null
						? cookie.expires
						: new Date();

			/**
			 * Persist session data
			 * If the execution environment supports waitUntil, use it to ensure the operation
			 * completes even after the response is sent
			 */
			if (getRuntimeKey() === "workerd") {
				c.executionCtx.waitUntil(storage.upsert(sid, newData, expires));
			} else {
				await storage.upsert(sid, newData, expires);
			}
		}

		/**
		 * Set signed cookie with session ID
		 */
		await setSignedCookie(c, name, sid, secret, {
			...cookie,
			httpOnly: true,
		});
	});
}

declare module "hono" {
	interface ContextVariableMap extends SessionVariables {}
}
