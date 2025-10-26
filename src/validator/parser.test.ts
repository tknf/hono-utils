import type { ValidationTargets } from "hono";
import { describe, expect, test } from "vitest";

import { flattenToNestedObject, sanitizeIssues } from "./parser";

type Issue = Parameters<typeof sanitizeIssues>[0][number];

describe("flattenToNestedObject", () => {
	test("converts dot and bracket notation keys into nested objects", () => {
		const result = flattenToNestedObject({
			"user.name": "Alice",
			"user.details.email": "alice@example.com",
			"user[preferences].language": "ja",
		});

		expect(result).toEqual({
			user: {
				name: "Alice",
				details: { email: "alice@example.com" },
				preferences: { language: "ja" },
			},
		});
	});

	test("builds arrays when numeric indices are provided", () => {
		const result = flattenToNestedObject({
			"users[0].name": "John",
			"users[0].roles[0]": "admin",
			"users[0].roles[2]": "editor",
			"users[1].name": "Jane",
			"users[1].roles[1]": "viewer",
		});

		expect(result).toEqual({
			users: [
				{ name: "John", roles: ["admin", "editor"] },
				{ name: "Jane", roles: ["viewer"] },
			],
		});
	});

	test("assigns values directly to array indices and compacts sparse arrays", () => {
		const result = flattenToNestedObject({
			"values[0]": "first",
			"values[2]": "third",
			"matrix[2][1]": "m-2-1",
			"matrix[2][3]": "m-2-3",
		});

		expect(result).toEqual({
			values: ["first", "third"],
			matrix: [["m-2-1", "m-2-3"]],
		});
	});

	test("keeps explicit nullish values when compacting arrays", () => {
		const result = flattenToNestedObject({
			"list[1]": null,
			"list[3]": false,
		});

		expect(result).toEqual({
			list: [null, false],
		});
	});

	test("supports bracket notation for object keys", () => {
		const result = flattenToNestedObject({
			"config[theme][primary]": "#fff",
			"config[theme][secondary]": "#000",
			"config[labels][submit]": "Send",
		});

		expect(result).toEqual({
			config: {
				theme: {
					primary: "#fff",
					secondary: "#000",
				},
				labels: {
					submit: "Send",
				},
			},
		});
	});

	test("throws when conflicting array/object structures are defined", () => {
		expect(() =>
			flattenToNestedObject({
				"user.name": "Alice",
				"user[0]": "first",
			})
		).toThrowError(/Key conflict/);

		expect(() =>
			flattenToNestedObject({
				"user[0]": "first",
				"user.name": "Alice",
			})
		).toThrowError(/Key conflict/);

		expect(() =>
			flattenToNestedObject({
				"list.label": "items",
				"list[0].name": "first",
			})
		).toThrowError(/Key conflict/);

		expect(() =>
			flattenToNestedObject({
				"list[0].name": "first",
				"list.label": "items",
			})
		).toThrowError(/Key conflict/);
	});
});

describe("sanitizeIssues", () => {
	const headerTarget = "header" as keyof ValidationTargets;
	const jsonTarget = "json" as keyof ValidationTargets;

	test("removes restricted fields from arktype issues while preserving prototype", () => {
		class CustomIssue {
			constructor(public data: Record<string, unknown>, public message: string) {}
		}

		const issue = new CustomIssue(
			{ cookie: "secret", authorization: "token" },
			"Invalid header"
		) as unknown as Issue;

		const sanitized = sanitizeIssues([issue], "arktype", headerTarget);
		const sanitizedIssue = sanitized[0] as typeof issue;

		expect(sanitizedIssue).not.toBe(issue);
		expect(Object.getPrototypeOf(sanitizedIssue)).toBe(CustomIssue.prototype);
		expect((sanitizedIssue as any).data).toEqual({ authorization: "token" });
		expect((issue as any).data).toEqual({ cookie: "secret", authorization: "token" });
	});

	test("strips restricted fields from valibot issue inputs in place", () => {
		const pathEntry = {
			input: { cookie: "secret", authorization: "token" },
		};
		const issue = {
			message: "Invalid header",
			path: [pathEntry],
		} as unknown as Issue;

		const sanitized = sanitizeIssues([issue], "valibot", headerTarget);

		expect(sanitized[0]).toBe(issue);
		expect(pathEntry.input).toEqual({ authorization: "token" });
	});

	test("returns original issues for unrestricted targets or unknown vendors", () => {
		const issues = [{ message: "Invalid" } as unknown as Issue] as readonly Issue[];

		const untouchedForTarget = sanitizeIssues(issues, "arktype", jsonTarget);
		const untouchedForVendor = sanitizeIssues(issues, "other", headerTarget);

		expect(untouchedForTarget).toBe(issues);
		expect(untouchedForVendor).toBe(issues);
	});
});
