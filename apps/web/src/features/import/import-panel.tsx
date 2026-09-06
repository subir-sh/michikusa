'use client';

import { FormEvent, useState } from 'react';

interface ImportResult {
  imported: number;
  skipped: number;
  failed: string[];
}

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

export function ImportPanel() {
  const [directory, setDirectory] = useState('');
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    setResult(null);

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
      setLoading(false);
    }
  }

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

      {result && (
        <p className="import-result">
          추가 {result.imported} · 중복 {result.skipped} · 실패 {result.failed.length}
        </p>
      )}
      {error && <p className="import-error">{error}</p>}
    </section>
  );
}
