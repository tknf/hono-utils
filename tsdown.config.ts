import { defineConfig } from "tsdown";

export default defineConfig([
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
]);
