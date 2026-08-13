/// <reference types="vite/client" />

/** `?inline` imports come back as base64 data URIs. */
declare module '*.pdf?inline' {
  const src: string;
  export default src;
}
