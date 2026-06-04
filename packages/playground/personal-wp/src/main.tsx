import { lazy, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

import { collectWindowErrors, logger } from '@php-wasm/logger';
import { Provider } from 'react-redux';
import store from './lib/state/redux/store';
import { Layout } from './components/layout';
import { EnsurePlaygroundSite } from './components/ensure-playground-site';

const DesktopAccessViewer = lazy(() =>
	import('./components/desktop-access-viewer').then((module) => ({
		default: module.DesktopAccessViewer,
	}))
);
const DesktopAccessConnect = lazy(() =>
	import('./components/desktop-access-connect').then((module) => ({
		default: module.DesktopAccessConnect,
	}))
);

collectWindowErrors(logger);

const root = createRoot(document.getElementById('root')!);
const desktopAccessSessionId = getDesktopAccessSessionId();

root.render(
	isDesktopAccessConnectRoute() ? (
		<Suspense fallback={null}>
			<DesktopAccessConnect />
		</Suspense>
	) : desktopAccessSessionId ? (
		<Suspense fallback={null}>
			<DesktopAccessViewer sessionId={desktopAccessSessionId} />
		</Suspense>
	) : (
		<Provider store={store}>
			<EnsurePlaygroundSite>
				<Layout />
			</EnsurePlaygroundSite>
		</Provider>
	)
);

function getDesktopAccessSessionId(): string | null {
	const params = new URLSearchParams(window.location.search);
	return params.get('share');
}

function isDesktopAccessConnectRoute(): boolean {
	return window.location.pathname === '/connect';
}
