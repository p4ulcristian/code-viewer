import { useState, useEffect } from 'react';

interface DirEntry {
  name: string;
  path: string;
  isDirectory: boolean;
}

interface DirListing {
  current: string;
  parent: string;
  entries: DirEntry[];
}

interface ProjectSetupProps {
  onProjectSelect: (path: string) => void;
  initialPath?: string;
}

export function ProjectSetup({ onProjectSelect, initialPath }: ProjectSetupProps) {
  const [currentPath, setCurrentPath] = useState(initialPath || '');
  const [listing, setListing] = useState<DirListing | null>(null);
  const [loading, setLoading] = useState(true);
  const [inputPath, setInputPath] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadDirectory(currentPath);
  }, [currentPath]);

  const loadDirectory = async (path: string) => {
    setLoading(true);
    setError(null);
    try {
      const url = path
        ? `/api/list-dir?path=${encodeURIComponent(path)}`
        : '/api/list-dir';
      console.log('[ProjectSetup] Fetching:', url);
      const response = await fetch(url);
      const data = await response.json();
      console.log('[ProjectSetup] Response:', data);
      if (data.error) {
        setError(data.error);
      } else {
        setListing(data);
        setInputPath(data.current);
      }
    } catch (e) {
      console.error('Failed to load directory:', e);
      setError('Failed to load directory');
    }
    setLoading(false);
  };

  const handleSelect = (path: string) => {
    setCurrentPath(path);
  };

  const handleGoUp = () => {
    if (listing?.parent) {
      setCurrentPath(listing.parent);
    }
  };

  const handleInputSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (inputPath) {
      // Force reload even if path is the same
      if (inputPath === currentPath) {
        loadDirectory(inputPath);
      } else {
        setCurrentPath(inputPath);
      }
    }
  };

  const handleChooseThis = () => {
    if (listing?.current) {
      onProjectSelect(listing.current);
    }
  };

  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      background: 'rgba(0, 0, 0, 0.9)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 10000,
    }}>
      <div style={{
        background: '#1e293b',
        borderRadius: '12px',
        padding: '24px',
        width: '600px',
        maxHeight: '80vh',
        display: 'flex',
        flexDirection: 'column',
        gap: '16px',
        boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)',
      }}>
        <h2 style={{ margin: 0, color: 'white', fontSize: '20px' }}>
          Select Project Directory
        </h2>

        <form onSubmit={handleInputSubmit} style={{ display: 'flex', gap: '8px' }}>
          <input
            type="text"
            value={inputPath}
            onChange={(e) => setInputPath(e.target.value)}
            placeholder="Enter path..."
            style={{
              flex: 1,
              padding: '10px 12px',
              background: '#0f172a',
              border: '1px solid #334155',
              borderRadius: '6px',
              color: 'white',
              fontSize: '14px',
              fontFamily: 'monospace',
            }}
          />
          <button
            type="submit"
            style={{
              padding: '10px 16px',
              background: '#3b82f6',
              border: 'none',
              borderRadius: '6px',
              color: 'white',
              cursor: 'pointer',
              fontSize: '14px',
            }}
          >
            Go
          </button>
        </form>

        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          padding: '8px 12px',
          background: '#0f172a',
          borderRadius: '6px',
        }}>
          <button
            onClick={handleGoUp}
            disabled={!listing?.parent || listing.parent === listing.current}
            style={{
              padding: '4px 8px',
              background: '#334155',
              border: 'none',
              borderRadius: '4px',
              color: 'white',
              cursor: 'pointer',
              opacity: (!listing?.parent || listing.parent === listing.current) ? 0.5 : 1,
            }}
          >
            ..
          </button>
          <span style={{ color: '#94a3b8', fontFamily: 'monospace', fontSize: '13px' }}>
            {listing?.current || 'Loading...'}
          </span>
        </div>

        <div style={{
          overflowY: 'auto',
          background: '#0f172a',
          borderRadius: '6px',
          height: '300px',
        }}>
          {loading ? (
            <div style={{ padding: '20px', color: '#64748b', textAlign: 'center' }}>
              Loading...
            </div>
          ) : error ? (
            <div style={{ padding: '20px', color: '#f87171', textAlign: 'center' }}>
              {error}
            </div>
          ) : listing?.entries.length === 0 ? (
            <div style={{ padding: '20px', color: '#64748b', textAlign: 'center' }}>
              No subdirectories
            </div>
          ) : (
            listing?.entries.map((entry) => (
              <div
                key={entry.path}
                onClick={() => handleSelect(entry.path)}
                style={{
                  padding: '10px 16px',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '10px',
                  borderBottom: '1px solid #1e293b',
                  color: 'white',
                  transition: 'background 0.1s',
                }}
                onMouseEnter={(e) => e.currentTarget.style.background = '#1e293b'}
                onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
              >
                <span style={{ color: '#60a5fa' }}>📁</span>
                <span style={{ fontFamily: 'monospace', fontSize: '14px' }}>
                  {entry.name}
                </span>
              </div>
            ))
          )}
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
          <button
            onClick={handleChooseThis}
            style={{
              padding: '12px 24px',
              background: '#22c55e',
              border: 'none',
              borderRadius: '6px',
              color: 'white',
              cursor: 'pointer',
              fontSize: '14px',
              fontWeight: 500,
            }}
          >
            Select This Directory
          </button>
        </div>
      </div>
    </div>
  );
}
