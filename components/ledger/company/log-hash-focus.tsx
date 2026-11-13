"use client";

import { useEffect } from "react";
import { focusSoon } from "../focus";

// Opened from the queue's "Log outreach" (…#log-outreach): the form is ready to type into. The
// block's scroll-margin keeps its heading clear of the phone's sticky bar (company.css).
export function LogHashFocus() {
  useEffect(() => {
    const go = () => {
      if (window.location.hash === "#log-outreach") focusSoon('#log-outreach input[name="channel"]:checked');
    };
    go();
    window.addEventListener("hashchange", go);
    return () => window.removeEventListener("hashchange", go);
  }, []);
  return null;
}
