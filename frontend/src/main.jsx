import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { AuditDataProvider } from "./api/dataContext";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <AuditDataProvider>
      <App />
    </AuditDataProvider>
  </React.StrictMode>,
);
