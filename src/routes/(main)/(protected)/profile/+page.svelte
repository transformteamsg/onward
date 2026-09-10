<script lang="ts">
  import { ArrowLeft, BookOpenCheck, Lightbulb } from '@lucide/svelte';

  import { afterNavigate } from '$app/navigation';
  import { Avatar } from '$lib/components/Avatar/index.js';
  import { HOME_PATH, IsWithinViewport } from '$lib/helpers/index.js';

  const { data } = $props();

  let target = $state<HTMLElement | null>(null);
  let returnTo = $state(HOME_PATH);
  let selectedPeriod = $state<'W' | 'M' | 'Y' | 'All'>('W');

  const isWithinViewport = new IsWithinViewport(() => target);

  afterNavigate(({ from }) => {
    if (from && from.url.pathname === '/learning') {
      returnTo = from.url.pathname;
      return;
    }

    returnTo = HOME_PATH;
  });

  type Period = 'W' | 'M' | 'Y' | 'All';

  const periods: Period[] = ['W', 'M', 'Y', 'All'];

  const handlePeriodChange = (period: Period) => {
    selectedPeriod = period;
  };

  const dateRange = $derived.by(() => {
    const end = new Date();
    let start: Date;

    if (selectedPeriod === 'W') {
      start = data.sevenDaysAgo;
    } else if (selectedPeriod === 'M') {
      start = data.thirtyDaysAgo;
    } else if (selectedPeriod === 'Y') {
      start = data.oneYearAgo;
    } else {
      start = data.firstRecordDate ?? end;
    }

    return `${start.getDate()} ${start.toLocaleDateString('en-US', { month: 'short' })} ${start.getFullYear()} - ${end.getDate()} ${end.toLocaleDateString('en-US', { month: 'short' })} ${end.getFullYear()}`;
  });
</script>

<header class="fixed inset-x-0 z-50 bg-white/90 backdrop-blur-sm">
  <div
    class={[
      'absolute inset-x-0 top-full h-px bg-transparent transition-colors duration-300',
      !isWithinViewport.current && '!bg-slate-950/7.5',
    ]}
  ></div>

  <div class="mx-auto w-full max-w-5xl px-4 py-3">
    <div class="flex items-center justify-between gap-x-8">
      <div class="flex items-center gap-x-3">
        <a
          href={returnTo}
          class="rounded-full p-4 transition-colors hover:bg-slate-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-950 focus-visible:outline-dashed"
        >
          <ArrowLeft />
        </a>
      </div>
      <!-- Sign-out is a POST with the session CSRF token, so a cross-site page cannot force it. -->
      <form method="POST" action="/logout">
        <input type="hidden" name="csrfToken" value={data.csrfToken} />
        <button
          type="submit"
          class="cursor-pointer rounded-full p-4 transition-colors hover:bg-slate-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-950 focus-visible:outline-dashed"
        >
          Log out
        </button>
      </form>
    </div>
  </div>
</header>

<div bind:this={target} class="absolute inset-x-0 top-0 h-px"></div>

<main class="relative mx-auto flex min-h-svh max-w-5xl flex-col gap-y-4 px-4 py-3 pt-23">
  <div class="flex items-center gap-x-6 rounded-3xl bg-white p-4">
    <div class="h-10 w-10 overflow-hidden rounded-full">
      <Avatar src={data.avatar} name={data.name} />
    </div>

    <div class="flex flex-col">
      <span class="text-xl font-medium">{data.name}</span>
      <span class="text-slate-500">{data.email}</span>
    </div>
  </div>

  <div class="flex flex-1 flex-col gap-y-4">
    <div class="flex items-center justify-between">
      <span class="text-xl font-semibold">Learning Insights</span>
    </div>

    <div class="flex flex-col gap-y-2">
      <div class="flex items-center justify-between gap-x-2.5 rounded-lg bg-slate-200 p-1">
        {#each periods as period (period)}
          <button
            class={[
              'flex flex-1 cursor-pointer items-center justify-center rounded-md px-3 py-1 text-sm font-medium text-zinc-500 transition-colors hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-950 focus-visible:outline-dashed',
              selectedPeriod === period && 'pointer-events-none bg-white !text-slate-950',
            ]}
            onclick={() => handlePeriodChange(period)}
          >
            {period}
          </button>
        {/each}
      </div>

      <span class="text-sm text-slate-500">{dateRange}</span>
    </div>

    <div class="flex items-center justify-between rounded-3xl bg-white p-4">
      <div class="flex items-center gap-x-2">
        <div class="rounded-full bg-black p-2 text-white">
          <BookOpenCheck class="h-4 w-4" />
        </div>

        <span>Consumed bites</span>
      </div>

      <div class="flex items-center gap-x-1">
        <span class="text-xl font-medium">
          {#if selectedPeriod === 'W'}
            {data.learningUnitsConsumedByWeek}
          {:else if selectedPeriod === 'M'}
            {data.learningUnitsConsumedByMonth}
          {:else if selectedPeriod === 'Y'}
            {data.learningUnitsConsumedByYear}
          {:else}
            {data.learningUnitsConsumedByAll}
          {/if}
        </span>
        <span class="text-slate-500">bites</span>
      </div>
    </div>

    <div class="flex items-center justify-between rounded-3xl bg-white p-4">
      <div class="flex items-center gap-x-2">
        <div class="rounded-full bg-black p-2 text-white">
          <Lightbulb class="h-4 w-4" />
        </div>

        <span>Completed bites</span>
      </div>

      <div class="flex items-center gap-x-1">
        <span class="text-xl font-medium">
          {#if selectedPeriod === 'W'}
            {data.learningUnitsCompletedByWeek}
          {:else if selectedPeriod === 'M'}
            {data.learningUnitsCompletedByMonth}
          {:else if selectedPeriod === 'Y'}
            {data.learningUnitsCompletedByYear}
          {:else}
            {data.learningUnitsCompletedByAll}
          {/if}
        </span>
        <span class="text-slate-500">bites</span>
      </div>
    </div>
  </div>
</main>
