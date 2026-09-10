<script lang="ts">
  import { BookOpen, FileSpreadsheet } from '@lucide/svelte';

  import { page } from '$app/state';
  import { Sidebar } from '$lib/components/Sidebar/index.js';

  let { children, data } = $props();

  const navItems = [
    { href: '/admin', label: 'Learning Units', icon: BookOpen },
    { href: '/admin/reports', label: 'Generate Report', icon: FileSpreadsheet },
  ];
</script>

<div class="flex h-screen overflow-hidden">
  <Sidebar title="Glow" currentPath={page.url.pathname} {navItems} csrfToken={data.csrfToken} />

  <main class="flex-1 overflow-y-auto p-6">
    {@render children()}
  </main>
</div>
