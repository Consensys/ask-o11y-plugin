/**
 * Debug utility to inspect localStorage session storage
 * Use this in browser console: window.debugStorage()
 */

export function debugStorage() {
  const prefix = 'grafana-o11y-chat-';
  const keys = Object.keys(localStorage).filter((key) => key.startsWith(prefix));

  console.group('🔍 Session Storage Debug');
  console.log('Total keys found:', keys.length);
  console.log('Keys:', keys);

  // Group by orgId
  const byOrg: Record<string, string[]> = {};
  keys.forEach((key) => {
    const match = key.match(/grafana-o11y-chat-org-(\d+)-/);
    if (match) {
      const orgId = match[1];
      if (!byOrg[orgId]) {
        byOrg[orgId] = [];
      }
      byOrg[orgId].push(key);
    }
  });

  console.group('📊 By Organization');
  Object.entries(byOrg).forEach(([orgId, orgKeys]) => {
    console.group(`Org ${orgId} (${orgKeys.length} keys)`);
    orgKeys.forEach((key) => {
      const value = localStorage.getItem(key);
      const size = value ? new Blob([value]).size : 0;
      console.log(`${key}: ${size} bytes`, value ? JSON.parse(value) : null);
    });
    console.groupEnd();
  });
  console.groupEnd();

  // Check for sessions index
  Object.entries(byOrg).forEach(([orgId, orgKeys]) => {
    const indexKey = `grafana-o11y-chat-org-${orgId}-sessions-index`;
    const indexData = localStorage.getItem(indexKey);
    if (indexData) {
      try {
        const sessions = JSON.parse(indexData);
        console.log(`Org ${orgId} - Sessions index:`, sessions.length, 'sessions');
        sessions.forEach((s: any) => {
          console.log(`  - ${s.id}: ${s.title} (${s.messageCount} messages)`);
        });
      } catch (e) {
        console.error('Failed to parse index:', e);
      }
    }
  });

  // Calculate total storage
  let totalSize = 0;
  keys.forEach((key) => {
    const value = localStorage.getItem(key);
    if (value) {
      totalSize += key.length + value.length;
    }
  });
  console.log(`📦 Total storage used: ${(totalSize / 1024).toFixed(2)} KB`);

  console.groupEnd();
  return { keys, byOrg, totalSize };
}

// Make it available globally for easy debugging
if (typeof window !== 'undefined') {
  (window as any).debugStorage = debugStorage;
}
