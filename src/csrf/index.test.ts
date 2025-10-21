import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { beforeEach, describe, expect, test, vi } from "vitest";

const getSignedCookieMock = vi.fn();
const setSignedCookieMock = vi.fn();

vi.mock("hono/factory", () => ({
	createMiddleware: <T>(handler: T) => handler,
}));

vi.mock("hono/cookie", () => ({
	getSignedCookie: (...args: unknown[]) => getSignedCookieMock(...args),
	setSignedCookie: (...args: unknown[]) => setSignedCookieMock(...args),
}));

import { useCsrf } from "./csrf";
import * as csrfIndex from "./index";

type MockContext = Context & {
	_variables: Map<string, unknown>;
};

interface CreateMockContextOptions {
	method?: string;
	envSecret?: string;
	headerValue?: string | null;
	body?: Record<string, unknown>;
	bodyThrows?: Error;
}

function createMockContext({
	method = "GET",
	envSecret,
	headerValue = null,
	body = {},
	bodyThrows,
}: CreateMockContextOptions = {}) {
	const variables = new Map<string, unknown>();

	const header = vi.fn(() => headerValue ?? undefined);
	const parseBody = bodyThrows
		? vi.fn(async () => {
				throw bodyThrows;
			})
		: vi.fn(async () => body);

	const context: MockContext = {
		env: envSecret ? { CSRF_SECRET: envSecret } : {},
		req: {
			method,
			header,
			parseBody,
		},
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
		variables,
		header,
		parseBody,
	};
}

beforeEach(() => {
	vi.clearAllMocks();
	getSignedCookieMock.mockResolvedValue(undefined);
	setSignedCookieMock.mockResolvedValue(undefined);
});

describe("csrf index exports", () => {
	test("re-exports useCsrf", () => {
		expect(csrfIndex.useCsrf).toBe(useCsrf);
	});
});

describe("useCsrf middleware", () => {
	test("throws when CSRF_SECRET is not provided", async () => {
		const { context } = createMockContext({ method: "GET" });
		const middleware = useCsrf({});

		await expect(middleware(context, vi.fn())).rejects.toThrow("CSRF_SECRET is not set");
		expect(setSignedCookieMock).not.toHaveBeenCalled();
	});

	test("generates token and sets signed cookie for safe methods", async () => {
		const getRandomValuesSpy = vi
			.spyOn(globalThis.crypto, "getRandomValues")
			.mockImplementation(<T extends ArrayBufferView>(array: T) => {
				const view = new Uint8Array(array.buffer, array.byteOffset, array.byteLength);
				view.fill(0);
				return array;
			});

		try {
			const { context, variables, parseBody } = createMockContext({ method: "GET" });
			const middleware = useCsrf({
				cookie: {
					name: "csrftest",
					secret: "cookie-secret",
					httpOnly: false,
				},
			});
			const next = vi.fn();

			await middleware(context, next);

			const token = "A".repeat(64);
			expect(setSignedCookieMock).toHaveBeenCalledWith(
				context,
				"csrftest",
				token,
				"cookie-secret",
				expect.objectContaining({
					httpOnly: false,
				})
			);
			expect(variables.get("csrfToken")).toBe(token);
			expect(next).toHaveBeenCalledTimes(1);
			expect(parseBody).not.toHaveBeenCalled();
			expect(getSignedCookieMock).not.toHaveBeenCalled();
		} finally {
			getRandomValuesSpy.mockRestore();
		}
	});

	test("accepts token from parsed body for unsafe methods", async () => {
		getSignedCookieMock.mockResolvedValue("token-from-cookie");
		const { context, parseBody } = createMockContext({
			method: "POST",
			envSecret: "env-secret",
			body: { _csrf: "token-from-cookie" },
		});
		const middleware = useCsrf({});
		const next = vi.fn();

		await middleware(context, next);

		expect(getSignedCookieMock).toHaveBeenCalledWith(context, "env-secret", "__csrftoken");
		expect(parseBody).toHaveBeenCalledTimes(1);
		expect(next).toHaveBeenCalledTimes(1);
		expect(setSignedCookieMock).not.toHaveBeenCalled();
	});

	test("accepts token from header when body token is absent", async () => {
		getSignedCookieMock.mockResolvedValue("header-token");
		const { context, header } = createMockContext({
			method: "PUT",
			envSecret: "env-secret",
			headerValue: "header-token",
			body: {},
		});
		const middleware = useCsrf({
			headerName: "X-CSRFToken",
		});
		const next = vi.fn();

		await middleware(context, next);

		expect(header).toHaveBeenCalledWith("X-CSRFToken");
		expect(next).toHaveBeenCalledTimes(1);
		expect(setSignedCookieMock).not.toHaveBeenCalled();
	});

	test("throws HTTPException when tokens do not match", async () => {
		getSignedCookieMock.mockResolvedValue("expected-token");
		const { context, parseBody, header } = createMockContext({
			method: "PATCH",
			envSecret: "env-secret",
			headerValue: "wrong-token",
			body: { _csrf: "another-wrong-token" },
		});
		const middleware = useCsrf({});

		let thrown: unknown;
		const next = vi.fn();
		await expect(
			middleware(context, next).catch((error) => {
				thrown = error;
				throw error;
			})
		).rejects.toBeInstanceOf(HTTPException);

		const httpError = thrown as HTTPException;
		expect(httpError.status).toBe(403);
		expect(httpError.message).toBe("CSRF token validation failed");
		expect(next).not.toHaveBeenCalled();
		expect(parseBody).toHaveBeenCalledTimes(1);
		expect(header).toHaveBeenCalledTimes(1);
	});

	test("treats parse body failures as empty object during validation", async () => {
		getSignedCookieMock.mockResolvedValue("header-token");
		const parseError = new Error("parse failure");
		const { context, parseBody } = createMockContext({
			method: "POST",
			envSecret: "env-secret",
			headerValue: "header-token",
			bodyThrows: parseError,
		});
		const middleware = useCsrf({});
		const next = vi.fn();

		await middleware(context, next);

		expect(parseBody).toHaveBeenCalledTimes(1);
		expect(next).toHaveBeenCalledTimes(1);
	});
});
