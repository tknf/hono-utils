// @ts-check

import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { html } from "hono/html";
import { useCsrf } from "../dist/csrf/index.js";
import { useSession } from "../dist/session/index.js";

/**
 * @type { import("hono").Hono<import("../dist/session").SessionEnv, any> }
 */
const app = new Hono();

const map = new Map();

app
	.use(
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
	)
	.use(
		useCsrf({
			cookie: {
				secret: "secret",
			},
		})
	);

/**
 * CSRF
 */
app
	.get("/form", async (c) => {
		// @ts-expect-error
		const token = await c.get("csrfToken");
		return c.html(html`
		<meta charset="UTF-8" />
		<meta name="X-CSRFToken" content="${token}" />
		<form method="POST" action="/submit">
		<input type="hidden" name="_csrf" value="${token}" />
		<button type="submit">Submit</button>
	</form>`);
	})
	.post("/submit", async (c) => {
		return c.text("Form submitted successfully!");
	});

/**
 * Session
 */
app.get("/session", async (c) => {
	const session = await c.get("session");
	let count = session.get("count") || 0;
	count++;
	session.set("count", count);
	return c.text(`Count: ${count}`);
});

serve(app, (info) => {
	console.log(`Example Hono server running at ${info.address}`);
});
