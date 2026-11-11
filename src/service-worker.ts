/// <reference types="@sveltejs/kit" />
/// <reference no-default-lib="true"/>
/// <reference lib="esnext" />
/// <reference lib="webworker" />
/**
 * Makes the app installable (Android/Chrome want a service worker). It
 * caches only the built files, so the app shell opens fast; everything
 * live (API, Frigate, video) always goes to the network. Browsers only
 * run it on https or localhost.
 */
import { build, files, version } from '$service-worker';

const sw = self as unknown as ServiceWorkerGlobalScope;
const CACHE = `bastion-heat-${version}`;
const SHELL = [...build, ...files.filter((file) => !file.startsWith('/themes/'))];

sw.addEventListener('install', (event) => {
	event.waitUntil(
		caches
			.open(CACHE)
			.then((cache) => cache.addAll(SHELL))
			.then(() => sw.skipWaiting())
	);
});

sw.addEventListener('activate', (event) => {
	event.waitUntil(
		caches
			.keys()
			.then((keys) =>
				Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)))
			)
			.then(() => sw.clients.claim())
	);
});

sw.addEventListener('fetch', (event) => {
	const url = new URL(event.request.url);
	if (event.request.method !== 'GET' || url.origin !== sw.location.origin) return;
	if (!SHELL.includes(url.pathname)) return;
	event.respondWith(caches.match(event.request).then((hit) => hit ?? fetch(event.request)));
});
