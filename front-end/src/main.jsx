import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import './index.css';
import App from './app.jsx';           // default export
import StoreContextProvider from './context/StoreContext.jsx';

const root = ReactDOM.createRoot(document.getElementById('root')); // ✅ matches index.html
root.render(
  <BrowserRouter>
    <StoreContextProvider>
      <App />
    </StoreContextProvider>
  </BrowserRouter>
);
