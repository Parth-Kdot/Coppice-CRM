"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useRef } from "react";

// A miss inside a workspace the person belongs to (a company that was archived, merged or never
// existed): drawn inside the workspace's own frame, so the spine and search are still there. A
// stranger never gets here: the workspace layout's membership check sends them to the plain
// global 404 before this frame is drawn.
export default function WorkspaceNotFound() {
  const params = useParams<{ workspaceId: string }>();
  const base = `/${encodeURIComponent(params.workspaceId ?? "")}`;
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus({ preventScroll: true });
  }, []);
  return (
    <div className="max-w-[640px] py-6">
      <title>Page not found</title>
      <h1 ref={heading} tabIndex={-1} className="lg-h1 outline-none">
        Page not found
      </h1>
      <p className="lg-sub mt-2">That company isn&apos;t in this workspace (it may have been archived or merged).</p>
      <p className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-3">
        <Link href={`${base}/board`} className="lg-btn lg-btn-primary">
          Back to the board
        </Link>
        <Link href={base} className="lg-link">
          Back to the queue
        </Link>
      </p>
    </div>
  );
}
