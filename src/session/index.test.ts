import type { Context } from "hono";
import { beforeEach, describe, expect, test, vi } from "vitest";

const getSignedCookieMock = vi.fn();
const setSignedCookieMock = vi.fn();
let runtimeKey = "node";

vi.mock("hono/factory", () => ({
	createMiddleware: <T>(handler: T) => handler,
}));

vi.mock("hono/cookie", () => ({
	getSignedCookie: (...args: unknown[]) => getSignedCookieMock(...args),
	setSignedCookie: (...args: unknown[]) => setSignedCookieMock(...args),
}));

vi.mock("hono/adapter", () => ({
	getRuntimeKey: () => runtimeKey,
}));

import * as sessionIndex from "./index";
import { flash, type Session, type SessionStorage, useSession } from "./session";

type MockContext = Context & {
	_variables: Map<string, unknown>;
};

function createMockContext(
	env: Partial<{ SESSION_SECRET: string }> = {},
	initialVariables: Record<string, unknown> = {}
) {
	const variables = new Map<string, unknown>(Object.entries(initialVariables));
	const executionCtx = {
		waitUntil: vi.fn(),
	};

	const context: MockContext = {
		env,
		executionCtx,
		_variables: variables,
		get(key: string) {
			return variables.get(key);
		},
		set(key: string, value: unknown) {
			variables.set(key, value);
			return value;
		},
	} as unknown as MockContext;

	return {
		context,
		executionCtx,
		variables,
	};
}

function createStorageMock<TData, TFlash>(
	// biome-ignore lint/suspicious/noExplicitAny: Test helper mirrors unknown argument list from SessionStorage.read
	readValue: SessionStorage<TData, TFlash>["read"] extends (...args: any[]) => Promise<infer R>
		? R
		: never
) {
	return {
		read: vi.fn().mockResolvedValue(readValue),
		upsert: vi.fn().mockResolvedValue(undefined),
		delete: vi.fn().mockResolvedValue(undefined),
	} satisfies SessionStorage<TData, TFlash>;
}

beforeEach(() => {
	runtimeKey = "node";
	vi.clearAllMocks();
	getSignedCookieMock.mockResolvedValue(null);
	setSignedCookieMock.mockResolvedValue(undefined);
});

describe("flash", () => {
	test("wraps keys with flash prefix", () => {
		expect(flash("message")).toBe("__flash_message__");
	});
});

describe("session index exports", () => {
	test("re-exports useSession", () => {
		expect(sessionIndex.useSession).toBe(useSession);
	});
});

