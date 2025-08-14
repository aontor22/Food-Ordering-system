import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import './index.css';
import App from './app.jsx';           // default export

const root = ReactDOM.createRoot(document.getElementById('root')); // ✅ matches index.html
root.render(
  <BrowserRouter>
    <App />
  </BrowserRouter>
);
