import type { StandardSchemaV1 } from "@standard-schema/spec";
import type {
	Context,
	Env,
	Input,
	MiddlewareHandler,
	TypedResponse,
	ValidationTargets,
} from "hono";
import { validator } from "hono/validator";
import { flattenToNestedObject, sanitizeIssues } from "./parser";

type HasUndefined<T> = undefined extends T ? true : false;
type TOrPromiseOfT<T> = T | Promise<T>;

type Hook<
	T,
	E extends Env,
	P extends string,
	Target extends keyof ValidationTargets = keyof ValidationTargets,
	O = {},
> = (
	result: (
		| { success: true; data: T }
		| { success: false; error: readonly StandardSchemaV1.Issue[]; data: T }
	) & {
		target: Target;
	},
	c: Context<E, P>
) => TOrPromiseOfT<Response | void | TypedResponse<O>>;

/**
 * Hono validator middleware
 * This is an extension of Hono's official validator. The official validator cannot correctly
 * validate form request bodies when they contain nested objects, but this middleware allows
 * correct validation of nested objects.
 *
 * https://github.com/honojs/middleware/blob/main/packages/standard-validator/src/index.ts
 */
export const useValidator = <
	Schema extends StandardSchemaV1,
	Target extends keyof ValidationTargets,
	E extends Env,
	P extends string,
	In = StandardSchemaV1.InferInput<Schema>,
	Out = StandardSchemaV1.InferOutput<Schema>,
	I extends Input = {
		in: HasUndefined<In> extends true
			? {
					[K in Target]?: In extends ValidationTargets[K]
						? In
						: { [K2 in keyof In]?: ValidationTargets[K][K2] };
				}
			: {
					[K in Target]: In extends ValidationTargets[K]
						? In
						: { [K2 in keyof In]: ValidationTargets[K][K2] };
				};
		out: { [K in Target]: Out };
	},
	V extends I = I,
>(
	target: Target,
	schema: Schema,
	hook?: Hook<StandardSchemaV1.InferOutput<Schema>, E, P, Target>
): MiddlewareHandler<E, P, V> => {
	// @ts-expect-error not typed well
	return validator(target, async (value, c) => {
		//
		const payload = flattenToNestedObject(value);
		const result = await schema["~standard"].validate(payload);

		if (hook) {
			const hookResult = await hook(
				result.issues
					? { data: payload, error: result.issues, success: false, target }
					: { data: payload, success: true, target },
				c
			);
			if (hookResult) {
				if (hookResult instanceof Response) {
					return hookResult;
				}

				if ("response" in hookResult) {
					return hookResult.response;
				}
			}
		}

		if (result.issues) {
			const processedIssues = sanitizeIssues(result.issues, schema["~standard"].vendor, target);
			return c.json({ data: payload, error: processedIssues, success: false }, 400);
		}

		return result.value as StandardSchemaV1.InferOutput<Schema>;
	});
};
