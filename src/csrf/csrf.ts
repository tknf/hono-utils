import type { MiddlewareHandler } from "hono";
import { getSignedCookie, setSignedCookie } from "hono/cookie";
import { createMiddleware } from "hono/factory";
import { HTTPException } from "hono/http-exception";
import type { CookieOptions } from "hono/utils/cookie";

export interface CsrfOptions {
	fieldName?: string;
	headerName?: string;
	cookie?: CookieOptions & {
		name?: string;
		secret?: string;
	};
}

export interface CsrfVariables {
	csrfToken: string;
}

export interface CsrfEnv {
	Variables: CsrfVariables;
}

export function useCsrf({
	fieldName = "_csrf",
	headerName = "X-CSRFToken",
	cookie: { name = "__csrftoken", secret: _secret, ...cookie } = {},
}: CsrfOptions): MiddlewareHandler {
	return createMiddleware(async (c, next) => {
		const secret = _secret || c.env.CSRF_SECRET;
		if (!secret) {
			throw new Error("CSRF_SECRET is not set");
		}

		const method = c.req.method.toLowerCase();

		if (method === "get" || method === "head" || method === "options") {
			/**
			 * Generate CSRF token and set it in a cookie
			 * 64-character random token (alphabetic + numeric), no-symbols
			 */
			const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
			const token = Array.from(crypto.getRandomValues(new Uint8Array(64)))
				.map((b) => chars.charAt(b % chars.length))
				.join("");
			if (!secret) {
				throw new Error("CSRF_SECRET is not set");
			}
			await setSignedCookie(c, name, token, secret, cookie);
			c.set("csrfToken", token);
		} else {
			/**
			 * Validate CSRF token from request
			 */
			const tokenFromCookie = await getSignedCookie(c, secret, name);
			// biome-ignore lint/suspicious/noExplicitAny: Any is needed to parse arbitrary body content
			const body = (await c.req.parseBody().catch(() => ({}))) as Record<string, any>;
			const tokenFromField = body[fieldName];
			const tokenFromHeader = c.req.header(headerName);

			if (
				!tokenFromCookie ||
				(tokenFromField !== tokenFromCookie && tokenFromHeader !== tokenFromCookie)
			) {
				throw new HTTPException(403, { message: "CSRF token validation failed" });
			}
		}

		/**
		 * CSRF token validated successfully
		 */
		await next();
	});
}
