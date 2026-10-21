/** The path the app is served under: "/" on Vercel, "/experiencedashboard/" on Mad Monkey's minis host (built with --base). */
export const BASE = import.meta.env.BASE_URL;

/** A file in /public, e.g. asset("mm-logo.png"). Never hardcode "/file": it 404s under the sub-path. */
export const asset = (file: string) => BASE + file.replace(/^\//, "");

/** A full link to a page of this app, e.g. appUrl("/a/abc") for a client share link. */
export const appUrl = (path: string) => window.location.origin + BASE.replace(/\/$/, "") + (path.startsWith("/") ? path : "/" + path);
