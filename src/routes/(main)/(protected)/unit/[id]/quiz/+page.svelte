<script lang="ts">
  import { ArrowLeft, X } from '@lucide/svelte';
  import type { SubmitFunction } from '@sveltejs/kit';
  import DOMPurify from 'dompurify';
  import { marked } from 'marked';
  import { onMount } from 'svelte';

  import { browser } from '$app/environment';
  import { applyAction, enhance } from '$app/forms';
  import { Badge } from '$lib/components/Badge/index.js';
  import { Button, LinkButton } from '$lib/components/Button/index.js';
  import { Modal } from '$lib/components/Modal/index.js';
  import {
    HOME_PATH,
    IsWithinViewport,
    noop,
    PASSING_SCORE,
    trackQuizAttempt,
    trackQuizCompletion,
  } from '$lib/helpers/index.js';
  import { Player } from '$lib/states/index.js';

  /**
   * The feedback the `checkAnswer` action returns for a single question. The correct answer reaches
   * the browser here only — after the learner commits to a selection.
   */
  interface Feedback {
    isCorrect: boolean;
    answer: number;
    explanation: string;
  }

  const { data, params } = $props();

  let target = $state<HTMLElement | null>(null);
  let currentQuestionAnswerIndex = $state(0);
  let selectedOptionIndex = $state(-1);
  let isFeedbackModalOpen = $state(false);
  let isCompletionModalOpen = $state(false);
  let isQuizFailedModalOpen = $state(false);
  let isCheckingAnswer = $state(false);
  let isSubmitting = $state(false);
  let feedback = $state<Feedback | null>(null);
  let correctAnswers = $state(0);
  let gradedQuestions = $state<number | null>(null);

  const currentQuestionAnswer = $derived(data.questionAnswers[currentQuestionAnswerIndex]);
  const totalQuestions = $derived(gradedQuestions ?? data.questionAnswers.length);
  const isLastQuestionAnswer = $derived(
    currentQuestionAnswerIndex === data.questionAnswers.length - 1,
  );

  const player = Player.get();
  const isWithinViewport = new IsWithinViewport(() => target);

  onMount(() => {
    player.stop();
  });

  const closeFeedbackModal = () => {
    isFeedbackModalOpen = false;
  };

  const handleCheckAnswer: SubmitFunction = () => {
    isCheckingAnswer = true;

    trackQuizAttempt(params.id.toString(), currentQuestionAnswer.id);

    return async ({ result }) => {
      isCheckingAnswer = false;

      if (result.type !== 'success' || !result.data) {
        await applyAction(result);
        return;
      }

      feedback = result.data as Feedback;
      isFeedbackModalOpen = true;
    };
  };

  const handleContinueClick = () => {
    // On the last question the button submits the quiz. The feedback modal stays open until the
    // server returns the outcome, so that no bare page shows while the request is in flight.
    if (isLastQuestionAnswer) {
      return;
    }

    isFeedbackModalOpen = false;
    feedback = null;

    // Move to next question.
    currentQuestionAnswerIndex++;
    selectedOptionIndex = -1;
  };

  const handleSubmit: SubmitFunction = () => {
    isSubmitting = true;

    trackQuizCompletion(params.id.toString());

    return async ({ result }) => {
      isSubmitting = false;

      if (result.type !== 'success' || !result.data) {
        await applyAction(result);
        return;
      }

      // The server grades the attempt. The client only decides which outcome to show.
      const outcome = result.data as {
        isQuizPassed: boolean | null;
        correctAnswers: number;
        totalQuestions: number;
      };

      correctAnswers = outcome.correctAnswers;
      gradedQuestions = outcome.totalQuestions;
      isFeedbackModalOpen = false;

      if (outcome.isQuizPassed === false) {
        isQuizFailedModalOpen = true;
      } else {
        isCompletionModalOpen = true;
      }
    };
  };
</script>

