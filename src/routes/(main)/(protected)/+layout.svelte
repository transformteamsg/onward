<script lang="ts">
  import { XIcon } from '@lucide/svelte';
  import { onMount } from 'svelte';

  import { invalidateAll } from '$app/navigation';
  import { page } from '$app/state';
  import { LinkButton } from '$lib/components/Button/index.js';
  import { ChatView } from '$lib/components/ChatView/index.js';
  import { ChatWidget } from '$lib/components/ChatWidget/index.js';
  import { Modal } from '$lib/components/Modal/index.js';
  import { NowPlayingBar } from '$lib/components/NowPlayingBar/index.js';
  import { NowPlayingView } from '$lib/components/NowPlayingView/index.js';
  import { OnboardingView } from '$lib/components/OnboardingView/index.js';
  import {
    noop,
    track20PercentPodcastPlay,
    track50PercentPodcastPlay,
    track80PercentPodcastPlay,
    trackAIChatClick,
    trackNowPlayingBarClick,
    trackPodcastCompletion,
  } from '$lib/helpers/index.js';
  import { Player } from '$lib/states/index.js';

  import type { LayoutData } from './$types';

  const { children } = $props();

  const player = Player.create();

  let isChatViewOpen = $state(false);

  let isTrackingSession = $state(false);
  let isPodcastCompletedModalOpen = $state(false);
  let isQuizAvailable = $derived(page.data?.isQuizAvailable ?? false);
  let isOnboardingViewOpen = $derived(!page.data.onboarded);

  const isQuizPage = $derived(page.url.pathname.includes('/quiz'));

  const handleNowPlayingBarClick = () => {
    player.isNowPlayingViewOpen = true;

    if (player.currentTrack) {
      trackNowPlayingBarClick(player.currentTrack.id);
    }
  };

  const handleNowPlayingBarPlay = () => {
    player.toggle();
  };

  const handleNowPlayingViewClose = () => {
    player.isNowPlayingViewOpen = false;
  };

  const handleSeek = (value: number) => {
    player.seek(value);
  };

  const handleSkipBack = () => {
    player.skipBack();
  };

  const handleSkipForward = () => {
    player.skipForward();
  };

  const handleSpeedChange = () => {
    player.cyclePlaybackSpeed();
  };

  const handleChatWidgetClick = () => {
    isChatViewOpen = true;
    trackAIChatClick();
  };

  const handleChatViewClose = () => {
    isChatViewOpen = false;
  };

  const handleOnboardingViewClose = () => {
    isOnboardingViewOpen = false;
  };

  const handlePodcastCompletedModalClose = () => {
    isPodcastCompletedModalOpen = false;
  };

  onMount(() => {
    const updateLearningJourney = async (progress: number, hasReachedEnd = false) => {
      await fetch('/api/learningjourney', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          id: player.currentTrack?.id,
          lastCheckpoint: progress,
          learningUnitContentId: player.currentTrack?.learningUnitContentId,
          csrfToken: (page.data as LayoutData).csrfToken,
          hasReachedEnd,
        }),
      });
    };

    const handlePause = () => {
      if (!isTrackingSession) {
        return;
      }

      updateLearningJourney(player.progress);
    };

    const handleEnded = async () => {
      if (isTrackingSession) {
        await updateLearningJourney(0, true);
        await invalidateAll();
      }

      if (isQuizAvailable) {
        isPodcastCompletedModalOpen = true;
      }

      isTrackingSession = false;
    };

    const handleCheckpoint = () => {
      if (!isTrackingSession) {
        isTrackingSession = true;
      }

      updateLearningJourney(player.progress);
    };

    const handleTwentyPercentPodcast = () => {
      if (!player.currentTrack) {
        return;
      }

      track20PercentPodcastPlay(player.currentTrack.id);
    };

    const handleFiftyPercentPodcast = () => {
      if (!player.currentTrack) {
        return;
      }

      track50PercentPodcastPlay(player.currentTrack.id);
    };

    const handleEightyPercentPodcast = () => {
      if (!player.currentTrack) {
        return;
      }

      track80PercentPodcastPlay(player.currentTrack.id);
    };

    const handleHundredPercentPodcast = () => {
      if (!player.currentTrack) {
        return;
      }

      trackPodcastCompletion(player.currentTrack.id);
    };

    player.addEventListener('pause', handlePause);
    player.addEventListener('ended', handleEnded);
    player.addEventListener('checkpoint', handleCheckpoint);
    player.addEventListener('twentyPercent', handleTwentyPercentPodcast);
    player.addEventListener('fiftyPercent', handleFiftyPercentPodcast);
    player.addEventListener('eightyPercent', handleEightyPercentPodcast);
    player.addEventListener('hundredPercent', handleHundredPercentPodcast);

    return () => {
      player.removeEventListener('pause', handlePause);
      player.removeEventListener('ended', handleEnded);
      player.removeEventListener('checkpoint', handleCheckpoint);
      player.removeEventListener('twentyPercent', handleTwentyPercentPodcast);
      player.removeEventListener('fiftyPercent', handleFiftyPercentPodcast);
      player.removeEventListener('eightyPercent', handleEightyPercentPodcast);
      player.removeEventListener('hundredPercent', handleHundredPercentPodcast);
    };
  });
</script>

{@render children()}

