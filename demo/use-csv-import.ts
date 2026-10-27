"use client";

import { useCallback, useMemo, useState } from "react";
import type { ImportPreview, ImportResult } from "./csv";
import { SAMPLE_CSV, SAMPLE_CSV_FILENAME } from "./sample-csv";
import { useDemoActions } from "./store";
import type { ImportField, ImportMapping } from "./validation";

// The CSV import screen's whole flow as one hook, so each prototype only has to draw it. It follows
// components/csv-importer.tsx: choosing a file starts a preview with guessed columns, changing a
// column re-runs the preview, the person picks Import or Skip for each duplicate row, and importing
// adds the companies. The hook keeps the file's text; the engine does the parsing and checking.

export type CsvImportFlow = {
  fileName: string | null;
  // Null until a file has been read, and again after a successful import.
  preview: ImportPreview | null;
  // Spreadsheet row numbers the person chose to skip. Starts from the suggested choices.
  skips: ReadonlySet<number>;
  // Set after a successful import: "Imported 11 · Skipped 2 · Errors 4".
  result: ImportResult | null;
  // The last problem, in the real app's words. Shown with a "Review again" button when a preview exists.
  error: string | null;
  // True while a chosen file is being read.
  pending: boolean;
  // Rows that will be added: rows found, minus rows with problems, minus rows skipped.
  importing: number;
  // Reads the file and shows its preview. Pass the File from an input, or null to clear.
  chooseFile(file: File | null): Promise<void>;
  // Loads the built-in messy sample sheet instead of a file.
  loadSample(): void;
  // Fills one field from a column (its position in preview.headers), or null for "Not in this file".
  setColumn(field: ImportField, column: number | null): void;
  setSkip(row: number, skip: boolean): void;
  // Runs the preview again with the same columns (the "Review again" button).
  reviewAgain(): void;
  runImport(): void;
  // "Import another file".
  startOver(): void;
};

export function useCsvImport(ws: string): CsvImportFlow {
  const actions = useDemoActions();
  const [fileName, setFileName] = useState<string | null>(null);
  const [text, setText] = useState<string | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [skips, setSkips] = useState<ReadonlySet<number>>(new Set());
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const review = useCallback(
    (csv: string, mapping: ImportMapping | null) => {
      const res = actions.previewImport(ws, csv, mapping);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setError(null);
      setPreview(res.data);
      setSkips(new Set(res.data.defaultSkips));
    },
    [actions, ws],
  );

  const clear = useCallback(() => {
    setFileName(null);
    setText(null);
    setPreview(null);
    setSkips(new Set());
    setError(null);
  }, []);

  const chooseFile = useCallback(
    async (file: File | null) => {
      setResult(null);
      clear();
      if (!file) return;
      const allowed = actions.checkImportFile(file);
      if (!allowed.ok) {
        setError(allowed.error);
        return;
      }
      setPending(true);
      try {
        const csv = await file.text();
        setFileName(file.name);
        setText(csv);
        review(csv, null);
      } catch {
        setError("That file couldn't be read.");
      } finally {
        setPending(false);
      }
    },
    [actions, clear, review],
  );

  const loadSample = useCallback(() => {
    setResult(null);
    clear();
    setFileName(SAMPLE_CSV_FILENAME);
    setText(SAMPLE_CSV);
    review(SAMPLE_CSV, null);
  }, [clear, review]);

  const setColumn = useCallback(
    (field: ImportField, column: number | null) => {
      if (text === null || preview === null) return;
      review(text, { ...preview.mapping, [field]: column });
    },
    [preview, review, text],
  );

  const setSkip = useCallback((row: number, skip: boolean) => {
    setSkips((current) => {
      const next = new Set(current);
      if (skip) next.add(row);
      else next.delete(row);
      return next;
    });
  }, []);

  const reviewAgain = useCallback(() => {
    if (text !== null) review(text, preview?.mapping ?? null);
  }, [preview, review, text]);

  const runImport = useCallback(() => {
    if (text === null || preview === null) return;
    const res = actions.runImport(ws, text, preview.mapping, [...skips], preview.seen);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setResult(res.data);
    clear();
  }, [actions, clear, preview, skips, text, ws]);

  const startOver = useCallback(() => {
    setResult(null);
    clear();
  }, [clear]);

  const importing = useMemo(() => (preview ? preview.rowCount - preview.errors.length - skips.size : 0), [preview, skips]);

  return { fileName, preview, skips, result, error, pending, importing, chooseFile, loadSample, setColumn, setSkip, reviewAgain, runImport, startOver };
}
