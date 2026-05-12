import React, { useCallback, useEffect, useRef, useMemo } from 'react';
import { Form, Row, Col, Input, InputNumber, Select, DatePicker, Switch, Radio, Checkbox, TimePicker, Cascader, TreeSelect, Upload, Button, Tooltip, Slider, ColorPicker, Rate, Mentions, Transfer, Tree } from 'antd';
import type { FormInstance } from 'antd';
import { QuestionCircleOutlined, ReloadOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { FormConfigItem, AntdComponentName, FORM_CONFIG_KEY, FORM_DATA_KEY, FORM_META_KEY, getFormData } from './formConfigTypes';
import { SubmitBar } from './SubmitBar';
import { useVSCodeBridge } from '../hooks/useVSCodeBridge';
import { useDataSource } from '../hooks/useDataSource';

interface Props {
  data: unknown;
  onChange: (next: unknown) => void;
}

const COMPONENT_MAP: Record<AntdComponentName, React.ComponentType<any>> = {
  'Input': Input,
  'Input.TextArea': Input.TextArea,
  'InputNumber': InputNumber,
  'Select': Select,
  'DatePicker': DatePicker,
  'Switch': Switch,
  'Radio.Group': Radio.Group,
  'Checkbox': Checkbox,
  'Checkbox.Group': Checkbox.Group,
  'TimePicker': TimePicker,
  'Cascader': Cascader,
  'TreeSelect': TreeSelect,
  'Upload': Upload,
  'Slider': Slider,
  'ColorPicker': ColorPicker,
  'Rate': Rate,
  'Mentions': Mentions,
  'Transfer': Transfer,
  'Tree': Tree,
};

function readFormConfig(data: unknown): FormConfigItem[] | null {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  const config = (data as any)[FORM_CONFIG_KEY];
  return Array.isArray(config) ? config : null;
}

function buildInitialValues(config: FormConfigItem[], data: unknown): Record<string, unknown> {
  const formData = getFormData(data);
  const values: Record<string, unknown> = {};
  for (const item of config) {
    if (item.keyName in formData) {
      values[item.keyName] = formData[item.keyName];
    } else if (item.defaultValue !== undefined) {
      values[item.keyName] = item.defaultValue;
    } else if (item.keyValue !== undefined) {
      values[item.keyName] = item.keyValue;
    }
  }
  return values;
}

function convertFormValues(values: Record<string, unknown>, config: FormConfigItem[]): Record<string, unknown> {
  const converted = { ...values };
  for (const item of config) {
    const val = converted[item.keyName];
    if (val === undefined || val === null) continue;
    if (item.component === 'DatePicker' && dayjs.isDayjs(val)) {
      converted[item.keyName] = val.format('YYYY-MM-DD');
    }
    if (item.component === 'TimePicker' && dayjs.isDayjs(val)) {
      converted[item.keyName] = val.format('HH:mm:ss');
    }
    if (item.component === 'ColorPicker') {
      const cv = val as any;
      converted[item.keyName] = typeof cv === 'string' ? cv : cv?.toHexString?.() ?? String(cv);
    }
  }
  return converted;
}

function hasFormDataKey(data: unknown): boolean {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return false;
  return FORM_DATA_KEY in (data as Record<string, unknown>);
}

const AntdFormItem: React.FC<{ item: FormConfigItem; form: FormInstance }> = ({ item, form }) => {
  const Component = COMPONENT_MAP[item.component];
  if (!Component) return null;

  const rules = (item.rules || []).map((r) => ({ ...r }));

  const label = (
    <span>
      {item.label}
      {item.tooltip && (
        <Tooltip title={item.tooltip}>
          <QuestionCircleOutlined style={{ marginLeft: 4, color: '#999' }} />
        </Tooltip>
      )}
    </span>
  );

  const { httpRequest } = useVSCodeBridge();
  const { options: dsOptions, loading: dsLoading, value: dsValue } = useDataSource(item.dataSource, form, httpRequest, item.component);

  // 当 dataSource 返回 value 模式的数据时，设置到表单字段
  useEffect(() => {
    if (dsValue !== undefined && item.dataSource?.mode === 'value') {
      form.setFieldsValue({ [item.keyName]: dsValue });
    }
  }, [dsValue, item.keyName, item.dataSource, form]);

  const componentProps: any = { ...(item.props || {}) };

  const mergedOptions = item.dataSource
    ? (dsOptions.length > 0 ? dsOptions : item.options ?? [])
    : item.options;

  if (dsLoading) {
    componentProps.loading = true;
  }

  if (mergedOptions) {
    if (item.component === 'TreeSelect') {
      componentProps.treeData = mergedOptions;
    } else {
      componentProps.options = mergedOptions;
    }
  }

  if (item.component === 'Upload') {
    return (
      <Form.Item
        name={item.keyName}
        label={label}
        rules={rules}
        valuePropName="fileList"
        getValueFromEvent={(e: any) => e.fileList}
        style={{ marginBottom: 8 }}
      >
        <Upload {...componentProps}>
          <Button icon={<ReloadOutlined />}>Upload</Button>
        </Upload>
      </Form.Item>
    );
  }

  if (item.component === 'ColorPicker') {
    return (
      <Form.Item
        name={item.keyName}
        label={label}
        rules={rules}
        getValueFromEvent={(color: any) => color?.toHexString?.() ?? color}
        normalize={(value: any) => {
          if (typeof value === 'string') return value;
          return value?.toHexString?.() ?? value;
        }}
        style={{ marginBottom: 8 }}
      >
        <ColorPicker {...componentProps} />
      </Form.Item>
    );
  }

  if (item.component === 'Transfer') {
    return (
      <Form.Item
        name={item.keyName}
        label={label}
        rules={rules}
        valuePropName="targetKeys"
        style={{ marginBottom: 8 }}
      >
        <Transfer
          dataSource={mergedOptions?.map((o) => ({
            key: String(o.value),
            title: String(o.label ?? o.value),
          })) ?? []}
          render={(item: any) => item.title ?? item.key}
          oneWay={componentProps.oneWay}
          showSearch={componentProps.showSearch}
          {...componentProps}
        />
      </Form.Item>
    );
  }

  if (item.component === 'Tree') {
    componentProps.treeData = componentProps.treeData ?? mergedOptions;
    return (
      <Form.Item
        name={item.keyName}
        label={label}
        rules={rules}
        valuePropName={item.valuePropName ?? 'checkedKeys'}
        style={{ marginBottom: 8 }}
      >
        <Tree checkable {...componentProps} />
      </Form.Item>
    );
  }

  if (item.component === 'DatePicker' || item.component === 'TimePicker') {
    return (
      <Form.Item
        name={item.keyName}
        label={label}
        rules={rules}
        getValueProps={(value: any) => {
          if (value === undefined || value === null) return { value: undefined };
          if (typeof value === 'string') {
            const fmt = item.component === 'TimePicker' ? 'HH:mm:ss' : undefined;
            return { value: dayjs(value, fmt) };
          }
          return { value };
        }}
        normalize={(value: any) => {
          if (dayjs.isDayjs(value)) {
            return item.component === 'TimePicker'
              ? value.format('HH:mm:ss')
              : value.format('YYYY-MM-DD');
          }
          return value;
        }}
        style={{ marginBottom: 8 }}
      >
        <Component {...componentProps} />
      </Form.Item>
    );
  }

  return (
    <Form.Item
      name={item.keyName}
      label={label}
      rules={rules}
      valuePropName={item.valuePropName}
      style={{ marginBottom: 8 }}
    >
      <Component {...componentProps} />
    </Form.Item>
  );
};

export const AntdFormView: React.FC<Props> = ({ data, onChange }) => {
  const [form] = Form.useForm();
  const config = useMemo(() => readFormConfig(data), [data]);
  const { state } = useVSCodeBridge();

  const initialValues = useMemo(() => {
    if (!config) return {};
    return buildInitialValues(config, data);
  }, [config, data]);

  if (!config) {
    return <div className="jr-empty">No formConfig found.</div>;
  }

  const handleValuesChange = (changedValues: any, allValues: any) => {
    const converted = convertFormValues(allValues, config);
    const obj = data as Record<string, unknown>;
    if (hasFormDataKey(data)) {
      onChange({
        ...obj,
        [FORM_DATA_KEY]: { ...(obj[FORM_DATA_KEY] as Record<string, unknown>), ...converted },
      });
    } else {
      const { [FORM_META_KEY]: meta, [FORM_CONFIG_KEY]: cfg, ...rest } = obj;
      const nextData: Record<string, unknown> = { ...rest, ...converted };
      if (meta !== undefined) nextData[FORM_META_KEY] = meta;
      if (cfg !== undefined) nextData[FORM_CONFIG_KEY] = cfg;
      onChange(nextData);
    }

    // 递归清理所有依赖链上的字段
    const keysToClear = new Set<string>();
    const collectDependents = (key: string) => {
      for (const item of config) {
        if (item.dataSource?.watch?.includes(key) && item.dataSource.clearOnWatchChange && !keysToClear.has(item.keyName)) {
          keysToClear.add(item.keyName);
          collectDependents(item.keyName); // 递归清理间接依赖
        }
      }
    };
    for (const changedKey of Object.keys(changedValues)) {
      collectDependents(changedKey);
    }
    if (keysToClear.size > 0) {
      const clearValues: Record<string, undefined> = {};
      for (const key of keysToClear) {
        clearValues[key] = undefined;
      }
      form.setFieldsValue(clearValues);
    }

    // Restore defaultValue for fields that are not in formData
    const defaultValues: Record<string, unknown> = {};
    for (const item of config) {
      if (item.defaultValue !== undefined && !(item.keyName in getFormData(data))) {
        defaultValues[item.keyName] = item.defaultValue;
      }
    }
    if (Object.keys(defaultValues).length > 0) {
      form.setFieldsValue(defaultValues);
    }
  };

  const hasSubmit = Boolean((data as any)?.[FORM_META_KEY]?.submit);

  const colSpan = (item: FormConfigItem) => {
    if (item.col?.span !== undefined) return item.col.span;
    const dv = item.defaultValue;
    const len = typeof dv === 'string' ? dv.length : 0;
    if (len > 50) return 24;
    if (len > 20) return 12;
    return 6;
  };
  const colOffset = (item: FormConfigItem) => item.col?.offset ?? 0;

  return (
    <div>
      <Form
        form={form}
        layout="horizontal"
        labelCol={{ style: { width: '120px', flex: '0 0 120px' } }}
        wrapperCol={{ flex: '1' }}
        initialValues={initialValues}
        onValuesChange={handleValuesChange}
        style={{ padding: '16px' }}
      >
        <Row gutter={[16, 8]}>
          {config.map((item) => (
            <Col key={item.keyName} span={colSpan(item)} offset={colOffset(item)}>
              <AntdFormItem item={item} form={form} />
            </Col>
          ))}
        </Row>
      </Form>
      {hasSubmit && (
        <SubmitBar
          data={data}
          onChange={onChange}
          initialSnapshot={buildInitialValues(config, data)}
          onReset={() => form.resetFields()}
        />
      )}
    </div>
  );
};