import { defineConfig } from "tsdown";

export default defineConfig([
	// CSRF (ESM/CJS)
	{
		entry: ["src/csrf/index.ts"],
		outDir: "dist/csrf",
		format: ["esm", "cjs"],
		dts: true,
		clean: true,
		target: "es2020",
		platform: "neutral",
	},
	// Session (ESM/CJS)
	{
		entry: ["src/session/index.ts"],
		outDir: "dist/session",
		format: ["esm", "cjs"],
		dts: true,
		clean: true,
		target: "es2020",
		platform: "neutral",
	},
	// Validator (ESM/CJS)
	{
		entry: ["src/validator/index.ts"],
		outDir: "dist/validator",
		format: ["esm", "cjs"],
		dts: true,
		clean: true,
		target: "es2020",
		platform: "neutral",
	},
]);
