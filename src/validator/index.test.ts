import type { StandardSchemaV1 } from "@standard-schema/spec";
import { beforeEach, describe, expect, test, vi } from "vitest";

const validatorFactoryMock = vi.fn(
	(_target: unknown, handler: (...args: any[]) => unknown) => handler
);

vi.mock("hono/validator", () => ({
	validator: (target: unknown, handler: (...args: any[]) => unknown) =>
		validatorFactoryMock(target, handler),
}));

import { useValidator } from "./validator";

describe("useValidator", () => {
	beforeEach(() => {
		validatorFactoryMock.mockClear();
	});

	const createSchema = (
		validate: (value: unknown) => Promise<{ value?: unknown; issues?: any[] }>,
		vendor = "arktype"
	) =>
		({
			"~standard": {
				vendor,
				validate,
			},
		}) as unknown as StandardSchemaV1;

	test("returns validated data with nested payloads", async () => {
		const validate = vi
			.fn()
			.mockResolvedValue({ value: { user: { name: "Alice", roles: ["admin"] } } });
		const schema = createSchema(validate);

		const handler = useValidator("json" as const, schema);
		expect(validatorFactoryMock).toHaveBeenCalledWith("json", expect.any(Function));

		const payload = {
			"user.name": "Alice",
			"user.roles[0]": "admin",
		};
		const context = {} as unknown;
		const result = await (handler as any)(payload, context);

		expect(validate).toHaveBeenCalledWith({
			user: {
				name: "Alice",
				roles: ["admin"],
			},
		});
		expect(result).toEqual({ user: { name: "Alice", roles: ["admin"] } });
	});

	test("sanitizes issues and returns JSON error response on validation failure", async () => {
		const issue = {
			message: "Invalid header",
			data: {
				cookie: "secret-cookie",
				authorization: "token",
			},
		};
		const validate = vi.fn().mockResolvedValue({ issues: [issue] });
		const schema = createSchema(validate, "arktype");

		const handler = useValidator("header" as const, schema);
		const jsonMock = vi.fn((body: unknown, status: number) => ({ body, status }));
		const context = { json: jsonMock };

		const payload = {
			cookie: "secret-cookie",
			authorization: "token",
		};
		const response = await (handler as any)(payload, context);

		expect(jsonMock).toHaveBeenCalledWith(
			{
				data: {
					cookie: "secret-cookie",
					authorization: "token",
				},
				error: [
					expect.objectContaining({
						message: "Invalid header",
						data: { authorization: "token" },
					}),
				],
				success: false,
			},
			400
		);
		expect(response).toEqual(jsonMock.mock.results[0].value);
		// Original issue is untouched
		expect(issue.data).toEqual({
			cookie: "secret-cookie",
			authorization: "token",
		});
	});

	test("invokes hook and short-circuits when hook returns a response", async () => {
		const validate = vi
			.fn()
			.mockResolvedValue({ value: { user: { name: "Bob" } }, issues: undefined });
		const schema = createSchema(validate);

		const hookResponse = new Response("blocked", { status: 418 });
		const hook = vi.fn().mockResolvedValue(hookResponse);

		const handler = useValidator("json" as const, schema, hook);
		const context = { env: {} };
		const payload = { "user.name": "Bob" };

		const result = await (handler as any)(payload, context);

		expect(hook).toHaveBeenCalledWith(
			{
				data: {
					user: {
						name: "Bob",
					},
				},
				success: true,
				target: "json",
			},
			context
		);
		expect(result).toBe(hookResponse);
		expect(validate).toHaveBeenCalledTimes(1);
	});

	test("hook can override failed validation with typed response", async () => {
		const issues = [{ message: "invalid" }];
		const validate = vi.fn().mockResolvedValue({ issues });
		const schema = createSchema(validate);
		const hookResponse = new Response("custom-error", { status: 422 });
		const hook = vi.fn().mockResolvedValue({ response: hookResponse });

		const handler = useValidator("json" as const, schema, hook);
		const jsonMock = vi.fn();
		const context = { json: jsonMock };

		const result = await (handler as any)({ value: "bad" }, context);

		expect(hook).toHaveBeenCalledWith(
			{
				data: { value: "bad" },
				error: issues,
				success: false,
				target: "json",
			},
			context
		);
		expect(result).toBe(hookResponse);
		expect(jsonMock).not.toHaveBeenCalled();
	});
});
