import { z } from 'zod';

const promptAnswerSchema = z.object({
  userId: z.string().min(1),
  answer: z.string().min(1),
  submittedAt: z.string().min(1),
  imageUri: z.string().min(1).optional(),
});

export const promptThreadSchema = z.object({
  promptId: z.string().min(1),
  answers: z.array(promptAnswerSchema),
});

export function getIsPromptRevealed(answers: { userId: string }[]): boolean {
  const uniqueUserCount = new Set(answers.map((item) => item.userId)).size;
  return uniqueUserCount >= 2;
}

/** Partner answer text and photos stay hidden until the server marks the prompt revealed. */
export function isPromptAnswerVisibleToViewer(
  revealed: boolean,
  viewerId: string | undefined,
  answerUserId: string,
): boolean {
  return revealed || (viewerId != null && viewerId === answerUserId);
}
