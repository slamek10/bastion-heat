export const SHARED_COOKIE: string;
export const SHARED_MAX_AGE: number;
export function sharedEnabled(): boolean;
export function createShared(now?: number): string;
export function validShared(value: unknown, now?: number): boolean;
export function sharedFromHeader(header: string | null | undefined): string | undefined;
