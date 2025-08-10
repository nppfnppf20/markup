<script lang="ts">
  import MarkupBoard from './lib/components/MarkupBoard.svelte';
  import { createLocalAdapters } from './lib/adapters/local';
  import type { UserRef } from './lib/types';

  // Configure these for your environment. For prototype, leave baseUrl blank to hit same origin.
  const { storageAdapter, lockAdapter } = createLocalAdapters();

  const docId = 'prototype-doc';
  const currentUser: UserRef = { id: 'demo', name: 'Demo' };
</script>

<div style="height: 100vh; display: grid; grid-template-rows: auto 1fr;">
  <header style="display:flex; align-items:center; gap:12px; padding: 8px 12px; border-bottom: 1px solid var(--color-border); background: var(--color-surface);">
    <strong>Markup Prototype</strong>
  </header>
  <main>
    <MarkupBoard {docId} {currentUser} {storageAdapter} {lockAdapter} />
  </main>
</div>

