type Warning = {
  message: string;
  paragraph_index: number | null;
  table_index?: number;
  text_preview: string;
};

// Only known informational messages are hidden; unfamiliar warnings remain visible.
export function actionableWarnings<T extends Warning>(warnings: T[]): T[] {
  const seen = new Set<string>();
  return warnings.filter(warning => {
    if (warning.message.trim() === "已使用本地快速解析，复杂或含糊要求仍建议人工确认。") return false;
    const key = JSON.stringify([warning.message, warning.paragraph_index, warning.table_index, warning.text_preview]);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function conciseWarning(message: string): string {
  if (message === "为保护复杂版面或用户指定内容，未套用所在节的页边距要求；相邻正文重排仍可能改变位置，请检查最终页面。") {
    return "部分页面保留了原页边距，以保护图表或指定内容。请在 Word 中检查这些页面。";
  }
  if (message === "已按保护策略保留该表格及其嵌套内容的原格式。") {
    return "此表格保留原格式，未套用新格式；如需调整，请在 Word 中修改。";
  }
  return message;
}
