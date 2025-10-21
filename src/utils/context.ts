import type { Context } from "hono";
import { getRuntimeKey } from "hono/adapter";

export const waitUntil = async (c: Context, promise: Promise<unknown>) => {
	if (getRuntimeKey() === "workerd") {
		c.executionCtx.waitUntil(promise);
	} else {
		await promise;
	}
};
