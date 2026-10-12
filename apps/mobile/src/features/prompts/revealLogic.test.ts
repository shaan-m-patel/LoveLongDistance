import { getIsPromptRevealed, isPromptAnswerVisibleToViewer } from '@/features/prompts/revealLogic';

describe('getIsPromptRevealed', () => {
  it('is false when one partner answered', () => {
    expect(getIsPromptRevealed([{ userId: 'user-1' }])).toBe(false);
  });

  it('is true when two partners answered', () => {
    expect(getIsPromptRevealed([{ userId: 'user-1' }, { userId: 'user-2' }])).toBe(true);
  });
});

describe('isPromptAnswerVisibleToViewer', () => {
  it('shows the viewer their own answer before reveal', () => {
    expect(isPromptAnswerVisibleToViewer(false, 'user-1', 'user-1')).toBe(true);
  });

  it('hides the partner answer until the prompt is revealed', () => {
    expect(isPromptAnswerVisibleToViewer(false, 'user-1', 'user-2')).toBe(false);
  });

  it('shows every answer after reveal', () => {
    expect(isPromptAnswerVisibleToViewer(true, 'user-1', 'user-2')).toBe(true);
  });
});
