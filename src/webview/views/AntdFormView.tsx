import React, { useMemo } from 'react';
import { Form, Row, Col, Input, InputNumber, Select, DatePicker, Switch, Radio, Checkbox, TimePicker, Cascader, TreeSelect, Upload, Button, Tooltip } from 'antd';
import { QuestionCircleOutlined, ReloadOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { FormConfigItem, AntdComponentName } from './formConfigTypes';
import { SubmitBar, FORM_META_KEY } from './SubmitBar';
import { useVSCodeBridge } from '../hooks/useVSCodeBridge';

const FORM_CONFIG_KEY = 'formConfig';

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
};

function readFormConfig(data: unknown): FormConfigItem[] | null {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  const config = (data as any)[FORM_CONFIG_KEY];
  return Array.isArray(config) ? config : null;
}

function buildInitialValues(config: FormConfigItem[]): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  for (const item of config) {
    values[item.keyName] = item.keyValue;
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
  }
  return converted;
}

const AntdFormItem: React.FC<{ item: FormConfigItem }> = ({ item }) => {
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

  const componentProps: any = { ...(item.props || {}) };

  if (item.options) {
    if (item.component === 'TreeSelect') {
      componentProps.treeData = item.options;
    } else {
      componentProps.options = item.options;
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
      >
        <Upload {...componentProps}>
          <Button icon={<ReloadOutlined />}>Upload</Button>
        </Upload>
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
    return buildInitialValues(config);
  }, [config]);

  if (!config) {
    return <div className="jr-empty">No formConfig found.</div>;
  }

  const handleValuesChange = (changedValues: any, allValues: any) => {
    const converted = convertFormValues(allValues, config);
    const { [FORM_META_KEY]: _meta, [FORM_CONFIG_KEY]: _config, ...rest } = (data as Record<string, unknown>) || {};
    const nextData = { ...rest, ...converted };
    if ((data as any)?.[FORM_META_KEY]) {
      (nextData as any)[FORM_META_KEY] = (data as any)[FORM_META_KEY];
    }
    if ((data as any)?.[FORM_CONFIG_KEY]) {
      (nextData as any)[FORM_CONFIG_KEY] = (data as any)[FORM_CONFIG_KEY];
    }
    onChange(nextData);
  };

  const hasSubmit = Boolean((data as any)?.[FORM_META_KEY]?.submit);

  const colSpan = (item: FormConfigItem) => item.col?.span ?? 24;
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
        <Row gutter={[16, 16]}>
          {config.map((item) => (
            <Col key={item.keyName} span={colSpan(item)} offset={colOffset(item)}>
              <AntdFormItem item={item} />
            </Col>
          ))}
        </Row>
      </Form>
      {hasSubmit && (
        <SubmitBar
          data={data}
          onChange={onChange}
          initialSnapshot={buildInitialValues(config)}
          onReset={() => form.resetFields()}
        />
      )}
    </div>
  );
};
