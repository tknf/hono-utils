import type { StandardSchemaV1 } from "@standard-schema/spec";
import type { ValidationTargets } from "hono";

/**
 * Converts a flat object with nested keys (e.g., 'key.subkey', 'key[0].title') into a deep nested JavaScript object.
 *
 * This function is robust:
 * 1. It strictly validates array indices (must be non-negative integers).
 * 2. It throws an error if a key attempts to redefine an existing structure (e.g., mixing array and object access).
 * 3. It compacts sparse arrays by removing undefined/empty slots at the end.
 *
 * @param flatObject A flat object where keys contain nesting notations (dot or bracket).
 * @returns The resulting nested JavaScript object.
 * @throws {Error} Throws an error if a key conflict is detected.
 */
export const flattenToNestedObject = (flatObject: Record<string, any>): Record<string, any> => {
	const data: Record<string, any> = {};

	for (const [key, value] of Object.entries(flatObject)) {
		// 1. Key Normalization and Splitting
		// Example: 'key[0].title' is converted to ['key', '0', 'title'].
		const keys = key
			.replace(/\[(\d+)\]/g, ".$1") // Normalize array indices: [0] -> .0
			.replace(/\[([^\]]+)\]/g, ".$1") // Normalize object brackets: [subkey] -> .subkey
			.split(".") // Split by dots
			.filter((k) => k.length > 0); // Remove any empty strings

		let current: Record<string, any> = data;

		// 2. Traverse Keys and Build Structure
		for (let i = 0; i < keys.length; i++) {
			const k = keys[i];
			const isLast = i === keys.length - 1;
			const kAsNumber = Number(k);

			// Strict index check: must be a non-negative integer.
			const isStrictIndex = Number.isInteger(kAsNumber) && kAsNumber >= 0;

			// Determine the expected type for the current key's value based on the NEXT key's format.
			const nextKey = keys[i + 1];
			const nextIsStrictIndex =
				nextKey && Number.isInteger(Number(nextKey)) && Number(nextKey) >= 0;
			const expectedType = nextIsStrictIndex ? "array" : "object";

			// 3. Structure Conflict Check
			if (k in current) {
				const existingType = Array.isArray(current[k]) ? "array" : "object";

				// If it's not the last key and the existing type conflicts with the expected type, throw.
				if (i < keys.length - 1 && existingType !== expectedType) {
					throw new Error(
						`Key conflict: '${k}' is already defined as an ${existingType}, but next key '${nextKey}' expects an ${expectedType}. Full key: ${key}`
					);
				}
			}

			if (isLast) {
				// Final Key: Assign the value.
				if (isStrictIndex && Array.isArray(current)) {
					// If the current container is an array, assign by numeric index.
					current[kAsNumber] = value;
				} else {
					// Otherwise, assign as an object property.
					current[k] = value;
				}
			} else {
				// Intermediate Key: Create nested object or array.
				if (!(k in current)) {
					// Initialize the key based on the expected type of the next segment.
					current[k] = expectedType === "array" ? [] : {};
				}

				// Advance to the next level.
				if (isStrictIndex && Array.isArray(current)) {
					// Traverse an array using a numeric index.
					if (!current[kAsNumber]) {
						// Initialize the array element if it doesn't exist.
						current[kAsNumber] = nextIsStrictIndex ? [] : {};
					}
					current = current[kAsNumber];
				} else {
					// Traverse an object using a string key.
					current = current[k];
				}
			}
		}
	}

	// 4. Array Compaction (Removes undefined/empty slots from sparse arrays)
	// Recursively processes the result to create dense arrays where indices were skipped.
	const compactArrays = (obj: any): any => {
		if (Array.isArray(obj)) {
			// Compact: Filter out undefined values and map over remaining elements.
			return obj.map(compactArrays).filter((val) => val !== undefined);
		}
		if (typeof obj === "object" && obj !== null) {
			// Recurse into nested objects.
			for (const prop in obj) {
				if (Object.hasOwn(obj, prop)) {
					obj[prop] = compactArrays(obj[prop]);
				}
			}
		}
		return obj;
	};

	// Apply compaction to the final result.
	return compactArrays(data);
};

// ==================================================

/**
 * Sanitize issues
 * reference: https://github.com/honojs/middleware/blob/main/packages/standard-validator/src/sanitize-issues.ts
 */

const RESTRICTED_DATA_FIELDS = {
	header: ["cookie"],
};

/**
 * Sanitizes validation issues by removing sensitive data fields from error messages.
 *
 * This function removes potentially sensitive information (like cookies) from validation
 * error messages before they are returned to the client. It handles different validation
 * library formats based on the vendor string.
 *
 * @param issues - Array of validation issues from Standard Schema validation
 * @param vendor - The validation library vendor identifier (e.g., 'arktype', 'valibot')
 * @param target - The validation target being processed ('header', 'json', etc.)
 * @returns Sanitized array of validation issues with sensitive data removed
 *
 * @example
 * ```ts
 * const issues = [{ message: 'Invalid header', data: { cookie: 'secret' } }]
 * const sanitized = sanitizeIssues(issues, 'arktype', 'header')
 * // Returns issues with cookie field removed from data
 * ```
 */
export function sanitizeIssues(
	issues: readonly StandardSchemaV1.Issue[],
	vendor: string,
	target: keyof ValidationTargets
): readonly StandardSchemaV1.Issue[] {
	if (!(target in RESTRICTED_DATA_FIELDS)) {
		return issues;
	}

	const restrictedFields =
		RESTRICTED_DATA_FIELDS[target as keyof typeof RESTRICTED_DATA_FIELDS] || [];

	if (vendor === "arktype") {
		return sanitizeArktypeIssues(issues, restrictedFields);
	}

	if (vendor === "valibot") {
		return sanitizeValibotIssues(issues, restrictedFields);
	}

	return issues;
}

function sanitizeArktypeIssues(
	issues: readonly StandardSchemaV1.Issue[],
	restrictedFields: string[]
): readonly StandardSchemaV1.Issue[] {
	return issues.map((issue) => {
		if (
			issue &&
			typeof issue === "object" &&
			"data" in issue &&
			typeof issue.data === "object" &&
			issue.data !== null &&
			!Array.isArray(issue.data)
		) {
			const dataCopy = { ...(issue.data as Record<string, unknown>) };
			for (const field of restrictedFields) {
				delete dataCopy[field];
			}
			// Preserve prototype chain to maintain toJSON method
			const sanitizedIssue = Object.create(Object.getPrototypeOf(issue));
			Object.assign(sanitizedIssue, issue, { data: dataCopy });
			return sanitizedIssue;
		}
		return issue;
	}) as readonly StandardSchemaV1.Issue[];
}

function sanitizeValibotIssues(
	issues: readonly StandardSchemaV1.Issue[],
	restrictedFields: string[]
): readonly StandardSchemaV1.Issue[] {
	return issues.map((issue) => {
		if (issue && typeof issue === "object" && "path" in issue && Array.isArray(issue.path)) {
			for (const path of issue.path) {
				if (
					typeof path === "object" &&
					"input" in path &&
					typeof path.input === "object" &&
					path.input !== null &&
					!Array.isArray(path.input)
				) {
					for (const field of restrictedFields) {
						delete path.input[field];
					}
				}
			}
		}
		return issue;
	}) as readonly StandardSchemaV1.Issue[];
}
