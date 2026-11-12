export const COOKIE: string;
export function missingConfig(): string[];
export function authEnabled(): boolean;
export function checkPassword(value: string | undefined): boolean;
export function sessionValue(): string;
export function hasSession(cookieHeader: string | null | undefined): boolean;
export function loginCookie(): { name: string; value: string; maxAge: number };
export function logoutCookies(): string[];
