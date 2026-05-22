import type * as Protocol from '../lib/front_end/generated/protocol.js';

export interface FormatStackTraceOptions {
	/** Maximum number of call frames to include before truncating. */
	maxFrames?: number;
	/** Whether to print "--- async ---" between async fragments. Defaults to true. */
	includeAsyncFragments?: boolean;
	/** Only show the topmost (synchronous) fragment, ignoring async parents. Defaults to false. */
	syncOnly?: boolean;
}

/** Formats a Protocol.Runtime.StackTrace into a V8-style string (e.g. "    at fn (url:line:col)"). */
export function formatStackTrace(stack: Protocol.Runtime.StackTrace, options: FormatStackTraceOptions = {}): string {
	const { maxFrames = Infinity, includeAsyncFragments = true, syncOnly = false } = options;
	const lines: string[] = [];
	if (stack.description) {
		lines.push(stack.description);
	}
	let current: Protocol.Runtime.StackTrace | undefined = stack;
	let frameCount = 0;

	while (current && frameCount < maxFrames) {
		for (const frame of current.callFrames) {
			if (frameCount >= maxFrames) break;
			lines.push(
				`    at ${frame.functionName || '(anonymous)'} (${frame.url}:${frame.lineNumber + 1}:${frame.columnNumber + 1})`,
			);
			frameCount += 1;
		}

		if (syncOnly || !current.parent) {
			break;
		}

		if (includeAsyncFragments && frameCount > 0) {
			lines.push('    --- async ---');
		}
		current = current.parent;
	}

	const totalFrames = syncOnly ? stack.callFrames.length : countStackFrames(stack);
	if (totalFrames > maxFrames) {
		lines.push(`    ... ${totalFrames - maxFrames} more frames`);
	}

	return lines.join('\n');
}

function countStackFrames(stack: Protocol.Runtime.StackTrace): number {
	let count = 0;
	let current: Protocol.Runtime.StackTrace | undefined = stack;
	while (current) {
		count += current.callFrames.length;
		current = current.parent ?? undefined;
	}
	return count;
}
