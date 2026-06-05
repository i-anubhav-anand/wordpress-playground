import { test } from '../../playground-fixtures';
import { writeFileSync, appendFileSync } from 'node:fs';

const logPath = '/tmp/posix-kernel-console-capture.log';

function timestamp(): string {
	return new Date().toISOString();
}

function logLine(line: string): void {
	appendFileSync(logPath, `[${timestamp()}] ${line}\n`);
}

test('capture every console / pageerror / requestfailed event during boot', async ({
	page,
}) => {
	writeFileSync(
		logPath,
		`=== console capture started at ${timestamp()} ===\n`
	);

	page.on('console', (msg) => {
		const loc = msg.location();
		const where = loc.url
			? ` @ ${loc.url}:${loc.lineNumber}:${loc.columnNumber}`
			: '';
		logLine(`[console.${msg.type()}] ${msg.text()}${where}`);
	});

	page.on('pageerror', (err) => {
		logLine(`[pageerror] ${err.name}: ${err.message}`);
		if (err.stack) {
			logLine(`[pageerror.stack]\n${err.stack}`);
		}
	});

	page.on('requestfailed', (req) => {
		const failure = req.failure();
		logLine(
			`[requestfailed] ${req.method()} ${req.url()} -- ${failure?.errorText ?? '<no failure text>'}`
		);
	});

	page.on('response', (resp) => {
		if (resp.status() >= 400) {
			logLine(
				`[response.${resp.status()}] ${resp.request().method()} ${resp.url()}`
			);
		}
	});

	page.on('framenavigated', (frame) => {
		logLine(
			`[framenavigated] name=${frame.name() || '<top>'} url=${frame.url()}`
		);
	});

	logLine('navigating to /');
	await page.goto('/');

	// Give the boot path ~90s to either succeed or crash.
	logLine('waiting 90s for boot to settle...');
	await page.waitForTimeout(90000);

	logLine('done waiting; dumping page snapshot');
	try {
		const title = await page.title();
		logLine(`[page.title] ${title}`);
	} catch (e) {
		logLine(`[page.title ERROR] ${(e as Error).message}`);
	}

	try {
		const url = page.url();
		logLine(`[page.url] ${url}`);
	} catch (e) {
		logLine(`[page.url ERROR] ${(e as Error).message}`);
	}

	// Try to read the inner WP iframe body for context (won't fail the test)
	try {
		const innerHTML = await page
			.frameLocator(
				'#playground-viewport:visible,.playground-viewport:visible'
			)
			.frameLocator('#wp')
			.locator('body')
			.innerHTML({ timeout: 5000 });
		logLine(`[wp.body.innerHTML.length] ${innerHTML.length}`);
		logLine(`[wp.body.innerHTML.preview] ${innerHTML.slice(0, 500)}`);
	} catch (e) {
		logLine(`[wp.body ERROR] ${(e as Error).message}`);
	}

	logLine(`=== console capture finished at ${timestamp()} ===`);
});
