/// <reference types="vite/client" />

/** 允许 TypeScript 将 Vue 单文件组件作为模块导入。 */
declare module "*.vue" {
  import type { DefineComponent } from "vue";
  const component: DefineComponent<{}, {}, any>;
  export default component;
}
