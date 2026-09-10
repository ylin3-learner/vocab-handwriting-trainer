// src/domain/validation/wordSchema.ts

export const REQUIRED_FIELDS = ['word', 'meaning', 'sentence'] as const;
export const OPTIONAL_FIELDS = ['root', 'root_meaning', 'hint', 'level'] as const;
export const ALLOWED_FIELDS = [...REQUIRED_FIELDS, ...OPTIONAL_FIELDS] as const;

export type RequiredField = typeof REQUIRED_FIELDS[number];
export type OptionalField = typeof OPTIONAL_FIELDS[number];
export type AllowedField = typeof ALLOWED_FIELDS[number];

// 欄位名稱對應到 Word 型別的屬性名稱（處理 camelCase 轉換）
export const FIELD_MAPPING: Record<string, keyof import('../../types/word').Word> = {
    word: 'word',
    meaning: 'meaning',
    sentence: 'sentence',
    root: 'root',
    root_meaning: 'rootMeaning',
    hint: 'hint',
    level: 'level',
};