describe("useSession middleware", () => {
	test("throws when SESSION_SECRET is not provided", async () => {
		const { context } = createMockContext();
		const storageFactory = vi.fn(() =>
			createStorageMock<Record<string, unknown>, Record<string, unknown>>({})
		);
		const middleware = useSession({
			storage: storageFactory,
		});

		await expect(middleware(context, vi.fn())).rejects.toThrow("SESSION_SECRET is not set");
		expect(storageFactory).not.toHaveBeenCalled();
		expect(getSignedCookieMock).not.toHaveBeenCalled();
	});

	test("manages session lifecycle and persists updates with maxAge cookies", async () => {
		const now = new Date("2025-01-01T00:00:00.000Z").getTime();
		const dateSpy = vi.spyOn(Date, "now").mockReturnValue(now);
		getSignedCookieMock.mockResolvedValue("existing-sid");

		type Data = { user: string; visits: number };
		type FlashData = { notice: string };
		const readValue = {
			user: "carol",
			visits: 5,
			[flash("notice")]: "persisted-notice",
		} satisfies Record<string, unknown>;
		const storage = createStorageMock<Data, FlashData>(readValue);
		const storageFactory = vi.fn(() => storage);

		const { context } = createMockContext({}, {});
		const middleware = useSession<Data, FlashData>({
			initialData: {
				user: "alice",
				visits: 0,
			},
			cookie: {
				name: "custom-session",
				secret: "top-secret",
				maxAge: 10,
			},
			storage: storageFactory,
		});

		const next = vi.fn(async () => {
			const session = context.get("session") as Session<Data, FlashData>;
			expect(session).toBeDefined();
			expect(session.id()).toBe("existing-sid");

			expect(session.has("user")).toBe(true);
			expect(session.get("user")).toBe("carol");

			expect(session.has("notice")).toBe(true);
			expect(session.get("notice")).toBe("persisted-notice");
			expect(session.has("notice")).toBe(false);

			session.set("visits", 6);
			session.flash("notice", "hello-again");
			expect(session.get("notice")).toBe("hello-again");

			session.unset("user");
			session.set("user", "dave");
			// biome-ignore lint/suspicious/noExplicitAny: Verifying behavior across arbitrary data and flash value shapes
			expect((session as Session<any, any>).get("missing")).toBeUndefined();
		});

		await middleware(context, next);

		expect(storageFactory).toHaveBeenCalledWith(context);
		expect(context.get("storage")).toBe(storage);
		expect(storage.read).toHaveBeenCalledWith("existing-sid");

		expect(storage.upsert).toHaveBeenCalledTimes(1);
		const [sidArg, dataArg, expiresArg] = storage.upsert.mock.calls[0];
		expect(sidArg).toBe("existing-sid");
		expect(dataArg).toEqual({
			visits: 6,
			user: "dave",
		});
		expect(expiresArg).toBeInstanceOf(Date);
		expect((expiresArg as Date).toISOString()).toBe(new Date(now + 10 * 1000).toISOString());

		expect(setSignedCookieMock).toHaveBeenCalledTimes(1);
		expect(setSignedCookieMock).toHaveBeenCalledWith(
			context,
			"custom-session",
			"existing-sid",
			"top-secret",
			expect.objectContaining({
				maxAge: 10,
				httpOnly: true,
			})
		);

		expect(next).toHaveBeenCalledTimes(1);
		expect(context.get("session")).toBeDefined();

		dateSpy.mockRestore();
	});

	test("reuses existing storage instance from context", async () => {
		getSignedCookieMock.mockResolvedValue("existing");

		const existingStorage = createStorageMock<{ value: string }, { flash: string }>({
			value: "from-store",
		});
		const storageFactory = vi.fn(() => {
			throw new Error("storage factory should not be called when storage is cached");
		});

		const { context } = createMockContext(
			{},
			{
				storage: existingStorage,
			}
		);
		const middleware = useSession<{ value: string }, { flash: string }>({
			cookie: { secret: "abc" },
			storage: storageFactory,
		});

		const next = vi.fn(() => {
			const session = context.get("session") as Session<{ value: string }, { flash: string }>;
			expect(session.get("value")).toBe("from-store");
		});

		// biome-ignore lint/suspicious/noExplicitAny: Casting test double to satisfy Hono middleware signature expectations
		await middleware(context, next as any);

		expect(storageFactory).not.toHaveBeenCalled();
		expect(existingStorage.read).toHaveBeenCalledWith("existing");
		expect(existingStorage.upsert).not.toHaveBeenCalled();
	});

	test("creates a new session id when cookie is absent and uses waitUntil on workerd runtime", async () => {
		runtimeKey = "workerd";
		const expires = new Date("2025-02-02T12:00:00Z");
		const randomUUIDSpy = vi
			.spyOn(globalThis.crypto, "randomUUID")
			// biome-ignore lint/suspicious/noExplicitAny: Mock return must allow any string to emulate crypto.randomUUID
			.mockReturnValue("new-sid" as any);

		const storage = createStorageMock<{ flag: boolean }, { flash: string }>({
			flag: true,
		});

		const { context, executionCtx } = createMockContext(
			{ SESSION_SECRET: "env-secret" },
			{
				storage,
			}
		);

		const middleware = useSession<{ flag: boolean }, { flash: string }>({
			cookie: { expires },
			storage: () => storage,
		});

		const next = vi.fn(() => {
			const session = context.get("session") as Session<{ flag: boolean }, { flash: string }>;
			expect(session.id()).toBe("new-sid");
			session.set("flag", false);
		});

		// biome-ignore lint/suspicious/noExplicitAny: Casting test double to satisfy Hono middleware signature expectations
		await middleware(context, next as any);

		expect(randomUUIDSpy).toHaveBeenCalled();
		expect(storage.read).toHaveBeenCalledWith("new-sid");
		expect(storage.upsert).toHaveBeenCalledWith("new-sid", { flag: false }, expires);
		expect(executionCtx.waitUntil).toHaveBeenCalledTimes(1);
		expect(setSignedCookieMock).toHaveBeenCalledWith(
			context,
			"__sessionid",
			"new-sid",
			"env-secret",
			expect.objectContaining({
				expires,
				httpOnly: true,
			})
		);

		randomUUIDSpy.mockRestore();
	});

	test("persists updates with default cookie expiration when options are omitted", async () => {
		vi.useFakeTimers();
		const fixedDate = new Date("2025-03-03T00:00:00.000Z");
		vi.setSystemTime(fixedDate);
		getSignedCookieMock.mockResolvedValue("default-sid");

		const storage = createStorageMock<{ flag: boolean }, { flash: string }>({
			flag: true,
		});
		const storageFactory = vi.fn(() => storage);
		const { context } = createMockContext({ SESSION_SECRET: "secret" });

		const middleware = useSession<{ flag: boolean }, { flash: string }>({
			storage: storageFactory,
		});

		const next = vi.fn(() => {
			const session = context.get("session") as Session<{ flag: boolean }, { flash: string }>;
			session.set("flag", false);
		});

		// biome-ignore lint/suspicious/noExplicitAny: Casting test double to satisfy Hono middleware signature expectations
		await middleware(context, next as any);

		expect(storageFactory).toHaveBeenCalledWith(context);
		expect(storage.upsert).toHaveBeenCalledTimes(1);
		const [, , expiresArg] = storage.upsert.mock.calls[0];
		expect((expiresArg as Date).toISOString()).toBe(fixedDate.toISOString());
		expect(setSignedCookieMock).toHaveBeenCalledWith(
			context,
			"__sessionid",
			"default-sid",
			"secret",
			expect.objectContaining({
				httpOnly: true,
			})
		);

		vi.useRealTimers();
	});

	test("does not persist session when data is unchanged", async () => {
		getSignedCookieMock.mockResolvedValue("session-sid");

		const storage = createStorageMock<{ counter: number }, { flash: string }>({
			counter: 1,
		});
		const { context } = createMockContext(
			{ SESSION_SECRET: "secret" },
			{
				storage,
			}
		);

		const middleware = useSession<{ counter: number }, { flash: string }>({
			storage: () => storage,
		});

		const next = vi.fn(() => {
			const session = context.get("session") as Session<{ counter: number }, { flash: string }>;
			expect(session.get("counter")).toBe(1);
			expect(session.data()).toEqual({ counter: 1 });
		});

		// biome-ignore lint/suspicious/noExplicitAny: Casting test double to satisfy Hono middleware signature expectations
		await middleware(context, next as any);

		expect(storage.upsert).not.toHaveBeenCalled();
		expect(setSignedCookieMock).toHaveBeenCalledTimes(1);
	});

	test("throws when storage factory returns null", async () => {
		getSignedCookieMock.mockResolvedValue("sid");

		const { context } = createMockContext({ SESSION_SECRET: "secret" });
		const storageFactory = vi.fn(() => null as unknown as SessionStorage);

		const middleware = useSession({
			storage: storageFactory,
		});

		await expect(middleware(context, vi.fn())).rejects.toThrow(TypeError);
		expect(storageFactory).toHaveBeenCalledTimes(1);
	});
});
