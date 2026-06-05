import { test } from '../../playground-fixtures';
import { writeFileSync, appendFileSync } from 'node:fs';

const logPath = '/tmp/posix-kernel-blueprint-capture.log';

function timestamp(): string {
	return new Date().toISOString();
}

function logLine(line: string): void {
	appendFileSync(logPath, `[${timestamp()}] ${line}\n`);
}

test('capture every console + iframe HTML during writeFile+runPHP blueprint', async ({
	page,
}) => {
	writeFileSync(
		logPath,
		`=== blueprint capture started at ${timestamp()} ===\n`
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

	const blueprint = {
		landingPage: '/smoke.php',
		steps: [
			{
				step: 'writeFile',
				path: '/wordpress/smoke.php',
				data: '<?php echo "kernel ok: " . PHP_VERSION;',
			},
		],
	};
	const url = `/#${JSON.stringify(blueprint)}`;
	logLine(`navigating to ${url}`);
	await page.goto(url);

	logLine('waiting 60s for blueprint to settle...');
	await page.waitForTimeout(60000);

	try {
		const innerHTML = await page
			.frameLocator(
				'#playground-viewport:visible,.playground-viewport:visible'
			)
			.frameLocator('#wp')
			.locator('body')
			.innerHTML({ timeout: 5000 });
		logLine(`[wp.body.innerHTML.length] ${innerHTML.length}`);
		logLine(`[wp.body.innerHTML]`);
		logLine(innerHTML);
	} catch (e) {
		logLine(`[wp.body ERROR] ${(e as Error).message}`);
	}

	logLine(`=== blueprint capture finished at ${timestamp()} ===`);
});
