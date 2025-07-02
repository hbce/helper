import { eq } from "drizzle-orm/expressions";
import { db } from "@/db/client";
import { conversationMessages } from "@/db/schema/conversationMessages";
import { NonRetriableError } from "@/jobs/utils";
import { getConversationById } from "@/lib/data/conversation";
import { ensureCleanedUpText, getConversationMessageById } from "@/lib/data/conversationMessage";
import { extractHashedWordsFromEmail } from "@/lib/emailSearchService/extractHashedWordsFromEmail";

function extractRawWords(params: {
  emailFrom?: string | null;
  subject?: string | null;
  body?: string | null;
}): string[] {
  const extractedWords: string[] = [];

  if (params.emailFrom) extractedWords.push(params.emailFrom);
  if (params.subject) extractedWords.push(...extractWords(params.subject));
  if (params.body) extractedWords.push(...extractWords(params.body));

  // Create a unique set of raw words
  return Array.from(new Set(extractedWords));
}

function extractWords(text: string): string[] {
  return text
    .toLowerCase()
    .split(/\s+/)
    .map((word) => word.replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, ""))
    .filter(Boolean);
}

const MAX_LENGTH = 5000;

export const indexConversationMessage = async ({ messageId }: { messageId: number }) => {
  const message = await getConversationMessageById(messageId);
  if (!message) {
    throw new NonRetriableError("Message not found");
  }

  const conversation = await getConversationById(message.conversationId);
  if (!conversation) {
    throw new NonRetriableError("Conversation not found");
  }

  const messageBody = await ensureCleanedUpText(message);

  // Collect words from subject and body
  const uniqueHashedWords = extractHashedWordsFromEmail({
    emailFrom: conversation.emailFrom,
    subject: conversation.subject,
    body: messageBody,
  });

  // Also extract raw words for prefix matching
  const rawWords = extractRawWords({
    emailFrom: conversation.emailFrom,
    subject: conversation.subject,
    body: messageBody,
  });

  // Combine hashed words and raw words
  const allWords = [...uniqueHashedWords, ...rawWords];

  // Generate the search index
  let totalLength = 0;
  const searchIndexWords = [];

  for (const word of allWords) {
    // +1 accounts for the space between words
    if (totalLength + word.length + 1 > MAX_LENGTH) {
      break;
    }
    searchIndexWords.push(word);
    totalLength += word.length + 1;
  }

  const searchIndex = searchIndexWords.join(" ");

  await db.update(conversationMessages).set({ searchIndex }).where(eq(conversationMessages.id, message.id));
};
