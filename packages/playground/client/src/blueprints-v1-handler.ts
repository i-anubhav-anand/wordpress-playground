import type { ProgressTracker } from '@php-wasm/progress';
import {
	type PlaygroundClient,
	type StartPlaygroundOptions,
	compileBlueprintV1,
	isBlueprintBundle,
	runBlueprintV1Steps,
	resolveRuntimeConfiguration,
	BlueprintReflection,
} from '.';
import { collectPhpLogs, logger } from '@php-wasm/logger';
import { consumeAPI } from '@php-wasm/universal';
import type { PHPWebExtension } from '@php-wasm/web';

export class BlueprintsV1Handler {
	private readonly options: StartPlaygroundOptions;

	constructor(options: StartPlaygroundOptions) {
		this.options = options;
	}

	async bootPlayground(
		iframe: HTMLIFrameElement,
		progressTracker: ProgressTracker
	) {
		const {
			onBlueprintValidated,
			onBlueprintStepCompleted,
			corsProxy,
			gitAdditionalHeadersCallback,
			mounts,
			sapiName,
			scope,
			shouldInstallWordPress,
			sqliteDriverVersion,
			wordpressInstallMode,
			onClientConnected,
			pathAliases,
		} = this.options;
		const executionProgress = progressTracker!.stage(0.5);
		const downloadProgress = progressTracker!.stage();

		// Set a default blueprint if none is provided.
		const blueprint = this.options.blueprint || {};

		// Connect the Comlink API client to the remote worker,
		// boot the playground, and run the blueprint steps.
		const playground = consumeAPI<PlaygroundClient>(
			iframe.contentWindow!,
			iframe.ownerDocument!.defaultView!
		) as PlaygroundClient;
		setProgressCaption(
			progressTracker,
			'Waiting for remote Playground runtime'
		);
		await playground.isConnected();
		setProgressCaption(
			progressTracker,
			'Resolving Playground runtime versions'
		);
		progressTracker.pipe(playground);

		const runtimeConfiguration =
			await resolveRuntimeConfiguration(blueprint);
		const extensions: PHPWebExtension[] = runtimeConfiguration.intl
			? ['intl']
			: [];
		extensions.push(...(this.options.extensions || []));
		await playground.onDownloadProgress(downloadProgress.loadingListener);
		// Blueprint's `preferredVersions.wp: false` is the declarative way to
		// opt out of WordPress. Bundles carry their declaration inside a JSON
		// file we haven't read here, so we only honor the flag for inline
		// declarations. If the caller also requested WordPress explicitly and
		// the two disagree, refuse to silently pick a winner.
		const declarativeOptOut =
			!isBlueprintBundle(blueprint) &&
			blueprint.preferredVersions?.wp === false;
		const resolvedWordPressInstallMode: WordPressInstallMode =
			wordpressInstallMode ??
			(declarativeOptOut
				? 'do-not-attempt-installing'
				: shouldInstallWordPress === false
					? 'install-from-existing-files-if-needed'
					: 'download-and-install');
		if (
			declarativeOptOut &&
			(shouldInstallWordPress === true ||
				(wordpressInstallMode !== undefined &&
					wordpressInstallMode !== 'do-not-attempt-installing'))
		) {
			throw new Error(
				'Conflicting options: WordPress was requested, ' +
					'but the Blueprint sets ' +
					'`preferredVersions.wp: false`. Pick one.'
			);
		}
		setProgressCaption(progressTracker, 'Booting PHP and WordPress');
		await playground.boot({
			mounts,
			sapiName,
			scope: scope ?? Math.random().toFixed(16),
			wordpressInstallMode: resolvedWordPressInstallMode,
			phpVersion: runtimeConfiguration.phpVersion,
			wpVersion: runtimeConfiguration.wpVersion,
			extensions,
			withNetworking: runtimeConfiguration.networking,
			corsProxyUrl: corsProxy,
			sqliteDriverVersion,
			pathAliases,
		});
		setProgressCaption(
			progressTracker,
			'Waiting for WordPress to be ready'
		);
		await playground.isReady();
		downloadProgress.finish();

		setProgressCaption(progressTracker, 'Connecting Playground client');
		collectPhpLogs(logger, playground);
		onClientConnected?.(playground);

		setProgressCaption(progressTracker, 'Preparing blueprint steps');
		const reflection = await BlueprintReflection.create(blueprint);
		if (reflection.getVersion() === 1) {
			const compiled = await compileBlueprintV1(blueprint, {
				progress: executionProgress,
				onStepCompleted: onBlueprintStepCompleted,
				onBlueprintValidated,
				corsProxy,
				gitAdditionalHeadersCallback,
			});
			setProgressCaption(progressTracker, 'Running blueprint steps');
			await runBlueprintV1Steps(compiled, playground);
		}

		/**
		 * Pre-fetch WordPress update checks to speed up the initial wp-admin load.
		 * Skip for old WordPress versions — the functions called by prefetch
		 * (wp_check_php_version, wp_update_plugins, etc.) don't exist or crash
		 * on legacy WP, and the resulting PHP errors create noise. WP 5.0
		 * (Gutenberg 1.0) also crashes the runtime with exit code 255 inside
		 * prefetchUpdateChecks when using the modern SQLite driver, so extend
		 * the skip range up to (but not including) WP 5.1.
		 *
		 * parseFloat extracts the major version from strings like "6.8",
		 * "4.9.26", etc. Non-numeric values like "nightly" or "trunk"
		 * produce NaN, which Number.isFinite rejects — those fall
		 * through to enabling prefetch (correct for dev builds).
		 *
		 * @see https://github.com/WordPress/wordpress-playground/pull/2295
		 */
		const wpMajor = parseFloat(runtimeConfiguration.wpVersion);
		const isLegacyWpVersion = Number.isFinite(wpMajor) && wpMajor < 5.1;
		// Prefetch only makes sense when WordPress is actually installed.
		// In PHP-only mode (`preferredVersions.wp: false`), wp-load.php
		// doesn't exist and the prefetch crashes the runtime.
		if (
			runtimeConfiguration.networking &&
			!isLegacyWpVersion &&
			resolvedWordPressInstallMode === 'download-and-install'
		) {
			setProgressCaption(
				progressTracker,
				'Prefetching WordPress update checks'
			);
			await playground.prefetchUpdateChecks();
		}

		return playground;
	}
}

type WordPressInstallMode = NonNullable<
	StartPlaygroundOptions['wordpressInstallMode']
>;

function setProgressCaption(
	progressTracker: ProgressTracker,
	caption: string
): void {
	progressTracker.setCaption?.(caption);
}
