import React from 'react';
import { createRoot } from 'react-dom/client';
import dayjs from 'dayjs';
import customParseFormat from 'dayjs/plugin/customParseFormat';
import { ConfigProvider } from 'antd';
import { App } from './App';
import cssText from './styles.css';

dayjs.extend(customParseFormat);

// 通过 text loader 把 CSS 以字符串形式注入到 head
const style = document.createElement('style');
style.textContent = cssText as unknown as string;
document.head.appendChild(style);

const container = document.getElementById('root');
if (container) {
  createRoot(container).render(
    <ConfigProvider theme={{ hashed: false }}>
      <App />
    </ConfigProvider>
  );
}
