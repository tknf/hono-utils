// @ts-check

import { serve } from "@hono/node-server";
import * as a from "arktype";
import { Hono } from "hono";
import { html } from "hono/html";
import * as v from "valibot";
import * as z from "zod";
import { useCsrf } from "../dist/csrf/index.js";
import { type SessionEnv, useSession } from "../dist/session/index.js";
import { useValidator } from "../dist/validator/index.js";

/**
 * @type { import("hono").Hono<import("../dist/session").SessionEnv, any> }
 */
const app = new Hono<SessionEnv>();

/**
 * CSRF
 */
app
	.use(
		"/csrf",
		useCsrf({
			cookie: {
				secret: "secret",
			},
		})
	)
	.get("/csrf", async (c) => {
		// @ts-expect-error
		const token = await c.get("csrfToken");
		return c.html(html`
		<meta charset="UTF-8" />
		<meta name="X-CSRFToken" content="${token}" />
		<form method="POST" action="/csrf/submit">
		<input type="hidden" name="_csrf" value="${token}" />
		<button type="submit">Submit</button>
	</form>`);
	})
	.post("/csrf/submit", async (c) => {
		return c.text("Form submitted successfully!");
	});

/**
 * Session
 */
const map = new Map();
app
	.use(
		"/session",
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
	.get("/session", async (c) => {
		const session = await c.get("session");
		let count = session.get("count") || 0;
		count++;
		session.set("count", count);
		return c.text(`Count: ${count}`);
	});

/**
 * Validator
 */
app
	.get("/validator", async (c) => {
		return c.html(html`
		<meta charset="UTF-8" />
		<form method="POST" action="/validator/zod">
			<label>
				FirstName: <input type="text" name="name.first_name" />
			</label>
			<br />
			<label>
				LastName: <input type="text" name="name.last_name" />
			</label>
			<br />
			<fieldset>
				<legend>Cars:</legend>
				<label>
					Car 1 (name): <input type="text" name="cars[0].name" />
				</label>
				<br />
				<label>
					Car 1 (model): <input type="text" name="cars[0].model" />
				</label>
				<br />
				<label>
					Car 2 (name): <input type="text" name="cars[1].name" />
				</label>
				<br />
				<label>
					Car 2 (model): <input type="text" name="cars[1].model" />
				</label>
			</fieldset>
			<br />
			<button type="submit">Submit</button>
		</form>
	`);
	})
	.post(
		"/validator/zod",
		useValidator(
			"form",
			z.object({
				name: z.object({
					first_name: z.number(),
					last_name: z.string(),
				}),
				cars: z.array(
					z.object({
						name: z.string(),
						model: z.string(),
					})
				),
			})
		),
		async (c) => {
			const data = c.req.valid("form");
			return c.json(data);
		}
	);

serve(app, (info) => {
	console.log(info);
	console.log(`Example Hono server running at ${info.address || "http://localhost"}:${info.port}`);
});