<header class="fixed inset-x-0 z-50 bg-white/90 backdrop-blur-sm">
  <div
    class={[
      'absolute inset-x-0 top-full h-px bg-transparent transition-colors duration-300',
      !isWithinViewport.current && '!bg-slate-950/7.5',
    ]}
  ></div>

  <div class="mx-auto flex max-w-5xl items-center justify-between gap-x-3 px-4 py-3">
    <div class="flex items-center gap-x-3">
      <a
        href="/unit/{params.id}"
        class="rounded-full p-4 transition-colors hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-950 focus-visible:outline-dashed"
      >
        <ArrowLeft />
      </a>
    </div>
  </div>
</header>

<div bind:this={target} class="absolute inset-x-0 top-0 h-px"></div>

<main class="relative mx-auto flex min-h-svh max-w-5xl flex-col gap-y-10 px-4 pt-23 pb-3">
  <div class="flex flex-1 flex-col gap-y-2">
    <Badge variant="slate">
      Question {currentQuestionAnswerIndex + 1} of {data.questionAnswers.length}
    </Badge>

    {#each data.questionAnswers as q, qi (q.id)}
      <div class={['flex flex-col gap-y-4', currentQuestionAnswerIndex !== qi && 'hidden']}>
        <span id="question-{qi}" class="prose prose-slate text-xl font-medium">
          {#if browser}
            <!-- eslint-disable-next-line svelte/no-at-html-tags -->
            {@html DOMPurify.sanitize(marked.parse(q.question, { async: false }))}
          {/if}
        </span>

        <div class="flex flex-col gap-y-2" role="radiogroup" aria-labelledby="question-{qi}">
          {#each q.options as o, oi (o)}
            <label
              class={[
                'group flex cursor-pointer items-center gap-x-3 rounded-2xl border border-slate-200 bg-white px-2.5 py-3.5 transition-[border-color,box-shadow] has-focus-visible:outline-dashed',
                'hover:ring-1 hover:ring-slate-200',
                'has-checked:border-slate-950 has-checked:ring-slate-950',
                'has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-slate-950 has-focus-visible:outline-dashed',
              ]}
            >
              <input
                type="radio"
                name="question-{qi}"
                value={oi}
                bind:group={selectedOptionIndex}
                class="sr-only"
              />

              <span
                class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-100 font-semibold transition-colors group-has-checked:bg-slate-950 group-has-checked:text-white"
              >
                {String.fromCharCode(65 + oi)}
              </span>

              <span class="text-left">{o}</span>
            </label>
          {/each}
        </div>
      </div>
    {/each}
  </div>

  <form method="POST" action="?/checkAnswer" use:enhance={handleCheckAnswer}>
    <input type="hidden" name="csrfToken" value={data.csrfToken} />
    <input type="hidden" name="questionAnswerId" value={currentQuestionAnswer.id} />
    <input type="hidden" name="selectedOptionIndex" value={selectedOptionIndex} />

    <Button
      class="py-3.75"
      width="full"
      type="submit"
      disabled={selectedOptionIndex === -1 || isCheckingAnswer}
    >
      Check Answer
    </Button>
  </form>
</main>

<Modal isopen={isFeedbackModalOpen} onclose={closeFeedbackModal} size="partial">
  {#if feedback}
    <header class="sticky inset-x-0 top-0 bg-white/90 backdrop-blur-sm">
      <div class="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
        <span class={['text-xl font-medium', !feedback.isCorrect && 'text-red-600']}>
          {feedback.isCorrect ? 'Correct answer!' : 'Not quite right!'}
        </span>

        <button
          onclick={closeFeedbackModal}
          class="cursor-pointer rounded-full p-3 transition-colors hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-950 focus-visible:outline-dashed"
        >
          <X />
        </button>
      </div>
    </header>

    <main class="mx-auto flex min-h-[calc(100%-72px)] max-w-5xl flex-col gap-y-10 px-4 py-3">
      <div class="flex flex-1 flex-col gap-y-4">
        <div class="flex flex-col gap-y-2">
          <span class="font-medium">Your answer</span>

          <div
            class={[
              'flex items-center gap-x-3 rounded-2xl border px-2.5 py-3.5',
              feedback.isCorrect ? 'border-transparent bg-lime-200' : 'border-red-600 bg-white',
            ]}
          >
            <span
              class={[
                'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg font-semibold',
                feedback.isCorrect ? 'bg-lime-400' : 'bg-red-500 text-white',
              ]}
            >
              {String.fromCharCode(65 + selectedOptionIndex)}
            </span>

            <span class={['text-left', !feedback.isCorrect && 'text-red-600']}>
              {currentQuestionAnswer.options[selectedOptionIndex]}
            </span>
          </div>
        </div>

        {#if !feedback.isCorrect}
          <div class="flex flex-col gap-y-2">
            <span class="font-medium">Correct answer</span>

            <div
              class="flex items-center gap-x-3 rounded-2xl border border-transparent bg-lime-200 px-2.5 py-3.5"
            >
              <span
                class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-lime-400 font-semibold"
              >
                {String.fromCharCode(65 + feedback.answer)}
              </span>

              <span class="text-left">
                {currentQuestionAnswer.options[feedback.answer]}
              </span>
            </div>
          </div>
        {/if}

        <div class="flex flex-col gap-y-2 rounded-2xl bg-slate-100 p-3">
          <span class="font-medium text-slate-500">Explanation</span>
          <span>{feedback.explanation}</span>
        </div>
      </div>

      <form method="POST" action="?/updateLJCompletionStatus" use:enhance={handleSubmit}>
        <input type="hidden" name="csrfToken" value={data.csrfToken} />

        <Button
          class="py-3.75"
          width="full"
          type={isLastQuestionAnswer ? 'submit' : 'button'}
          disabled={isSubmitting}
          onclick={handleContinueClick}
        >
          Continue
        </Button>
      </form>
    </main>
  {/if}
</Modal>

<Modal isopen={isCompletionModalOpen} onclose={noop} variant="light">
  <div class="mx-auto flex min-h-svh max-w-5xl flex-col items-center justify-center px-4 py-6">
    <div class="flex flex-col items-center justify-center gap-y-1">
      <div class="flex flex-col items-center justify-center gap-y-2">
        <div class="flex flex-col items-center justify-center">
          <span class="text-xl font-medium">Congrats!</span>
          <span class="text-xl font-medium">You have completed</span>
        </div>

        <span class="max-w-xs text-center text-xl font-bold">'{data.learningUnitTitle}'</span>
      </div>
    </div>

    <div class="relative mt-2.5 pb-20">
      <enhanced:img
        src="$lib/assets/completion-splash.png?w=644"
        alt="Completion splash"
        class="w-[322px]"
      />

      <div class="absolute inset-x-0 bottom-0 flex flex-col gap-y-5">
        <LinkButton href={`/unit/${params.id}`} variant="primary" width="full" class="max-w-sm">
          Done
        </LinkButton>

        <a
          href="/profile"
          class="inline-flex w-full cursor-pointer items-center justify-center rounded-full px-3.75 py-2.75 font-medium hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-950 focus-visible:outline-dashed"
        >
          Check my profile
        </a>
      </div>
    </div>
  </div>
</Modal>

<Modal isopen={isQuizFailedModalOpen} onclose={noop} variant="light">
  <div class="mx-auto flex min-h-svh max-w-5xl flex-col items-center justify-center px-4 py-6">
    <div class="flex flex-col items-center justify-center gap-y-1">
      <span class="text-xl font-medium">Try again!</span>
      <span class="text-xl font-bold">{correctAnswers}/{totalQuestions}</span>
      <span>
        You need {Math.ceil((totalQuestions * PASSING_SCORE) / 100)} points to pass
      </span>
    </div>

    <div class="relative mt-2.5 pb-20">
      <enhanced:img
        src="$lib/assets/failed-splash.png?w=644"
        alt="Fail quiz splash"
        class="w-[322px]"
      />

      <div class="absolute inset-x-0 bottom-0 flex flex-col gap-y-5">
        <LinkButton href={`/unit/${params.id}`} variant="primary" width="full" class="max-w-sm">
          Retry
        </LinkButton>

        <a
          href={HOME_PATH}
          class="inline-flex w-full cursor-pointer items-center justify-center rounded-full px-3.75 py-2.75 font-medium hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-950 focus-visible:outline-dashed"
        >
          Back to home
        </a>
      </div>
    </div>
  </div>
</Modal>
