import { z } from "zod";

// The browser bundles carry zod because a few client components read limits and helpers from
// lib/validation. By default zod probes whether the page may compile code at run time, and a strict
// Content-Security-Policy reports that probe as a violation even though it is caught. The browser
// never parses anything with zod, so switch the probe off. Import this module before lib/validation.
if (typeof window !== "undefined") z.config({ jitless: true });
