export interface FormConfigItem {
  label: string;
  keyName: string;
  keyValue: unknown;
  component: AntdComponentName;
  col?: { span: number; offset?: number };
  tooltip?: string;
  rules?: Array<Record<string, unknown>>;
  options?: Array<{ label: string; value: unknown }>;
  props?: Record<string, unknown>;
  valuePropName?: string;
}

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
  | 'Upload';
