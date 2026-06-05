import { test, expect } from '../../playground-fixtures';
import { writeFileSync, appendFileSync } from 'node:fs';

const logPath = '/tmp/iterative-or-probe.log';
function ts(): string {
	return new Date().toISOString();
}
function log(s: string): void {
	appendFileSync(logPath, `[${ts()}] ${s}\n`);
}

function buildLeftLeaningOrPhp(depth: number): string {
	const terms = Array.from(
		{ length: depth },
		(_, i) => `'tok${i}' === $needle`
	);
	return `<?php
$needle = 'nope';
$r = (
${terms.join(' ||\n')}
);
echo "iter-or ok: PHP=" . PHP_VERSION . " depth=${depth} r=" . var_export($r, true);
`;
}

const DEPTH = 100;

test(`left-leaning ||-chain depth=${DEPTH} compiles without V8 stack overflow`, async ({
	page,
	website,
	wordpress,
}) => {
	writeFileSync(
		logPath,
		`=== iter-or probe start ${ts()} depth=${DEPTH} ===\n`
	);

	page.on('console', (msg) => {
		const t = msg.text();
		if (
			t.includes('Maximum call stack') ||
			t.includes('RangeError') ||
			t.includes('Centralized worker failed') ||
			t.includes('iter-or ok')
		) {
			log(`[console.${msg.type()}] ${t}`);
		}
	});
	page.on('pageerror', (err) => {
		log(`[pageerror] ${err.name}: ${err.message}`);
	});

	const blueprint = {
		preferredVersions: { wp: false as const, php: '8.3' },
		landingPage: '/or-probe.php',
		steps: [
			{
				step: 'writeFile' as const,
				path: '/wordpress/or-probe.php',
				data: buildLeftLeaningOrPhp(DEPTH),
			},
		],
	};
	log(
		`navigating /#blueprint, blueprint size=${JSON.stringify(blueprint).length}`
	);
	await website.goto(`/#${JSON.stringify(blueprint)}`);

	log('waiting for "iter-or ok" in inner iframe body...');
	await expect(wordpress.locator('body')).toContainText('iter-or ok:', {
		timeout: 60000,
	});

	const innerText = await wordpress.locator('body').innerText();
	log(`[wp.body.innerText] ${innerText}`);
	log(`=== iter-or probe end ${ts()} ===`);
});
