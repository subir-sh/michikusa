'use client';

import { FormEvent, useState } from 'react';
import styles from './import-panel.module.css';

interface ImportResult {
  imported: number;
  skipped: number;
  failed: string[];
}

type ImportPhase = 'idle' | 'scanning' | 'processing' | 'completed' | 'failed';

interface ImportProgress {
  phase: ImportPhase;
  total: number;
  processed: number;
  imported: number;
  skipped: number;
  failed: number;
  currentFile: string | null;
  error: string | null;
}

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
const POLL_INTERVAL_MS = 400;

function sleep(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function progressLabel(progress: ImportProgress) {
  if (progress.phase === 'scanning') return '사진 파일 찾는 중…';
  if (progress.phase === 'processing') {
    return `추가 ${progress.imported} · 중복 ${progress.skipped} · 실패 ${progress.failed}`;
  }
  if (progress.phase === 'completed') return '가져오기 완료';
  if (progress.phase === 'failed') return progress.error ?? '가져오기 실패';
  return '대기 중';
}

export function ImportPanel() {
  const [directory, setDirectory] = useState('');
  const [result, setResult] = useState<ImportResult | null>(null);
  const [progress, setProgress] = useState<ImportProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function refreshProgress() {
    try {
      const response = await fetch(`${API_URL}/photos/import-progress`, {
        cache: 'no-store',
      });
      if (response.ok) {
        setProgress((await response.json()) as ImportProgress);
      }
    } catch {
      // The import request itself reports connection errors.
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    setResult(null);
    setProgress({
      phase: 'scanning',
      total: 0,
      processed: 0,
      imported: 0,
      skipped: 0,
      failed: 0,
      currentFile: null,
      error: null,
    });

    let polling = true;
    const pollingPromise = (async () => {
      while (polling) {
        await refreshProgress();
        await sleep(POLL_INTERVAL_MS);
      }
    })();

    try {
      const response = await fetch(`${API_URL}/photos/import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ directory }),
      });

      if (!response.ok) {
        throw new Error(await response.text());
      }

      const nextResult = (await response.json()) as ImportResult;
      setResult(nextResult);
      window.dispatchEvent(new Event('michikusa:photos-imported'));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      polling = false;
      await pollingPromise;
      await refreshProgress();
      setLoading(false);
    }
  }

  const showProgress = loading && progress !== null;

  return (
    <section className="panel">
      <h2>사진 가져오기</h2>
      <form className="import-form" onSubmit={handleSubmit}>
        <input
          value={directory}
          onChange={(event) => setDirectory(event.target.value)}
          placeholder="D:\\Photos\\Japan"
          aria-label="사진 폴더 경로"
        />
        <button type="submit" disabled={loading || !directory.trim()}>
          {loading ? '가져오는 중…' : '가져오기'}
        </button>
      </form>

      {showProgress && (
        <div className={styles.progress} aria-live="polite">
          <div className={styles.progressHeader}>
            <span>{progressLabel(progress)}</span>
            {progress.total > 0 && (
              <strong>
                {progress.processed} / {progress.total}
              </strong>
            )}
          </div>
          {progress.total > 0 ? (
            <progress
              className={styles.progressBar}
              max={progress.total}
              value={progress.processed}
            />
          ) : (
            <progress className={styles.progressBar} />
          )}
          {progress.currentFile && (
            <span className={styles.currentFile}>{progress.currentFile}</span>
          )}
        </div>
      )}

      {result && (
        <p className="import-result">
          추가 {result.imported} · 중복 {result.skipped} · 실패 {result.failed.length}
        </p>
      )}
      {error && <p className="import-error">{error}</p>}
    </section>
  );
}
