import { EmscriptenDownloadMonitor } from '@php-wasm/progress';
import { decodeZip } from '@php-wasm/stream-compression';
import { resolveWordPressRelease } from '@wp-playground/wordpress';
import {
	chmodSync,
	mkdirSync,
	writeFileSync,
	existsSync,
	copyFileSync,
} from 'node:fs';
import { dirname, joinPaths } from '@php-wasm/util';
import {
	cachedDownload,
	fetchSqliteIntegration,
} from '../blueprints-v1/download';
import type { KernelLimitedPHPApi } from './php-api';

import DISABLE_WP_MAIL_MU_PLUGIN_PHP from './wp-templates/disable-wp-mail.php?raw';
import AUTO_LOGIN_MU_PLUGIN_PHP from './wp-templates/auto-login.php?raw';
import WP_CONFIG_PHP from './wp-templates/wp-config.php?raw';

export interface PrepareWordPressOptions {
	wordPressRoot: string;
	wpVersionQuery?: string;
	onStatus?: (message: string) => void;
}

export interface PrepareWordPressResult {
	wordPressRoot: string;
	wpVersion: string;
	skipped: boolean;
}

export async function prepareWordPressForPosixKernel(
	options: PrepareWordPressOptions
): Promise<PrepareWordPressResult> {
	const { wordPressRoot, wpVersionQuery = 'latest', onStatus } = options;

	mkdirSync(wordPressRoot, { recursive: true });

	let skipped = false;
	let wpVersion: string;

	if (existsSync(joinPaths(wordPressRoot, 'wp-settings.php'))) {
		// Don't ping the release API for cached installs.
		wpVersion = 'cached';
		skipped = true;
	} else {
		const release = await resolveWordPressRelease(wpVersionQuery);
		wpVersion = release.version;

		onStatus?.(`Downloading WordPress ${release.version}`);
		const monitor = new EmscriptenDownloadMonitor();
		const wpZip = await cachedDownload(
			release.releaseUrl,
			`${release.version}.zip`,
			monitor
		);
		const wpZipBytes = new Uint8Array(await wpZip.arrayBuffer());

		onStatus?.('Extracting WordPress');
		await extractZipToDir(wpZipBytes, wordPressRoot, {
			stripLeadingDir: 'wordpress',
		});
	}

	await ensureSqliteIntegrationPlugin(wordPressRoot, onStatus);
	ensureDbDropIn(wordPressRoot);
	ensureWpConfig(wordPressRoot);
	ensureDatabaseDir(wordPressRoot);
	ensureAutoLoginMuPlugin(wordPressRoot);
	ensureDisableWpMailMuPlugin(wordPressRoot);

	return { wordPressRoot, wpVersion, skipped };
}

/**
 * Drive WP's installer over HTTP. Idempotent: a 200 root probe means
 * already-installed. HTTP rather than programmatic `wp_install()` because
 * a standalone php.wasm CLI hangs loading the SQLite drop-in, which
 * needs the per-request state nginx + php-fpm establish.
 */
export async function ensureWordPressInstalled(
	api: KernelLimitedPHPApi
): Promise<void> {
	const probe = await api.request({
		method: 'GET',
		url: '/',
	});
	const probeLocation = probe.headers['location']?.[0] ?? '';
	const installRequired =
		probe.httpStatusCode === 302 && probeLocation.includes('install.php');
	if (!installRequired) {
		return;
	}

	const formBody = new URLSearchParams({
		weblog_title: 'My WordPress Website',
		user_name: 'admin',
		admin_password: 'password',
		admin_password2: 'password',
		// Without `pw_weak`, install.php rejects "password" and re-renders.
		pw_weak: '1',
		admin_email: 'admin@example.com',
		blog_public: '1',
		Submit: 'Install WordPress',
	}).toString();
	const installResponse = await api.request({
		method: 'POST',
		url: '/wp-admin/install.php?step=2',
		headers: {
			'Content-Type': 'application/x-www-form-urlencoded',
		},
		body: formBody,
	});
	if (installResponse.httpStatusCode !== 200) {
		throw new Error(
			`WordPress install request failed: HTTP ` +
				`${installResponse.httpStatusCode}`
		);
	}
	const html = new TextDecoder().decode(installResponse.bytes);
	if (
		!html.includes('Success') &&
		!html.includes('WordPress has been installed')
	) {
		throw new Error(
			`WordPress installer did not report success: ` +
				`${html.slice(0, 1000)}`
		);
	}
}

function ensureAutoLoginMuPlugin(wordPressRoot: string): void {
	const path = joinPaths(
		wordPressRoot,
		'wp-content/mu-plugins/1-playground-auto-login.php'
	);
	mkdirSync(dirname(path), { recursive: true });
	if (existsSync(path)) {
		return;
	}
	writeFileSync(path, AUTO_LOGIN_MU_PLUGIN_PHP);
}