{#if !isQuizPage}
  <div class="pointer-events-none fixed inset-x-0 bottom-0 z-100">
    <div class="mx-auto flex max-w-5xl justify-end gap-x-4 px-4 py-3">
      {#if player.currentTrack}
        <NowPlayingBar
          title={player.currentTrack.title}
          isplaying={player.isPlaying}
          onclick={handleNowPlayingBarClick}
          onplay={handleNowPlayingBarPlay}
        />
      {/if}

      <ChatWidget onclick={handleChatWidgetClick} />
    </div>
  </div>
{/if}

{#if player.currentTrack}
  <NowPlayingView
    isopen={player.isNowPlayingViewOpen}
    onclose={handleNowPlayingViewClose}
    isplaying={player.isPlaying}
    playbackspeed={player.playbackSpeed}
    duration={player.duration}
    progress={player.progress}
    currenttrack={player.currentTrack}
    onplaypause={handleNowPlayingBarPlay}
    onseek={handleSeek}
    onskipback={handleSkipBack}
    onskipforward={handleSkipForward}
    onspeedchange={handleSpeedChange}
  />

  <Modal isopen={isPodcastCompletedModalOpen} onclose={noop} class="z-300">
    <div
      class={[
        'absolute left-1/2 h-1/3 w-[150%] -translate-x-1/2 rounded-b-[50%]',
        player.currentTrack.tags[0].code === 'BOB' && 'bg-blue-400',
        player.currentTrack.tags[0].code === 'AI' && 'bg-cyan-400',
        player.currentTrack.tags[0].code === 'NEWS' && 'bg-orange-400',
        player.currentTrack.tags[0].code === 'PROD' && 'bg-emerald-400',
        player.currentTrack.tags[0].code === 'CAREER' && 'bg-violet-400',
        player.currentTrack.tags[0].code === 'INNOV' && 'bg-pink-400',
        player.currentTrack.tags[0].code === 'WELLBEING' && 'bg-teal-400',
        player.currentTrack.tags[0].code === 'STU_WELL' && 'bg-sky-400',
        player.currentTrack.tags[0].code === 'STU_DEV' && 'bg-green-400',
      ]}
    ></div>

    <div class="relative z-1">
      <div class="mx-auto flex max-w-5xl items-center justify-end px-4 py-3">
        <button
          onclick={handlePodcastCompletedModalClose}
          class="flex cursor-pointer items-center justify-center rounded-full bg-white/20 p-3 transition-colors hover:bg-white/50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-950 focus-visible:outline-dashed"
        >
          <XIcon />
        </button>
      </div>

      <div class="mx-auto flex min-h-svh max-w-5xl flex-col gap-y-6 px-4 py-3">
        <div class="flex flex-col items-center justify-center">
          {#if player.currentTrack.tags[0].code === 'BOB'}
            <enhanced:img
              src="$lib/assets/collections/learn-with-bob.png?w=464"
              alt="Learn with Bob"
              class="w-[232px]"
            />
          {:else if player.currentTrack.tags[0].code === 'AI'}
            <enhanced:img
              src="$lib/assets/collections/artificial-intelligence.png?w=464"
              alt="Artificial Intelligence"
              class="w-[232px]"
            />
          {:else if player.currentTrack.tags[0].code === 'NEWS'}
            <enhanced:img
              src="$lib/assets/collections/in-the-news.png?w=464"
              alt="In the News"
              class="w-[232px]"
            />
          {:else if player.currentTrack.tags[0].code === 'PROD'}
            <enhanced:img
              src="$lib/assets/collections/productivity.png?w=464"
              alt="Productivity"
              class="w-[232px]"
            />
          {:else if player.currentTrack.tags[0].code === 'CAREER'}
            <enhanced:img
              src="$lib/assets/collections/career-growth.png?w=464"
              alt="Career Growth"
              class="w-[232px]"
            />
          {:else if player.currentTrack.tags[0].code === 'INNOV'}
            <enhanced:img
              src="$lib/assets/collections/innovation.png?w=464"
              alt="Innovation"
              class="w-[232px]"
            />
          {:else if player.currentTrack.tags[0].code === 'WELLBEING'}
            <enhanced:img
              src="$lib/assets/collections/wellbeing.png?w=464"
              alt="Wellbeing"
              class="w-[232px]"
            />
          {:else if player.currentTrack.tags[0].code === 'STU_WELL'}
            <enhanced:img
              src="$lib/assets/collections/student-wellbeing.png?w=464"
              alt="Student Wellbeing"
              class="w-[232px]"
            />
          {:else if player.currentTrack.tags[0].code === 'STU_DEV'}
            <enhanced:img
              src="$lib/assets/collections/student-development.png?w=464"
              alt="Student Development"
              class="w-[232px]"
            />
          {/if}
        </div>

        <div class="flex flex-col items-center justify-center gap-y-6">
          <div class="flex flex-col gap-y-4 text-center">
            <span class="text-xl font-medium">Just completed learning!</span>
            <span class="text-sm leading-6">
              And you are almost there.<br />Deepen your understanding by taking a<br />quiz and
              earn one more completion status.
            </span>
          </div>

          <LinkButton
            href={`/unit/${player.currentTrack.id}/quiz`}
            class="max-w-sm"
            width="full"
            onclick={handlePodcastCompletedModalClose}
          >
            Take quiz
          </LinkButton>
        </div>
      </div>
    </div>
  </Modal>
{/if}

<ChatView isopen={isChatViewOpen} onclose={handleChatViewClose} />

<OnboardingView
  isopen={isOnboardingViewOpen}
  onclose={handleOnboardingViewClose}
  topics={page.data.onboardingTopics ?? []}
/>
