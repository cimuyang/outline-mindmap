import { moment } from 'obsidian'
export function label(zh: string, en: string): string { return moment.locale().startsWith('zh') ? zh : en }