/**
 * No-op wp_mail() mu-plugin. wp_install() → wp_new_blog_notification()
 * calls PHPMailer → popen("sendmail"), which kandelo's fork+exec
 * exit_group(127)s on, killing the FPM worker mid-install.
 */
function ensureDisableWpMailMuPlugin(wordPressRoot: string): void {
	const path = joinPaths(
		wordPressRoot,
		'wp-content/mu-plugins/0-disable-wp-mail.php'
	);
	mkdirSync(dirname(path), { recursive: true });
	if (existsSync(path)) {
		return;
	}
	writeFileSync(path, DISABLE_WP_MAIL_MU_PLUGIN_PHP);
}

async function ensureSqliteIntegrationPlugin(
	wordPressRoot: string,
	onStatus?: (message: string) => void
): Promise<void> {
	const sqlitePluginDir = joinPaths(
		wordPressRoot,
		'wp-content/plugins/sqlite-database-integration'
	);
	if (existsSync(joinPaths(sqlitePluginDir, 'load.php'))) {
		return;
	}
	onStatus?.('Installing SQLite Database Integration');
	mkdirSync(sqlitePluginDir, { recursive: true });
	const sqliteZip = await fetchSqliteIntegration('v2.1.16');
	const sqliteZipBytes = new Uint8Array(await sqliteZip.arrayBuffer());
	await extractZipToDir(sqliteZipBytes, sqlitePluginDir, {
		stripLeadingDir: 'sqlite-database-integration',
	});
}

function ensureDbDropIn(wordPressRoot: string): void {
	const wpContent = joinPaths(wordPressRoot, 'wp-content');
	const dbDropIn = joinPaths(wpContent, 'db.php');
	const source = joinPaths(
		wpContent,
		'plugins/sqlite-database-integration/db.copy'
	);
	mkdirSync(wpContent, { recursive: true });
	if (!existsSync(dbDropIn) && existsSync(source)) {
		copyFileSync(source, dbDropIn);
	}
}

function ensureWpConfig(wordPressRoot: string): void {
	const wpConfigPath = joinPaths(wordPressRoot, 'wp-config.php');
	if (existsSync(wpConfigPath)) {
		return;
	}
	writeFileSync(wpConfigPath, WP_CONFIG_PHP);
}

function ensureDatabaseDir(wordPressRoot: string): void {
	const databaseDir = joinPaths(wordPressRoot, 'wp-content/database');
	mkdirSync(databaseDir, { recursive: true });
	// FPM workers (uid 99) need world-write: kandelo's HostFS maps host
	// files to uid 0, and the SQLite drop-in wp_die()s if !is_writable.
	chmodSync(databaseDir, 0o777);
}

interface ExtractZipOptions {
	/**
	 * If set, only entries whose path starts with `<stripLeadingDir>/`
	 * (or `<stripLeadingDir>-<suffix>/` for versioned plugin zips) are
	 * kept, with that prefix removed from every output path.
	 */
	stripLeadingDir?: string;
}

async function extractZipToDir(
	zipBytes: Uint8Array,
	destDir: string,
	options: ExtractZipOptions = {}
): Promise<void> {
	// decodeZip reads via a BYOB reader, which requires `type: 'bytes'`.
	const stream = new ReadableStream({
		type: 'bytes',
		start(controller) {
			controller.enqueue(new Uint8Array(zipBytes));
			controller.close();
		},
	} as UnderlyingByteSource) as ReadableStream<Uint8Array>;

	const reader = decodeZip(stream).getReader();

	while (true) {
		const { value, done } = await reader.read();
		if (done) {
			break;
		}
		if (!value) {
			continue;
		}
		let pathStr = value.name;
		if (options.stripLeadingDir !== undefined) {
			const stripped = stripLeadingDirPrefix(
				pathStr,
				options.stripLeadingDir
			);
			if (stripped === null) {
				continue;
			}
			pathStr = stripped;
		}
		if (pathStr === '' || pathStr === '/') {
			continue;
		}
		const targetPath = joinPaths(destDir, pathStr);
		if (value.type === 'directory') {
			mkdirSync(targetPath, { recursive: true });
			continue;
		}
		mkdirSync(dirname(targetPath), { recursive: true });
		const bytes = new Uint8Array(await value.arrayBuffer());
		writeFileSync(targetPath, bytes);
	}
}

export function stripLeadingDirPrefix(
	path: string,
	dirName: string
): string | null {
	const exactPrefix = `${dirName}/`;
	if (path === exactPrefix) {
		return '';
	}
	if (path.startsWith(exactPrefix)) {
		return path.slice(exactPrefix.length);
	}
	const versionedPrefix = `${dirName}-`;
	if (path.startsWith(versionedPrefix)) {
		const slash = path.indexOf('/');
		if (slash > -1) {
			return path.slice(slash + 1);
		}
	}
	return null;
}
