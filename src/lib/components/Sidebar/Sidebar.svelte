<script lang="ts">
  import { LogOut } from '@lucide/svelte';
  import type { Component } from 'svelte';

  interface NavItem {
    href: string;
    label: string;
    icon: Component;
  }

  export interface Props {
    title: string;
    currentPath: string;
    navItems: NavItem[];
    /**
     * The masked session CSRF token, submitted by the sign-out form.
     */
    csrfToken: string;
  }

  let { title, currentPath, navItems, csrfToken }: Props = $props();

  const isActive = (href: string): boolean => {
    return currentPath === href;
  };
</script>

<aside class="flex w-64 flex-col border-r-1 border-slate-200 shadow-md">
  <!-- Sidebar Header -->
  <div class="p-6">
    <span class="text-xl font-medium">{title}</span>
  </div>

  <!-- Sidebar Navigation Items -->
  <nav class="flex-1 overflow-y-auto py-4">
    <div class="mb-6">
      {#each navItems as item (item.href)}
        <a
          href={item.href}
          data-sveltekit-noscroll
          class={[
            'flex items-center rounded-md px-6 py-2.5 text-sm font-medium transition-colors hover:bg-slate-100 focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-950 focus-visible:outline-dashed',
            isActive(item.href) && 'bg-slate-100',
          ]}
        >
          <item.icon class="mr-3 size-5 flex-shrink-0" />
          {item.label}
        </a>
      {/each}
    </div>
  </nav>

  <!-- Sidebar Footer -->
  <div class="pb-4">
    <!-- Sign-out is a POST with the session CSRF token, so a cross-site page cannot force it. -->
    <form method="POST" action="/admin/logout">
      <input type="hidden" name="csrfToken" value={csrfToken} />
      <button
        type="submit"
        class="flex w-full cursor-pointer items-center rounded-md px-6 py-2.5 text-sm font-medium transition-colors hover:bg-slate-100 focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-950 focus-visible:outline-dashed"
      >
        <LogOut class="mr-3 h-5 w-5 flex-shrink-0" />
        Logout
      </button>
    </form>
  </div>
</aside>
