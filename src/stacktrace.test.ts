import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { formatStackTrace } from './stacktrace.js';
import type * as Protocol from '../lib/front_end/generated/protocol.js';

function makeFrame(
	functionName: string,
	url: string,
	lineNumber: number,
	columnNumber: number,
	scriptId = '' as Protocol.Runtime.ScriptId,
): Protocol.Runtime.CallFrame {
	return { functionName, url, lineNumber, columnNumber, scriptId };
}

describe('formatStackTrace', () => {
	it('prepends description when present', () => {
		const stack: Protocol.Runtime.StackTrace = {
			description: 'Error: something went wrong',
			callFrames: [makeFrame('foo', 'app.js', 9, 4)],
		};
		assert.equal(
			formatStackTrace(stack),
			'Error: something went wrong\n    at foo (app.js:10:5)',
		);
	});

	it('formats a single frame with 1-based line and column', () => {
		const stack: Protocol.Runtime.StackTrace = {
			callFrames: [makeFrame('foo', 'app.js', 9, 4)],
		};
		assert.equal(formatStackTrace(stack), '    at foo (app.js:10:5)');
	});

	it('uses (anonymous) for frames with empty functionName', () => {
		const stack: Protocol.Runtime.StackTrace = {
			callFrames: [makeFrame('', 'app.js', 0, 0)],
		};
		assert.equal(formatStackTrace(stack), '    at (anonymous) (app.js:1:1)');
	});

	it('formats multiple frames joined by newlines', () => {
		const stack: Protocol.Runtime.StackTrace = {
			callFrames: [
				makeFrame('a', 'a.js', 0, 0),
				makeFrame('b', 'b.js', 1, 2),
			],
		};
		assert.equal(
			formatStackTrace(stack),
			'    at a (a.js:1:1)\n    at b (b.js:2:3)',
		);
	});

	it('inserts async separator between parent fragments', () => {
		const stack: Protocol.Runtime.StackTrace = {
			callFrames: [makeFrame('child', 'c.js', 0, 0)],
			parent: {
				callFrames: [makeFrame('parent', 'p.js', 5, 0)],
			},
		};
		assert.equal(
			formatStackTrace(stack),
			'    at child (c.js:1:1)\n    --- async ---\n    at parent (p.js:6:1)',
		);
	});

	it('stops at first fragment when syncOnly is true', () => {
		const stack: Protocol.Runtime.StackTrace = {
			callFrames: [makeFrame('child', 'c.js', 0, 0)],
			parent: {
				callFrames: [makeFrame('parent', 'p.js', 5, 0)],
			},
		};
		assert.equal(
			formatStackTrace(stack, { syncOnly: true }),
			'    at child (c.js:1:1)',
		);
	});

	it('omits async separator when includeAsyncFragments is false', () => {
		const stack: Protocol.Runtime.StackTrace = {
			callFrames: [makeFrame('child', 'c.js', 0, 0)],
			parent: {
				callFrames: [makeFrame('parent', 'p.js', 5, 0)],
			},
		};
		assert.equal(
			formatStackTrace(stack, { includeAsyncFragments: false }),
			'    at child (c.js:1:1)\n    at parent (p.js:6:1)',
		);
	});

	it('truncates at maxFrames and shows remaining count', () => {
		const stack: Protocol.Runtime.StackTrace = {
			callFrames: [
				makeFrame('a', 'a.js', 0, 0),
				makeFrame('b', 'b.js', 1, 0),
				makeFrame('c', 'c.js', 2, 0),
			],
		};
		assert.equal(
			formatStackTrace(stack, { maxFrames: 2 }),
			'    at a (a.js:1:1)\n    at b (b.js:2:1)\n    ... 1 more frames',
		);
	});

	it('truncates across async parents', () => {
		const stack: Protocol.Runtime.StackTrace = {
			callFrames: [makeFrame('a', 'a.js', 0, 0)],
			parent: {
				callFrames: [
					makeFrame('b', 'b.js', 0, 0),
					makeFrame('c', 'c.js', 0, 0),
				],
			},
		};
		assert.equal(
			formatStackTrace(stack, { maxFrames: 2 }),
			'    at a (a.js:1:1)\n    --- async ---\n    at b (b.js:1:1)\n    ... 1 more frames',
		);
	});

	it('truncation with syncOnly counts only sync frames', () => {
		const stack: Protocol.Runtime.StackTrace = {
			callFrames: [
				makeFrame('a', 'a.js', 0, 0),
				makeFrame('b', 'b.js', 0, 0),
				makeFrame('c', 'c.js', 0, 0),
			],
			parent: {
				callFrames: [makeFrame('d', 'd.js', 0, 0)],
			},
		};
		assert.equal(
			formatStackTrace(stack, { maxFrames: 1, syncOnly: true }),
			'    at a (a.js:1:1)\n    ... 2 more frames',
		);
	});

	it('uses <anonymous> for frames with no URL by default', () => {
		const stack: Protocol.Runtime.StackTrace = {
			callFrames: [makeFrame('eval', '', 11, 46, '42' as Protocol.Runtime.ScriptId)],
		};
		assert.equal(
			formatStackTrace(stack),
			'    at eval (<anonymous>:12:47)',
		);
	});

	it('uses VM{scriptId} for frames with no URL when locationFallback is vm', () => {
		const stack: Protocol.Runtime.StackTrace = {
			callFrames: [makeFrame('eval', '', 11, 46, '42' as Protocol.Runtime.ScriptId)],
		};
		assert.equal(
			formatStackTrace(stack, { locationFallback: 'vm' }),
			'    at eval (VM42:12:47)',
		);
	});
});
