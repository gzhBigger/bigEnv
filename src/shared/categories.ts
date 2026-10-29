/**
 * Canonical SDK category order, shared by the main-process catalog metadata and the renderer so the
 * category tabs and the card order never drift apart.
 */
export const SDK_CATEGORIES = [
  '语言运行时',
  'JVM 生态',
  'C/C++ 与构建',
  '数据库',
  '命令行工具',
  '编辑器与文档',
  '其他',
] as const;

export type SdkCategory = (typeof SDK_CATEGORIES)[number];

export function categoryRank(category: string): number {
  const index = SDK_CATEGORIES.indexOf(category as SdkCategory);
  return index === -1 ? SDK_CATEGORIES.length : index;
}
