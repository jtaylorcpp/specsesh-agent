// Lets plain Node run the TypeScript fixtures: their relative `.js` imports name `.ts` sources.
//   node --import ./ts-resolve.mjs crash-child.ts ...
import { registerHooks } from "node:module";

registerHooks({
	resolve(specifier, context, nextResolve) {
		try {
			return nextResolve(specifier, context);
		} catch (error) {
			if (error?.code !== "ERR_MODULE_NOT_FOUND" || !/^\.\.?\//.test(specifier) || !specifier.endsWith(".js")) throw error;
			return nextResolve(`${specifier.slice(0, -3)}.ts`, context);
		}
	},
});
