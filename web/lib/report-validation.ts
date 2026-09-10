const object = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const count = (value: unknown) => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

export function validFormatReport(value: unknown): boolean {
  if (!object(value) || value.report_schema_version !== 1) return false;
  if (!object(value.template) || typeof value.template.name !== "string" || !value.template.name) return false;
  if (!object(value.stats) || !Object.keys(value.stats).length || !Object.values(value.stats).every(count)) return false;
  if (!object(value.module_status) || !["body", "heading", "table", "page"].every(key => object((value.module_status as Record<string, unknown>)[key]))) return false;
  if (!Object.values(value.module_status).every(item => object(item) && count(item.count) && typeof item.status === "string" && !!item.status && typeof item.action === "string" && !!item.action && typeof item.note === "string")) return false;
  if (!Array.isArray(value.warnings) || !value.warnings.every(item => object(item) && (item.paragraph_index === null || count(item.paragraph_index)) && typeof item.text_preview === "string" && typeof item.message === "string" && !!item.message)) return false;
  if (!Array.isArray(value.paragraphs) || !value.paragraphs.every(item => object(item) && count(item.index) && typeof item.detected_type === "string")) return false;
  if (!Array.isArray(value.tables)) return false;
  return object(value.verification) && value.verification.structure_inventory === "completed" && value.verification.layout === "not_performed";
}
