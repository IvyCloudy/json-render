export interface DataSourceHttpConfig {
  url: string;
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  headers?: Record<string, string>;
  query?: Record<string, unknown>;
  body?: unknown;
  timeoutMs?: number;
}

export interface DataSourceTransform {
  path?: string;
  labelField?: string;
  valueField?: string;
  disabledField?: string;
  childrenField?: string;
}

export interface DataSourceCacheConfig {
  ttl: number;
  key?: string;
}

export interface DataSourceSearchConfig {
  debounce?: number;
  minLength?: number;
}

export interface FormItemDataSource {
  http: DataSourceHttpConfig;
  transform?: DataSourceTransform;
  fallback?: Array<{ label: string; value: unknown; disabled?: boolean }>;
  cache?: DataSourceCacheConfig;
  search?: DataSourceSearchConfig;
  watch?: string[];
  condition?: string;
  clearOnWatchChange?: boolean;
}

export interface FormConfigItem {
  label: string;
  keyName: string;
  /** @deprecated Values should come from formData instead. Kept for backward compatibility. */
  keyValue?: unknown;
  component: AntdComponentName;
  col?: { span: number; offset?: number };
  tooltip?: string;
  rules?: Array<Record<string, unknown>>;
  options?: Array<{ label: string; value: unknown }>;
  props?: Record<string, unknown>;
  valuePropName?: string;
  dataSource?: FormItemDataSource;
}

export function hasFormConfig(data: unknown): boolean {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return false;
  return Array.isArray((data as Record<string, unknown>)[FORM_CONFIG_KEY]);
}

export const FORM_DATA_KEY = 'formData';
export const FORM_CONFIG_KEY = 'formConfig';

/**
 * Extract form values from data object.
 * Priority: formData > root-level fields (backward compat) > keyValue fallback
 */
export function getFormData(data: unknown): Record<string, unknown> {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return {};
  const obj = data as Record<string, unknown>;
  if (obj[FORM_DATA_KEY] && typeof obj[FORM_DATA_KEY] === 'object' && !Array.isArray(obj[FORM_DATA_KEY])) {
    return obj[FORM_DATA_KEY] as Record<string, unknown>;
  }
  const { [FORM_META_KEY]: _, [FORM_CONFIG_KEY]: __, ...rest } = obj;
  return rest;
}

export const FORM_META_KEY = '__form';

export type AntdComponentName =
  | 'Input'
  | 'Input.TextArea'
  | 'InputNumber'
  | 'Select'
  | 'DatePicker'
  | 'Switch'
  | 'Radio.Group'
  | 'Checkbox'
  | 'Checkbox.Group'
  | 'TimePicker'
  | 'Cascader'
  | 'TreeSelect'
  | 'Upload'
  | 'Slider'
  | 'ColorPicker'
  | 'Rate'
  | 'Mentions'
  | 'Transfer'
  | 'Tree';
