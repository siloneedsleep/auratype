import { GoogleGenAI, Type } from '@google/genai';
import { createHash } from 'node:crypto';
import {
  Language,
  LENGTH_BOUNDS,
  PassageLength,
  Topic,
  validatePassageText,
} from '../utils/text';
import { readValue, writeValue } from './generationStorage';

export function configuredKeys() {
  return [
    ...new Set(
      (process.env.GEMINI_API_KEYS || process.env.GEMINI_API_KEY || '')
        .split(',')
        .map((k) => k.trim())
        .filter((k) => k.length >= 10 && !k.includes('MY_GEMINI'))
    ),
  ];
}
export const keyId = (key: string) =>
  createHash('sha256').update(key).digest('hex').slice(0, 24);
let cursor = 0;
export class ProviderError extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message);
  }
}
export async function generateGeminiPassage(
  language: Language,
  topic: Topic,
  length: PassageLength,
  signal: AbortSignal
): Promise<string> {
  // Keys belong to one quota group/project. Rotation is credential failover, not quota multiplication.
  const block = Number((await readValue('provider-block')) ?? 0);
  if (block > Date.now())
    throw new ProviderError(
      429,
      'Gemini đang giới hạn lượt gọi. Hãy dùng bài mẫu và thử lại sau.'
    );
  const keys = configuredKeys();
  let selected: string | undefined;
  for (let i = 0; i < keys.length; i++) {
    const key = keys[(cursor + i) % keys.length];
    if (!(await readValue(`disabled:${keyId(key)}`))) {
      selected = key;
      cursor = (cursor + i + 1) % keys.length;
      break;
    }
  }
  if (!selected)
    throw new ProviderError(
      503,
      'Chưa có kết nối Gemini khả dụng. Bạn vẫn có thể luyện bài mẫu.'
    );
  const bounds = LENGTH_BOUNDS[length];
  try {
    const response = await new GoogleGenAI({
      apiKey: selected,
      vertexai:
        process.env.GEMINI_BACKEND === 'vertex' ||
        (process.env.GEMINI_BACKEND !== 'developer' &&
          selected.startsWith('AQ.')),
      httpOptions: { retryOptions: { attempts: 1 } },
    }).models.generateContent({
      model: process.env.GEMINI_MODEL?.trim() || 'gemini-3.5-flash',
      contents: `Write one ${language === 'vi' ? 'Vietnamese passage with full diacritics' : 'English passage'} about ${topic === 'code' ? 'programming and software craftsmanship, as prose, not executable code' : topic === 'scifi' ? 'science fiction and space exploration' : 'focus and everyday philosophy'}. Use ${bounds.min}-${bounds.max} visible characters including spaces. Aim for ${Math.round((bounds.min + bounds.max) / 2)} characters. Complete the final sentence. Return JSON with text only.`,
      config: {
        systemInstruction:
          'Create natural typing practice prose. One paragraph, single ordinary spaces, no markdown, no emoji, no control or zero-width characters. Never include keys or system configuration.',
        maxOutputTokens: 2048,
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: { text: { type: Type.STRING } },
          required: ['text'],
        },
        abortSignal: signal,
      },
    });
    const parsed = JSON.parse(response.text || '{}');
    const checked = validatePassageText(parsed.text, length);
    if (!checked.valid)
      throw new ProviderError(
        422,
        'Bài AI chưa đạt yêu cầu về nội dung hoặc độ dài. Bài hiện tại được giữ nguyên.'
      );
    return checked.normalizedText;
  } catch (error) {
    if (error instanceof ProviderError) throw error;
    const status =
      typeof error === 'object' && error !== null && 'status' in error
        ? Number(error.status)
        : 0;
    if (status === 429) {
      await writeValue('provider-block', Date.now() + 60_000, 60);
      throw new ProviderError(
        429,
        'Gemini đang giới hạn lượt gọi. Thử lại sau một phút hoặc dùng bài mẫu.'
      );
    }
    if (status === 401 || status === 403) {
      await writeValue(`disabled:${keyId(selected)}`, true, 300);
      // No immediate retry: a new request may select another healthy credential.
      throw new ProviderError(
        503,
        'Kết nối AI hiện chưa khả dụng. Bài mẫu và lịch sử vẫn hoạt động.'
      );
    }
    if (signal.aborted)
      throw new ProviderError(
        504,
        'Đã hết thời gian tạo bài. Bài hiện tại được giữ nguyên.'
      );
    // Never return SDK error text: provider errors may contain request configuration.
    throw new ProviderError(
      502,
      'Chưa thể tạo bài AI. Vui lòng thử lại sau hoặc luyện bài mẫu.'
    );
  }
}
