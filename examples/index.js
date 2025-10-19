// @ts-check

import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { useSession } from "../dist/session/index.js";

const app = new Hono();

const map = new Map();

app.use(
	useSession({
		cookie: {
			secret: "secret",
		},
		storage: (_c) => {
			return {
				read: async (sid) => {
					const data = map.get(sid);
					return data || null;
				},
				upsert: async (sid, data) => {
					map.set(sid, data);
				},
				delete: async (sid) => {
					map.delete(sid);
				},
			};
		},
	})
);

app.get("/", async (c) => {
	const session = await c.get("session");
	let count = session.get("count") || 0;
	count++;
	session.set("count", count);
	return c.text(`Count: ${count}`);
});

serve(app, (info) => {
	console.log(`Example Hono server running at ${info.address}`);
});
