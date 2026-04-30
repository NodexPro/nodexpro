import { useEffect, useState } from 'react';
import { apiJson } from '../api/client';

export function ExampleModulePage() {
  const [data, setData] = useState<{ message?: string; moduleCode?: string; version?: string } | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    apiJson<{ message: string; moduleCode: string; version: string }>('m/example')
      .then(setData)
      .catch((e) => setError(e.message));
  }, []);

  if (error) return <p style={{ color: 'red' }}>{error}</p>;
  if (!data) return <p>Loading...</p>;

  return (
    <div>
      <h1>Example Module</h1>
      <p>{data.message}</p>
      <p>Code: {data.moduleCode}, Version: {data.version}</p>
    </div>
  );
}
