import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles/index.scss";

const root = document.getElementById("root");

if (!root) {
  throw new Error("未找到根节点 #root。");
}

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
