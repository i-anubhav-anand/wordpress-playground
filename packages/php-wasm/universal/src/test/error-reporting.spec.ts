import { afterEach, describe, expect, it, vi } from 'vitest';
import { PHPResponse } from '../lib/php-response';
import {
	prettyPrintFullStackTrace,
	printResponseDebugDetails,
} from '../lib/error-reporting';

describe('error reporting', () => {
	let stderr = '';
	let writeSpy: { mockRestore(): void } | undefined;

	afterEach(() => {
		writeSpy?.mockRestore();
		stderr = '';
	});

	it('redacts sensitive URLs from debug stack traces', async () => {
		writeSpy = vi
			.spyOn(process.stderr, 'write')
			.mockImplementation((chunk: string | Uint8Array) => {
				stderr += chunk.toString();
				return true;
			});
		const error = new Error(
			'Failed https://user:pass@example.com/file.zip?token=secret'
		);

		await prettyPrintFullStackTrace(error);

		expect(stderr).toContain('REDACTED');
		expect(stderr).not.toContain('user:pass');
		expect(stderr).not.toContain('token=secret');
	});

	it('redacts sensitive URLs from response debug details', () => {
		writeSpy = vi
			.spyOn(process.stderr, 'write')
			.mockImplementation((chunk: string | Uint8Array) => {
				stderr += chunk.toString();
				return true;
			});
		const response = new PHPResponse(
			200,
			{
				'X-Source': [
					'https://user:pass@example.com/header?token=secret',
				],
			},
			new TextEncoder().encode(
				'https://user:pass@example.com/stdout?token=secret'
			),
			'https://user:pass@example.com/stderr?token=secret'
		);

		printResponseDebugDetails(response);

		expect(stderr).toContain('REDACTED');
		expect(stderr).not.toContain('user:pass');
		expect(stderr).not.toContain('token=secret');
	});
});
