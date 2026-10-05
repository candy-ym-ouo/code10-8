import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App } from './app/App';
import { AppProviders } from './app/providers';
import './styles/tokens.css';
import './styles/base.css';
import './styles/app.css';

const root = document.getElementById('root');
if (!root) throw new Error('缺少 #root 挂载点');

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <BrowserRouter>
      <AppProviders>
        <App />
      </AppProviders>
    </BrowserRouter>
  </React.StrictMode>,
);

