declare global {
	namespace App {}
	interface Window {
		ManagedMediaSource?: typeof MediaSource;
	}
}

export {};
