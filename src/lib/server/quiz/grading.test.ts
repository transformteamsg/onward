import { describe, expect, test } from 'vitest';

import { gradeQuiz } from './grading.js';

const questionAnswers = [
  { id: 'q1', answer: 0 },
  { id: 'q2', answer: 1 },
  { id: 'q3', answer: 2 },
  { id: 'q4', answer: 3 },
  { id: 'q5', answer: 0 },
];

describe('gradeQuiz', () => {
  test('passes an attempt where every answer matches', () => {
    const selections = new Map([
      ['q1', 0],
      ['q2', 1],
      ['q3', 2],
      ['q4', 3],
      ['q5', 0],
    ]);

    expect(gradeQuiz(questionAnswers, selections)).toEqual({
      correctAnswers: 5,
      totalQuestions: 5,
      score: 100,
      isQuizPassed: true,
    });
  });

  test('passes an attempt that reaches the passing score exactly', () => {
    const selections = new Map([
      ['q1', 0],
      ['q2', 1],
      ['q3', 2],
      ['q4', 3],
      ['q5', 4],
    ]);

    expect(gradeQuiz(questionAnswers, selections)).toEqual({
      correctAnswers: 4,
      totalQuestions: 5,
      score: 80,
      isQuizPassed: true,
    });
  });

  test('fails an attempt below the passing score', () => {
    const selections = new Map([
      ['q1', 0],
      ['q2', 1],
      ['q3', 2],
      ['q4', 0],
      ['q5', 1],
    ]);

    expect(gradeQuiz(questionAnswers, selections)).toEqual({
      correctAnswers: 3,
      totalQuestions: 5,
      score: 60,
      isQuizPassed: false,
    });
  });

  test('counts a question with no selection as incorrect', () => {
    const selections = new Map([
      ['q1', 0],
      ['q2', 1],
      ['q3', 2],
      ['q4', 3],
    ]);

    const grade = gradeQuiz(questionAnswers, selections);

    expect(grade.correctAnswers).toBe(4);
    expect(grade.totalQuestions).toBe(5);
  });

  test('ignores a selection for a question outside the quiz', () => {
    const selections = new Map([
      ['q1', 0],
      ['other', 0],
    ]);

    expect(gradeQuiz(questionAnswers, selections)).toEqual({
      correctAnswers: 1,
      totalQuestions: 5,
      score: 20,
      isQuizPassed: false,
    });
  });

  test('fails an attempt with no selections at all', () => {
    expect(gradeQuiz(questionAnswers, new Map())).toEqual({
      correctAnswers: 0,
      totalQuestions: 5,
      score: 0,
      isQuizPassed: false,
    });
  });

  test('fails a quiz that has no questions', () => {
    expect(gradeQuiz([], new Map())).toEqual({
      correctAnswers: 0,
      totalQuestions: 0,
      score: 0,
      isQuizPassed: false,
    });
  });
});
